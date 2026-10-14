// brain.mjs — every node is a brain. Pure, total, deterministic.
//
// A brain is a library of VERIFIED patterns (the Konomi SLM: knowledge in a readable pattern library, not opaque
// weights — each pattern earned its place by predicting held-out cases it never saw). A node answers from its own
// library or ABSTAINS; it never guesses. The brains form one distributed intelligence over the spine — the mycelium:
//   · a pattern travels as a signed record (toRecord / fromRecord), like a nutrient through the hyphae;
//   · a node ADOPTS a pattern only after re-verifying it on its OWN local data (adopt) — never on the publisher's word;
//   · a node that abstains asks the mesh — a signed ask on the spine; the peer whose library covers it replies (mesh.mjs).
// The answer path (route → gate → verified pattern → receipt) is the Konomi SLM's, ported faithfully and credited:
// sjgant80-hub/konomi-slm, the Konomi architecture by Thomas Frumkin.
import { sha256 } from './sha256.mjs';

export const GATE_AUC = 0.6;     // a pattern is fit to answer only if its held-out AUC clears this
export const ROUTE_MIN = 0.35;   // below this membership the input is out of distribution → ABSTAIN
export const HIGH_STAKES_GATE = 0.65;       // adopting a brain for money or security work needs more than the plain gate
export const REGRESSION_TOLERANCE = 0.01;   // a replacement may score this much below the brain it replaces, no more

const DOMAIN = /^[a-z][a-z0-9_-]{0,31}$/;
const DIST_KEYS = ['min', 'q1', 'med', 'q3', 'max'];
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const round6 = (v) => (fin(v) ? Math.round(v * 1e6) / 1e6 : 0);

/** Is a held-out AUC good enough to answer from? (one gate, used everywhere a pattern is judged) */
export const passesGate = (heldAuc) => heldAuc >= GATE_AUC;

/** A rule fires when its feature crosses its cut. */
export const fires = (rule, x) => (rule.op === '>' ? x > rule.v : x <= rule.v);

/** Is this a well-formed pattern? (the shape every brain file and every received record must have) */
export function validPattern(p) {
  try {
    if (!DOMAIN.test(p.domain)) return false;
    if (!Array.isArray(p.features) || p.features.length > 16) return false;   // empty features can never cover a rule
    if (!Array.isArray(p.rules) || p.rules.length < 1 || p.rules.length > 12) return false;
    for (const r of p.rules) {
      if (!r || !p.features.includes(r.feat)) return false;
      if (r.op !== '>' && r.op !== '<=') return false;
      if (!fin(r.v) || !fin(r.w)) return false;
    }
    if (!fin(p.threshold) || !fin(p.spread) || !fin(p.base)) return false;
    if (!fin(p.heldAuc) || p.heldAuc < 0 || p.heldAuc > 1) return false;
    for (const f of p.features) if (!DIST_KEYS.every((k) => fin(p.dist[f][k]))) return false;
    return true;
  } catch { return false; }
}

/** Membership of a value in a feature's distribution: 1 inside the IQR, decaying outside it. Total. */
export function membership(value, fp) {
  try { return member(value, fp); } catch { return 0; }
}
function member(value, fp) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 0;
  const span = Math.max(fp.q3 - fp.q1, (fp.max - fp.min) * 0.5, 1e-9);
  const d = Math.max(fp.q1 - x, x - fp.q3, 0);       // 0 anywhere inside the IQR → membership exactly 1
  return round6(Math.exp(-d / span));
}

/** Score an input against a pattern's rules. Total. */
export function scoreInput(p, input) {
  try { return score(p, input); } catch { return 0; }
}
function score(p, input) {
  let s = 0;
  for (const rule of p.rules) {
    const x = Number(input[rule.feat]);
    if (Number.isFinite(x) && fires(rule, x)) s += rule.w;
  }
  return round6(s);
}

/** Which pattern in a library does this input fit, and how well? Total. */
export function route(library, input) {
  try { return routeIn(library, input); } catch { return { ok: false, best: null, ranked: [] }; }
}
function routeIn(library, input) {
  if (typeof library !== 'object' || typeof input !== 'object') return { ok: false, best: null, ranked: [] };   // null throws below → refused
  const ranked = [];
  for (const id of Object.keys(library).sort()) {    // code-unit order, then a stable sort: ties go to the lower name
    const p = library[id];
    if (!validPattern(p)) continue;
    const present = p.features.filter((f) => Number.isFinite(Number(input[f])));
    const coverage = present.length / p.features.length;
    let member = 0;
    if (coverage === 1) member = p.features.reduce((a, f) => a + membership(input[f], p.dist[f]), 0) / p.features.length;
    ranked.push({ domain: id, coverage: round6(coverage), routeScore: round6(coverage === 1 ? member : 0) });
  }
  ranked.sort((a, b) => b.routeScore - a.routeScore);
  return { ok: true, best: ranked[0] || null, ranked };
}

/** THE BRAIN CALL: route → gate → answer from a verified pattern, or ABSTAIN. Every answer carries a receipt. */
export function answer(library, input) {
  const r = route(library, input);
  if (!r.ok || !r.best) return { verdict: 'ABSTAIN', why: 'no pattern to route to', routeScore: 0 };
  const best = r.best;
  if (best.routeScore < ROUTE_MIN) return { verdict: 'ABSTAIN', why: 'out of distribution — no verified pattern covers this input', domain: best.domain, routeScore: best.routeScore };
  const p = library[best.domain];
  if (!passesGate(p.heldAuc)) return { verdict: 'ABSTAIN', why: 'the matched pattern is below the gate', domain: best.domain, routeScore: best.routeScore };
  const score = scoreInput(p, input);
  const label = score > p.threshold ? 1 : 0;
  const confidence = round6(Math.min(1, Math.abs(score - p.threshold) / (p.spread || 1)));
  const core = { model: 'konomi-slm/1', domain: p.domain, patternId: p.patternId || '', heldAuc: p.heldAuc, gateAuc: GATE_AUC,
    input: inputHash(p, input), routeScore: best.routeScore, score, threshold: p.threshold, label, verdict: 'VERIFIED' };
  return { verdict: 'VERIFIED', domain: p.domain, label, confidence, routeScore: best.routeScore, receipt: { ...core, receiptHash: sha256(JSON.stringify(core)) } };
}

