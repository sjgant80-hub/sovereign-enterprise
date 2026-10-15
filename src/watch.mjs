// watch.mjs — the behaviour watch over the AI agents. Pure, total, deterministic; every number it reports is an integer.
//
// "Identity is insufficient; behaviour is authoritative." An agent can hold a valid key and a valid grant and still
// be hijacked or scripted, so the watch does not ask who signed a decision — it asks whether the agent is behaving
// like itself. This is Behavioral Entropy Signatures (BES), the work of Gary W. Floyd, Lumiea Systems Research
// Division — ThunderStruck Service, LLC, "GEP-Based Security: Behavioral Entropy Signatures for Cybersecurity and
// DevOps", applied to the company's own agents. Its finding, kept exactly: an impostor fails one of two ways — it is
// OVERLY REGULAR (scripted: the entropy of what it does collapses) or RANDOMLY UNCORRELATED (hijacked: what it does no
// longer follows the work). The estate built BES inward first (sjgant80-hub/bes-inward); its kernel is vendored
// verbatim under ../vendor/bes-inward and used here for the op-mix, the rhythm (how variable the gaps between an
// agent's decisions are on the door's clock) and the L1 divergence between op-mixes — taken per kind of work, so work
// re-routed to an agent when another is paused is not mistaken for a change in the agent. Its rule is kept: the
// baseline is ONE-CLASS, learned from the agent's own early behaviour, and never folds in a window it would flag
// (negative selection). A hijack must be both large (divergence over maxDrift) and real (a two-sample test over minZ):
// a small baseline mis-estimates a rare act, and the test keeps that noise from reading as a hijack.
//
// One change from bes-inward, on purpose: there the baseline keeps folding allowed windows, so a slow enough drift
// drags it along. Here the baseline FREEZES once it settles — nothing the agent does afterwards can move it — so a
// slow drift is measured against the agent as it was, and is caught once it has drifted far enough.
//
// What the watch reads is the 'decisions' collection on the spine: { agent, event, channel, domain, state, action,
// by, cross, … }. A behaviour token is state:action ("done:hold-payment", "watch:-"). Per agent, over a window of
// its decisions in write order, the signature holds: the action entropy, the entropy of what it does GIVEN the work
// (channel), the transition entropy between consecutive decisions, the entropy of where its answers came from
// (own / mesh / screen / none), of its done/watch split, its rhythm and its rate on the door's clock — and how many
// decisions did not fit the work at all. Entropies are in milli-bits.
import { ACTIONS } from './agent.mjs';
import { signature as besSignature, divergence as besDivergence, DEFAULTS as BES } from '../vendor/bes-inward/bes.mjs';

export const VERDICTS = Object.freeze(['learning', 'normal', 'scripted', 'hijacked']);
export const DEFAULTS = Object.freeze({
  window: 40,          // decisions in a judged window
  step: 10,            // once settled, judge again every `step` decisions (a sliding window)
  settle: 3,           // windows of the agent's own early behaviour before its baseline freezes
  floor: 250,          // milli-bits: below this the window is one thing every time (scripted, even while learning)
  collapse: 100,       // permille: an entropy below a tenth of the baseline's own has collapsed (scripted)
  maxDrift: 400,       // permille: acts on the same work drifted further than this from its own …
  minZ: 4000,          // milli-sigma: … and the drift is this many standard deviations real (hijacked)
  minVariability: BES.minVariability,   // bes-inward's rhythm floor: clockwork below it (scripted)
  maxOffWork: 0,       // decisions that do not fit the work they were given; an honest agent makes none
  minSeen: 3,          // a kind of work is compared only if the baseline acted on it at least this often
});
const RANGE = Object.freeze({ window: [4, 4096], step: [1, 4096], settle: [1, 64], floor: [0, 20000], collapse: [0, 1000],
  maxDrift: [0, 2000], minZ: [0, 100000], minVariability: [0, 100000], maxOffWork: [0, 4096], minSeen: [1, 4096] });
export const DEFAULT_POLICY = Object.freeze({ auto: true, pauseOn: Object.freeze(['hijacked', 'scripted']) });
// what can collapse: what it does, its transitions, and what it does GIVEN the work. Its done/watch split is reported but not
// judged: on the live company an honest agent can go 120 decisions without holding one for a human (measured: Finance and
// Systems did), and a script that approves or holds everything already collapses what it does given the work.
const COLLAPSE = Object.freeze(['mixH', 'transH', 'condH']);
const EVENT = /^e(\d{1,9})$/;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (x) => (typeof x === 'string' ? x : '');

