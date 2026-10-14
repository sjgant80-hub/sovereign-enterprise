// train.mjs — teach the company your own work: a CSV of your own records → a verified brain, grown on your device.
// Pure, total, deterministic. Nothing leaves the page.
//
// The CSV reader is csv-forge's (sjgant80-hub/csv-forge, vendored unchanged at 19633c3 under ../vendor/csv-forge):
// parse → infer each column → pick the yes/no column to predict → encode every usable feature. This kernel then keeps
// the (at most 16) features most related to the outcome, gives them names that can travel on the spine, and grows a
// brain with the same ribosome the agents use (grow.mjs) — graded on held-out rows it never grew on, and refused if it
// does not clear the gate. A brain grown here routes, answers, travels and is adopted exactly like the shipped ones.
import { prepare } from '../vendor/csv-forge/csv.mjs';
import { growPattern, MIN_ROWS } from './grow.mjs';

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

/**
 * CSV text → a brain. opts: { target (column name), domain (a name for the brain), seed }.
 * → { ok, verified, why, pattern, target, positive, rows, features: [{ name, from, relevance }], dropped }
 */
export function trainFromCsv(text, opts) {
  try {
    const { target, domain = 'custom', seed = 1 } = opts || {};
    if (typeof text !== 'string' || !text.trim()) return { ok: false, verified: false, why: 'an empty file' };
    if (!DOMAIN.test(domain)) return { ok: false, verified: false, why: 'the brain needs a lower-case name (letters, digits, - or _)' };
    const p = prepare(text, typeof target === 'string' ? { targetName: target } : {});
    if (!p.targetName || p.classes.length !== 2) return { ok: false, verified: false, why: 'it needs a column with exactly two values to predict — yes/no, churned/stayed, paid/defaulted' };
    if (p.cases.length < MIN_ROWS) return { ok: false, verified: false, why: 'it needs at least ' + MIN_ROWS + ' rows to grow and grade a brain honestly (this file has ' + p.cases.length + ')' };
    const ys = p.cases.map((c) => c.y);
    const ranked = p.featureNames.map((name, j) => ({ name, j, r: relevance(p.cases.map((c) => c.x[j]), ys) }))
      .filter((f) => f.r > 0)
      .sort((a, b) => b.r - a.r);                      // sort is stable: equally related columns keep the file's order
    const keep = ranked.slice(0, MAX_FEATURES);
    if (!keep.length) return { ok: false, verified: false, why: 'no column moves with the outcome — there is nothing to learn' };
    const safe = safeNames(keep.map((f) => f.name));
    const rows = p.cases.map((c) => { const r = {}; keep.forEach((f, k) => { r[safe[k]] = c.x[f.j]; }); r.y = c.y; return r; });
    const g = growPattern(domain, rows, safe, { seed });
    const features = keep.map((f, k) => ({ name: safe[k], from: f.name, relevance: Math.round(f.r * 1000) / 1000 }));
    if (!g.ok) return { ok: false, verified: false, why: g.why, target: p.targetName, positive: p.positiveLabel, rows: p.cases.length, features, dropped: ranked.length - keep.length };
    return { ok: true, verified: g.verified, why: g.why, pattern: g.pattern, target: p.targetName, positive: p.positiveLabel, rows: p.cases.length, features, dropped: ranked.length - keep.length };
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
