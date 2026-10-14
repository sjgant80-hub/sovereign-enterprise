// seedlib.mjs — THE SEED LIBRARY · a general ribosome (grow-not-install, knowledge-in-seeds-not-weights).
//
// A SEED is a tiny konomi-family tag: "◊ seed.v1 <domain> <rngSeed> <body> <mac>". It carries NO trained
// weights — only a recipe pointer (which domain), a seed, and either a grow-config (g:) or a packed genome
// (f:). On arrival a universal, one-time RIBOSOME reads the seed and GROWS a working build locally from the
// node's own data: it either evolves a scorecard on that data (grow-seed) or expresses a shipped genome
// (fixed-seed), then grades it on held-out cases it never grew on. The whole library is a few hundred bytes;
// the knowledge lives in the readable, provable, editable seeds, not smeared across billion-parameter weights.
//
// HONESTY: germination here is DETERMINISTIC ASSEMBLY — a decoder plus a seeded evolutionary search over an
// interpretable scorecard (a sum of single-feature threshold rules). It is NOT a language model. No model of
// any size runs inside the measured germination. A small LLM (real, optional) is offered only as IMAGINATION —
// proposing a seed from a free-text domain description — and is kept OUT of everything graded here.
//
// Lineage, credited: the grow→fit→grade-on-held-out protocol, the seeded RNG, the stratified split and the
// AUC are the pattern of fall-spore and pattern-organs (sjgant80-hub), vendored in ./vendor/fall-spore and
// reused for the real UCI shopper organ. The "defense grows in" guard (verify before you parse) is SENTINEL's.
// Powered by the Konomi architecture, created by Thomas Frumkin. Every exported entry point is pure, total and
// deterministic: hostile input returns {ok:false}, never throws.

import { hmacSha256Hex } from './sha256.mjs';

// ── the scorecard genome: up to MAXRULES single-feature threshold rules, each (feature, quantile, side, weight).
//    A genome is a short list of small integers → a handful of bytes. ────────────────────────────────────────
export const MAXRULES = 6;
export const MAXFEATS = 16;                                  // feature index width (domains use ≤ 16 features)
// interior quantiles 1/16 … 15/16 — the rule's threshold is this quantile of the feature on the LOCAL data
export const QGRID = Array.from({ length: 15 }, (_, k) => (k + 1) / 16);
// signed weights (log-odds-ish); the score is their sum over firing rules. No zero — a rule is on/off via `on`.
export const WGRID = [-2, -1, -0.5, -0.25, 0.25, 0.5, 1, 2];

export const bitsFor = (n) => { let b = 0; while ((1 << b) < n) b++; return Math.max(1, b); };
const FEAT_BITS = bitsFor(MAXFEATS), Q_BITS = bitsFor(QGRID.length), W_BITS = bitsFor(WGRID.length);
// genome layout: on(MAXRULES) then per rule feat,q,dir,w
export const GENOME_FIELDS = [['on', MAXRULES]];
for (let r = 0; r < MAXRULES; r++) GENOME_FIELDS.push([`f${r}`, FEAT_BITS], [`q${r}`, Q_BITS], [`d${r}`, 1], [`w${r}`, W_BITS]);
export const GENOME_BITS = GENOME_FIELDS.reduce((s, [, w]) => s + w, 0);
export const GENOME_BYTES = Math.ceil(GENOME_BITS / 8);

export function packGenome(g) {
  const bytes = new Uint8Array(GENOME_BYTES);
  let pos = 0;
  for (const [name, width] of GENOME_FIELDS) {
    let v = Number(g && g[name]);
    if (!Number.isInteger(v) || v < 0) v = 0;
    v &= (1 << width) - 1;
    for (let k = 0; k < width; k++) { if ((v >> k) & 1) bytes[pos >> 3] |= 1 << (pos & 7); pos++; }
  }
  return bytes;
}
export function unpackGenome(bytes) {
  const g = {};
  let pos = 0;
  for (const [name, width] of GENOME_FIELDS) {
    let v = 0;
    for (let k = 0; k < width; k++) { if (((bytes[pos >> 3] || 0) >> (pos & 7)) & 1) v |= 1 << k; pos++; }
    g[name] = v;
  }
  return g;
}

