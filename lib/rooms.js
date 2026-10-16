'use strict';
/**
 * Room state. Pure logic with no networking, so it is easy to read and test.
 *
 * Playback model (the heart of the sync):
 *   playback = { source, playing, pos, at, rev, nonce }
 *   - pos is the video position in seconds at the SERVER time `at` (ms).
 *   - While playing, the true position at server time T is pos + (T - at)/1000.
 *   - Clients estimate the server clock offset (NTP style), compute the expected position
 *     themselves and correct their local player when it drifts (see public/js/room.js).
 */
const crypto = require('crypto');
const { findMovie } = require('../data/movies');

const SEAT_ROWS = [9, 9, 10, 10, 11, 11, 12]; // matches public/js/seatmap.js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CHAT_HISTORY = 100;
const MAX_QUEUE = 40;
const MAX_POLLS = 20;
const GRACE_MS = 25000; // keep a dropped member's seat while they reconnect

const rid = () => crypto.randomBytes(5).toString('hex');
function newCode() {
  let s = '';
  for (const b of crypto.randomBytes(5)) s += ALPHABET[b % ALPHABET.length];
  return s;
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i;

/** Turn a pasted URL into a playable source, or null. */
function sourceFromUrl(url, title) {
  url = String(url || '').trim();
  const yt = url.match(YT_RE);
  if (yt) return { kind: 'youtube', ytId: yt[1], title: clean(title, 80) || 'YouTube video' };
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return { kind: 'file', url: u.toString(), title: clean(title, 80) || decodeURIComponent(u.pathname.split('/').pop() || 'Video') };
    }
  } catch { /* not a URL */ }
  return null;
}

function sourceFromMovie(m) {
  if (!m) return null;
  return { kind: m.source.kind, url: m.source.url, alt: m.source.alt, ytId: m.source.ytId, title: m.title, movieId: m.id };
}

class Room {
  constructor({ movieId = null, scheduledFor = null, isPublic = true, everyoneControls = false } = {}) {
    this.code = newCode();
    this.createdAt = Date.now();
    this.emptySince = Date.now();
    this.hostId = null;
    this.settings = { everyoneControls: !!everyoneControls, isPublic: !!isPublic };
    this.scheduledFor = scheduledFor || null;
    this.members = new Map(); // clientId -> member
    this.chat = [];
    this.queue = [];
    this.polls = [];
    this.playback = {
      source: sourceFromMovie(findMovie(movieId)),
      playing: false, pos: 0, at: Date.now(), rev: 0, nonce: 1
    };
  }

  /* ---------- playback ---------- */
  position(now = Date.now()) {
    const p = this.playback;
    return p.playing ? Math.max(0, p.pos + (now - p.at) / 1000) : p.pos;
  }
  setPlayback({ playing, pos }, now = Date.now()) {
    const p = this.playback;
    p.playing = playing ?? p.playing;
    p.pos = Math.max(0, Number.isFinite(pos) ? pos : this.position(now));
    p.at = now;
    p.rev++;
  }
  setSource(source, autoplay = true, now = Date.now()) {
    const p = this.playback;
    p.source = source;
    p.nonce++;
    p.playing = !!autoplay && !!source;
    p.pos = 0;
    p.at = now;
    p.rev++;
  }
  playbackView(now = Date.now()) {
    return { ...this.playback, serverNow: now };
  }
  canControl(id) { return id === this.hostId || this.settings.everyoneControls; }

  /** Called when a video finishes. Returns true when the room moved on. */
  ended(nonce) {
    if (nonce !== this.playback.nonce) return false;
    if (!this.playback.playing) return false;
    if (this.queue.length) {
      const next = this.nextInQueue();
      this.queue = this.queue.filter((q) => q.id !== next.id);
      this.setSource(next.source, true);
    } else {
      this.setPlayback({ playing: false, pos: this.playback.pos });
    }
    return true;
  }
  nextInQueue() {
    // Most votes first; ties keep insertion order.
    return this.queue.reduce((best, q) => (!best || q.votes.length > best.votes.length ? q : best), null);
  }

