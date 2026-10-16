// Browse: live parties, category chips, fuzzy search, sorting.
import { poster } from './art.js';
import { searchMovies } from './search.js';
import { api, getMovies, esc, stars } from './util.js';

export async function renderBrowse(root, { query = '' } = {}) {
  const movies = await getMovies();
  const genres = ['All', ...new Set(movies.flatMap((m) => m.genres))];
  let q = query, genre = 'All', sort = 'featured';

  root.innerHTML = `
  <section class="browse">
    <h1>All Movies</h1>
    <div id="live"></div>
    <div class="bar">
      <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Search titles, genres, cast…  (typos are fine: try “sintle”)" value="${esc(q)}" autocomplete="off"></label>
      <select id="sort" aria-label="Sort"><option value="featured">Featured</option><option value="rating">Top rated</option><option value="newest">Newest</option><option value="short">Shortest</option><option value="az">A–Z</option></select>
    </div>
    <div class="chips" id="chips">${genres.map((g) => `<button class="chip ${g === 'All' ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
    <div class="grid" id="grid"></div>
  </section>`;

  const grid = root.querySelector('#grid');
  function paint() {
    let list = searchMovies(movies, q, { genre });
    if (!q.trim()) {
      const by = { rating: (a, b) => b.rating - a.rating, newest: (a, b) => b.year - a.year, short: (a, b) => a.runtime - b.runtime, az: (a, b) => a.title.localeCompare(b.title) }[sort];
      if (by) list = [...list].sort(by);
    }
    grid.innerHTML = list.length ? list.map((m) => `
      <a class="card" href="#/movie/${m.id}">
        <span class="cp" style="background-image:${poster(m)}"></span>
        <b>${esc(m.title)}</b>
        <small>${stars(m.rating)} · ${m.runtime} min</small>
      </a>`).join('') : `<div class="empty">Nothing matches “${esc(q)}”. Try fewer letters or another genre.</div>`;
  }
  root.querySelector('#q').addEventListener('input', (e) => { q = e.target.value; paint(); });
  root.querySelector('#sort').addEventListener('change', (e) => { sort = e.target.value; paint(); });
  root.querySelector('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    genre = b.dataset.g;
    root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    paint();
  });
  paint();
  if (query) root.querySelector('#q').focus();

  // Live parties strip
  const live = root.querySelector('#live');
  const loadLive = async () => {
    try {
      const rooms = await api('/api/live');
      live.innerHTML = rooms.length ? `<div class="live-h"><i class="dot"></i> Live parties</div><div class="live-row">${rooms.map((r) => `
        <a class="lp" href="#/room/${r.code}"><b>${esc(r.title || 'Waiting for a movie')}</b><small>${r.count} watching · host ${esc(r.host || '—')} · ${r.playing ? '▶ playing' : '⏸ paused'}</small><span>Join ${r.code}</span></a>`).join('')}</div>` : '';
    } catch { /* ignore */ }
  };
  loadLive();
  const t = setInterval(loadLive, 5000);
  return () => clearInterval(t);
}