/** Tuning params → a complete, in-range set (anything missing, non-integer or out of range takes the default). */
export function paramsOf(params) {
  const p = {};
  for (const k of Object.keys(DEFAULTS)) {
    let v;
    try { v = params[k]; } catch { v = undefined; }
    const r = RANGE[k];
    p[k] = Number.isSafeInteger(v) && v >= r[0] && v <= r[1] ? v : DEFAULTS[k];
  }
  return p;
}

/** One spine decision record → the fields the watch reads (null if it is not a readable object). */
export function readDecision(r) {
  try {
    if (!r || typeof r !== 'object') return null;
    const m = EVENT.exec(str(r.event));
    return { id: str(r.id), agent: str(r.agent), at: m ? Number(m[1]) : -1, channel: str(r.channel), domain: str(r.domain),
      state: str(r.state), action: str(r.action), by: str(r.by), cross: r.cross === true };
  } catch { return null; }
}

/**
 * Why a decision does not fit the work it was given — '' when it fits. seen: the door events this agent has already
 * decided (a Set). The door hands each piece of work to one agent once, so an honest agent never decides a kind of work
 * that does not exist, a piece of work that never came through the door, or the same piece twice; never answers a
 * different kind of work than it was given; never acts in a way the work does not call for; and never acts on a
 * high-stakes call without a second brain. (It may close its work out of door order — a call that waited on the mesh
 * closes after later ones its own brain answered at once — so order is not a rule.)
 */
export function offWork(d, seen) {
  try {
    const A = hasOwn(ACTIONS, d.channel) ? ACTIONS[d.channel] : null;
    if (!A) return 'no such kind of work';
    if (d.at < 0) return 'no such piece of work';
    if (seen instanceof Set && seen.has(d.at)) return 'the same work decided twice';
    if (d.domain !== '' && d.domain !== d.channel) return 'answered a different kind of work';
    const legal = d.action === A[0] || d.action === A[1];
    if (d.state === 'done') return !legal ? 'an act its work does not call for' : A.stakes === 'high' && !d.cross ? 'a high-stakes act with no second brain' : '';
    if (d.state !== 'watch') return 'not a decision';
    return legal || d.action === '' || (d.action === 'quarantine-input' && d.by === 'screen') ? '' : 'an act its work does not call for';
  } catch { return 'unreadable'; }
}

/** An agent's records, in write order → read, tokenised and checked against the work (the one pre-pass). */
function prepare(records) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    const d = readDecision(r);
    if (!d) continue;
    d.tok = d.state + ':' + (d.action || '-');
    d.off = offWork(d, seen);
    seen.add(d.at);
    out.push(d);
  }
  return out;
}

/** Conditional entropy H(token | given) in milli-bits over [given, token] pairs (one given ⇒ plain entropy). */
function entropy(pairs) {
  const groups = new Map();
  for (const [g, t] of pairs) {
    let m = groups.get(g);
    if (!m) groups.set(g, (m = new Map()));
    m.set(t, (m.get(t) || 0) + 1);
  }
  let h = 0;
  for (const m of groups.values()) {
    let n = 0;
    for (const c of m.values()) n += c;
    for (const c of m.values()) h += c * Math.log2(n / c);
  }
  return Math.round((h * 1000) / Math.max(1, pairs.length));
}

const EMPTY_SIG = Object.freeze({ n: 0, mixH: 0, condH: 0, transH: 0, sourceH: 0, stateH: 0, doneP: 0, rhythm: 0, gap: 0, rate: 0, offWork: 0, offWhy: '', mix: {} });

function sigOf(w) {
  const toks = w.map((d) => d.tok);
  const off = w.filter((d) => d.off !== '');
  // the rhythm is read on the door's clock: when the work it took came through the door, in door order — an agent closes
  // a call that waited on the mesh after later ones, and that is not a change in its rhythm
  const at = w.map((d) => d.at).sort((a, b) => a - b);
  // the vendored BES kernel: op-mix + rhythm. Its rhythm floors the mean deviation to a whole time unit, so the door
  // clock goes in in milli-events — on whole events, gaps of 2-4 floor to zero and an honest agent reads as clockwork
  const bes = besSignature(w.map((d, i) => ({ type: d.tok, at: at[i] * 1000 })));
  const n = w.length;
  const span = n ? at[n - 1] - at[0] : 0;
  return {
    n,
    mixH: entropy(toks.map((t) => ['', t])),
    condH: entropy(w.map((d) => [d.channel, d.tok])),
    transH: entropy(toks.slice(1).map((t, i) => [toks[i], t])),
    sourceH: entropy(w.map((d) => ['', d.by.split(':')[0]])),
    stateH: entropy(w.map((d) => ['', d.state])),
    doneP: Math.floor((w.filter((d) => d.state === 'done').length * 1000) / Math.max(1, n)),
    rhythm: bes.variability,
    gap: n > 1 ? Math.floor(span / (n - 1)) : 0,
    rate: Math.floor((n * 1000) / Math.max(1, span + 1)),
    offWork: off.length,
    offWhy: off.length ? off[0].off : '',
    mix: bes.mix,
  };
}