export const toHex = (bytes) => Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, '0')).join('');
export function fromHex(str) {
  const s = String(str), out = [];
  for (let i = 0; i + 1 < s.length; i += 2) { const v = parseInt(s.slice(i, i + 2), 16); if (Number.isNaN(v)) break; out.push(v); }
  return Uint8Array.from(out);
}

// ── the SENTINEL-style guard: a shared-secret HMAC over the seed's canonical body. A tampered or forged seed
//    fails the guard and never germinates. (Symmetric, not Ed25519 like SENTINEL — stated plainly.) ──────────
export const LIBRARY_KEY = 'seed-library.v1/konomi/thomas-frumkin';   // shared secret baked into the ribosome
export const MAC_LEN = 12;                                             // hex chars of HMAC kept in the tag
export const macFor = (canonical) => hmacSha256Hex(LIBRARY_KEY, canonical).slice(0, MAC_LEN);

export const SEED_TAG = '◊ seed.v1';
const canonical = (domain, rngSeed, body) => [domain, String(rngSeed >>> 0), body].join(' ');

// make a seed object (not yet a string): {domain, seed, grow:{population,elites,generations}|null, genome|null}
export function makeSeed({ domain = 'shopper', seed = 1, grow: growCfg = null, genome = null } = {}) {
  return { domain: String(domain), seed: seed >>> 0, grow: growCfg, genome };
}

// encode → "◊ seed.v1 <domain> <rngSeed> <g:P.E.G|f:hex> <mac>"
export function encodeSeed(seed) {
  const domain = String((seed && seed.domain) || 'shopper');
  const rngSeed = (seed && seed.seed) >>> 0;
  let body;
  if (seed && seed.grow) {
    const { population, elites, generations } = seed.grow;
    body = 'g:' + [population, elites, generations].map((x) => x >>> 0).join('.');
  } else {
    body = 'f:' + toHex(packGenome((seed && seed.genome) || stemGenome()));
  }
  return [SEED_TAG, domain, String(rngSeed), body, macFor(canonical(domain, rngSeed, body))].join(' ');
}

// decode → {ok, seed} or {ok:false,error}. With {guard:true} (the default) a bad/missing MAC is rejected.
export function decodeSeed(str, { guard = true } = {}) {
  if (typeof str !== 'string') return { ok: false, error: 'a seed is a string' };
  const parts = str.trim().split(/\s+/);
  if (parts.slice(0, 2).join(' ') !== SEED_TAG) return { ok: false, error: 'not a seed (missing ◊ seed.v1 tag)' };
  const domain = parts[2];
  if (!domain) return { ok: false, error: 'seed names no domain' };
  const rngSeed = Number(parts[3]);
  if (!Number.isInteger(rngSeed) || rngSeed < 1) return { ok: false, error: 'seed must be a whole number ≥ 1' };
  const body = parts[4] || '';
  const mac = parts[5] || '';
  if (guard && mac !== macFor(canonical(domain, rngSeed, body))) return { ok: false, error: 'seed failed the SENTINEL guard (bad or missing signature)' };
  if (body.startsWith('g:')) {
    const [population, elites, generations] = body.slice(2).split('.').map(Number);
    if (![population, elites, generations].every((x) => Number.isInteger(x) && x >= 1)) return { ok: false, error: 'bad grow-config' };
    if (elites >= population) return { ok: false, error: 'elites must be fewer than the population' };
    return { ok: true, seed: { domain, seed: rngSeed, grow: { population, elites, generations }, genome: null } };
  }
  if (body.startsWith('f:')) {
    const genome = unpackGenome(fromHex(body.slice(2)));
    return { ok: true, seed: { domain, seed: rngSeed, grow: null, genome } };
  }
  return { ok: false, error: 'seed body must be g: (grow) or f: (fixed genome)' };
}

