// Procedural artwork: every poster, backdrop and cast portrait is generated as SVG from the
// movie's `theme`, so the project ships no copyrighted images and works offline.

function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h)},${s}%,${l}%,${a})`;
const f = (n) => Math.round(n * 10) / 10;

function smooth(points, W, H, close = true) {
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q${f(points[i][0])} ${f(points[i][1])} ${f(mx)} ${f(my)}`;
  }
  const last = points[points.length - 1];
  d += ` L${f(last[0])} ${f(last[1])}`;
  return close ? `${d} L${W} ${H} L0 ${H}Z` : d;
}
function ridge(W, H, r, base, amp, steps, fill, jag) {
  const pts = [[0, base]];
  for (let i = 0; i <= steps; i++) {
    const x = (W * i) / steps;
    const y = base - (jag ? r() * amp : (Math.sin(i * 0.8 + r() * 2) * 0.5 + 0.5) * amp);
    pts.push([x, y]);
  }
  if (jag) {
    let d = `M0 ${H} L0 ${f(base)}`;
    pts.slice(1).forEach((p) => { d += ` L${f(p[0])} ${f(p[1])}`; });
    return `<path d="${d} L${W} ${H}Z" fill="${fill}"/>`;
  }
  return `<path d="${smooth(pts, W, H)}" fill="${fill}"/>`;
}