/** The behavioural signature of a window of ONE agent's decisions (spine records, write order). Total on junk. */
export function signature(records) {
  try { return sigOf(prepare(records)); } catch { return { ...EMPTY_SIG, mix: {} }; }
}

/** Acts per kind of work: { channel: { list: [{ type: action }], count: { action: n } } } over the decisions that ACTED
 *  (done) and fit their work. Holding a call for a human is not an act — deferring to a person is the safe way to fail. */
function actsOf(w) {
  const by = {};
  for (const d of w) {
    if (d.state !== 'done' || d.off !== '') continue;
    const c = hasOwn(by, d.channel) ? by[d.channel] : (by[d.channel] = { list: [], count: {} });
    c.list.push({ type: d.action });
    c.count[d.action] = (hasOwn(c.count, d.action) ? c.count[d.action] : 0) + 1;
  }
  return by;
}

/**
 * How far what the agent ACTED has moved from its own acts on the SAME kind of work, over channels the baseline acted
 * on at least `minSeen` times — as an effect and as a test, because a hijack is a change that is both LARGE and REAL:
 *   drift — bes-inward's L1 divergence (permille) between the action mix here and the baseline's, per channel,
 *           weighted by this block's acts on it: 0 = the same as itself, 2000 = disjoint;
 *   z     — Pearson's two-sample homogeneity test of the same counts (Σ (x·m − y·n)² / (n·m·(x + y)) per action),
 *           summed over channels and turned into standard deviations (Wilson–Hilferty), in milli-sigma.
 * A small baseline mis-estimates a rare act; the test carries both samples' sizes, so that noise is not read as drift.
 * → { drift, z }, each −1 when nothing compares.
 */
function driftOf(w, acts, minSeen) {
  const by = actsOf(w);
  let s = 0, k = 0, chi = 0, dof = 0;
  for (const c of Object.keys(by)) {
    if (!hasOwn(acts, c) || acts[c].n < minSeen) continue;
    const here = by[c], base = acts[c], n = here.list.length, m = base.n;
    s += n * besDivergence(besSignature(here.list), base);
    k += n;
    for (const a of new Set([...Object.keys(here.count), ...Object.keys(base.count)])) {
      const x = hasOwn(here.count, a) ? here.count[a] : 0, y = hasOwn(base.count, a) ? base.count[a] : 0;
      chi += (x * m - y * n) ** 2 / (n * m * (x + y));
      dof++;
    }
    dof--;
  }
  const v = 2 / (9 * dof);
  return { drift: k ? Math.floor(s / k) : -1, z: dof > 0 ? Math.round((1000 * (Math.cbrt(chi / dof) - (1 - v))) / Math.sqrt(v)) : -1 };
}

/** Fold the learning windows (already passed the absolute checks) into a frozen one-class baseline. */
function baselineOf(learn) {
  const by = actsOf(learn), acts = {};
  for (const c of Object.keys(by)) acts[c] = { n: by[c].list.length, mix: besSignature(by[c].list).mix, count: by[c].count };
  const s = sigOf(learn);
  return { settled: true, n: learn.length, acts, mixH: s.mixH, transH: s.transH, condH: s.condH, stateH: s.stateH, sourceH: s.sourceH,
    doneP: s.doneP, rhythm: s.rhythm, rate: s.rate, mix: s.mix };
}
/** A baseline that has learned nothing yet. */
export const emptyBaseline = () => ({ settled: false, n: 0, acts: {}, mixH: 0, transH: 0, condH: 0, stateH: 0, sourceH: 0, doneP: 0, rhythm: 0, rate: 0, mix: {} });

/** The baseline-free checks, which hold even while the baseline is still learning. → 'verdict|reason', or ''.
 *  Regularity is read first (Gary's first failure mode): an agent that does one thing whatever the work is scripted,
 *  even though that one thing is also off its work. Entropy and rhythm need a full window; a decision that does not
 *  fit its work is caught on any window, at once. */
