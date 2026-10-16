// The watch-party room: synced player, seat map with chat bubbles, reactions, queue, polls, people.
import { createPlayer } from './player.js';
import { createSeatMap } from './seatmap.js';
import { createVoiceChat } from './voice.js';
import { expectedPos, plan, IN_SYNC } from './sync.js';
import * as net from './net.js';
import { poster, backdrop } from './art.js';
import { getProfile, saveProfile, esc, getMovies, modal, toast, fmtTime, COLORS, whenLabel } from './util.js';

const EMOJI = ['👏', '😂', '😮', '❤️', '🔥', '😢'];
const SEEK_RES = 1000;

export async function renderRoom(root, code, hooks = {}) {
  code = code.toUpperCase();
  const me = getProfile();
  const movies = await getMovies();

  // First visit: ask for a name and colour before taking a seat.
  if (!me.named) {
    const ok = await askProfile(code);
    if (!ok) { location.hash = '#/'; return null; }
  }

  const S = { meta: null, pb: null, chat: [], queue: [], polls: [], tab: 'chat', unread: 0 };
  let player = null, playerKey = null, blocked = false, lastSeek = 0, dur = 0, drift = 0, dragging = false, errorMsg = null;
  let vol = 0.8, muted = false, joinedOnce = false, disposed = false;
  const unsubs = [];
  const myId = me.clientId;

  root.innerHTML = `
  <div class="room">
    <div class="r-main">
      <div class="r-top">
        <div class="r-title"><h2 id="rtitle">Joining…</h2><small id="rsub"></small></div>
        <div class="r-actions">
          <button class="chipb" id="copy" title="Copy invite link">🔗 <b>${esc(code)}</b> <span>Copy invite</span></button>
          <button class="chipb" id="pick">🎬 <span id="picklabel">Change movie</span></button>
          <div class="voice-group" id="voice-wrap">
            <button class="chipb voice-btn" id="voicebtn" title="Join voice chat">🎙️ <span>Voice Chat</span></button>
          </div>
          <button class="chipb danger" id="leavebtn" title="Leave room">🚪 <span>Leave</span></button>
                     <button class="chipb danger" id="dismissbtn" title="Dismiss room for everyone" style="display:none">🛑 <span>Dismiss</span></button>
            <button class="chipb" id="decorateBtn" title="Decorate Attic">🛋️ <span>Decorate</span></button>
            <button class="chipb" id="audioBtn" title="Toggle ambient audio">🔊 <span>Audio</span></button>
        </div>
      </div>
      <div class="stage-wrap">
        <div class="stage" id="stage"><div class="screen" id="screen"></div><div class="overlay" id="overlay"></div></div>
        <div class="controls" id="controls">
          <button class="cb play" id="pp" aria-label="Play or pause">▶</button>
          <button class="cb" id="back" aria-label="Back 10 seconds">⟲<small>10</small></button>
          <button class="cb" id="fwd" aria-label="Forward 10 seconds"><small>10</small>⟳</button>
          <span class="tm" id="tcur">0:00</span>
          <input type="range" class="seek" id="seek" min="0" max="${SEEK_RES}" value="0" aria-label="Seek">
          <span class="tm" id="tdur">0:00</span>
          <button class="cb" id="mute" aria-label="Mute">🔊</button>
          <input type="range" class="vol" id="vol" min="0" max="100" value="80" aria-label="Volume">
          <button class="cb" id="fs" aria-label="Fullscreen">⛶</button>
        </div>
        <div class="syncrow"><span class="syncpill" id="sync">● Connecting…</span><button class="linkb" id="resync">Re-sync me</button></div>
      </div>
      <div class="screen-arc"><span>Screen</span></div>
      <div id="seatmount"></div>
      <div class="react-bar" id="reactbar">${EMOJI.map((e) => `<button data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
    </div>

    <aside class="r-side">
      <nav class="tabs" id="tabs">
        <button data-tab="chat" class="on">Chat<i id="bchat"></i></button>
        <button data-tab="queue">Queue<i id="bqueue"></i></button>
        <button data-tab="polls">Polls<i id="bpolls"></i></button>
        <button data-tab="people">People<i id="bpeople"></i></button>
      </nav>
      <section class="panel chat on" data-panel="chat">
        <div class="msgs" id="msgs"></div>
        <form class="chatform" id="chatform"><input id="chatin" maxlength="300" placeholder="Say something…" autocomplete="off"><button class="btn-y sm">Send</button></form>
      </section>
      <section class="panel" data-panel="queue">
        <form class="stack" id="qform">
          <input id="qurl" placeholder="Paste a YouTube or video link" autocomplete="off">
          <div class="two"><input id="qtitle" placeholder="Title (optional)" maxlength="80"><button class="btn-y sm">Add</button></div>
        </form>
        <div class="sub">Or pick from the catalogue</div>
        <div class="qcat" id="qcat">${movies.map((m) => `<button data-id="${m.id}" title="${esc(m.title)}" style="background-image:${backdrop(m)}"></button>`).join('')}</div>
        <div class="sub">Up next <small>(most votes plays first)</small></div>
        <ul class="qlist" id="qlist"></ul>
      </section>
      <section class="panel" data-panel="polls">
        <details class="newpoll"><summary>＋ New poll</summary>
          <form class="stack" id="pform"><input id="pq" placeholder="Question, e.g. What next?" maxlength="120"><textarea id="po" rows="3" placeholder="One option per line (2–6)"></textarea><button class="btn-y sm">Start poll</button></form>
        </details>
        <div id="plist"></div>
      </section>
      <section class="panel" data-panel="people">
        <div id="host-settings"></div>
        <ul class="plist" id="people"></ul>
      </section>
    </aside>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const screenEl = $('#screen');
  const seatmap = createSeatMap({
    selectable: true,
    onPick: async (r, c) => {
      try {
        const res = await net.request('seat', { r, c });
        if (res && res.ok) saveProfile({ seat: { r, c } }); else toast('That seat is taken.');
      } catch { /* offline */ }
    }
  });
  $('#seatmount').appendChild(seatmap.el);

  /* ------------------------------------------------------------ voice chat */
  const voice = createVoiceChat({
    myId,
    net,
    onSpeakingChange: (id, isSpeaking) => {
      seatmap.setSpeaking(id, isSpeaking);
      const li = root.querySelector(`.plist li[data-id="${id}"]`);
      if (li) {
        const badge = li.querySelector('.vbadge');
        if (badge) {
          badge.classList.toggle('speaking', isSpeaking);
          badge.textContent = isSpeaking ? '🔊' : (badge.dataset.muted === 'true' ? '🔇' : '🎙️');
        }
      }
    },
    onStateChange: () => {
      renderVoiceControls();
      renderPeople();
    },
    onError: (msg) => {
      toast(msg);
    }
  });

  function renderVoiceControls() {
    const wrap = $('#voice-wrap');
    if (!wrap) return;
    if (!voice.inVoice) {
      wrap.innerHTML = `<button class="chipb voice-btn" id="voicebtn" title="Join voice chat">🎙️ <span>Voice Chat</span></button>`;
    } else {
      wrap.innerHTML = `
        <button class="chipb ${voice.muted ? 'voice-muted' : 'voice-on'}" id="voicemutebtn" title="${voice.muted ? 'Unmute microphone' : 'Mute microphone'}">
          ${voice.muted ? '🔇 <span style="color:#f87171">Muted</span>' : '🎤 <span>Speaking</span>'}
        </button>
        <button class="chipb voice-exit" id="voiceleavebtn" title="Leave voice chat">✕ <span>Leave Voice</span></button>
      `;
    }
  }

  root.addEventListener('click', (e) => {
    const vJoin = e.target.closest('#voicebtn');
    if (vJoin) {
      voice.join(S.meta ? S.meta.members : []);
      return;
    }
    const vMute = e.target.closest('#voicemutebtn');
    if (vMute) {
      voice.toggleMute();
      return;
    }
    const vLeave = e.target.closest('#voiceleavebtn');
    if (vLeave) {
      voice.leave();
      return;
    }
  });

  /* ------------------------------------------------------------ helpers */
  const canControl = () => !!S.meta && (S.meta.hostId === myId || S.meta.settings.everyoneControls);
  const isHost = () => !!S.meta && S.meta.hostId === myId;
  const memberById = (id) => S.meta && S.meta.members.find((m) => m.id === id);
  const exp = () => expectedPos(S.pb, net.serverNow());

  function ctl(action, pos) {
    if (!S.pb || !S.pb.source) { toast('Pick something to watch first.'); return; }
    if (!canControl()) { toast('Only the host can control playback. Ask them, or have them allow everyone.'); return; }
    net.request('ctl', { action, pos, sentAt: Date.now() }).then((r) => { if (r && !r.ok) toast(r.error); }).catch(() => toast('Offline, reconnecting…'));
  }

  /* ------------------------------------------------------------ player + sync */
  function ensurePlayer() {
    const src = S.pb && S.pb.source;
    const key = src ? String(S.pb.nonce) : 'none';
    if (key === playerKey) return;
    if (player) player.destroy();
    player = null; playerKey = key; blocked = false; dur = 0; errorMsg = null; lastSeek = 0;
    screenEl.innerHTML = '';
    if (!src) return;
    const nonce = S.pb.nonce;
    player = createPlayer(screenEl, src, {
      onEnded: () => net.send('ended', { nonce }),
      onDuration: (d) => { dur = d || 0; },
      onBlocked: () => { blocked = true; renderOverlay(); },
      onError: (msg) => { errorMsg = msg; renderOverlay(); }
    });
    player.setVolume(vol); player.setMuted(muted);
    player.ready.then(() => { if (!disposed) reconcile(); });
  }

  function reconcile() {
    if (!S.pb || !player) return;
    const pb = S.pb, target = exp(), now = performance.now();
    if (dur && target > dur + 1 && pb.playing) return; // past the end: wait for the "ended" hand-off
    if (pb.playing) {
      if (!player.isEnded() && !player.isPlaying() && !blocked) player.play();
      drift = player.getTime() - target;
      const act = plan({ drift, playing: true, canNudge: player.canNudge });
      if (act.seek) { if (now - lastSeek > 1200) { player.seek(target); lastSeek = now; } }
      else player.setRate(act.rate);
    } else {
      if (player.isPlaying()) player.pause();
      drift = player.getTime() - target;
      player.setRate(1);
      if (plan({ drift, playing: false }).seek && now - lastSeek > 800) { player.seek(target); lastSeek = now; }
    }
  }

  function renderOverlay() {
    const ov = $('#overlay');
    const pb = S.pb;
    let html = '';
    if (errorMsg) html = `<div class="ovc"><b>⚠ ${esc(errorMsg)}</b>${canControl() ? '<button class="btn-g" data-act="pickmovie">Pick another</button>' : '<small>Ask the host to pick another.</small>'}</div>`;
    else if (!pb) html = '<div class="ovc"><b>Joining…</b></div>';
    else if (!pb.source) html = `<div class="ovc"><b>Nothing is playing yet</b>${canControl() ? '<button class="btn-y" data-act="pickmovie">🎬 Choose a movie</button>' : '<small>Waiting for the host to choose something.</small>'}</div>`;
    else if (blocked && pb.playing) html = '<div class="ovc tap"><button class="btn-y big" data-act="tap">▶ Tap to join the screening</button><small>Your browser needs one click before it lets the video play.</small></div>';
    else if (!pb.playing && pb.pos < 0.5) {
      const sched = S.meta && S.meta.scheduledFor;
      const when = sched && sched > Date.now() ? `<small>Scheduled for ${esc(whenLabel(sched))} · <span id="countdown"></span></small>` : '<small>Waiting for everyone to settle in.</small>';
      html = `<div class="ovc ready"><span class="mini-poster" style="background-image:${backdrop(movies.find((m) => m.id === pb.source.movieId) || { id: pb.source.title, title: pb.source.title, year: '', genres: ['Video'], theme: { h1: 220, h2: 40, motif: 'signal' } })}"></span><b>${esc(pb.source.title)}</b>${when}${canControl() ? '<button class="btn-y" data-act="start">▶ Start the party</button>' : '<small>The host will press play.</small>'}</div>`;
    }
    ov.innerHTML = html;
    ov.classList.toggle('show', !!html);
  }
  $('#overlay').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'tap') { blocked = false; player && player.play(); renderOverlay(); setTimeout(reconcile, 50); }
    if (a.dataset.act === 'start') { ctl('play', 0); }
    if (a.dataset.act === 'pickmovie') openPicker();
  });

  /* ------------------------------------------------------------ controls */
  $('#pp').onclick = () => { if (!S.pb) return; if (S.pb.playing) ctl('pause', exp()); else { if (blocked) { blocked = false; player && player.play(); } ctl('play', exp()); } };
  $('#back').onclick = () => ctl('seek', Math.max(0, exp() - 10));
  $('#fwd').onclick = () => ctl('seek', exp() + 10);
  const seek = $('#seek');
  seek.addEventListener('pointerdown', () => { dragging = true; });
  seek.addEventListener('input', () => { if (dur) $('#tcur').textContent = fmtTime((seek.value / SEEK_RES) * dur); });
  seek.addEventListener('change', () => { dragging = false; if (dur) ctl('seek', (seek.value / SEEK_RES) * dur); });
  $('#vol').oninput = (e) => { vol = e.target.value / 100; muted = vol === 0; player && (player.setVolume(vol), player.setMuted(muted)); $('#mute').textContent = muted ? '🔇' : '🔊'; };
  $('#mute').onclick = () => { muted = !muted; player && player.setMuted(muted); $('#mute').textContent = muted ? '🔇' : '🔊'; };
  $('#fs').onclick = () => { const st = $('#stage'); if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen && st.requestFullscreen(); };
  $('#resync').onclick = () => { lastSeek = 0; if (S.pb && player) { player.seek(exp()); lastSeek = performance.now(); toast('Re-synced'); } };
  $('#reactbar').onclick = (e) => { const b = e.target.closest('button'); if (b) net.send('react', { emoji: b.dataset.e }); };
  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); $('#pp').click(); }
  };
  document.addEventListener('keydown', onKey);

  /* ------------------------------------------------------------ top bar */
