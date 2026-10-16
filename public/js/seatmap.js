// The cinema seat map. Used on the movie page (pick your seat) and in the room (everyone sits here,
// chat shows up as speech bubbles above heads, reactions float up from your seat).
export const SEAT_ROWS = [9, 9, 10, 10, 11, 11, 12];

const SEAT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="12" rx="3.5"/><rect x="1.5" y="8.5" width="5.5" height="11" rx="2.4"/><rect x="17" y="8.5" width="5.5" height="11" rx="2.4"/><rect x="6" y="14" width="12" height="6.5" rx="2.4"/></svg>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSeatMap({ onPick = null, selectable = true } = {}) {
  const el = document.createElement('div');
  el.className = 'seatmap';
  const seats = {};
  SEAT_ROWS.forEach((n, r) => {
    const row = document.createElement('div');
    row.className = 'srow';
    for (let c = 0; c < n; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seat';
      b.dataset.r = r; b.dataset.c = c;
      b.setAttribute('aria-label', `Row ${r + 1}, seat ${c + 1}`);
      b.innerHTML = SEAT_SVG;
      row.appendChild(b);
      seats[`${r}-${c}`] = b;
    }
    el.appendChild(row);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.seat');
    if (!b || !onPick || b.classList.contains('taken')) return;
    onPick(Number(b.dataset.r), Number(b.dataset.c));
  });

  const timers = new Map();

  function update({ members = [], me = null, selected = null } = {}) {
    const byKey = new Map();
    members.forEach((m) => { if (m.seat) byKey.set(`${m.seat.r}-${m.seat.c}`, m); });
    for (const [key, b] of Object.entries(seats)) {
      const m = byKey.get(key);
      const wasId = b.dataset.who;
      if (m) {
        b.classList.add('taken');
        b.classList.toggle('me', m.id === me);
        b.classList.toggle('away', !m.connected);
        b.classList.toggle('speaking', !!m.speaking);
        b.classList.toggle('in-voice', !!m.inVoice);
        b.classList.remove('sel');
        if (wasId !== m.id || b.dataset.color !== m.color || b.dataset.name !== m.name) {
          const bubble = b.querySelector('.bubble');
          b.innerHTML = `<span class="av" style="--c:${esc(m.color)}">${esc((m.name || '?').trim().charAt(0).toUpperCase())}</span><span class="nm">${esc(m.name)}</span>`;
          if (bubble && wasId === m.id) b.appendChild(bubble);
          b.dataset.who = m.id; b.dataset.color = m.color; b.dataset.name = m.name;
        }
        b.disabled = !selectable;
      } else {
        if (wasId) { b.innerHTML = SEAT_SVG; delete b.dataset.who; delete b.dataset.color; delete b.dataset.name; }
        b.classList.remove('taken', 'me', 'away', 'talking');
        b.classList.toggle('sel', !!selected && selected.r === Number(b.dataset.r) && selected.c === Number(b.dataset.c));
        b.disabled = !selectable;
      }
    }
    el._byKey = byKey;
  }

  const seatOf = (id) => {
    for (const [key, m] of (el._byKey || new Map())) if (m.id === id) return seats[key];
    return null;
  };

  /** Speech bubble above a member's head. */
  function bubble(id, text) {
    const b = seatOf(id);
    if (!b) return;
    b.querySelector('.bubble')?.remove();
    clearTimeout(timers.get(id));
    const d = document.createElement('div');
    d.className = 'bubble';
    d.textContent = text.length > 90 ? text.slice(0, 88) + '…' : text;
    b.appendChild(d);
    b.classList.add('talking');
    timers.set(id, setTimeout(() => { d.remove(); b.classList.remove('talking'); }, Math.min(9000, 3500 + text.length * 60)));
  }

  /** Emoji that floats up from a member's seat. */
  function react(id, emoji) {
    const b = seatOf(id) || el.querySelector('.srow:last-child');
    if (!b) return;
    const d = document.createElement('span');
    d.className = 'floater';
    d.textContent = emoji;
    d.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 36)}px`);
    b.appendChild(d);
    b.classList.add('talking');
    setTimeout(() => { d.remove(); if (!b.querySelector('.bubble')) b.classList.remove('talking'); }, 2200);
  }

  function setSpeaking(id, isSpeaking) {
    const b = seatOf(id);
    if (b) b.classList.toggle('speaking', !!isSpeaking);
  }

  return { el, update, bubble, react, setSpeaking };
}
