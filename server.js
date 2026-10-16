'use strict';
/**
 * Astral Watch Party server: static files + tiny REST API + WebSocket room protocol.
 * Zero dependencies. Run with:  node server.js   (PORT env var optional)
 *
 * WebSocket protocol (JSON text frames)
 *   client -> server : { t: 'type', id?: number, d: {...} }      (id => the server answers with an ack)
 *   server -> client : { ack: id, d: result }  or  { t: 'type', d: {...} }
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./lib/ws');
const { Room, GRACE_MS, sourceFromUrl, sourceFromMovie, clean } = require('./lib/rooms');
const { movies, findMovie } = require('./data/movies');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map(); // code -> Room
const allConns = new Set();

/* ------------------------------------------------------------------ HTTP */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2'
};

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(s);
}

function readBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) { // needed so <video> can seek
      let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
      if (!(start >= 0) || end >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];
  try {
    if (url === '/api/movies') return json(res, 200, movies);
    if (url === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });
    if (url === '/api/live') {
      const live = [...rooms.values()].filter((r) => r.settings.isPublic && r.connectedCount() > 0).map((r) => r.summary());
      return json(res, 200, live);
    }
    if (url === '/api/rooms' && req.method === 'POST') {
      const b = await readBody(req);
      const movie = b.movieId ? findMovie(b.movieId) : null;
      const sched = Number(b.scheduledFor);
      const room = new Room({
        movieId: movie ? movie.id : null,
        scheduledFor: sched > Date.now() ? sched : null,
        isPublic: b.isPublic !== false,
        everyoneControls: !!b.everyoneControls
      });
      rooms.set(room.code, room);
      return json(res, 201, { code: room.code });
    }
    const m = url.match(/^\/api\/rooms\/([A-Za-z0-9]{3,10})$/);
    if (m) {
      const room = rooms.get(m[1].toUpperCase());
      return room ? json(res, 200, room.summary()) : json(res, 404, { error: 'Room not found' });
    }
    serveStatic(req, res);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Server error' });
  }
});

/* ------------------------------------------------------------ WebSocket */
function send(conn, t, d) { conn.send(JSON.stringify({ t, d })); }

function broadcast(room, t, d) {
  const msg = JSON.stringify({ t, d });
  for (const m of room.members.values()) if (m.conn) m.conn.send(msg);
}
const pushMeta = (room) => broadcast(room, 'meta', room.meta());
const pushPlayback = (room, extra = {}) => broadcast(room, 'pb', { ...room.playbackView(), ...extra });
const pushQueue = (room) => broadcast(room, 'queue', room.queueView());
const pushPolls = (room) => broadcast(room, 'polls', room.pollsView());
function sys(room, text) { broadcast(room, 'chat', room.addChat({ sys: true, text })); }

/** Per-connection token bucket so one client cannot flood a room. */
function allow(ctx) {
  const now = Date.now();
  ctx.tokens = Math.min(12, (ctx.tokens ?? 12) + ((now - (ctx.tokenAt || now)) / 1000) * 3);
  ctx.tokenAt = now;
  if (ctx.tokens < 1) return false;
  ctx.tokens -= 1;
  return true;
}

function leaveRoom(ctx, explicit) {
  const { room, member } = ctx;
  if (!room || !member) return;
  ctx.room = null; ctx.member = null;
  if (member.conn !== ctx.conn) return; // taken over by a newer connection
  member.conn = null;
  member.connected = false;
  if (member.inVoice) {
    member.inVoice = false;
    member.speaking = false;
    broadcast(room, 'voice_state', { id: member.id, inVoice: false, muted: false, speaking: false });
  }
  const finish = () => {
    const r = room.removeMember(member.id);
    if (!r) return;
    sys(room, `${member.name} left`);
    if (r.newHost) sys(room, `${r.newHost.name} is now the host`);
    pushMeta(room);
  };
  if (explicit) finish();
  else { member.timer = setTimeout(finish, GRACE_MS); pushMeta(room); } // keep the seat for a few seconds
}

