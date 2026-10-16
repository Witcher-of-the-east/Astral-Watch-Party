// Fuzzy movie search: exact/prefix/substring hits rank highest, then in-order letter matches
// ("tfst" -> "Tears of Steel"), then typo tolerance (Levenshtein <= 2 on whole words).
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}
function subseq(q, s) {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

function scoreField(q, text, weight, loose = false) {
  const s = norm(text);
  if (!s.trim()) return 0;
  if (s.trim() === q) return 100 * weight;
  if (s.startsWith(q)) return 80 * weight;
  if (s.includes(' ' + q)) return 70 * weight;
  if (s.includes(q)) return 55 * weight;
  const words = s.split(/\s+/).filter(Boolean);
  const qw = q.split(/\s+/).filter(Boolean);
  if (qw.length && qw.every((w) => words.some((x) => x.startsWith(w) || (w.length > 3 && lev(w, x) <= 2)))) return 45 * weight;
  if (loose && q.length >= 3 && subseq(q.replace(/ /g, ''), s.replace(/ /g, ''))) return 25 * weight;
  return 0;
}

export function searchMovies(movies, query, { genre = null } = {}) {
  const q = norm(query).trim();
  let list = movies;
  if (genre && genre !== 'All') list = list.filter((m) => m.genres.includes(genre));
  if (!q) return list;
  return list
    .map((m) => {
      const score = Math.max(
        scoreField(q, m.title, 1, true),
        scoreField(q, m.genres.join(' '), 0.6),
        scoreField(q, m.cast.map((c) => c.name).join(' '), 0.5, true),
        scoreField(q, m.director, 0.4),
        scoreField(q, m.description, 0.3)
      );
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}