// the guard on its own: does this seed-string carry a valid library signature? (total)
export function guard(str) {
  if (typeof str !== 'string') return false;
  const parts = str.trim().split(/\s+/);
  if (parts.slice(0, 2).join(' ') !== SEED_TAG || parts.length < 6) return false;
  return parts[5] === macFor(canonical(parts[2], Number(parts[3]) >>> 0, parts[4] || ''));
}

// ── randomness, one seeded stream (fall-spore / pattern-organs, credited) ─────────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const draw = (r, k) => Math.floor(r() * k);
function shuffled(list, r) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = draw(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// stratified split: the same share of each class goes to the held slice (fall-spore, credited)
export function splitRows(dataset, rows, share, seed) {
  const r = rng(seed);
  const held = [];
  for (const cls of [1, 0]) {
    const group = shuffled(rows.filter((i) => dataset.y[i] === cls), r);
    held.push(...group.slice(0, Math.floor(group.length * share)));
  }
  const set = new Set(held);
  return { held: [...set].sort((p, q) => p - q), rest: rows.filter((i) => !set.has(i)) };
}

// area under the ROC curve, ties count half (fall-spore / pattern-organs, credited)
export function auc(scores, y) {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let below = 0, sum = 0, pos = 0, neg = 0, i = 0;
  while (i < order.length) {
    let gp = 0, gn = 0, j = i;
    while (j < order.length && scores[order[j]] === scores[order[i]]) { if (y[order[j]]) gp++; else gn++; j++; }
    sum += gp * (below + gn / 2); below += gn; pos += gp; neg += gn; i = j;
  }
  return pos > 0 && neg > 0 ? sum / (pos * neg) : 0.5;
}

// ── the quantile threshold of a feature on a set of rows (deterministic, total) ──────────────────────────────
export function quantile(dataset, feat, rows, q) {
  const xs = rows.map((i) => dataset.cols[feat][i]).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.floor(q * (xs.length - 1))));
  return xs[idx];
}

// ── express a genome into a scorecard on the local training rows (compute each rule's real threshold) ────────
export function fit(dataset, rows, genome) {
  const feats = dataset.features;
  const nf = feats.length;
  const base = rows.length ? rows.reduce((a, i) => a + dataset.y[i], 0) / rows.length : 0;
  const rules = [];
  for (let r = 0; r < MAXRULES; r++) {
    if (!((genome.on >> r) & 1)) continue;
    const feat = feats[genome[`f${r}`] % nf];
    const q = QGRID[genome[`q${r}`] % QGRID.length];
    const op = ((genome[`d${r}`]) & 1) ? '>' : '<=';
    const w = WGRID[genome[`w${r}`] % WGRID.length];
    rules.push({ feat, op, v: round6(quantile(dataset, feat, rows, q)), w });
  }
  return { genome, base: round6(base), rules };
}

export const fires = (rule, x) => (rule.op === '>' ? x > rule.v : x <= rule.v);
export function scoreRow(scorecard, dataset, i) {
  let s = 0;
  for (const rule of scorecard.rules) if (fires(rule, dataset.cols[rule.feat][i])) s += rule.w;
  return s;
}

// a fixed operating point from TRAIN (predict positive for the top `base` fraction), applied to held-out → accuracy
export function heldAccuracy(scorecard, dataset, trainRows, heldRows) {
  const base = trainRows.length ? trainRows.reduce((a, i) => a + dataset.y[i], 0) / trainRows.length : 0;
  const ts = trainRows.map((i) => scoreRow(scorecard, dataset, i)).sort((a, b) => a - b);
  const thr = ts.length ? ts[Math.min(ts.length - 1, Math.floor((1 - base) * ts.length))] : 0;
  if (!heldRows.length) return 0;
  let correct = 0;
  for (const i of heldRows) { const pred = scoreRow(scorecard, dataset, i) > thr ? 1 : 0; if (pred === dataset.y[i]) correct++; }
  return round6(correct / heldRows.length);
}

