// Small shared helpers: profile storage, API calls, toasts, modals, formatting.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const COLORS = ['#f5c400', '#ff6b6b', '#4ecdc4', '#6c8cff', '#c77dff', '#ff9f43', '#7bd88f', '#ff7eb6'];
const ADJ = ['Neon', 'Velvet', 'Cosmic', 'Midnight', 'Golden', 'Quiet', 'Electric', 'Lucky'];
const NOUN = ['Falcon', 'Otter', 'Comet', 'Panda', 'Raven', 'Lynx', 'Koala', 'Fox'];

function ls(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* storage unavailable */ }
  return null;
}

let profile = ls('astral.profile');
if (!profile || !profile.clientId) {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  profile = {
    clientId: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24),
    name: `${rnd(ADJ)} ${rnd(NOUN)}`,
    color: rnd(COLORS),
    seat: null,
    named: false
  };
  ls('astral.profile', profile);
}
export const getProfile = () => profile;
export function saveProfile(patch) { profile = { ...profile, ...patch }; ls('astral.profile', profile); return profile; }

export async function api(path, opts) {
  const res = await fetch(path, opts && opts.body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : undefined);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}
let moviesCache = null;
export async function getMovies() { return (moviesCache ||= await api('/api/movies')); }
export const movieById = (id) => (moviesCache || []).find((m) => m.id === id);

export async function createParty({ movieId = null, scheduledFor = null, isPublic = true, everyoneControls = false } = {}) {
  const { code } = await api('/api/rooms', { body: { movieId, scheduledFor, isPublic, everyoneControls } });
  location.hash = `#/room/${code}`;
}

/* ---- toast ---- */
let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---- modal ---- */
export function modal(html, { wide = false, onClose = null } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="scrim"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="x" aria-label="Close">✕</button>${html}</div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc_); onClose && onClose(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  root.querySelector('.scrim').addEventListener('mousedown', (e) => { if (e.target.classList.contains('scrim')) close(); });
  root.querySelector('.x').addEventListener('click', close);
  return { el: root.querySelector('.modal'), close };
}

/* ---- formatting ---- */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}
export const stars = (r) => {
  const full = Math.round(r);
  return `<span class="stars" aria-label="${r} out of 5">${'★'.repeat(full)}<i>${'★'.repeat(5 - full)}</i></span>`;
};
export const pad2 = (n) => String(n).padStart(2, '0');
export function whenLabel(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