/** The case a receipt speaks for: a hash of exactly the values the pattern read, in its own feature order. Total. */
export function inputHash(p, input) {
  try { return sha256(JSON.stringify(p.features.map((f) => [f, input[f] ?? null]))).slice(0, 16); } catch { return ''; }
}

/** Re-hash a receipt; any changed field breaks it. Total. */
export function verifyReceipt(receipt) {
  try {
    const { receiptHash, ...core } = receipt;
    return sha256(JSON.stringify(core)) === receiptHash;
  } catch { return false; }
}

/** Area under the ROC curve (ties counted half). 0.5 when a class is missing. */
export function auc(scores, y) {
  const pos = [], neg = [];
  scores.forEach((s, i) => (y[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return 0.5;
  let sum = 0;
  for (const p of pos) for (const n of neg) sum += p > n ? 1 : p === n ? 0.5 : 0;   // Mann–Whitney: every pair, ties half
  return sum / (pos.length * neg.length);
}

/** How does a pattern do on THESE rows (a node's own local data)? → { auc, acc, n } */
export function verifyOn(p, rows) {
  try { return verifyIn(p, rows); } catch { return { auc: 0.5, acc: 0, n: 0 }; }
}
function verifyIn(p, rows) {
  if (!validPattern(p) || !Array.isArray(rows)) return { auc: 0.5, acc: 0, n: 0 };
  const scores = [], y = [];
  let hit = 0;
  for (const row of rows) {
    const s = scoreInput(p, row);
    scores.push(s);
    y.push(row.y ? 1 : 0);
    if ((s > p.threshold ? 1 : 0) === (row.y ? 1 : 0)) hit++;
  }
  return { auc: round6(auc(scores, y)), acc: round6(hit / rows.length), n: rows.length };
}

/** The mycelium rule: adopt a received pattern only if it re-verifies on THIS node's own data — and, when the node
 *  already holds a brain for that job, only if it does at least as well as that brain on the same cases (to within
 *  REGRESSION_TOLERANCE). A subtly poisoned brain that still clears the gate cannot replace a better one. */
export function adopt(p, localRows, gate = GATE_AUC, current = null) {
  if (!validPattern(p)) return { adopt: false, localAuc: 0, n: 0, reason: 'malformed pattern' };
  const v = verifyOn(p, localRows);
  if (v.n < 50) return { adopt: false, localAuc: v.auc, n: v.n, reason: 'not enough local data to verify' };
  if (v.auc < gate) return { adopt: false, localAuc: v.auc, n: v.n, reason: 'did not re-verify here (AUC ' + v.auc + ' < ' + gate + ')' };
  if (validPattern(current)) {
    const c = verifyOn(current, localRows).auc;
    if (v.auc < c - REGRESSION_TOLERANCE) return { adopt: false, localAuc: v.auc, n: v.n, currentAuc: c, reason: 'worse than the brain it would replace on ' + v.n + ' of this device’s own cases (AUC ' + v.auc + ' < ' + c + ')' };
  }
  return { adopt: true, localAuc: v.auc, n: v.n, reason: 're-verified on ' + v.n + ' local cases (AUC ' + v.auc + ')' };
}

// ── a pattern as one signed spine record (the spine carries strings / ints / booleans only) ──────────────────
const num = (x) => String(round6(x));
/** Pattern → record fields (all scalars, each under the spine's 2,000-char field limit). */
export function toRecord(p) {
  return {
    domain: p.domain, title: String(p.title || p.domain).slice(0, 120), role: String(p.role || ''), real: !!p.real,
    features: p.features.join(','),
    rules: p.rules.map((r) => [r.feat, r.op, num(r.v), num(r.w)].join('|')).join(';'),
    dist: p.features.map((f) => f + ':' + ['min', 'q1', 'med', 'q3', 'max'].map((k) => num(p.dist[f][k])).join(',')).join(';'),
    threshold: num(p.threshold), spread: num(p.spread), base: num(p.base),
    heldAuc: num(p.heldAuc), heldAcc: num(p.heldAcc || 0), held: Number.isSafeInteger(p.held) ? p.held : 0,
    patternId: String(p.patternId || ''),
  };
}
/** Record fields → pattern, or null if anything is off (a received record is untrusted until validated). */
export function fromRecord(rec) {
  try {
    const features = rec.features.split(',');
    const rules = rec.rules.split(';').map((s) => { const [feat, op, v, w] = s.split('|'); return { feat, op, v: Number(v), w: Number(w) }; });
    const dist = {};
    for (const part of rec.dist.split(';')) {
      const [f, vals] = part.split(':');
      const [min, q1, med, q3, max] = vals.split(',').map(Number);
      dist[f] = { min, q1, med, q3, max };
    }
    const p = { domain: rec.domain, title: rec.title, role: rec.role, real: !!rec.real, features, rules, dist,
      threshold: Number(rec.threshold), spread: Number(rec.spread), base: Number(rec.base),
      heldAuc: Number(rec.heldAuc), heldAcc: Number(rec.heldAcc), held: rec.held, patternId: rec.patternId };
    return validPattern(p) ? p : null;
  } catch { return null; }
}