function scene(motif, W, H, t, r) {
  const { h1, h2 } = t;
  const portrait = H > W;
  const sx = portrait ? 0.5 : 0.72, sy = portrait ? 0.34 : 0.38;
  let s = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hsl(h1, 60, 11)}"/><stop offset=".55" stop-color="${hsl(h2, 70, 30)}"/><stop offset="1" stop-color="${hsl(h1, 55, 8)}"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="${hsl(h2, 95, 72, 0.95)}"/><stop offset=".35" stop-color="${hsl(h2, 90, 58, 0.35)}"/><stop offset="1" stop-color="${hsl(h2, 90, 50, 0)}"/></radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .10 0"/></filter>
  </defs><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  const R = Math.min(W, H);

  if (motif === 'meadow') {
    s += `<circle cx="${W * sx}" cy="${H * sy}" r="${R * 0.75}" fill="url(#glow)"/><circle cx="${W * sx}" cy="${H * sy}" r="${R * 0.13}" fill="${hsl(h2, 100, 85)}"/>`;
    s += ridge(W, H, r, H * 0.62, H * 0.12, 18, hsl(h1 + 20, 45, 22), false);
    s += ridge(W, H, r, H * 0.74, H * 0.13, 16, hsl(h1 + 10, 50, 15), false);
    for (let i = 0; i < 16; i++) {
      const x = r() * W, y = H * (0.66 + r() * 0.12), rr = R * (0.04 + r() * 0.05);
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${hsl(h1 + 15, 50, 10 + r() * 6)}"/><rect x="${f(x - rr * 0.1)}" y="${f(y)}" width="${f(rr * 0.2)}" height="${f(rr * 1.2)}" fill="${hsl(25, 40, 8)}"/>`;
    }
    s += ridge(W, H, r, H * 0.9, H * 0.12, 14, hsl(h1, 50, 6), false);
  } else if (motif === 'peaks') {
    s += `<circle cx="${W * 0.7}" cy="${H * 0.3}" r="${R * 0.8}" fill="url(#glow)"/><circle cx="${W * 0.7}" cy="${H * 0.3}" r="${R * 0.17}" fill="${hsl(h2, 60, 90)}"/>`;
    s += `<circle cx="${W * 0.74}" cy="${H * 0.28}" r="${R * 0.15}" fill="${hsl(h1, 60, 14)}" opacity=".35"/>`;
    s += ridge(W, H, r, H * 0.62, H * 0.38, 22, hsl(h1, 45, 24), true);
    s += `<rect y="${H * 0.5}" width="${W}" height="${H * 0.3}" fill="${hsl(h2, 70, 80, 0.10)}"/>`;
    s += ridge(W, H, r, H * 0.78, H * 0.3, 26, hsl(h1, 50, 13), true);
    s += ridge(W, H, r, H * 0.95, H * 0.2, 30, hsl(h1, 55, 6), true);
  } else if (motif === 'city') {
    s += `<circle cx="${W * 0.62}" cy="${H * 0.42}" r="${R * 0.52}" fill="none" stroke="${hsl(h2, 90, 62)}" stroke-width="${R * 0.018}" opacity=".85"/>`;
    s += `<circle cx="${W * 0.62}" cy="${H * 0.42}" r="${R * 0.62}" fill="url(#glow)" opacity=".7"/>`;
    for (let layer = 0; layer < 2; layer++) {
      const col = hsl(h1, 50, layer ? 5 : 11);
      let x = -10;
      while (x < W) {
        const w = R * (0.06 + r() * 0.09), h = H * (layer ? 0.18 + r() * 0.3 : 0.28 + r() * 0.3);
        s += `<rect x="${f(x)}" y="${f(H - h)}" width="${f(w)}" height="${f(h)}" fill="${col}"/>`;
        if (layer) for (let k = 0; k < 8; k++) if (r() > 0.55) s += `<rect x="${f(x + r() * (w - 4))}" y="${f(H - h + r() * h * 0.8)}" width="3" height="4" fill="${hsl(h2, 100, 70)}" opacity=".85"/>`;
        x += w + R * 0.01;
      }
    }
  } else if (motif === 'arches') {
    s += `<circle cx="${W * 0.5}" cy="${H * 0.55}" r="${R * 0.7}" fill="url(#glow)"/>`;
    for (let i = 0; i < 7; i++) {
      const w = W * (0.9 - i * 0.12), top = H * (0.1 + i * 0.07), cx = W / 2;
      s += `<path d="M${f(cx - w / 2)} ${H} V${f(top + w / 2)} A${f(w / 2)} ${f(w / 2)} 0 0 1 ${f(cx + w / 2)} ${f(top + w / 2)} V${H}" fill="none" stroke="${hsl(h1 + i * 8, 70, 30 + i * 5)}" stroke-width="${R * 0.02}" opacity="${0.9 - i * 0.08}"/>`;
    }
    for (let i = 0; i < 6; i++) s += `<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.6)}" r="${f(R * (0.02 + r() * 0.06))}" fill="${hsl(h2, 90, 65)}" opacity=".8"/>`;
    s += `<rect y="${H * 0.82}" width="${W}" height="${H * 0.18}" fill="${hsl(h1, 55, 7)}"/>`;
  } else if (motif === 'rays') {
    const cx = W * 0.55, cy = H * 0.7;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, l = R * 1.6;
      s += `<path d="M${f(cx)} ${f(cy)} L${f(cx + Math.cos(a) * l)} ${f(cy + Math.sin(a) * l)} L${f(cx + Math.cos(a + 0.08) * l)} ${f(cy + Math.sin(a + 0.08) * l)}Z" fill="${hsl(h2, 100, 60)}" opacity="${0.06 + r() * 0.12}"/>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="${R * 0.7}" fill="url(#glow)"/>`;
    for (let i = 0; i < 9; i++) {
      const x = W * (0.2 + r() * 0.7), h = H * (0.15 + r() * 0.4), w = R * (0.05 + r() * 0.06);
      s += `<path d="M${f(x - w)} ${H} Q${f(x - w)} ${f(H - h * 0.6)} ${f(x)} ${f(H - h)} Q${f(x + w)} ${f(H - h * 0.6)} ${f(x + w)} ${H}Z" fill="${hsl(h2 - 10 + r() * 20, 100, 52 + r() * 14)}" opacity=".85"/>`;
    }
    s += `<rect y="${H * 0.9}" width="${W}" height="${H * 0.1}" fill="${hsl(h1, 60, 5)}"/>`;
  } else if (motif === 'road') {
    const hy = H * 0.56;
    s += `<circle cx="${W * 0.5}" cy="${hy}" r="${R * 0.7}" fill="url(#glow)"/><circle cx="${W * 0.5}" cy="${hy}" r="${R * 0.12}" fill="${hsl(h2, 100, 88)}"/>`;
    s += ridge(W, H, r, hy + 2, H * 0.12, 20, hsl(h1, 50, 12), true);
    s += `<rect y="${hy}" width="${W}" height="${H - hy}" fill="${hsl(h1, 40, 8)}"/>`;
    s += `<path d="M${W * 0.5 - 3} ${hy} L${W * 0.02} ${H} L${W * 0.98} ${H} L${W * 0.5 + 3} ${hy}Z" fill="${hsl(h1, 20, 16)}"/>`;
    for (let i = 0; i < 9; i++) {
      const t0 = i / 9, t1 = t0 + 0.05, y0 = hy + (H - hy) * t0 * t0, y1 = hy + (H - hy) * t1 * t1, w0 = 1 + t0 * t0 * 14, w1 = 1 + t1 * t1 * 14;
      s += `<path d="M${W / 2 - w0} ${f(y0)} L${W / 2 + w0} ${f(y0)} L${W / 2 + w1} ${f(y1)} L${W / 2 - w1} ${f(y1)}Z" fill="${hsl(h2, 100, 70)}" opacity=".9"/>`;
    }
  } else { // signal
    const cx = W / 2, cy = H * 0.46;
    for (let i = 8; i > 0; i--) s += `<circle cx="${cx}" cy="${cy}" r="${R * i * 0.07}" fill="none" stroke="${hsl(h2, 90, 60)}" stroke-width="${R * 0.006}" opacity="${0.12 + i * 0.07}"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${R * 0.5}" fill="url(#glow)" opacity=".6"/>`;
    const cols = [h1, h1 + 40, h2, h2 + 50, 300, 0, 120];
    cols.forEach((c, i) => { s += `<rect x="${(W / cols.length) * i}" y="${H * 0.84}" width="${W / cols.length + 1}" height="${H * 0.16}" fill="${hsl(c, 80, 50)}" opacity=".85"/>`; });
    for (let y = 0; y < H; y += 6) s += `<rect y="${y}" width="${W}" height="1" fill="#000" opacity=".18"/>`;
  }
  s += `<rect width="${W}" height="${H}" filter="url(#grain)"/>`;
  return s;
}

