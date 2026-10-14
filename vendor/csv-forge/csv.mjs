// csv.mjs — turn ANY CSV into labelled cases the pattern forge can work on, entirely in the browser.
// No data leaves the page. Pure, deterministic, never throws on garbage.
//
// Pipeline: parseCsv → inferColumns (numeric / categorical / id / constant / empty) → suggestTarget
// (a binary column, name-hint preferred) → encode (numerics pass through, categoricals become one 0/1
// indicator per level; ids/constants/empties are dropped) → { cases:[{x:[numbers], y:0|1}], featureNames }.
// `prepare(text)` runs the whole chain with sensible defaults.

const CATEGORICAL_CAP = 50;                        // more distinct values than this ⇒ treat as an id, skip
const TARGET_HINTS = ['churn', 'target', 'label', 'class', 'default', 'fraud', 'converted', 'approved', 'outcome', 'survived', 'attrition'];
const POSITIVE_HINTS = ['yes', 'true', '1', 'churn', 'churned', 'positive', 'default', 'fraud', 'y'];

const cell = (r, i) => (Array.isArray(r) && i >= 0 && i < r.length) ? String(r[i]).trim() : '';
const isNum = (s) => s !== '' && Number.isFinite(Number(s));
const numOr0 = (s) => (isNum(s) ? Number(s) : 0);

const QUANTILE_BINS = 16;   // cap distinct thresholds per numeric column so the forge stays interactive on any CSV

/** build a value→snapped-value function that collapses a numeric column onto ≤16 quantile edges (real values,
 *  so stump thresholds stay interpretable). Keeps proposeStumps bounded no matter the column's cardinality. */
export function quantizer(values) {
  const sorted = (Array.isArray(values) ? values.filter(Number.isFinite) : []).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return (v) => v;
  const edges = Array.from({ length: QUANTILE_BINS }, (_, k) => sorted[Math.floor((k * n) / QUANTILE_BINS)]);
  const uniq = [...new Set(edges)];                  // ascending (sorted source, ascending k)
  return (v) => { const below = uniq.filter((e) => e <= v); return below.length > 0 ? below[below.length - 1] : uniq[0]; };
}

/** parse CSV text → { header:[names], rows:[[cells]] }. Handles quoted fields, escaped quotes, CRLF, blank lines. */
export function parseCsv(text) {
  if (typeof text !== 'string' || text.length === 0) return { header: [], rows: [] };
  const records = [];
  let field = '', row = [], inQuotes = false, pending = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
      pending = true;
    } else if (ch === '"') { inQuotes = true; pending = true; }
    else if (ch === ',') { row.push(field); field = ''; pending = true; }
    else if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; pending = false; }
    else if (ch !== '\r') { field += ch; pending = true; }
  }
  if (pending) { row.push(field); records.push(row); }
  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0].map((h) => String(h).trim());
  const rows = records.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  return { header, rows };
}

/** classify every column: numeric | categorical | id | constant | empty, with distinct count and levels. */
export function inferColumns(header, rows) {
  if (!Array.isArray(header) || !Array.isArray(rows)) return [];
  const n = rows.length;
  return header.map((name, index) => {
    const vals = [];
    for (const r of rows) { const v = cell(r, index); if (v !== '') vals.push(v); }
    const nonEmpty = vals.length;
    if (nonEmpty === 0) return { name: String(name), index, kind: 'empty', distinct: 0, numericShare: 0, levels: [] };
    const numeric = vals.reduce((k, v) => k + (isNum(v) ? 1 : 0), 0);
    const numericShare = numeric / nonEmpty;
    const set = new Set(vals);
    const distinct = set.size;
    let kind;
    if (numericShare >= 0.95 && distinct > 2) kind = 'numeric';
    else if (distinct <= 1) kind = 'constant';
    else if (distinct > CATEGORICAL_CAP || distinct >= 0.9 * n) kind = 'id';
    else kind = 'categorical';
    return { name: String(name), index, kind, distinct, numericShare, levels: kind === 'categorical' ? [...set].sort() : [] };
  });
}

/** choose a binary column to predict: a name-hinted one first, else the last binary column. -1 if none. */
export function suggestTarget(cols, rows) {
  if (!Array.isArray(cols)) return -1;
  const binary = cols.filter((c) => c && c.distinct === 2 && c.kind !== 'id');
  if (binary.length === 0) return -1;
  for (const c of binary) { const nm = c.name.toLowerCase(); if (TARGET_HINTS.some((h) => nm.includes(h))) return c.index; }
  return binary[binary.length - 1].index;
}

/** which of the two target values is the positive (y=1) class: a hint value, else the rarer one. */
export function choosePositive(vals, counts) {
  if (!Array.isArray(vals) || !(counts instanceof Map)) return null;
  for (const v of vals) { if (POSITIVE_HINTS.includes(String(v).toLowerCase())) return v; }
  return counts.get(vals[0]) <= counts.get(vals[1]) ? vals[0] : vals[1];
}

/** encode selected feature columns + a binary target into cases. Numerics pass through; categoricals → indicators. */
export function encode(rows, cols, targetIndex, featureIndexes) {
  const empty = { cases: [], featureNames: [], positiveLabel: null, classes: [] };
  if (!Array.isArray(rows) || !Array.isArray(cols)) return empty;
  const counts = new Map();
  for (const r of rows) { const v = cell(r, targetIndex); if (v !== '') counts.set(v, (counts.get(v) || 0) + 1); }
  const classes = [...counts.keys()];
  if (classes.length !== 2) return empty;
  const positive = choosePositive(classes, counts);
  const plan = [];
  for (const fi of (Array.isArray(featureIndexes) ? featureIndexes : [])) {
    const c = cols.find((cc) => cc && cc.index === fi);
    if (!c) continue;
    if (c.kind === 'numeric') {
      const vals = [];
      for (const r of rows) { const s = cell(r, fi); if (isNum(s)) vals.push(Number(s)); }
      plan.push({ kind: 'num', index: fi, name: c.name, snap: quantizer(vals) });   // bin to ≤16 thresholds
    } else if (c.kind === 'categorical') for (const lv of c.levels) plan.push({ kind: 'ind', index: fi, name: c.name, level: lv });
  }
  const featureNames = plan.map((p) => (p.kind === 'num' ? p.name : `${p.name} = ${p.level}`));
  const cases = [];
  for (const r of rows) {
    const tv = cell(r, targetIndex);
    if (tv === '') continue;
    const x = plan.map((p) => (p.kind === 'num' ? p.snap(numOr0(cell(r, p.index))) : (cell(r, p.index) === p.level ? 1 : 0)));
    cases.push({ x, y: tv === positive ? 1 : 0 });
  }
  return { cases, featureNames, positiveLabel: positive, classes };
}

/** run the whole chain: parse → infer → pick target (or opts.targetName) → encode every usable feature. */
export function prepare(text, opts = {}) {
  const { header, rows } = parseCsv(text);
  const cols = inferColumns(header, rows);
  let targetIndex = -1;
  if (opts && typeof opts.targetName === 'string') {
    const hit = cols.find((c) => c.name.toLowerCase() === opts.targetName.toLowerCase());
    if (hit) targetIndex = hit.index;
  }
  if (targetIndex < 0) targetIndex = suggestTarget(cols, rows);
  const featureIndexes = cols.filter((c) => c.index !== targetIndex).map((c) => c.index);
  const enc = encode(rows, cols, targetIndex, featureIndexes);
  const tcol = cols.find((c) => c.index === targetIndex);
  return { header, nrows: rows.length, cols, targetIndex, targetName: tcol ? tcol.name : null, ...enc };
}
