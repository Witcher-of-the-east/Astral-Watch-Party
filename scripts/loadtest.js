'use strict';
/**
 * Load + latency test. Starts the server in-process, joins N bot clients to one room, then:
 *   1. Control propagation: the host sends play/pause/seek commands; every bot measures
 *      (receive time - host send time). Both run on one machine / one clock, so this is the
 *      server + WebSocket cost, without internet latency.
 *   2. Drift: each bot simulates a video player (random start error and a slightly wrong playback
 *      speed) running the same correction logic as the browser (public/js/sync.js), and we report
 *      how far each simulated player is from the true position after correction kicks in.
 *
 *   node scripts/loadtest.js [clients=25] [commands=60]
 */
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');

const N = Number(process.argv[2]) || 25;
const COMMANDS = Number(process.argv[3]) || 60;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

class Bot {
  constructor(port, i) {
    this.i = i; this.id = `bot-${i}-${Math.random().toString(36).slice(2, 8)}`;
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.nextId = 1; this.acks = new Map(); this.handlers = {};
    this.ready = new Promise((res) => { this.ws.onopen = res; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.ack != null) { const f = this.acks.get(m.ack); if (f) { this.acks.delete(m.ack); f(m.d); } return; }
      const h = this.handlers[m.t]; if (h) h(m.d, Date.now());
    };
  }
  req(t, d) { return new Promise((res) => { const id = this.nextId++; this.acks.set(id, res); this.ws.send(JSON.stringify({ t, id, d })); }); }
  on(t, f) { this.handlers[t] = f; }
}

(async () => {
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const sync = await import(pathToFileURL(path.join(__dirname, '../public/js/sync.js')).href);

  const { code } = await post(port, '/api/rooms', { movieId: 'big-buck-bunny', everyoneControls: false });
  const bots = Array.from({ length: N }, (_, i) => new Bot(port, i));
  await Promise.all(bots.map((b) => b.ready));
  const joins = await Promise.all(bots.map((b, i) => b.req('join', { code, clientId: b.id, name: `Bot ${i}` })));
  const failed = joins.filter((j) => !j.ok).length;
  const seated = joins.filter((j, i) => true).length;
  const host = bots[0];

  // ---- 1. control propagation latency
  const lat = [];
  const sentAt = new Map();
  bots.slice(1).forEach((b) => b.on('pb', (pb, recv) => {
    if (pb.tick || pb.sentAt == null) return;
    lat.push(recv - pb.sentAt);
  }));
  const actions = ['play', 'pause', 'seek'];
  for (let i = 0; i < COMMANDS; i++) {
    const action = actions[i % 3];
    await host.req('ctl', { action, pos: 10 + i, sentAt: Date.now() });
    await sleep(25);
  }
  await sleep(300);

  // ---- 2. drift after correction, simulated players using the real correction maths
  await host.req('ctl', { action: 'seek', pos: 0, sentAt: Date.now() });
  await host.req('ctl', { action: 'play', pos: 0, sentAt: Date.now() });
  const players = bots.map((b, i) => {
    const p = { pb: null, t: 0, rate: 1, speed: 1 + (Math.random() - 0.5) * 0.02, lastSeek: 0 };
    b.on('pb', (pb) => { p.pb = pb; });
    return p;
  });
  await sleep(200);
  const STEP = 100; // ms simulation step
  const drifts = [];
  const start = Date.now();
  // Give every simulated player a random starting error up to +/-4 s (late joiner / buffering).
  players.forEach((p) => { p.t = sync.expectedPos(p.pb, Date.now()) + (Math.random() - 0.5) * 8; });
  let last = Date.now();
  while (Date.now() - start < 12000) {
    await sleep(STEP);
    const now = Date.now(); const dt = (now - last) / 1000; last = now;
    players.forEach((p) => {
      p.t += dt * p.rate * p.speed;
      if (Math.floor((now - start) / 250) !== Math.floor((now - STEP - start) / 250)) { // reconcile loop @ 4 Hz
        const exp = sync.expectedPos(p.pb, now);
        const drift = p.t - exp;
        const act = sync.plan({ drift, playing: true, canNudge: true });
        if (act.seek && now - p.lastSeek > 1200) { p.t = exp; p.lastSeek = now; }
        p.rate = act.rate;
      }
      if (now - start > 4000) drifts.push(Math.abs(p.t - sync.expectedPos(p.pb, now)) * 1000);
    });
  }

  const row = (name, arr, unit = 'ms') => `${name.padEnd(28)} p50 ${pct(arr, 50).toFixed(1)}${unit}   p95 ${pct(arr, 95).toFixed(1)}${unit}   p99 ${pct(arr, 99).toFixed(1)}${unit}   max ${Math.max(...arr).toFixed(1)}${unit}`;
  console.log(`\nClients joined: ${N - failed}/${N}   room ${code}   seats taken: ${seated}`);
  console.log(`Commands sent: ${COMMANDS}   deliveries measured: ${lat.length} (${N - 1} listeners each)`);
  console.log(row('Control propagation latency', lat));
  console.log(row('Drift after correction', drifts));
  console.log(`(drift sampled from t=4s of a 12s run; players start up to ±4 s off and run ±1% fast/slow)\n`);

  bots.forEach((b) => b.ws.close());
  const ok = pct(lat, 95) <= 250 && pct(drifts, 95) <= 500 && failed === 0;
  console.log(ok ? 'PASS: p95 propagation ≤ 250 ms and p95 drift ≤ 500 ms' : 'FAIL: a target was missed');
  process.exit(ok ? 0 : 1);
})();