const cache = new Map();
// Single quotes so the value can sit inside a double-quoted style="" attribute.
const uri = (svg) => `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')`;

/** Wide cinematic background (CSS background-image value). */
export function backdrop(movie) {
  if (!movie) return '';
  if (movie.backdropUrl) return `url('${movie.backdropUrl.replace(/'/g, "\\'")}')`;
  if (movie.posterUrl) return `url('${movie.posterUrl.replace(/'/g, "\\'")}')`;
  const key = 'b' + movie.id;
  if (!cache.has(key)) {
    const W = 1600, H = 900;
    const motif = (movie.theme && movie.theme.motif) || 'signal';
    const theme = movie.theme || { h1: 200, h2: 40, motif };
    cache.set(key, uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${scene(motif, W, H, theme, rng(hash(movie.id || 'x')))}</svg>`));
  }
  return cache.get(key);
}

function wrap(title, max) {
  const words = title.toUpperCase().split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Portrait poster with title lettering (CSS background-image value). */
export function poster(movie) {
  if (!movie) return '';
  if (movie.posterUrl) return `url('${movie.posterUrl.replace(/'/g, "\\'")}')`;
  const key = 'p' + movie.id;
  if (!cache.has(key)) {
    const W = 300, H = 450, r = rng(hash(movie.id || 'x') ^ 7);
    const motif = (movie.theme && movie.theme.motif) || 'signal';
    const theme = movie.theme || { h1: 200, h2: 40, motif };
    const lines = wrap(movie.title || 'Movie', 11);
    const size = lines.some((l) => l.length > 9) ? 30 : 36;
    const text = lines.map((l, i) => `<text x="150" y="${392 - (lines.length - 1 - i) * (size + 4)}" text-anchor="middle" font-family="Montserrat, Arial Black, Impact, sans-serif" font-weight="800" font-size="${size}" letter-spacing="3" fill="#fff">${l.replace(/&/g, '&amp;')}</text>`).join('');
    const genre = (movie.genres && movie.genres[0]) ? movie.genres[0].toUpperCase() : 'FILM';
    cache.set(key, uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${scene(motif, W, H, theme, r)}
      <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#fade)"/>${text}
      <text x="150" y="426" text-anchor="middle" font-family="Montserrat, Arial, sans-serif" font-size="11" letter-spacing="4" fill="#f5c400">${movie.year || ''} · ${genre}</text>
      <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#fff" stroke-opacity=".12"/></svg>`));
  }
  return cache.get(key);
}

/** Illustrated cast-member portrait. */
export function portrait(name, hue) {
  const key = 'c' + name;
  if (!cache.has(key)) {
    const h = hash(name) % 360, r = rng(hash(name));
    const skin = hsl(20 + r() * 20, 40, 45 + r() * 25);
    cache.set(key, uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(h, 55, 36)}"/><stop offset="1" stop-color="${hsl(h + 50, 60, 14)}"/></linearGradient></defs>
      <rect width="120" height="150" fill="url(#g)"/>
      <path d="M10 150 C10 108 36 98 60 98 C84 98 110 108 110 150Z" fill="${hsl(h + 180, 30, 20)}"/>
      <rect x="51" y="82" width="18" height="22" rx="8" fill="${skin}"/>
      <ellipse cx="60" cy="64" rx="22" ry="26" fill="${skin}"/>
      <path d="M36 62 C34 36 52 28 62 30 C80 30 88 42 84 62 C80 50 70 44 60 46 C48 46 40 52 36 62Z" fill="${hsl(r() * 60, 30, 14 + r() * 14)}"/>
    </svg>`));
  }
  return cache.get(key);
}