// ── genomes: stem, random, mutate, cross ─────────────────────────────────────────────────────────────────────
export function stemGenome() {
  const g = { on: (1 << MAXRULES) - 1 };
  for (let r = 0; r < MAXRULES; r++) { g[`f${r}`] = r; g[`q${r}`] = Math.floor(QGRID.length / 2); g[`d${r}`] = 1; g[`w${r}`] = WGRID.indexOf(0.5); }
  return g;
}
export function randomGenome(r) {
  const g = { on: 1 + draw(r, (1 << MAXRULES) - 1) };   // at least one rule on
  for (let k = 0; k < MAXRULES; k++) { g[`f${k}`] = draw(r, MAXFEATS); g[`q${k}`] = draw(r, QGRID.length); g[`d${k}`] = draw(r, 2); g[`w${k}`] = draw(r, WGRID.length); }
  return g;
}
export const coin = (r) => draw(r, 2) === 0;
export function crossGenome(a, b, r) {
  const g = { on: 0 };
  for (let k = 0; k < MAXRULES; k++) if ((((coin(r) ? a : b).on) >> k) & 1) g.on |= 1 << k;
  if (!g.on) g.on = a.on || 1;
  for (let k = 0; k < MAXRULES; k++) { const src = coin(r) ? a : b; g[`f${k}`] = src[`f${k}`]; g[`q${k}`] = src[`q${k}`]; g[`d${k}`] = src[`d${k}`]; g[`w${k}`] = src[`w${k}`]; }
  return g;
}
// one change: toggle a rule, or nudge one rule's feature / quantile / side / weight
export function mutateGenome(g, r) {
  const out = { ...g };
  const slot = draw(r, 1 + MAXRULES * 4);
  if (slot < MAXRULES) { const n = out.on ^ (1 << slot); out.on = n || 1; }   // never leave every rule off
  else {
    const k = Math.floor((slot - MAXRULES) / 4), what = (slot - MAXRULES) % 4;
    if (what === 0) out[`f${k}`] = draw(r, MAXFEATS);
    else if (what === 1) { const step = coin(r) ? -1 : 1; out[`q${k}`] = Math.min(QGRID.length - 1, Math.max(0, g[`q${k}`] + step)); }
    else if (what === 2) out[`d${k}`] = g[`d${k}`] ^ 1;
    else out[`w${k}`] = draw(r, WGRID.length);
  }
  return out;
}

// ── GROW: evolve a scorecard on an inner train/validation split of the local training rows. Deterministic. ───
export function assess(dataset, inner, genome) {
  const card = fit(dataset, inner.rest, genome);
  const scores = inner.held.map((i) => scoreRow(card, dataset, i));
  return auc(scores, inner.held.map((i) => dataset.y[i]));
}
export function grow(dataset, trainRows, seed, cfg, tick = () => {}) {
  const inner = splitRows(dataset, trainRows, 1 / 3, seed);
  const r = rng(seed * 7919 + 1);
  let born = 0;
  const live = (g) => { tick(); return { g, n: born++, fitness: assess(dataset, inner, g) }; };
  const better = (a, b) => a.fitness > b.fitness || (a.fitness === b.fitness && a.n < b.n);
  let pop = [stemGenome(), ...Array.from({ length: cfg.population - 1 }, () => randomGenome(r))].map(live);
  const best = () => pop.reduce((a, b) => (better(b, a) ? b : a));
  const history = [best().fitness];
  for (let gen = 1; gen < cfg.generations; gen++) {
    const battle = () => { const a = pop[draw(r, pop.length)], b = pop[draw(r, pop.length)]; return better(b, a) ? b : a; };
    const next = [...pop].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, cfg.elites);
    while (next.length < cfg.population) {
      const child = crossGenome(battle().g, battle().g, r);
      next.push(live(coin(r) ? mutateGenome(child, r) : child));
    }
    pop = next;
    history.push(best().fitness);
  }
  return { evals: born, champion: best().g, fitness: round6(best().fitness), history: history.map(round6) };
}

