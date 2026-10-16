// Movie page: hero with facts + cast + storyline, then "plan your party" with date, time and the seat map.
import { backdrop, portrait } from './art.js';
import { createSeatMap, SEAT_ROWS } from './seatmap.js';
import { scheduleTimestamp } from './home.js';
import { getMovies, createParty, getProfile, saveProfile, esc, stars, modal, toast, pad2, whenLabel } from './util.js';

export async function renderDetail(root, id) {
  const movies = await getMovies();
  const m = movies.find((x) => x.id === id);
  if (!m) { root.innerHTML = '<div class="empty">Movie not found. <a href="#/browse">Browse all movies</a></div>'; return; }

  let day = 0, time = 'Now', isPublic = true, everyone = false;
  let seat = getProfile().seat;
  const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  const month = days[0].toLocaleDateString(undefined, { month: 'long' });

  root.innerHTML = `
  <section class="detail">
    <div class="bg on" style="background-image:${backdrop(m)}"></div><div class="shade"></div>
    <div class="d-left">
      <h1>${esc(m.title).replace(/: /, ':<br>')}</h1>
      <p class="tagline">${esc(m.tagline)}</p>
      <dl class="facts">
        <dt>Rating:</dt><dd>${stars(m.rating)}</dd>
        <dt>Format:</dt><dd>${esc(m.format)} · ${esc(m.age)}</dd>
        <dt>Genre:</dt><dd>${esc(m.genres.join(', '))}</dd>
        <dt>Country:</dt><dd>${esc(m.country)}</dd>
        <dt>Duration:</dt><dd>${m.runtime} minute${m.runtime === 1 ? '' : 's'}</dd>
        <dt>Language:</dt><dd>${esc(m.language)}</dd>
        <dt>Directors:</dt><dd>${esc(m.director)}</dd>
      </dl>
      <div class="cta"><button class="btn-y" id="quick">▶ Start Party now</button><button class="btn-g" id="scrollbook">Plan it ↓</button></div>
    </div>
    <button class="playbig" id="preview" aria-label="Preview ${esc(m.title)}"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    <div class="d-right">
      <h3>Starring:</h3>
      <div class="cast-clip"><div class="cast" id="cast">${m.cast.map((c) => `
        <figure class="cm"><span class="ph" style="background-image:${portrait(c.name)}"></span><figcaption><b>${esc(c.name)}</b><small>${esc(c.role)}</small></figcaption></figure>`).join('')}</div></div>
      <div class="cast-ctl"><button class="circ" id="cprev" aria-label="Previous">‹</button><button class="circ" id="cnext" aria-label="Next">›</button><div class="prog"><i id="prog"></i></div></div>
      <h3 class="story">Storyline</h3>
      <p class="desc">${esc(m.description)}</p>
    </div>
  </section>

  <section class="book" id="book">
    <div class="b-left">
      <div class="lbl">Date for ${esc(month)}:</div>
      <div class="dates" id="dates">${days.map((d, i) => `
        <button class="dt ${i === 0 ? 'on' : ''}" data-i="${i}"><b>${d.getDate()}</b><small>${d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</small></button>`).join('')}</div>
      <div class="lbl">Time:</div>
      <div class="pills" id="times">${['Now', ...m.times].map((t) => `<button class="pill ${t === 'Now' ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <div class="lbl">Your party</div>
      <div class="ticket">
        <header><b>${esc(m.title)}</b><span>⌃</span></header>
        <div class="trow"><span>📅 <em id="tdate">Today</em></span><span>🕒 <em id="ttime">Starts right away</em></span></div>
        <table>
          <tr><th>Seat</th><th>Room</th><th>Controls</th></tr>
          <tr><td id="tseat">Auto</td><td><button class="mini" id="tpub">Public</button></td><td><button class="mini" id="tctl">Host only</button></td></tr>
        </table>
        <footer><button class="btn-y" id="create">▶ Create Party</button><span class="price">Price: <b>Free</b></span></footer>
      </div>
    </div>
    <div class="b-right">
      <div class="screen-arc"><span>Screen</span></div>
      <div id="seatmount"></div>
      <p class="hint">Pick the seat you want. Friends who join take the rest.</p>
    </div>
  </section>`;

  /* cast carousel */
  const cast = root.querySelector('#cast'), prog = root.querySelector('#prog');
  const stepC = () => (cast.firstElementChild ? cast.firstElementChild.offsetWidth + 12 : 120);
  const updProg = () => { const max = cast.scrollWidth - cast.clientWidth; prog.style.width = `${max > 0 ? 25 + (cast.scrollLeft / max) * 75 : 100}%`; };
  cast.addEventListener('scroll', updProg); updProg();
  root.querySelector('#cnext').onclick = () => cast.scrollBy({ left: stepC(), behavior: 'smooth' });
  root.querySelector('#cprev').onclick = () => cast.scrollBy({ left: -stepC(), behavior: 'smooth' });

  /* seat map */
  const map = createSeatMap({
    selectable: true,
    onPick: (r, c) => {
      seat = seat && seat.r === r && seat.c === c ? null : { r, c };
      saveProfile({ seat }); paint();
    }
  });
  root.querySelector('#seatmount').appendChild(map.el);

  function paint() {
    map.update({ selected: seat });
    root.querySelector('#tseat').textContent = seat ? `Row ${seat.r + 1} · Seat ${seat.c + 1}` : 'Auto';
    const ts = scheduleTimestamp(time, day);
    root.querySelector('#tdate').textContent = ts ? whenLabel(ts).split(' · ')[0] : 'Today';
    root.querySelector('#ttime').textContent = ts ? `Starts ${pad2(new Date(ts).getHours())}:${pad2(new Date(ts).getMinutes())}` : 'Starts right away';
    root.querySelector('#tpub').textContent = isPublic ? 'Public' : 'Invite only';
    root.querySelector('#tctl').textContent = everyone ? 'Everyone' : 'Host only';
  }
  paint();

  root.querySelector('#dates').onclick = (e) => {
    const b = e.target.closest('.dt'); if (!b) return;
    day = Number(b.dataset.i);
    root.querySelectorAll('.dt').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  };
  root.querySelector('#times').onclick = (e) => {
    const b = e.target.closest('.pill'); if (!b) return;
    time = b.dataset.t;
    root.querySelectorAll('#times .pill').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  };
  root.querySelector('#tpub').onclick = () => { isPublic = !isPublic; paint(); };
  root.querySelector('#tctl').onclick = () => { everyone = !everyone; paint(); };

  const create = (now) => createParty({
    movieId: m.id, isPublic, everyoneControls: everyone,
    scheduledFor: now ? null : scheduleTimestamp(time, day)
  }).catch((e) => toast(e.message));
  root.querySelector('#create').onclick = () => create(false);
  root.querySelector('#quick').onclick = () => create(true);
  root.querySelector('#scrollbook').onclick = () => root.querySelector('#book').scrollIntoView({ behavior: 'smooth' });

  root.querySelector('#preview').onclick = () => {
    const s = m.source;
    const inner = s.kind === 'youtube'
      ? `<iframe class="pv" src="https://www.youtube.com/embed/${esc(s.ytId)}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
      : `<video class="pv" src="${esc(s.url)}" controls autoplay playsinline></video>`;
    modal(`<h2 class="mh">${esc(m.title)} <small>solo preview</small></h2>${inner}`, { wide: true });
  };
}