const HANDLERS = {
  ping(ctx, d, ack) { ack(Date.now()); },

  join(ctx, d, ack) {
    const room = rooms.get(String(d.code || '').toUpperCase());
    if (!room) return ack({ ok: false, error: 'Room not found. Check the code.' });
    const id = clean(d.clientId, 40);
    if (id.length < 6) return ack({ ok: false, error: 'Bad client id' });
    if (ctx.room) leaveRoom(ctx, true);
    const { member, isNew } = room.addMember(id, { name: d.name, color: d.color }, d.seat);
    if (member.conn && member.conn !== ctx.conn) { // same person opened a second tab: newest wins
      send(member.conn, 'kicked', { reason: 'You joined this room from another tab.' });
      member.conn.onclose = null; member.conn.close();
    }
    member.conn = ctx.conn;
    ctx.room = room; ctx.member = member;
    if (isNew) sys(room, `${member.name} joined`);
    ack({
      ok: true, you: id, meta: room.meta(), playback: room.playbackView(),
      chat: room.chat, queue: room.queueView(), polls: room.pollsView()
    });
    pushMeta(room);
  },

  leave(ctx) { leaveRoom(ctx, true); },

  profile(ctx, d) {
    const { room, member } = ctx; if (!room) return;
    member.name = clean(d.name, 24) || member.name;
    if (/^#[0-9a-f]{6}$/i.test(d.color || '')) member.color = d.color;
    pushMeta(room);
  },

  seat(ctx, d, ack) {
    const { room, member } = ctx; if (!room) return;
    const ok = room.takeSeat(member.id, d.r, d.c);
    ack({ ok });
    if (ok) pushMeta(room);
  },

  chat(ctx, d) {
    const { room, member } = ctx; if (!room || !allow(ctx)) return;
    const text = clean(d.text, 300);
    if (!text) return;
    broadcast(room, 'chat', room.addChat({ from: member.id, name: member.name, color: member.color, text }));
  },

  react(ctx, d) {
    const { room, member } = ctx; if (!room || !allow(ctx)) return;
    const emoji = String(d.emoji || '').slice(0, 8);
    if (emoji) broadcast(room, 'react', { from: member.id, emoji });
  },

  ctl(ctx, d, ack) {
    const { room, member } = ctx; if (!room) return;
    if (!room.canControl(member.id)) return ack({ ok: false, error: 'Only the host can control playback.' });
    if (!room.playback.source) return ack({ ok: false, error: 'Pick something to watch first.' });
    const now = Date.now();
    const pos = Number(d.pos);
    if (d.action === 'play') room.setPlayback({ playing: true, pos: Number.isFinite(pos) ? pos : room.position(now) }, now);
    else if (d.action === 'pause') room.setPlayback({ playing: false, pos: Number.isFinite(pos) ? pos : room.position(now) }, now);
    else if (d.action === 'seek') room.setPlayback({ pos: Number.isFinite(pos) ? pos : 0 }, now);
    else return ack({ ok: false, error: 'Unknown action' });
    pushPlayback(room, { by: member.id, sentAt: d.sentAt });
    ack({ ok: true });
  },

  source(ctx, d, ack) {
    const { room, member } = ctx; if (!room) return;
    if (!room.canControl(member.id)) return ack({ ok: false, error: 'Only the host can change the video.' });
    const src = d.movieId ? sourceFromMovie(findMovie(d.movieId)) : sourceFromUrl(d.url, d.title);
    if (!src) return ack({ ok: false, error: 'That does not look like a YouTube link or a direct video URL.' });
    room.setSource(src, true);
    pushPlayback(room, { by: member.id });
    sys(room, `${member.name} started "${src.title}"`);
    ack({ ok: true });
  },

  qadd(ctx, d, ack) {
    const { room, member } = ctx; if (!room || !allow(ctx)) return;
    const src = d.movieId ? sourceFromMovie(findMovie(d.movieId)) : sourceFromUrl(d.url, d.title);
    if (!src) return ack({ ok: false, error: 'That does not look like a YouTube link or a direct video URL.' });
    if (!room.addQueue(src, member)) return ack({ ok: false, error: 'The queue is full.' });
    pushQueue(room);
    ack({ ok: true });
  },
  qrm(ctx, d) {
    const { room, member } = ctx; if (!room) return;
    const q = room.queue.find((x) => x.id === d.id);
    if (!q || (q.addedById !== member.id && room.hostId !== member.id)) return;
    room.queue = room.queue.filter((x) => x.id !== d.id);
    pushQueue(room);
  },
  qvote(ctx, d) {
    const { room, member } = ctx; if (!room) return;
    const q = room.queue.find((x) => x.id === d.id);
    if (!q) return;
    q.votes = q.votes.includes(member.id) ? q.votes.filter((v) => v !== member.id) : [...q.votes, member.id];
    pushQueue(room);
  },
  qplay(ctx, d, ack) {
    const { room, member } = ctx; if (!room) return;
    if (!room.canControl(member.id)) return ack({ ok: false, error: 'Only the host can do that.' });
    const q = room.queue.find((x) => x.id === d.id);
    if (!q) return ack({ ok: false });
    room.queue = room.queue.filter((x) => x.id !== d.id);
    room.setSource(q.source, true);
    pushPlayback(room, { by: member.id });
    pushQueue(room);
    sys(room, `${member.name} started "${q.title}"`);
    ack({ ok: true });
  },

  ended(ctx, d) {
    const { room } = ctx; if (!room) return;
    if (room.ended(d.nonce)) {
      pushPlayback(room);
      pushQueue(room);
      if (room.playback.playing) sys(room, `Up next: "${room.playback.source.title}"`);
    }
  },

  pollnew(ctx, d, ack) {
    const { room, member } = ctx; if (!room || !allow(ctx)) return;
    const poll = room.createPoll(member, d.question, d.options);
    if (!poll) return ack({ ok: false, error: 'A poll needs a question and at least two options.' });
    pushPolls(room);
    sys(room, `${member.name} started a poll: ${poll.question}`);
    ack({ ok: true });
  },
  pollvote(ctx, d) {
    const { room, member } = ctx; if (!room) return;
    if (room.votePoll(member.id, d.id, d.idx)) pushPolls(room);
  },
  pollclose(ctx, d) {
    const { room, member } = ctx; if (!room) return;
    const p = room.polls.find((x) => x.id === d.id);
    if (!p || (p.byId !== member.id && room.hostId !== member.id)) return;
    p.closed = true;
    pushPolls(room);
  },

  transfer(ctx, d, ack) {
    const { room, member } = ctx; if (!room) return;
    if (room.hostId !== member.id) return ack({ ok: false, error: 'Only the host can transfer hosting.' });
    const to = room.members.get(d.to);
    if (!to || !to.connected) return ack({ ok: false, error: 'That person is not here.' });
    room.hostId = to.id;
    sys(room, `${member.name} made ${to.name} the host`);
    pushMeta(room);
    ack({ ok: true });
  },

  settings(ctx, d) {
    const { room, member } = ctx; if (!room || room.hostId !== member.id) return;
    if (typeof d.everyoneControls === 'boolean') room.settings.everyoneControls = d.everyoneControls;
    if (typeof d.isPublic === 'boolean') room.settings.isPublic = d.isPublic;
    if (typeof d.ambience === 'string') room.settings.ambience = d.ambience;
    if (typeof d.audioEnabled === 'boolean') room.settings.audioEnabled = d.audioEnabled;
    pushMeta(room);
  },

  dismiss(ctx, d, ack) {
    const { room, member } = ctx; if (!room || !member) return;
    if (room.hostId !== member.id) return ack({ ok: false, error: 'Only the host can dismiss the room.' });
    broadcast(room, 'dismissed', { by: member.name });
    rooms.delete(room.code);
    for (const m of room.members.values()) {
      clearTimeout(m.timer);
      if (m.conn) m.conn = null;
    }
    room.members.clear();
    ctx.room = null; ctx.member = null;
    ack({ ok: true });
  },

  voice_state(ctx, d) {
    const { room, member } = ctx; if (!room || !member) return;
    if (typeof d.inVoice === 'boolean') member.inVoice = d.inVoice;
    if (typeof d.muted === 'boolean') member.voiceMuted = d.muted;
    if (typeof d.speaking === 'boolean') member.speaking = d.speaking;
    broadcast(room, 'voice_state', {
      id: member.id,
      inVoice: !!member.inVoice,
      muted: !!member.voiceMuted,
      speaking: !!member.speaking
    });
  },

  voice_signal(ctx, d) {
    const { room, member } = ctx; if (!room || !member || !d.to || !d.signal) return;
    const target = room.members.get(d.to);
    if (target && target.conn && target.connected) {
      send(target.conn, 'voice_signal', {
        from: member.id,
        signal: d.signal
      });
    }
  }
};

attach(server, (conn) => {
  const ctx = { conn, room: null, member: null };
  allConns.add(conn);
  conn.onmessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const h = HANDLERS[msg && msg.t];
    if (!h) return;
    const ack = (d) => { if (msg.id != null) conn.send(JSON.stringify({ ack: msg.id, d })); };
    try { h(ctx, msg.d || {}, ack); } catch (e) { console.error('handler error', msg.t, e); }
  };
  conn.onclose = () => { allConns.delete(conn); leaveRoom(ctx, false); };
});

// Heartbeat: close sockets that stopped answering.
server.on('ws-heartbeat', () => {
  for (const c of allConns) {
    if (!c.alive) { c.close(1001); continue; }
    c.alive = false; c.ping();
  }
});

// Drift-correction ticks: every 2 s, tell each playing room where "now" is.
setInterval(() => {
  for (const room of rooms.values()) if (room.playback.playing && room.connectedCount()) pushPlayback(room, { tick: true });
}, 2000).unref();

// Forget rooms nobody has used for 10 minutes.
setInterval(() => {
  for (const [code, room] of rooms) if (room.emptySince && Date.now() - room.emptySince > 600000) rooms.delete(code);
}, 60000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  Astral Watch Party running → http://localhost:${PORT}\n`);
  });
}
module.exports = { server, rooms };