function absolute(w, p) {
  const full = w.n >= p.window;
  if (full && w.mixH < p.floor) return 'scripted|one thing every time — action entropy ' + w.mixH + ' mb, under the floor of ' + p.floor + ' mb';
  if (full && w.gap >= 2 && w.rhythm < p.minVariability) return 'scripted|clockwork — rhythm ' + w.rhythm + '‰ on the door clock, under ' + p.minVariability + '‰';
  if (w.offWork > p.maxOffWork) return 'hijacked|it acted off its own work — ' + w.offWhy + ' (' + w.offWork + ' of ' + w.n + ' decisions)';
  return '';
}

/**
 * Judge an agent's evidence against its baseline. evidence = { window, recent, drift }: the signature of its latest
 * `window` decisions (the fast, baseline-free checks), of its latest `window × settle` decisions — the same size the
 * baseline was learned on, so the two compare like for like — and how far that recent block's acts drifted from its
 * own on the same work. Two-sided, as Gary's finding has it: an entropy collapsed below `collapse`‰ of its own → too
 * regular (scripted); acts drifted more than `maxDrift`‰ from its own on the same work, and more than `minZ` milli-sigma
 * of real, → uncorrelated (hijacked).
 * → { verdict, reason }. Total: evidence that cannot be read is not judged ('learning') — it never accuses on garbage.
 */
export function judge(evidence, baseline, params) {
  try {
    const p = paramsOf(params);
    const w = evidence.window, r = evidence.recent;
    const abs = absolute(w, p);
    if (abs) { const [verdict, reason] = abs.split('|'); return { verdict, reason }; }
    if (!(baseline && baseline.settled === true)) return { verdict: 'learning', reason: 'still learning how this agent behaves' };
    if (r.n >= p.window * p.settle) {
      for (const k of COLLAPSE) {
        if (r[k] * 1000 < baseline[k] * p.collapse) return { verdict: 'scripted', reason: 'too regular — ' + k + ' collapsed to ' + r[k] + ' mb from its own ' + baseline[k] + ' mb' };
      }
      if (evidence.drift > p.maxDrift && evidence.z > p.minZ) {
        return { verdict: 'hijacked', reason: 'uncorrelated with itself — on the same work its acts drifted ' + evidence.drift + '‰ from its own (' + (evidence.z / 1000).toFixed(1) + ' sigma)' };
      }
    }
    return { verdict: 'normal', reason: 'behaving like itself' };
  } catch { return { verdict: 'learning', reason: 'no readable evidence — nothing judged' }; }
}

/** How far ONE agent's acts drifted from a baseline's on the same work → { drift, z } (see driftOf). Total. */
export function drift(records, baseline, params) {
  try { return driftOf(prepare(records), baseline.acts, paramsOf(params).minSeen); } catch { return { drift: -1, z: -1 }; }
}

function evidenceAt(recs, end, from, base, p) {
  const block = recs.slice(Math.max(from, end - p.window * p.settle), end);
  return { window: sigOf(recs.slice(Math.max(from, end - p.window), end)), recent: sigOf(block), ...driftOf(block, base.acts, p.minSeen) };
}

const flagged = (v) => v === 'scripted' || v === 'hijacked';

/**
 * Learning, from `start`: tumbling windows of the agent's own early behaviour. A window the absolute checks flag never
 * enters the baseline (negative selection). The part of each window after the clearance `cut` is judged, and every
 * flag is reported. → { end, base, flags: [{ verdict, reason, end, ev }] } — base settles, and then freezes, after
 * `settle` clean windows; nothing after that can move it.
 */
function learnIn(recs, start, cut, p) {
  const learn = [], flags = [];
  let end = start;
  for (; end + p.window <= recs.length && learn.length < p.window * p.settle; end += p.window) {
    const judged = absolute(sigOf(recs.slice(Math.max(cut, end), end + p.window)), p);
    if (judged) flags.push({ verdict: judged.split('|')[0], reason: judged.split('|')[1], end: end + p.window, ev: evidenceAt(recs, end + p.window, cut, emptyBaseline(), p) });
    const w = recs.slice(end, end + p.window);
    if (!absolute(sigOf(w), p)) learn.push(...w);
  }
  return { end, flags, base: learn.length >= p.window * p.settle ? baselineOf(learn) : emptyBaseline() };
}

/** Learn a baseline from ONE agent's early decisions: the first `settle` tumbling windows that pass the absolute
 *  checks, frozen once there are enough (settled), else an unsettled baseline. Total. */
