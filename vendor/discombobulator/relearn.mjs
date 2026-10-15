// kernel/relearn.mjs — BRING YOUR OWN legacy decision log → re-grow a sovereign replacement, PROVE
// equivalence on held-out rows, and OWN the result. Generic over ANY CSV + a chosen decision column
// (multi-class). Pure, deterministic, never throws. It reuses the vendored csv-forge parser and ports
// the proven CART (kernel/understand.mjs) PARAMETERIZED by a per-dataset schema, so it is not tied to
// the LoanDesk columns the sealed demo pipeline uses. Nothing here uploads — it runs in the browser.

import { parseCsv, inferColumns, quantizer } from '../csv-forge/csv.mjs';

const safeStr = (v) => (v == null ? '' : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const GINI_MIN_GAIN = 1e-9;
const DECISION_HINTS = ['decision', 'status', 'outcome', 'result', 'verdict', 'label', 'class', 'disposition', 'action'];

/** fnv1a-32 fingerprint (browser-safe, no crypto) — signs receipts and splits rows deterministically. */
export function fingerprint(str) {
  let h = 0x811c9dc5 >>> 0;
  const s = typeof str === 'string' ? str : safeStr(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const hash10 = (s) => { let h = 0x811c9dc5 >>> 0; const t = safeStr(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0) % 10; };

/** deterministic split: ~25% HOLDOUT (equivalence is measured here, never seen by induction),
 *  of the remaining train ~25% VALIDATE (leaf-confidence), rest FIT (tree grown here). */
export function sliceOf(key) {
  if (hash10(key) < 3) return 'holdout';
  return hash10(key + ':t') < 3 ? 'validate' : 'fit';
}

/** pick the decision column to reproduce: a name-hinted categorical first, else the last categorical. */
export function suggestDecision(cols) {
  if (!Array.isArray(cols)) return '';
  const cands = cols.filter((c) => c && c.kind === 'categorical');   // inferColumns already caps categoricals at 2..50 distinct
  for (const c of cands) { if (DECISION_HINTS.some((h) => c.name.toLowerCase().includes(h))) return c.name; }
  return cands.length > 0 ? cands[cands.length - 1].name : '';
}

/** parse a decision log and shape it for the forge: infer columns, pick the decision, quantize numerics,
 *  build entries {id, x(object keyed by feature name), y(decision), slice}. Pure; returns {ok:false,...} on junk. */
export function prepareLog(text, opts = {}) {
  const { header, rows } = parseCsv(text);
  if (header.length === 0 || rows.length === 0) return { ok: false, error: 'empty-or-unparseable' };
  const cols = inferColumns(header, rows);
  const wanted = opts && typeof opts.decisionColumn === 'string' ? opts.decisionColumn : '';
  const decisionName = (wanted && cols.some((c) => c.name === wanted)) ? wanted : suggestDecision(cols);
  const dcol = cols.find((c) => c.name === decisionName);
  if (!dcol) return { ok: false, error: 'no-decision-column', cols };
  const di = dcol.index;
  const numericCols = cols.filter((c) => c.kind === 'numeric' && c.index !== di);
  const categoricalCols = cols.filter((c) => c.kind === 'categorical' && c.index !== di);
  const schema = { numeric: numericCols.map((c) => c.name), categorical: categoricalCols.map((c) => c.name) };
  const featureNames = [...schema.numeric, ...schema.categorical];
  const cellAt = (r, i) => (Array.isArray(r) && i >= 0 && i < r.length) ? String(r[i]).trim() : '';
  // quantize each numeric column so the forge stays interactive on any size
  const snaps = {};
  for (const c of numericCols) { const vals = []; for (const r of rows) { const s = cellAt(r, c.index); if (s !== '' && Number.isFinite(Number(s))) vals.push(Number(s)); } snaps[c.name] = quantizer(vals); }
  const entries = [];
  const decisionSet = new Set();
  let ri = -1;
  for (const r of rows) {
    ri++;
    const y = cellAt(r, di);
    if (y === '') continue;
    decisionSet.add(y);
    const x = {};
    for (const c of numericCols) x[c.name] = snaps[c.name](num(cellAt(r, c.index)));
    for (const c of categoricalCols) x[c.name] = cellAt(r, c.index);
    entries.push({ id: ri, x, y, slice: sliceOf(String(ri)) });
  }
  if (entries.length === 0) return { ok: false, error: 'no-labelled-rows', cols };
  return { ok: true, header, nrows: entries.length, cols, decisionName, decisions: [...decisionSet].sort(), featureNames, schema, entries };
}

// ---------------- the CART (schema-parameterized port of kernel/understand.mjs) ----------------
export function labelCounts(rows) {
  const c = {};
  for (const r of rows) { const y = r && typeof r.y === 'string' ? r.y : ''; c[y] = (c[y] || 0) + 1; }
  return c;
}
export function gini(counts, total) {
  if (!total) return 0;   // !total already covers 0/negative/NaN; no separate <= needed
  let s = 0;
  for (const k in counts) { const p = counts[k] / total; s += p * p; }
  return 1 - s;
}
export function majority(counts) {
  let best = null, bn = -1;
  for (const k of Object.keys(counts).sort()) { if (counts[k] > bn) { bn = counts[k]; best = k; } }
  return best;
}
function numericThresholds(rows, f, cap) {
  const vals = [...new Set(rows.map((r) => r.x[f]))].sort((a, b) => a - b);
  const mids = [];
  for (let i = 1; i < vals.length; i++) mids.push((vals[i - 1] + vals[i]) / 2);
  if (mids.length <= cap) return mids;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(mids[Math.floor((i * mids.length) / cap)]);
  return [...new Set(out)];
}
export function bestSplit(rows, schema, opts) {
  const parentGini = gini(labelCounts(rows), rows.length);
  let best = null;
  for (const f of (schema && Array.isArray(schema.numeric) ? schema.numeric : [])) {
    for (const t of numericThresholds(rows, f, opts.thresholdCap)) {
      const L = [], R = [];
      for (const r of rows) (r.x[f] <= t ? L : R).push(r);
      if (L.length < opts.minLeaf || R.length < opts.minLeaf) continue;
      const g = (L.length * gini(labelCounts(L), L.length) + R.length * gini(labelCounts(R), R.length)) / rows.length;
      const gain = parentGini - g;
      if (gain > GINI_MIN_GAIN && (!best || gain > best.gain)) best = { kind: 'num', feature: f, threshold: t, gain, L, R };
    }
  }
  for (const f of (schema && Array.isArray(schema.categorical) ? schema.categorical : [])) {
    const vals = [...new Set(rows.map((r) => r.x[f]))].sort();
    for (const v of vals) {
      const L = [], R = [];
      for (const r of rows) (r.x[f] === v ? L : R).push(r);
      if (L.length < opts.minLeaf || R.length < opts.minLeaf) continue;
      const g = (L.length * gini(labelCounts(L), L.length) + R.length * gini(labelCounts(R), R.length)) / rows.length;
      const gain = parentGini - g;
      if (gain > GINI_MIN_GAIN && (!best || gain > best.gain)) best = { kind: 'cat', feature: f, value: v, gain, L, R };
    }
  }
  return best;
}
let LEAF_SEQ = 0;
export function fitTree(entries, schema, options) {
  const opts = { maxDepth: options?.maxDepth ?? 10, minLeaf: options?.minLeaf ?? 6, thresholdCap: options?.thresholdCap ?? 40 };
  const rows = (Array.isArray(entries) ? entries : []).filter((r) => r && r.x && typeof r.y === 'string');
  if (rows.length === 0) return null;
  LEAF_SEQ = 0;
  return build(rows, schema, 0, opts);
}
function build(rows, schema, depth, opts) {
  const counts = labelCounts(rows);
  const label = majority(counts);
  const pure = Object.keys(counts).length <= 1;
  if (pure || depth >= opts.maxDepth || rows.length < 2 * opts.minLeaf) return { leaf: true, id: LEAF_SEQ++, label, n: rows.length, counts };
  const sp = bestSplit(rows, schema, opts);
  if (!sp) return { leaf: true, id: LEAF_SEQ++, label, n: rows.length, counts };
  const node = sp.kind === 'num'
    ? { leaf: false, kind: 'num', feature: sp.feature, threshold: sp.threshold }
    : { leaf: false, kind: 'cat', feature: sp.feature, value: sp.value };
  node.left = build(sp.L, schema, depth + 1, opts);
  node.right = build(sp.R, schema, depth + 1, opts);
  return node;
}
export function routeLeaf(tree, x) {
  let node = tree, guard = 0;
  while (node && !node.leaf && guard++ < 100000) {
    if (node.kind === 'num') node = (num(x[node.feature]) <= node.threshold) ? node.left : node.right;
    else node = (String(x[node.feature]) === node.value) ? node.left : node.right;
  }
  return node && node.leaf ? node : null;
}
export function predict(tree, x) { const leaf = routeLeaf(tree, x); return leaf ? leaf.label : null; }

/** grow the replacement + flag low-confidence leaves on the validate slice (misunderstandings, surfaced). */
export function grow(prepared, options) {
  if (!prepared || prepared.ok !== true) return { ok: false, error: 'bad-input' };
  const opts = { maxDepth: options?.maxDepth ?? 10, minLeaf: options?.minLeaf ?? 6, thresholdCap: options?.thresholdCap ?? 40, confTau: options?.confTau ?? 0.8, minValidate: options?.minValidate ?? 3 };
  const fit = prepared.entries.filter((e) => e.slice === 'fit');
  const validate = prepared.entries.filter((e) => e.slice === 'validate');
  if (fit.length === 0) return { ok: false, error: 'no-fit-rows' };
  const tree = fitTree(fit, prepared.schema, opts);
  // leaf confidence on validate
  const per = new Map();
  for (const e of validate) { const leaf = routeLeaf(tree, e.x); if (!leaf) continue; const v = per.get(leaf.id) || { hit: 0, total: 0 }; v.total++; if (leaf.label === e.y) v.hit++; per.set(leaf.id, v); }
  const leaves = [], flagged = [];
  (function collect(node) {
    if (!node) return;
    if (node.leaf) { const v = per.get(node.id) || { hit: 0, total: 0 }; const acc = v.total > 0 ? v.hit / v.total : null; const confident = v.total >= opts.minValidate && acc !== null && acc >= opts.confTau; const rec = { id: node.id, label: node.label, validateN: v.total, acc, confident }; leaves.push(rec); if (!confident) flagged.push(rec); return; }
    collect(node.left); collect(node.right);
  })(tree);
  return { ok: true, tree, leaves: leaves.length, flagged: flagged.length, flaggedLeaves: flagged, fitN: fit.length, validateN: validate.length };
}

/** THE SAFETY GATE: run old-vs-new on the held-out slice, surface EVERY mismatch (nothing hidden). */
export function equivalence(tree, holdout) {
  const rows = Array.isArray(holdout) ? holdout.filter((e) => e && e.x && typeof e.y === 'string') : [];
  let same = 0; const mismatches = [];
  for (const e of rows) { const regrown = predict(tree, e.x); if (regrown === e.y) same++; else mismatches.push({ id: e.id, legacy: e.y, regrown: regrown == null ? 'UNKNOWN' : regrown }); }
  const total = rows.length;
  return { same, total, rate: total > 0 ? Math.round((same / total) * 1000) / 1000 : 0, mismatches, invariant: (same + mismatches.length) === total };
}

/** predict a decision for a raw row object (string/number values keyed by the original column names). */
export function predictRow(tree, schema, row) {
  const r = (row && typeof row === 'object') ? row : {};
  const x = {};
  for (const f of (schema && Array.isArray(schema.numeric) ? schema.numeric : [])) x[f] = num(r[f]);
  for (const f of (schema && Array.isArray(schema.categorical) ? schema.categorical : [])) x[f] = safeStr(r[f]);
  return predict(tree, x);
}

/** emit a self-contained, runnable ES module the user downloads and OWNS: predict(row) → decision + receipt. */
export function replacementModule(spec) {
  try {
    const s = (spec && typeof spec === 'object') ? spec : {};
    const tree = s.tree || null;
    const schema = (s.schema && typeof s.schema === 'object') ? s.schema : { numeric: [], categorical: [] };
    const receipt = (s.receipt && typeof s.receipt === 'object') ? s.receipt : {};
    return `// replacement-model.mjs — a sovereign re-growth of "${safeStr(s.systemName) || 'your legacy system'}", minted by
// discombobulator (https://sjgant80-hub.github.io/discombobulator/). Reproduces the "${safeStr(s.decisionName)}"
// decision; held-out equivalence ${safeStr(s.equivalenceRate)}. Runs anywhere, no dependencies, no per-call cost. You own this.
export const receipt = ${JSON.stringify(receipt, null, 2)};
const TREE = ${JSON.stringify(tree)};
const SCHEMA = ${JSON.stringify(schema)};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export function predict(row) {
  row = row || {};
  const x = {};
  for (const f of SCHEMA.numeric) x[f] = num(row[f]);
  for (const f of SCHEMA.categorical) x[f] = row[f] == null ? '' : String(row[f]);
  let node = TREE, guard = 0;
  while (node && !node.leaf && guard++ < 100000) {
    if (node.kind === 'num') node = (num(x[node.feature]) <= node.threshold) ? node.left : node.right;
    else node = (String(x[node.feature]) === node.value) ? node.left : node.right;
  }
  return node && node.leaf ? node.label : null;
}
export default predict;
`;
  } catch { return '// replacement-model.mjs — could not be rendered.\nexport const receipt = {};\nexport function predict() { return null; }\nexport default predict;\n'; }
}

function canonical(body) {
  const stable = (v) => { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = stable(v[k]); return o; } return v; };
  try { return JSON.stringify(stable(body)); } catch { return ''; }
}

/** a signed, re-checkable migration receipt — the safety report the client keeps. */
export function buildMigrationReceipt(input) {
  const i = (input && typeof input === 'object') ? input : {};
  const body = {
    tool: 'discombobulator',
    system: safeStr(i.systemName),
    decision: safeStr(i.decisionName),
    rows: num(i.rows),
    decisions: Array.isArray(i.decisions) ? i.decisions.slice() : [],
    features: num(i.featureCount),
    heldOut: num(i.holdoutN),
    equivalenceRate: Number.isFinite(Number(i.equivalenceRate)) ? Number(i.equivalenceRate) : 0,
    mismatches: num(i.mismatchCount),
    invariantHolds: i.invariantHolds === true,
    flaggedLeaves: num(i.flaggedLeaves),
    at: safeStr(i.at),
  };
  return { ...body, sig: fingerprint(canonical(body)) };
}
export function verifyMigrationReceipt(r) {
  if (!r || typeof r !== 'object' || typeof r.sig !== 'string') return false;
  const body = { ...r }; delete body.sig;
  return fingerprint(canonical(body)) === r.sig;
}
