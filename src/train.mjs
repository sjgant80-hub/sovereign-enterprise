// train.mjs — teach the company your own work: a CSV of your own records → a verified brain, grown on your device.
// Pure, total, deterministic. Nothing leaves the page.
//
// The CSV reader is csv-forge's (sjgant80-hub/csv-forge, vendored unchanged at 19633c3 under ../vendor/csv-forge):
// parse → infer each column → pick the yes/no column to predict → encode every usable feature. This kernel then keeps
// the (at most 16) features most related to the outcome, gives them names that can travel on the spine, and grows a
// brain with the same ribosome the agents use (grow.mjs) — graded on held-out rows it never grew on, and refused if it
// does not clear the gate. A brain grown here routes, answers, travels and is adopted exactly like the shipped ones.
import { prepare, parseCsv } from '../vendor/csv-forge/csv.mjs';
import { growPattern, MIN_ROWS } from './grow.mjs';
import { dateOf } from './bridge.mjs';

export const MAX_FEATURES = 16;
const DOMAIN = /^[a-z][a-z0-9_-]{0,31}$/;

/** A feature name that can travel inside a spine record (no separators), unique within the set. */
export function safeNames(names) {
  const used = new Set();
  return (Array.isArray(names) ? names : []).map((n, i) => {
    let s = String(n).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 28);
    if (!/^[A-Za-z]/.test(s)) s = 'f' + i + (s ? '_' + s : '');
    let out = s, k = 2;
    while (used.has(out)) out = s.slice(0, 26) + '_' + k++;
    used.add(out);
    return out;
  });
}

/** How strongly a feature column moves with the outcome: |Pearson r| with the 0/1 label (0 for a constant column). */
export function relevance(xs, ys) {
  const n = xs.length;
  if (n !== ys.length) return 0;                       // an empty pair falls through to sxx = 0 below, so it scores 0 too
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? Math.abs(sxy / Math.sqrt(sxx * syy)) : 0;
}

const cellOf = (r, i) => String(r[i] ?? '').trim();   // csv-forge's own cell rule: a missing cell reads as empty
const DATE_NAME = /date|day|time|when/i;
/**
 * The order a file's cases are grown and graded in (p: csv-forge's preparation of the same text). When one column gives
 * EVERY case a real calendar day (bridge.mjs dateOf), the cases go oldest first and the grade is on the newest — how the
 * brain does on what came after everything it grew on (split 'time'); a column named for a date is tried first. Otherwise
 * the file's own order, graded on 3 rows in every 10 spread through it (split 'mixed'). The receipt orders the same file
 * the same way, so a brain's held-out score reproduces exactly. → { order: [case index], split, column, days }
 */
export function datedOrder(text, p) {
  const n = p && Array.isArray(p.cases) ? p.cases.length : 0;
  const mixed = { order: Array.from({ length: n }, (_, i) => i), split: 'mixed', column: '', days: [] };
  try {
    const { header, rows } = parseCsv(text);
    const kept = rows.filter((r) => cellOf(r, p.targetIndex) !== '');   // csv-forge's own case rule: the outcome is known
    if (n === 0 || kept.length !== n) return mixed;
    const cols = header.map((_, c) => c).filter((c) => c !== p.targetIndex);
    const named = cols.filter((c) => DATE_NAME.test(String(header[c])));
    for (const c of [...named, ...cols.filter((x) => !named.includes(x))]) {
      const days = kept.map((r) => dateOf(cellOf(r, c)));
      if (days.includes('')) continue;
      // oldest first, a day as the number YYYYMMDD; one day keeps the file's order
      const order = days.map((d, i) => [Number(d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10)), i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[1]);
      return { order, split: 'time', column: String(header[c]), days: order.map((i) => days[i]) };
    }
    return mixed;
  } catch { return mixed; }
}

/**
 * CSV text → a brain. opts: { target (column name), domain (a name for the brain), seed }.
 * When the file dates every case, it is graded on the newest rows (datedOrder) and says so: split 'time', graded: { column,
 * from, to } (the first and last day of the rows it was graded on); else split 'mixed', graded null.
 * → { ok, verified, why, pattern, split, graded, heldBase: { n, yes } (the graded rows, and how many were the positive answer), target, positive, rows, features: [{ name, from, relevance }], dropped }
 */
export function trainFromCsv(text, opts) {
  try {
    const { target, domain = 'custom', seed = 1 } = opts || {};
    if (typeof text !== 'string' || !text.trim()) return { ok: false, verified: false, why: 'an empty file' };
    if (!DOMAIN.test(domain)) return { ok: false, verified: false, why: 'the brain needs a lower-case name (letters, digits, - or _)' };
    const p = prepare(text, typeof target === 'string' ? { targetName: target } : {});
    if (!p.targetName || p.classes.length !== 2) return { ok: false, verified: false, why: 'it needs a column with exactly two values to predict — yes/no, churned/stayed, paid/defaulted' };
    if (p.cases.length < MIN_ROWS) return { ok: false, verified: false, why: 'it needs at least ' + MIN_ROWS + ' rows to grow and grade a brain honestly (this file has ' + p.cases.length + ')' };
    const ord = datedOrder(text, p);
    const cases = ord.order.map((i) => p.cases[i]);
    const ys = cases.map((c) => c.y);
    const ranked = p.featureNames.map((name, j) => ({ name, j, r: relevance(cases.map((c) => c.x[j]), ys) }))
      .filter((f) => f.r > 0)
      .sort((a, b) => b.r - a.r);                      // sort is stable: equally related columns keep the file's order
    const keep = ranked.slice(0, MAX_FEATURES);
    if (!keep.length) return { ok: false, verified: false, why: 'no column moves with the outcome — there is nothing to learn' };
    const safe = safeNames(keep.map((f) => f.name));
    const rows = cases.map((c) => { const r = {}; keep.forEach((f, k) => { r[safe[k]] = c.x[f.j]; }); r.y = c.y; return r; });
    const g = growPattern(domain, rows, safe, { seed, split: ord.split });
    const graded = ord.split === 'time' && g.heldBase ? { column: ord.column, from: ord.days[ord.days.length - g.heldBase.n], to: ord.days[ord.days.length - 1] } : null;
    const features = keep.map((f, k) => ({ name: safe[k], from: f.name, relevance: Math.round(f.r * 1000) / 1000 }));
    if (!g.ok) return { ok: false, verified: false, why: g.why, target: p.targetName, positive: p.positiveLabel, rows: p.cases.length, features, dropped: ranked.length - keep.length };
    return { ok: true, verified: g.verified, why: g.why, pattern: g.pattern, split: ord.split, graded, heldBase: g.heldBase, target: p.targetName, positive: p.positiveLabel, rows: p.cases.length, features, dropped: ranked.length - keep.length };
  } catch {
    return { ok: false, verified: false, why: 'the file could not be read' };
  }
}

/** The real sales sample as a CSV, so a visitor can try training without a file of their own. */
export function sampleCsv(json) {
  try {
    const head = [...json.features, 'Purchased'].join(',');
    return [head, ...json.data.map((r) => r.slice(0, json.features.length).concat(r[json.features.length] ? 'yes' : 'no').join(','))].join('\n');
  } catch { return ''; }
}
