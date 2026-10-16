// App shell: header, side menu, search overlay, profile, and the hash router.
import { renderHome } from './home.js';
import { renderDetail } from './detail.js';
import { renderBrowse } from './browse.js';
import { renderRoom } from './room.js';
import { searchMovies } from './search.js';
import { poster } from './art.js';
import * as net from './net.js';
import { $, esc, api, getMovies, getProfile, saveProfile, modal, toast, createParty, COLORS } from './util.js';

const app = $('#app');
let dispose = null;
let token = 0;
let roomInfo = null;

/* ------------------------------------------------------------ router */
async function route() {
  const my = ++token;
  if (dispose) { try { await dispose(); } catch (e) { console.error(e); } dispose = null; }
  closeDrawer();
  const [, page, arg] = (location.hash.replace(/^#/, '') || '/').split('/');
  document.body.dataset.page = page || 'home';
  window.scrollTo(0, 0);
  app.innerHTML = '<div class="loading"><i></i></div>';
  let d = null;
  try {
    app.innerHTML = '';
    if (!page) d = await renderHome(app);
    else if (page === 'movie') d = await renderDetail(app, arg);
    else if (page === 'browse') d = await renderBrowse(app, { query: sessionStorage.getItem('astral.q') || '' });
    else if (page === 'room') d = await renderRoom(app, arg || '', { onRoom: setRoomInfo });
    else app.innerHTML = '<div class="empty big"><h2>Page not found</h2><a class="btn-y" href="#/">Back to the cinema</a></div>';
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty big"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn-y" href="#/">Back to the cinema</a></div>`;
  }
  sessionStorage.removeItem('astral.q');
  if (my !== token) { if (d) d(); return; }
  dispose = d;
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ header */
const onScroll = () => document.querySelector('.top').classList.toggle('solid', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
function setRoomInfo(info) { roomInfo = info; paintCenter(); }
let liveCount = 0;
function paintCenter() {
  const c = $('#hc');
  if (roomInfo) c.innerHTML = `<b>Room ${esc(roomInfo.code)}</b> · ${roomInfo.count} watching`;
  else c.innerHTML = liveCount ? `<i class="dot"></i><b>${liveCount}</b> live ${liveCount === 1 ? 'party' : 'parties'}` : '<b>Astral</b>, Global';
}
async function pollLive() { try { liveCount = (await api('/api/live')).length; paintCenter(); } catch { /* offline */ } }
function paintUser() {
  const p = getProfile();
  $('#uname').innerHTML = `<b>${esc(p.name)}</b>`;
  $('#uav').textContent = p.name.charAt(0).toUpperCase();
  $('#uav').style.setProperty('--c', p.color);
}
$('#hc').onclick = () => { location.hash = '#/browse'; };

/* ------------------------------------------------------------ profile */
function openProfile() {
  const p = getProfile();
  let color = p.color;
  const m = modal(`<h2 class="mh">Your profile</h2>
    <form class="stack" id="pf"><input id="pname" maxlength="24" value="${esc(p.name)}" placeholder="Your name" autocomplete="off">
      <div class="swatches" id="sw">${COLORS.map((c) => `<button type="button" class="${c === color ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <button class="btn-y">Save</button></form>`);
  m.el.querySelector('#sw').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    color = b.dataset.c; m.el.querySelectorAll('#sw button').forEach((x) => x.classList.toggle('on', x === b));
  };
  m.el.querySelector('#pf').onsubmit = (e) => {
    e.preventDefault();
    const name = m.el.querySelector('#pname').value.trim() || p.name;
    saveProfile({ name, color, named: true });
    net.send('profile', { name, color });
    paintUser(); m.close();
  };
}
$('#user').onclick = openProfile;

/* ------------------------------------------------------------ search overlay */
$('#searchbtn').onclick = async () => {
  const movies = await getMovies();
  const m = modal(`<div class="sbox"><input id="sq" type="search" placeholder="Search movies, genres, cast…" autocomplete="off"><div id="sres" class="sres"></div></div>`, { wide: true });
  const inp = m.el.querySelector('#sq'), res = m.el.querySelector('#sres');
  const paint = () => {
    const list = searchMovies(movies, inp.value).slice(0, 6);
    res.innerHTML = list.length ? list.map((x) => `<a href="#/movie/${x.id}" class="sr"><span style="background-image:${poster(x)}"></span><div><b>${esc(x.title)}</b><small>${x.year} · ${esc(x.genres.join(', '))}</small></div></a>`).join('') : '<div class="none">No matches</div>';
  };
  inp.oninput = paint; paint(); inp.focus();
  res.onclick = (e) => { if (e.target.closest('a')) m.close(); };
  inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { sessionStorage.setItem('astral.q', inp.value.trim()); m.close(); if (location.hash === '#/browse') route(); else location.hash = '#/browse'; } };
};

/* ------------------------------------------------------------ drawer */
const drawer = $('#drawer');
function closeDrawer() { drawer.classList.remove('open'); }
$('#menubtn').onclick = async () => {
  drawer.classList.toggle('open');
  if (drawer.classList.contains('open')) {
    try {
      const live = await api('/api/live');
      $('#dlive').innerHTML = live.length ? live.map((r) => `<a href="#/room/${r.code}" class="dl"><b>${esc(r.title || 'Waiting for a movie')}</b><small>${r.count} watching · ${r.code}</small></a>`).join('') : '<small class="muted">No public parties right now.</small>';
    } catch { /* ignore */ }
  }
};
$('#dclose').onclick = closeDrawer;
$('#joinform').onsubmit = async (e) => {
  e.preventDefault();
  const raw = $('#joincode').value.trim();
  const code = (raw.match(/([A-Za-z0-9]{5})\/?$/) || [])[1];
  if (!code) return toast('Enter the 5-letter room code or paste the invite link.');
  try { await api(`/api/rooms/${code.toUpperCase()}`); location.hash = `#/room/${code.toUpperCase()}`; $('#joincode').value = ''; }
  catch { toast('No room with that code.'); }
};
$('#blank').onclick = () => createParty({}).catch((e) => toast(e.message));
document.addEventListener('click', (e) => { if (drawer.classList.contains('open') && !e.target.closest('#drawer') && !e.target.closest('#menubtn')) closeDrawer(); });

/* ------------------------------------------------------------ boot */
paintUser(); paintCenter(); pollLive();
setInterval(pollLive, 8000);
route();