// ── GERMINATE: read the seed, grow/express the build on the local data, grade on held-out it never grew on. ──
export function germinate(dataset, seed, { guard: useGuard = true, tick = () => {} } = {}) {
  if (!dataset || dataset.ok === false || !dataset.n) return { ok: false, error: 'germinate needs a loaded dataset' };
  let S = seed;
  if (typeof seed === 'string') { const d = decodeSeed(seed, { guard: useGuard }); if (!d.ok) return d; S = d.seed; }
  if (!S || typeof S !== 'object') return { ok: false, error: 'bad seed' };
  const train = dataset.trainRows, held = dataset.heldRows;
  if (!Array.isArray(train) || !Array.isArray(held) || !train.length || !held.length) return { ok: false, error: 'dataset has no train/held rows' };
  let genome, grownFrom;
  if (S.grow) {
    if (!(S.grow.elites < S.grow.population)) return { ok: false, error: 'elites must be fewer than the population' };
    const g = grow(dataset, train, S.seed >>> 0, S.grow, tick);
    genome = g.champion; grownFrom = { grown: true, evals: g.evals, innerFitness: g.fitness, history: g.history };
  } else {
    genome = S.genome || stemGenome(); grownFrom = { grown: false, evals: 0 };
  }
  const scorecard = fit(dataset, train, genome);
  const scores = held.map((i) => scoreRow(scorecard, dataset, i));
  const y = held.map((i) => dataset.y[i]);
  return {
    ok: true, domain: dataset.name, genome, scorecard, grownFrom,
    train: train.length, held: held.length,
    heldAuc: round6(auc(scores, y)),
    heldAcc: heldAccuracy(scorecard, dataset, train, held),
    base: round6(y.reduce((a, v) => a + v, 0) / y.length),
  };
}

// ── sizes: the tiny seed vs the grown body it grows into ─────────────────────────────────────────────────────
export const round6 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0);
export const utf8Bytes = (s) => { let n = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
export function grownBody(scorecard) {
  return { genome: packGenomeHex(scorecard.genome), base: scorecard.base, rules: scorecard.rules.map((r) => ({ feat: r.feat, op: r.op, v: r.v, w: r.w })) };
}
const packGenomeHex = (g) => toHex(packGenome(g));
export function ratioOf(seedStr, scorecard) {
  const seedBytes = utf8Bytes(typeof seedStr === 'string' ? seedStr : encodeSeed(seedStr));
  const grownBytes = utf8Bytes(JSON.stringify(grownBody(scorecard)));
  return { seedBytes, grownBytes, ratio: seedBytes > 0 ? round6(grownBytes / seedBytes) : 0 };
}

// ── OFFLINE PROBE: run a function with the network globals trapped (fall-spore, credited). Total. ────────────
export function probeOffline(fn) {
  const g = globalThis;
  const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket, importScripts: g.importScripts };
  let touched = false;
  const mark = (name) => { touched = true; throw new Error('network blocked during germination: ' + name); };
  try {
    g.fetch = (...a) => mark('fetch');
    g.XMLHttpRequest = function () { mark('XMLHttpRequest'); };
    g.WebSocket = function () { mark('WebSocket'); };
    g.importScripts = (...a) => mark('importScripts');
    let ok = true, error = null, result = null;
    try { result = fn(); } catch (e) { ok = false; error = String((e && e.message) || e); }
    return { ok, networkTouched: touched, error, result };
  } finally {
    g.fetch = saved.fetch; g.XMLHttpRequest = saved.XMLHttpRequest; g.WebSocket = saved.WebSocket; g.importScripts = saved.importScripts;
  }
}

export default { encodeSeed, decodeSeed, guard, makeSeed, germinate, grow, fit, scoreRow, auc, ratioOf, probeOffline };
