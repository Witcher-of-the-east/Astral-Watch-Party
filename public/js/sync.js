// Pure sync maths, shared by the browser (room.js) and the load test (scripts/loadtest.js).

/** Where the video should be right now, given the server's playback record and the server clock. */
export function expectedPos(pb, serverNow) {
  if (!pb) return 0;
  return pb.playing ? Math.max(0, pb.pos + (serverNow - pb.at) / 1000) : pb.pos;
}

/** Beyond this many seconds of drift we hard-seek instead of gently nudging the playback rate. */
export const HARD_SEEK = 0.5;
/** Inside this window we consider the viewer "in sync". */
export const IN_SYNC = 0.25;

/**
 * Decide how to correct a local player.
 * drift = localTime - expectedTime  (positive = we are ahead)
 * canNudge = the player supports fine playbackRate changes (HTML5 video yes, YouTube no)
 */
export function plan({ drift, playing, canNudge }) {
  const a = Math.abs(drift);
  if (!playing) return { seek: a > IN_SYNC, rate: 1 };
  if (a > HARD_SEEK) return { seek: true, rate: 1 };
  if (canNudge && a > 0.06) {
    const nudge = Math.max(-0.12, Math.min(0.12, drift * 0.6));
    return { seek: false, rate: 1 - nudge };
  }
  return { seek: false, rate: 1 };
}

/** Median-filtered NTP-style clock estimate from {rtt, off} samples (keeps the lowest-RTT ones). */
export function estimateClock(samples) {
  if (!samples.length) return { offset: 0, rtt: null };
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(samples.length / 2)));
  const offs = best.map((s) => s.off).sort((a, b) => a - b);
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  return { offset: offs[Math.floor(offs.length / 2)], rtt: rtts[Math.floor(rtts.length / 2)] };
}