// Added ambience and audio controls

// Helper to apply ambience class and audio
function applyAmbience() {
  const roomEl = root.querySelector('.room');
  if (!roomEl) return;
  // Remove any existing ambience classes
  roomEl.className = roomEl.className.replace(/\bambience-\w+\b/g, '').trim();
  const amb = S.meta && S.meta.settings && S.meta.settings.ambience ? S.meta.settings.ambience : 'clear';
  roomEl.classList.add(`ambience-${amb}`);
  // Handle ambient audio
  const audioEnabled = S.meta && S.meta.settings && typeof S.meta.settings.audioEnabled === 'boolean' ? S.meta.settings.audioEnabled : false;
  let audioEl = document.getElementById('ambienceAudio');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'ambienceAudio';
    audioEl.src = '/audio/ambient.mp3'; // placeholder audio file
    audioEl.loop = true;
    audioEl.volume = 0.5;
    document.body.appendChild(audioEl);
  }
  if (audioEnabled) {
    audioEl.play().catch(() => {}); // avoid autoplay errors
  } else {
    audioEl.pause();
    audioEl.currentTime = 0;
  }
}

// Open decor modal
function openDecorateModal() {
  const themes = [
    { id: 'clear', name: 'Clear Skies', desc: 'deep‑blue night sky, bright stars, a glowing moon, and warm fairy lights.' },
    { id: 'rain', name: 'Rainy Window', desc: 'raindrops on the window, soft reflections, and gentle rain ambience.' },
    { id: 'meteor', name: 'Meteor Shower', desc: 'shooting stars, subtle celestial particles, and a brighter night sky.' },
    { id: 'golden', name: 'Golden Hour', desc: 'amber lighting, warm sunset tones, and a cozy late‑evening atmosphere.' },
    { id: 'winter', name: 'Winter Night', desc: 'gentle snowfall outside, cool blue lighting, and warm indoor lamps.' },
    { id: 'dream', name: 'Dreamscape', desc: 'drifting particles, soft purple‑blue gradients, and a magical atmosphere.' },
  ];
  const m = modal(`
    <h2 class="mh">Decorate Your Attic</h2>
    <div class="theme-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;">
      ${themes.map(t => `
        <div class="theme-card" data-id="${t.id}" style="border:1px solid var(--line);border-radius:8px;padding:8px;cursor:pointer;">
          <strong>${t.name}</strong>
          <p style="font-size:11px;color:var(--mut);margin:4px 0;">${t.desc}</p>
        </div>`).join('')}
    </div>
    <div class="two" style="margin-top:12px;">
      <button class="btn-y" id="randomBtn">Randomize</button>
      <button class="btn-y" id="saveBtn">Save</button>
    </div>
  `, { wide: true });

  // Highlight current selection
  const current = S.meta && S.meta.settings && S.meta.settings.ambience ? S.meta.settings.ambience : 'clear';
  const cards = m.el.querySelectorAll('.theme-card');
  cards.forEach(c => { if (c.dataset.id === current) c.style.borderColor = 'var(--y)'; });

  let selected = current;
  m.el.querySelector('.theme-grid').onclick = (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    selected = card.dataset.id;
    cards.forEach(c => c.style.borderColor = (c === card ? 'var(--y)' : 'var(--line)'));
  };
  m.el.querySelector('#randomBtn').onclick = () => {
    const rand = themes[Math.floor(Math.random()*themes.length)].id;
    selected = rand;
    cards.forEach(c => c.style.borderColor = (c.dataset.id===rand? 'var(--y)' : 'var(--line)'));
  };
  m.el.querySelector('#saveBtn').onclick = () => {
    net.send('settings', { ambience: selected });
    m.close();
  };
}

