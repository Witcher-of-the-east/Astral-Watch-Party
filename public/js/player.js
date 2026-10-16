// Player adapters with one shared interface so the room code does not care what is playing.
//   { kind, canNudge, ready, play(), pause(), seek(t), getTime(), getDuration(), isPlaying(),
//     isEnded(), setRate(r), setVolume(v 0..1), setMuted(b), destroy() }
// handlers: { onEnded(), onDuration(sec), onBlocked() }

let ytPromise = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { ytPromise = null; reject(new Error('YouTube could not be loaded')); };
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}

function fileAdapter(container, source, h) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  // Offer an alternative encoding when the movie has one; the browser picks what it can decode.
  [[source.url, /\.webm(\?|$)/i.test(source.url) ? 'video/webm' : 'video/mp4'], source.alt && [source.alt, /\.webm(\?|$)/i.test(source.alt) ? 'video/webm' : 'video/mp4']]
    .filter(Boolean).forEach(([src, type]) => { const el = document.createElement('source'); el.src = src; el.type = type; v.appendChild(el); });
  v.className = 'vid';
  container.appendChild(v);
  v.addEventListener('ended', () => h.onEnded && h.onEnded());
  v.addEventListener('loadedmetadata', () => h.onDuration && h.onDuration(v.duration));
  const fail = () => h.onError && h.onError('This video could not be loaded.');
  v.addEventListener('error', fail);
  v.lastElementChild && v.lastElementChild.addEventListener('error', fail);
  const api = {
    kind: 'file', canNudge: true,
    ready: Promise.resolve(),
    play() {
      const p = v.play();
      return p ? p.catch((e) => { if (e && e.name === 'NotAllowedError') { h.onBlocked && h.onBlocked(); } }) : Promise.resolve();
    },
    pause() { v.pause(); },
    seek(t) { try { v.currentTime = Math.max(0, t); } catch { /* not ready */ } },
    getTime: () => v.currentTime || 0,
    getDuration: () => (Number.isFinite(v.duration) ? v.duration : 0),
    isPlaying: () => !v.paused && !v.ended,
    isEnded: () => v.ended,
    setRate(r) { if (Math.abs(v.playbackRate - r) > 0.001) v.playbackRate = r; },
    setVolume(x) { v.volume = x; },
    setMuted(b) { v.muted = b; },
    destroy() { v.pause(); v.querySelectorAll('source').forEach((x) => x.remove()); v.load(); v.remove(); }
  };
  return api;
}

function youtubeAdapter(container, source, h) {
  const holder = document.createElement('div');
  holder.className = 'ytholder';
  container.appendChild(holder);
  let player = null, destroyed = false, state = -1, dur = 0;
  const ready = loadYT().then((YT) => new Promise((resolve) => {
    if (destroyed) return resolve();
    const target = document.createElement('div');
    holder.appendChild(target);
    player = new YT.Player(target, {
      videoId: source.ytId,
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => { dur = player.getDuration() || 0; h.onDuration && h.onDuration(dur); resolve(); },
        onStateChange: (e) => {
          state = e.data;
          if (state === 0) h.onEnded && h.onEnded();
          if (state === 1) { dur = player.getDuration() || dur; h.onDuration && h.onDuration(dur); }
        },
        onError: () => h.onError && h.onError('YouTube refused to play this video (embedding may be disabled).')
      }
    });
  })).catch((e) => { h.onError && h.onError(e.message); });
  let wantPlay = false;
  return {
    kind: 'youtube', canNudge: false, ready,
    play() {
      wantPlay = true;
      if (player && player.playVideo) player.playVideo();
      // If the browser blocks autoplay the state never becomes "playing".
      setTimeout(() => { if (wantPlay && !destroyed && state !== 1 && state !== 3) h.onBlocked && h.onBlocked(); }, 1800);
      return Promise.resolve();
    },
    pause() { wantPlay = false; player && player.pauseVideo && player.pauseVideo(); },
    seek(t) { player && player.seekTo && player.seekTo(Math.max(0, t), true); },
    getTime: () => (player && player.getCurrentTime ? player.getCurrentTime() || 0 : 0),
    getDuration: () => dur,
    isPlaying: () => state === 1 || state === 3,
    isEnded: () => state === 0,
    setRate() {},
    setVolume(x) { player && player.setVolume && player.setVolume(Math.round(x * 100)); },
    setMuted(b) { player && (b ? player.mute() : player.unMute()); },
    destroy() { destroyed = true; try { player && player.destroy(); } catch { /* ignore */ } holder.remove(); }
  };
}

export function createPlayer(container, source, handlers) {
  return source.kind === 'youtube' ? youtubeAdapter(container, source, handlers) : fileAdapter(container, source, handlers);
}
