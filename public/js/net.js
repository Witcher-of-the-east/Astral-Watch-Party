// WebSocket client: request/ack helper, auto-reconnect, and an NTP-style server clock estimate.
import { estimateClock } from './sync.js';

export const clock = { offset: 0, rtt: null };
export const serverNow = () => Date.now() + clock.offset;

const listeners = new Map(); // type -> Set<fn>
const statusListeners = new Set();
let ws = null;
let nextId = 1;
const pending = new Map();
let retry = 0;
let samples = [];
let pingTimer = null;
export let online = false;

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
const emitStatus = () => statusListeners.forEach((f) => f(online));

function sample() {
  if (!online) return;
  const t0 = performance.now(), w0 = Date.now();
  request('ping', {}, 3000).then((ts) => {
    const rtt = performance.now() - t0;
    samples.push({ rtt, off: ts - (w0 + rtt / 2) });
    if (samples.length > 10) samples.shift();
    Object.assign(clock, estimateClock(samples));
  }).catch(() => {});
}

export function connect() {
  if (ws && ws.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    online = true; retry = 0; samples = [];
    emitStatus();
    for (let i = 0; i < 5; i++) setTimeout(sample, i * 180); // quick burst for an early good estimate
    clearInterval(pingTimer);
    pingTimer = setInterval(sample, 4000);
    (listeners.get('open') || []).forEach((f) => f());
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.ack != null) { const p = pending.get(m.ack); if (p) { pending.delete(m.ack); clearTimeout(p.timer); p.resolve(m.d); } return; }
    (listeners.get(m.t) || []).forEach((f) => f(m.d));
  };
  ws.onclose = () => {
    online = false; emitStatus();
    clearInterval(pingTimer);
    pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('disconnected')); });
    pending.clear();
    const wait = Math.min(5000, 400 * 2 ** retry++);
    setTimeout(connect, wait);
  };
  ws.onerror = () => {};
}

export function send(t, d = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t, d }));
}

export function request(t, d = {}, timeout = 6000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('offline'));
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ t, id, d }));
  });
}
