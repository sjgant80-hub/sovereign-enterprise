// grow.mjs — a node GROWS its own brain from its own data. Pure, total, deterministic.
//
// The second half of "every node is a brain": a node does not only receive patterns, it grows them. Given its own
// labelled rows it germinates a grow-seed (an evolutionary search over an interpretable scorecard — a handful of
// single-feature threshold rules), fits the champion on its train rows, grades it on held-out rows it never grew on,
// and keeps it only if it clears the gate. Two nodes growing on two different samples reach two INDEPENDENT patterns
// for the same job — which is what makes a second brain's agreement worth something on a high-stakes call.
//
// The ribosome (seed → grow → fit → grade on held-out) is seed-library's, vendored verbatim under
// ../vendor/seed-library and credited (seed-library / fall-spore / pattern-organs, sjgant80-hub; the Konomi
// architecture by Thomas Frumkin). The pattern shape is the Konomi SLM's, so a grown pattern routes, answers,
// travels and is adopted exactly like a shipped one.
import { makeSeed, encodeSeed, germinate, fit, quantile, round6, MAXFEATS } from '../vendor/seed-library/seedlib.mjs';
import { sha256 } from './sha256.mjs';
import { GATE_AUC, validPattern, passesGate, fires } from './brain.mjs';

export const GROW = Object.freeze({ population: 24, elites: 4, generations: 16 });
export const MIN_ROWS = 120;       // fewer than this and a held-out grade means nothing — refuse to grow
const HELD_EVERY = 10, HELD_SLOTS = 3;   // 3 rows in every 10 are held out (seed-library's split)

/** Rows [{...features, y}] → a seed-library dataset, or null. */
export function toDataset(name, rows, features) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return null;
  if (!Array.isArray(rows) || !Array.isArray(features) || features.length < 1 || features.length > MAXFEATS) return null;
  if (features.some((f) => typeof f !== 'string' || f === 'y')) return null;
  const good = rows.filter((r) => r && typeof r === 'object' && (r.y === 0 || r.y === 1) && features.every((f) => Number.isFinite(r[f])));
  const n = good.length;
  if (n < MIN_ROWS) return null;
  const cols = {};
  for (const f of features) cols[f] = Float64Array.from(good, (r) => r[f]);
  const y = Uint8Array.from(good, (r) => r.y);
  const trainRows = [], heldRows = [];
  for (let i = 0; i < n; i++) (i % HELD_EVERY < HELD_SLOTS ? heldRows : trainRows).push(i);
  return { ok: true, name, features: features.slice(), n, cols, y, trainRows, heldRows };
}

/** Grow a pattern for `domain` from a node's own rows. → { ok, pattern, verified, why } — never throws. */
export function growPattern(domain, rows, features, { seed = 1, grow = GROW, grownBy = '' } = {}) {
  try {
    const ds = toDataset(domain, rows, features);
    if (!ds) return { ok: false, verified: false, why: 'not enough clean labelled rows to grow on (need ' + MIN_ROWS + ')' };
    if (!ds.y.some((v) => v === 1) || !ds.y.some((v) => v === 0)) return { ok: false, verified: false, why: 'only one class in the rows — nothing to learn' };
    const seedStr = encodeSeed(makeSeed({ domain, seed: Math.max(1, seed >>> 0), grow }));
    const g = germinate(ds, seedStr, { guard: true });
    if (!g.ok) return { ok: false, verified: false, why: g.error };
    const card = fit(ds, ds.trainRows, g.genome);
    const op = operatingPoint(card, ds);
    const dist = {};
    for (const f of ds.features) {
      const xs = ds.trainRows.map((i) => ds.cols[f][i]);
      dist[f] = { min: round6(Math.min(...xs)), q1: round6(quantile(ds, f, ds.trainRows, 0.25)), med: round6(quantile(ds, f, ds.trainRows, 0.5)),
        q3: round6(quantile(ds, f, ds.trainRows, 0.75)), max: round6(Math.max(...xs)) };
    }
    const pattern = {
      model: 'konomi-slm/1', domain, title: domain, role: '', real: false,
      features: ds.features, rules: card.rules.map((r) => ({ feat: r.feat, op: r.op, v: r.v, w: r.w })),
      base: op.base, threshold: op.thr, spread: op.spread,
      heldAuc: g.heldAuc, heldAcc: g.heldAcc, held: g.held, train: g.train, dist,
      seed: seedStr, grownBy: String(grownBy).slice(0, 64), verified: passesGate(g.heldAuc),
    };
    pattern.patternId = sha256(JSON.stringify({ d: domain, s: seedStr, r: pattern.rules })).slice(0, 16);
    if (!validPattern(pattern)) return { ok: false, verified: false, why: 'the grown pattern is malformed' };
    return { ok: true, pattern, verified: pattern.verified, why: pattern.verified ? 'grew and passed held-out (AUC ' + g.heldAuc + ')' : 'grew but failed held-out (AUC ' + g.heldAuc + ' < ' + GATE_AUC + ') — CUT' };
  } catch {
    return { ok: false, verified: false, why: 'growth failed closed' };
  }
}

// the operating threshold (from TRAIN: predict positive for the top `base` share) — the Konomi SLM's rule
function operatingPoint(card, ds) {
  const tr = ds.trainRows;
  const base = tr.reduce((a, i) => a + ds.y[i], 0) / tr.length;
  const ts = tr.map((i) => card.rules.reduce((s, r) => s + (fires(r, ds.cols[r.feat][i]) ? r.w : 0), 0)).sort((a, b) => a - b);
  const thr = ts[Math.floor((1 - base) * ts.length)];       // both classes are present, so base > 0 and this index is in range
  const spread = Math.max(ts[ts.length - 1] - ts[0], 1e-9);
  return { thr: round6(thr), base: round6(base), spread: round6(spread) };
}