// Audio toggle handler
function toggleAudio() {
  const cur = S.meta && S.meta.settings && typeof S.meta.settings.audioEnabled === 'boolean' ? S.meta.settings.audioEnabled : false;
  net.send('settings', { audioEnabled: !cur });
}

// Attach button listeners
root.addEventListener('click', (e) => {
  const dBtn = e.target.closest('#decorateBtn');
  if (dBtn) { openDecorateModal(); return; }
  const aBtn = e.target.closest('#audioBtn');
  if (aBtn) { toggleAudio(); return; }
});

// Extend renderMeta to apply ambience after updating UI
const _origRenderMeta = renderMeta;
renderMeta = function() {
  _origRenderMeta.apply(this, arguments);
  applyAmbience();
};
  $('#copy').onclick = async () => {
    const link = `${location.origin}/#/room/${code}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { prompt('Copy this invite link:', link); }
  };
  $('#pick').onclick = () => { if (canControl()) openPicker(); else { setTab('queue'); toast('Add it to the queue and vote for it.'); } };

  function openPicker() {
    const m = modal(`<h2 class="mh">Choose what to watch</h2>
      <div class="pgrid">${movies.map((x) => `<button data-id="${x.id}" class="pk"><span style="background-image:${backdrop(x)}"></span><b>${esc(x.title)}</b></button>`).join('')}</div>
      <form class="stack" id="pickform"><div class="sub">…or paste any YouTube / direct video link</div><div class="two"><input id="pkurl" placeholder="https://…"><button class="btn-y sm">Play</button></div></form>`, { wide: true });
    m.el.querySelector('.pgrid').onclick = async (e) => {
      const b = e.target.closest('.pk'); if (!b) return;
      const r = await net.request('source', { movieId: b.dataset.id }).catch(() => null);
      if (r && r.ok) m.close(); else toast((r && r.error) || 'Could not change the movie.');
    };
    m.el.querySelector('#pickform').onsubmit = async (e) => {
      e.preventDefault();
      const r = await net.request('source', { url: m.el.querySelector('#pkurl').value }).catch(() => null);
      if (r && r.ok) m.close(); else toast((r && r.error) || 'Could not play that link.');
    };
  }

  $('#leavebtn').onclick = () => {
    const isH = isHost();
    const otherConnected = S.meta ? S.meta.members.filter((m) => m.connected && m.id !== myId).length : 0;
    const msg = isH && otherConnected > 0
      ? 'You are the host. If you leave, hosting will automatically pass to the next member. Leave room?'
      : 'Are you sure you want to leave this watch party?';
    const m = modal(`
      <h2 class="mh">Leave Watch Party</h2>
      <p class="muted">${msg}</p>
      <div class="two" style="margin-top:18px">
        <button class="btn-g" id="staybtn">Stay in party</button>
        <button class="btn-danger" id="confirmleave">Leave Room</button>
      </div>
    `);
    m.el.querySelector('#staybtn').onclick = () => m.close();
    m.el.querySelector('#confirmleave').onclick = () => {
      m.close();
      voice.leave();
      net.send('leave');
      location.hash = '#/';
      toast('You left the room.');
    };
  };

  function askDismiss() {
    if (!isHost()) return;
    const m = modal(`
      <h2 class="mh" style="color:var(--bad)">Dismiss room for everyone?</h2>
      <p class="muted">This will end the watch party immediately and disconnect all members. Everyone will be returned to the cinema home.</p>
      <div class="two" style="margin-top:18px">
        <button class="btn-g" id="canceldismiss">Cancel</button>
        <button class="btn-danger" id="confirmdismiss">Dismiss Room</button>
      </div>
    `);
    m.el.querySelector('#canceldismiss').onclick = () => m.close();
    m.el.querySelector('#confirmdismiss').onclick = async () => {
      m.close();
      voice.leave();
      const res = await net.request('dismiss').catch(() => null);
      if (res && !res.ok) {
        toast(res.error || 'Failed to dismiss room.');
      } else {
        location.hash = '#/';
        toast('Room dismissed.');
      }
    };
  }
  $('#dismissbtn').onclick = askDismiss;

  /* ------------------------------------------------------------ tabs */
  function setTab(t) {
    S.tab = t;
    root.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    root.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === t));
    if (t === 'chat') { S.unread = 0; renderBadges(); const mm = $('#msgs'); mm.scrollTop = mm.scrollHeight; }
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
  function renderBadges() {
    $('#bchat').textContent = S.unread ? S.unread : '';
    $('#bqueue').textContent = S.queue.length || '';
    $('#bpolls').textContent = S.polls.filter((p) => !p.closed).length || '';
    $('#bpeople').textContent = S.meta ? S.meta.members.filter((m) => m.connected).length : '';
  }

  /* ------------------------------------------------------------ chat */
  function chatNode(c) {
    const d = document.createElement('div');
    if (c.sys) { d.className = 'msg sys'; d.textContent = c.text; }
    else {
      d.className = 'msg' + (c.from === myId ? ' mine' : '');
      d.innerHTML = `<b style="color:${esc(c.color)}">${esc(c.name)}</b><span>${esc(c.text)}</span>`;
    }
    return d;
  }
  function renderChat() {
    const box = $('#msgs');
    box.innerHTML = '';
    S.chat.forEach((c) => box.appendChild(chatNode(c)));
    box.scrollTop = box.scrollHeight;
  }
  $('#chatform').onsubmit = (e) => {
    e.preventDefault();
    const inp = $('#chatin'); const text = inp.value.trim();
    if (!text) return;
    net.send('chat', { text }); inp.value = '';
  };

  /* ------------------------------------------------------------ queue */
  $('#qform').onsubmit = async (e) => {
    e.preventDefault();
    const url = $('#qurl').value.trim(); if (!url) return;
    const r = await net.request('qadd', { url, title: $('#qtitle').value }).catch(() => null);
    if (r && r.ok) { $('#qurl').value = ''; $('#qtitle').value = ''; } else toast((r && r.error) || 'Could not add that.');
  };
  $('#qcat').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = await net.request('qadd', { movieId: b.dataset.id }).catch(() => null);
    if (r && !r.ok) toast(r.error); else toast('Added to the queue');
  };
  function renderQueue() {
    const list = [...S.queue].map((q, i) => ({ q, i })).sort((a, b) => b.q.votes - a.q.votes || a.i - b.i).map((x) => x.q);
    $('#qlist').innerHTML = list.length ? list.map((q, i) => {
      const mv = q.source.movieId ? movies.find((m) => m.id === q.source.movieId) : null;
      const voted = q.voters.includes(myId);
      return `<li data-id="${q.id}">
        <span class="qt" style="${mv ? `background-image:${backdrop(mv)}` : ''}">${mv ? '' : q.source.kind === 'youtube' ? '▶' : '🎞'}</span>
        <div><b>${esc(q.title)}</b><small>${i === 0 ? '<em>Up next</em> · ' : ''}added by ${esc(q.addedBy)}</small></div>
        <button class="vote ${voted ? 'on' : ''}" data-a="vote" aria-label="Vote">▲ ${q.votes}</button>
        ${canControl() ? '<button class="ib" data-a="play" title="Play now">▶</button>' : ''}
        ${(q.addedById === myId || isHost()) ? '<button class="ib" data-a="rm" title="Remove">✕</button>' : ''}</li>`;
    }).join('') : '<li class="none">The queue is empty. Add something above.</li>';
    renderBadges();
  }
  $('#qlist').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('li').dataset.id;
    if (b.dataset.a === 'vote') net.send('qvote', { id });
    if (b.dataset.a === 'rm') net.send('qrm', { id });
    if (b.dataset.a === 'play') { const r = await net.request('qplay', { id }).catch(() => null); if (r && !r.ok) toast(r.error); }
  };

  /* ------------------------------------------------------------ polls */
  $('#pform').onsubmit = async (e) => {
    e.preventDefault();
    const options = $('#po').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const r = await net.request('pollnew', { question: $('#pq').value, options }).catch(() => null);
    if (r && r.ok) { $('#pq').value = ''; $('#po').value = ''; root.querySelector('.newpoll').open = false; } else toast((r && r.error) || 'Could not start that poll.');
  };
  function renderPolls() {
    const list = [...S.polls].reverse();
    $('#plist').innerHTML = list.length ? list.map((p) => {
      const total = p.options.reduce((n, o) => n + o.voters.length, 0);
      return `<div class="poll ${p.closed ? 'closed' : ''}" data-id="${p.id}">
        <div class="pq">${esc(p.question)}</div><small>by ${esc(p.by)} · ${total} vote${total === 1 ? '' : 's'}${p.closed ? ' · final' : ''}</small>
        ${p.options.map((o, i) => `<button class="po ${o.voters.includes(myId) ? 'mine' : ''}" data-i="${i}" ${p.closed ? 'disabled' : ''}><i style="width:${total ? (o.voters.length / total) * 100 : 0}%"></i><span>${esc(o.text)}</span><em>${o.voters.length}</em></button>`).join('')}
        ${!p.closed && (p.byId === myId || isHost()) ? '<button class="linkb" data-close="1">Close poll</button>' : ''}</div>`;
    }).join('') : '<div class="none">No polls yet. Start one to decide what to watch next.</div>';
    renderBadges();
  }
  $('#plist').onclick = (e) => {
    const poll = e.target.closest('.poll'); if (!poll) return;
    if (e.target.closest('[data-close]')) return net.send('pollclose', { id: poll.dataset.id });
    const o = e.target.closest('.po'); if (o) net.send('pollvote', { id: poll.dataset.id, idx: Number(o.dataset.i) });
  };

  /* ------------------------------------------------------------ people */
  function renderPeople() {
    if (!S.meta) return;
    const host = isHost();
    $('#host-settings').innerHTML = `<div class="hs">
      <label class="tg"><input type="checkbox" id="optctl" ${S.meta.settings.everyoneControls ? 'checked' : ''} ${host ? '' : 'disabled'}><span>Everyone can control playback</span></label>
      <label class="tg"><input type="checkbox" id="optpub" ${S.meta.settings.isPublic ? 'checked' : ''} ${host ? '' : 'disabled'}><span>Listed in Live parties</span></label>
      ${host ? '<button class="btn-danger sm" id="hostdismiss" style="margin-top:6px;width:100%;justify-content:center">🛑 Dismiss Room (End for all)</button>' : '<small>Only the host can change these.</small>'}</div>`;
    $('#people').innerHTML = S.meta.members.map((m) => {
      const vBadge = m.inVoice
        ? `<span class="vbadge ${m.speaking ? 'speaking' : ''} ${m.voiceMuted ? 'muted' : 'on'}" data-muted="${!!m.voiceMuted}" title="${m.voiceMuted ? 'Muted' : (m.speaking ? 'Speaking' : 'In Voice')}">${m.speaking ? '🔊' : (m.voiceMuted ? '🔇' : '🎙️')}</span>`
        : '';
      return `
      <li class="${m.connected ? '' : 'off'}" data-id="${m.id}">
        <span class="av" style="--c:${esc(m.color)}">${esc(m.name.charAt(0).toUpperCase())}</span>
        <div><b>${esc(m.name)}${m.id === myId ? ' <em>(you)</em>' : ''}</b><small>${m.id === S.meta.hostId ? '👑 Host · ' : ''}${m.seat ? `Row ${m.seat.r + 1}, seat ${m.seat.c + 1}` : 'Standing at the back'}${m.connected ? '' : ' · reconnecting'}</small></div>
        ${vBadge}
        ${host && m.id !== myId && m.connected ? '<button class="linkb" data-a="host">Make host</button>' : ''}</li>`;
    }).join('');
    renderBadges();
  }
  $('#host-settings').addEventListener('change', (e) => {
    if (e.target.id === 'optctl') net.send('settings', { everyoneControls: e.target.checked });
    if (e.target.id === 'optpub') net.send('settings', { isPublic: e.target.checked });
  });
  $('#host-settings').addEventListener('click', (e) => {
    if (e.target.id === 'hostdismiss') askDismiss();
  });
  $('#people').onclick = async (e) => {
    const b = e.target.closest('[data-a="host"]'); if (!b) return;
    const r = await net.request('transfer', { to: b.closest('li').dataset.id }).catch(() => null);
    if (r && !r.ok) toast(r.error);
  };

  /* ------------------------------------------------------------ render-all + tick */
  function renderMeta() {
    if (!S.meta) return;
    seatmap.update({ members: S.meta.members, me: myId });
    renderPeople(); renderQueue(); renderPolls(); renderOverlay();
    const n = S.meta.members.filter((m) => m.connected).length;
    $('#rsub').textContent = `${n} watching · host ${(memberById(S.meta.hostId) || {}).name || '—'}${S.meta.settings.everyoneControls ? ' · everyone can control' : ''}`;
    $('#picklabel').textContent = canControl() ? 'Change movie' : 'Add to queue';
    const disBtn = $('#dismissbtn');
    if (disBtn) disBtn.style.display = isHost() ? 'inline-flex' : 'none';
    hooks.onRoom && hooks.onRoom({ code, count: n });
    updateControlsState();
  }
  function updateControlsState() {
    const can = canControl();
    ['pp', 'back', 'fwd', 'seek'].forEach((id) => { $('#' + id).disabled = !can; });
    $('#controls').classList.toggle('locked', !can);
    $('#controls').title = can ? '' : 'Only the host controls playback';
  }

  function tick() {
    if (!S.pb) return;
    reconcile();
    const pb = S.pb;
    $('#rtitle').textContent = pb.source ? pb.source.title : 'Waiting for a movie';
    $('#pp').textContent = pb.playing ? '⏸' : '▶';
    const t = pb.source ? Math.min(exp(), dur || Infinity) : 0;
    if (!dragging) {
      $('#tcur').textContent = fmtTime(t);
      seek.value = dur ? Math.round((t / dur) * SEEK_RES) : 0;
    }
    $('#tdur').textContent = fmtTime(dur);
    const pill = $('#sync');
    const rtt = net.clock.rtt != null ? `${Math.round(net.clock.rtt)} ms ping` : '';
    let label, cls;
    if (!net.online) { label = 'Reconnecting…'; cls = 'bad'; }
    else if (blocked) { label = 'Tap the screen to start'; cls = 'warn'; }
    else if (!pb.source) { label = 'Idle'; cls = ''; }
    else if (!pb.playing) { label = 'Paused'; cls = 'ok'; }
    else if (Math.abs(drift) < IN_SYNC) { label = 'In sync'; cls = 'ok'; }
    else { label = 'Catching up'; cls = 'warn'; }
    pill.className = `syncpill ${cls}`;
    pill.textContent = `● ${label}${rtt ? ' · ' + rtt : ''}${pb.playing && player ? ` · drift ${Math.round(drift * 1000)} ms` : ''}`;
    const cd = root.querySelector('#countdown');
    if (cd && S.meta && S.meta.scheduledFor) {
      const s = Math.max(0, Math.round((S.meta.scheduledFor - Date.now()) / 1000));
      cd.textContent = s ? `in ${fmtTime(s)}` : 'any moment now';
    }
  }
  const tickTimer = setInterval(tick, 250);
  const infoTimer = setInterval(() => { if (S.pb && S.pb.playing) renderOverlay(); }, 5000);

  /* ------------------------------------------------------------ network wiring */
  function applySnapshot(r) {
    S.meta = r.meta; S.pb = r.playback; S.chat = r.chat; S.queue = r.queue; S.polls = r.polls;
    if (net.clock.rtt == null) net.clock.offset = r.playback.serverNow - Date.now();
    ensurePlayer(); renderChat(); renderMeta(); tick(); setTimeout(reconcile, 300);
  }
  async function join() {
    try {
      const r = await net.request('join', { code, clientId: myId, name: getProfile().name, color: getProfile().color, seat: getProfile().seat });
      if (!r.ok) { fatal(r.error); return; }
      joinedOnce = true; applySnapshot(r);
    } catch { /* will retry on reconnect */ }
  }
  function fatal(msg) {
    root.innerHTML = `<div class="empty big"><h2>${esc(msg)}</h2><p>Rooms disappear after a while with nobody in them.</p><a class="btn-y" href="#/">Back to the cinema</a></div>`;
    hooks.onRoom && hooks.onRoom(null);
  }

  unsubs.push(net.on('meta', (d) => { S.meta = d; renderMeta(); }));
  unsubs.push(net.on('pb', (d) => {
    const prevPlaying = S.pb && S.pb.playing;
    S.pb = d;
    ensurePlayer();
    if (!d.tick) { if (d.playing !== prevPlaying || d.rev) renderOverlay(); }
    reconcile(); tick();
  }));
  unsubs.push(net.on('chat', (c) => {
    S.chat.push(c); if (S.chat.length > 150) S.chat.shift();
    const box = $('#msgs'); const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.appendChild(chatNode(c)); if (atEnd || c.from === myId) box.scrollTop = box.scrollHeight;
    if (!c.sys) seatmap.bubble(c.from, c.text);
    if (S.tab !== 'chat' && !c.sys && c.from !== myId) { S.unread++; renderBadges(); }
  }));
  unsubs.push(net.on('react', (d) => seatmap.react(d.from, d.emoji)));
  unsubs.push(net.on('queue', (q) => { S.queue = q; renderQueue(); }));
  unsubs.push(net.on('polls', (p) => { S.polls = p; renderPolls(); }));
  unsubs.push(net.on('kicked', (d) => { toast(d.reason); location.hash = '#/'; }));
  unsubs.push(net.on('open', () => { if (joinedOnce) join(); }));
  unsubs.push(net.on('voice_state', (d) => {
    voice.handlePeerVoiceState(d.id, d);
    if (S.meta) {
      const m = S.meta.members.find((x) => x.id === d.id);
      if (m) {
        m.inVoice = d.inVoice;
        m.voiceMuted = d.muted;
        m.speaking = d.speaking;
      }
    }
    seatmap.setSpeaking(d.id, !!d.speaking);
    renderPeople();
  }));
  unsubs.push(net.on('voice_signal', (d) => {
    voice.handleSignal(d.from, d.signal);
  }));
  unsubs.push(net.on('dismissed', (d) => {
    voice.leave();
    modal(`<h2 class="mh" style="color:var(--bad)">Party Dismissed</h2>
      <p class="muted">The host <b>${esc(d.by || 'Host')}</b> has dismissed this watch party.</p>
      <div style="margin-top:18px"><a class="btn-y" href="#/">Return to Cinema</a></div>`);
    location.hash = '#/';
    toast('The watch party was ended by the host.');
  }));

  net.connect();
  if (net.online) join(); else { const off = net.onStatus((o) => { if (o) { off(); if (!joinedOnce) join(); } }); unsubs.push(off); }

  return () => {
    disposed = true;
    voice.destroy();
    clearInterval(tickTimer); clearInterval(infoTimer);
    document.removeEventListener('keydown', onKey);
    unsubs.forEach((u) => u && u());
    if (player) player.destroy();
    net.send('leave');
    hooks.onRoom && hooks.onRoom(null);
  };
}

/* ---- first-visit profile prompt ---- */
function askProfile(code) {
  return new Promise((resolve) => {
    const p = getProfile();
    let color = p.color, done = false;
    const m = modal(`<h2 class="mh">Take a seat</h2>
      <p class="muted">You're joining room <b>${esc(code)}</b>. Pick a name and a colour, your friends will see them on your seat.</p>
      <form class="stack" id="pf">
        <input id="pname" maxlength="24" value="${esc(p.name)}" placeholder="Your name" autocomplete="off">
        <div class="swatches" id="sw">${COLORS.map((c) => `<button type="button" class="${c === color ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
        <button class="btn-y">Take my seat</button>
      </form>`, { onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('#sw').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      color = b.dataset.c; m.el.querySelectorAll('#sw button').forEach((x) => x.classList.toggle('on', x === b));
    };
    m.el.querySelector('#pf').onsubmit = (e) => {
      e.preventDefault();
      saveProfile({ name: m.el.querySelector('#pname').value.trim() || p.name, color, named: true });
      done = true; m.close();
      resolve(true);
    };
    setTimeout(() => m.el.querySelector('#pname').select(), 50);
  });
}