export function learnBaseline(records, params) {
  try {
    const recs = prepare(records);
    return learnIn(recs, 0, recs.length, paramsOf(params)).base;
  } catch { return emptyBaseline(); }
}

/**
 * Watch ONE agent over its decision records (write order). The FIRST flag latches — flaggedAt names the decision that
 * tipped it, and only a human clears it; the diagnosis (scripted / hijacked) follows the newest evidence that flags,
 * so a script first caught by one off-work act reads as scripted once its windows show it does one thing every time.
 * clear = { at: decisionId, rebaseline } is a human's clearance: only decisions after `at` are judged again; the
 * baseline is kept (a clearance cannot launder a hijack into it) unless `rebaseline`, which re-learns after `at`.
 * → { verdict, reason, caught, flaggedAt, decisions, evidence, baseline }
 */
export function watchAgent(records, params, clear) {
  try {
    const p = paramsOf(params);
    const recs = prepare(records);
    let at = '', rebase = false;
    try { at = str(clear.at); rebase = clear.rebaseline === true; } catch { at = ''; }
    let cut = 0;
    for (const d of recs) { if (at === '' || d.id > at) break; cut++; }
    // judged afresh from the clearance: a decision after it is checked against the work decided after it — work a thief
    // closed on the agent's key before the clearance is not held against the honest agent that finishes it afterwards
    const fresh = new Set();
    for (const d of recs.slice(cut)) { d.off = offWork(d, fresh); fresh.add(d.at); }
    const L = learnIn(recs, rebase ? cut : 0, cut, p);
    const flags = L.flags;
    // then a sliding window every `step` decisions, the last one ending at the newest decision
    const ends = Array.from({ length: Math.max(1, Math.ceil((recs.length - L.end) / p.step)) }, (_, i) => Math.min(recs.length, L.end + (i + 1) * p.step));
    let now = null;
    for (const end of ends) {
      const ev = evidenceAt(recs, end, cut, L.base, p);
      now = { ...judge(ev, L.base, p), end, ev };
      if (flagged(now.verdict)) flags.push(now);
    }
    const last = flags.length ? flags[flags.length - 1] : now;
    return { verdict: last.verdict, reason: last.reason, caught: flags.length ? flags[0].reason : '', flaggedAt: flags.length ? recs[flags[0].end - 1].id : '',
      decisions: recs.length, evidence: last.ev, baseline: L.base };
  } catch {
    return { verdict: 'learning', reason: 'the watch could not read this stream', caught: '', flaggedAt: '', decisions: 0, evidence: null, baseline: emptyBaseline() };
  }
}

/** Watch every agent in a 'decisions' collection, in any order: records are keyed by their id (a duplicate id keeps
 *  the first) and taken in id order, which on the spine is each agent's write order (a Lamport tick, then its key).
 *  clears = { [agentId]: { at, rebaseline } }. → { [agentId]: { agent, ...watchAgent result } } */
export function watchAll(records, params, clears) {
  try {
    const byId = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      const d = readDecision(r);
      if (d && d.agent && !byId.has(d.id)) byId.set(d.id, [d.agent, r]);
    }
    const byAgent = new Map();
    for (const id of [...byId.keys()].sort()) {
      const [agent, r] = byId.get(id);
      if (!byAgent.has(agent)) byAgent.set(agent, []);
      byAgent.get(agent).push(r);
    }
    const res = {};
    for (const agent of [...byAgent.keys()].sort()) {
      let c = null;
      try { c = hasOwn(clears, agent) ? clears[agent] : null; } catch { c = null; }
      res[agent] = { agent, ...watchAgent(byAgent.get(agent), params, c) };
    }
    return res;
  } catch { return {}; }
}

/** The automatic pause rule (the behaviour watch, automatic): pause an agent the watch flags. Only a flag (scripted / hijacked) can ever pause —
 *  a policy cannot make 'normal' or 'learning' pause — and policy.auto === false leaves every call to the humans. */
export function shouldPause(verdict, policy) {
  try {
    const v = typeof verdict === 'string' ? verdict : str(verdict.verdict);
    if (v !== 'scripted' && v !== 'hijacked') return false;
    const pol = policy && typeof policy === 'object' ? policy : DEFAULT_POLICY;
    if (pol.auto === false) return false;
    return Array.isArray(pol.pauseOn) ? pol.pauseOn.includes(v) : DEFAULT_POLICY.pauseOn.includes(v);
  } catch { return false; }
}