  /* ---------- members & seats ---------- */
  seatFree(r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= SEAT_ROWS.length || c < 0 || c >= SEAT_ROWS[r]) return false;
    for (const m of this.members.values()) if (m.seat && m.seat.r === r && m.seat.c === c) return false;
    return true;
  }
  bestSeat() {
    // Nearest to the middle of the middle rows.
    const mid = (SEAT_ROWS.length - 1) / 2 + 0.5;
    const options = [];
    SEAT_ROWS.forEach((n, r) => {
      for (let c = 0; c < n; c++) options.push({ r, c, score: Math.abs(r - mid) * 1.6 + Math.abs(c - (n - 1) / 2) + Math.random() * 0.4 });
    });
    options.sort((a, b) => a.score - b.score);
    const o = options.find((s) => this.seatFree(s.r, s.c));
    return o ? { r: o.r, c: o.c } : null;
  }

  addMember(id, { name, color }, pref) {
    let m = this.members.get(id);
    const isNew = !m;
    if (isNew) {
      m = { id, name: 'Guest', color: '#f5c400', seat: null, conn: null, connected: true, joinedAt: Date.now(), timer: null };
      this.members.set(id, m);
    }
    m.name = clean(name, 24) || m.name;
    if (/^#[0-9a-f]{6}$/i.test(color || '')) m.color = color;
    m.connected = true;
    clearTimeout(m.timer);
    if (!m.seat) {
      if (pref && this.seatFree(pref.r, pref.c)) m.seat = { r: pref.r, c: pref.c };
      else m.seat = this.bestSeat();
    }
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = id;
    this.emptySince = null;
    return { member: m, isNew };
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return null;
    clearTimeout(m.timer);
    this.members.delete(id);
    let newHost = null;
    if (this.hostId === id) {
      const next = [...this.members.values()].filter((x) => x.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0]
        || [...this.members.values()][0];
      this.hostId = next ? next.id : null;
      newHost = next || null;
    }
    if (this.members.size === 0) this.emptySince = Date.now();
    return { member: m, newHost };
  }

  takeSeat(id, r, c) {
    const m = this.members.get(id);
    if (!m || !this.seatFree(r, c)) return false;
    m.seat = { r, c };
    return true;
  }

  connectedCount() { let n = 0; for (const m of this.members.values()) if (m.connected) n++; return n; }

  /* ---------- chat / queue / polls ---------- */
  addChat(entry) {
    const e = { id: rid(), ts: Date.now(), ...entry };
    this.chat.push(e);
    if (this.chat.length > MAX_CHAT_HISTORY) this.chat.shift();
    return e;
  }

  addQueue(source, by) {
    if (this.queue.length >= MAX_QUEUE) return null;
    const item = { id: rid(), source, title: source.title, addedBy: by.name, addedById: by.id, votes: [by.id] };
    this.queue.push(item);
    return item;
  }

  createPoll(by, question, options) {
    question = clean(question, 120);
    options = (options || []).map((o) => clean(o, 60)).filter(Boolean).slice(0, 6);
    if (!question || options.length < 2) return null;
    if (this.polls.length >= MAX_POLLS) this.polls.shift();
    const poll = { id: rid(), question, options: options.map((text) => ({ text, voters: [] })), by: by.name, byId: by.id, closed: false, ts: Date.now() };
    this.polls.push(poll);
    return poll;
  }
  votePoll(id, pollId, idx) {
    const poll = this.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed || !poll.options[idx]) return null;
    poll.options.forEach((o) => { o.voters = o.voters.filter((v) => v !== id); });
    poll.options[idx].voters.push(id);
    return poll;
  }

  /* ---------- views sent to clients ---------- */
  meta() {
    return {
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      scheduledFor: this.scheduledFor,
      members: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, seat: m.seat, connected: m.connected }))
    };
  }
  queueView() { return this.queue.map((q) => ({ id: q.id, title: q.title, source: q.source, addedBy: q.addedBy, votes: q.votes.length, voters: q.votes })); }
  pollsView() { return this.polls.map((p) => ({ ...p, options: p.options.map((o) => ({ text: o.text, voters: o.voters })) })); }
  summary() {
    const host = this.members.get(this.hostId);
    return {
      code: this.code,
      title: this.playback.source ? this.playback.source.title : null,
      movieId: this.playback.source ? this.playback.source.movieId || null : null,
      playing: this.playback.playing,
      count: this.connectedCount(),
      host: host ? host.name : null,
      scheduledFor: this.scheduledFor
    };
  }
}

module.exports = { Room, SEAT_ROWS, GRACE_MS, sourceFromUrl, sourceFromMovie, clean };
