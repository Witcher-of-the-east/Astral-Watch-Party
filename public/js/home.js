// Home: the numbered hero carousel with a poster rail (the signature screen of the design).
import { backdrop, poster } from './art.js';
import { getMovies, createParty, esc, stars, pad2, toast } from './util.js';

export function scheduleTimestamp(time, dayOffset = 0) {
  if (!time || time === 'Now') return null;
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.getTime() > Date.now() ? d.getTime() : null;
}

export async function renderHome(root) {
  const movies = await getMovies();
  const N = movies.length;
  let idx = 0, time = null, busy = false, front = 'A';

  root.innerHTML = `
  <section class="hero">
    <div class="bg on" id="bgA"></div><div class="bg" id="bgB"></div><div class="shade"></div>
    <div class="hero-left" id="info"></div>
    <div class="hero-right">
      <div class="uplabel"><i class="pin"></i><span>Up next</span></div>
      <div class="rail-clip"><div class="rail" id="rail"></div></div>
      <div class="arrows"><button class="circ" id="prev" aria-label="Previous movie">‹</button><button class="circ" id="next" aria-label="Next movie">›</button></div>
    </div>
  </section>`;

  const info = root.querySelector('#info');
  const rail = root.querySelector('#rail');
  const bgs = { A: root.querySelector('#bgA'), B: root.querySelector('#bgB') };
  bgs.A.style.backgroundImage = backdrop(movies[0]);

  function renderInfo(swap = true) {
    const m = movies[idx];
    info.innerHTML = `
      <div class="tag"><i class="pin"></i>Tonight</div>
      <div class="titlerow ${swap ? 'swap' : ''}">
        <span class="num">${pad2(idx + 1)}</span>
        <h1>${esc(m.title).replace(/: /, ':<br>')}</h1>
      </div>
      <div class="meta ${swap ? 'swap' : ''}">
        ${stars(m.rating)}
        <span class="genre">Genre: ${esc(m.genres.join(', ').toLowerCase())}</span>
        <span class="badge">${esc(m.format)}</span><span class="badge">${esc(m.age)}</span>
      </div>
      <div class="sess">Session schedule</div>
      <div class="pills">${m.times.map((t) => `<button class="pill ${t === time ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <div class="cta">
        <button class="btn-y" id="go"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Start Party</button>
        <a class="btn-g" href="#/movie/${m.id}">More <small>▷</small></a>
      </div>`;
  }

  function renderRail() {
    const prev = (idx - 1 + N) % N;
    const order = [prev, ...Array.from({ length: Math.max(0, N - 1) }, (_, k) => (idx + 1 + k) % N)];
    rail.style.transition = 'none';
    rail.innerHTML = order.map((i) => `
      <button class="rc" data-i="${i}" aria-label="${esc(movies[i].title)}">
        <span class="ri">${pad2(i + 1)}</span>
        <span class="rp" style="background-image:${poster(movies[i])}"></span>
      </button>`).join('');
    const step = stepSize();
    rail.style.transform = `translateX(${-step}px)`;
  }
  const stepSize = () => (rail.children[1] ? rail.children[1].offsetLeft - rail.children[0].offsetLeft : 160);

  function crossfade() {
    const next = front === 'A' ? 'B' : 'A';
    bgs[next].style.backgroundImage = backdrop(movies[idx]);
    bgs[next].classList.add('on');
    bgs[front].classList.remove('on');
    front = next;
  }

  function go(dir) {
    if (busy) return;
    busy = true;
    const step = stepSize();
    rail.style.transition = 'transform .6s cubic-bezier(.7,0,.2,1)';
    rail.style.transform = `translateX(${dir > 0 ? -2 * step : 0}px)`;
    setTimeout(() => {
      idx = (idx + dir + N) % N; time = null;
      crossfade(); renderInfo();
    }, 220);
    setTimeout(() => { renderRail(); busy = false; }, 640);
  }

  function select(i) {
    if (busy || i === idx) return;
    idx = i; time = null;
    crossfade(); renderInfo(); renderRail();
  }

  root.querySelector('#next').onclick = () => { go(1); restart(); };
  root.querySelector('#prev').onclick = () => { go(-1); restart(); };
  rail.addEventListener('click', (e) => {
    const c = e.target.closest('.rc');
    if (c) { select(Number(c.dataset.i)); restart(); }
  });
  info.addEventListener('click', (e) => {
    const p = e.target.closest('.pill');
    if (p) { time = time === p.dataset.t ? null : p.dataset.t; renderInfo(false); return; }
    if (e.target.closest('#go')) {
      createParty({ movieId: movies[idx].id, scheduledFor: scheduleTimestamp(time) }).catch((err) => toast(err.message));
    }
  });

  let timer = null;
  const restart = () => { clearInterval(timer); timer = setInterval(() => go(1), 9000); };
  renderInfo(false); renderRail(); restart();
  const onResize = () => renderRail();
  window.addEventListener('resize', onResize);
  const onKey = (e) => { if (e.key === 'ArrowRight') { go(1); restart(); } if (e.key === 'ArrowLeft') { go(-1); restart(); } };
  document.addEventListener('keydown', onKey);

  return () => { clearInterval(timer); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); };
}
