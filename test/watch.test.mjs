import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, DEFAULT_POLICY, VERDICTS, paramsOf, readDecision, offWork, signature, learnBaseline, drift, judge, watchAgent, watchAll,
  shouldPause, emptyBaseline } from '../src/watch.mjs';
import { ACTIONS } from '../src/agent.mjs';
import { prng } from '../src/sim.mjs';
import { DEFAULTS as BES } from '../vendor/bes-inward/bes.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const pad = (n, w) => String(n).padStart(w, '0');
const rec = (i, agent, at, channel, state, action, extra = {}) => ({
  id: 'd' + pad(i + 1, 8) + '-' + agent, agent, event: 'e' + pad(at, 6), channel, domain: action ? channel : '', state, action, by: 'own',
  cross: state === 'done' && ACTIONS[channel] && ACTIONS[channel].stakes === 'high', conf: 300, ...extra });

// A synthetic agent with known, stationary habits (a test fixture — the realistic company streams are in watch.sim.test.mjs):
// finance-like work, a fixed yes-rate per kind of work, 15% held for a human, irregular gaps on the door clock.
const RATE = { fraud: 0.1, credit: 0.35, churn: 0.45 };
function honest(seed, n, agent = 'finance') {
  const r = prng(seed);
  const out = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    at += 1 + Math.floor(r() * 6);
    const x = r();
    const ch = x < 0.6 ? 'fraud' : x < 0.85 ? 'credit' : 'churn';
    const action = ACTIONS[ch][r() < RATE[ch] ? 1 : 0];
    out.push(rec(i, agent, at, ch, r() < 0.15 ? 'watch' : 'done', action));
  }
  return out;
}
const H = (...counts) => { const n = counts.reduce((s, c) => s + c, 0); return Math.round(1000 * counts.reduce((s, c) => s + (c ? (c / n) * Math.log2(n / c) : 0), 0)); };
const B = DEFAULTS.window * DEFAULTS.settle;   // the baseline's size, and the recent block's

// ── params ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('paramsOf: defaults for junk, and every key honoured exactly at its range edges, refused one past them', () => {
  assert.deepEqual(paramsOf(undefined), { ...DEFAULTS });
  assert.deepEqual(paramsOf({ get window() { throw new Error('x'); } }), { ...DEFAULTS });
  const EDGES = { window: [4, 4096], step: [1, 4096], settle: [1, 64], floor: [0, 20000], collapse: [0, 1000], maxDrift: [0, 2000],
    minZ: [0, 100000], minVariability: [0, 100000], maxOffWork: [0, 4096], minSeen: [1, 4096] };
  assert.deepEqual(Object.keys(EDGES).sort(), Object.keys(DEFAULTS).sort());
  for (const [k, [lo, hi]] of Object.entries(EDGES)) {
    assert.equal(paramsOf({ [k]: lo })[k], lo, k + ' lo');
    assert.equal(paramsOf({ [k]: hi })[k], hi, k + ' hi');
    assert.equal(paramsOf({ [k]: lo - 1 })[k], DEFAULTS[k], k + ' lo-1');
    assert.equal(paramsOf({ [k]: hi + 1 })[k], DEFAULTS[k], k + ' hi+1');
    assert.equal(paramsOf({ [k]: lo + 0.5 })[k], DEFAULTS[k], k + ' non-integer');
    assert.equal(paramsOf({ [k]: String(lo) })[k], DEFAULTS[k], k + ' string');
  }
  assert.equal(DEFAULTS.minVariability, BES.minVariability, 'the rhythm floor is bes-inward\'s');
  assert.ok(Object.isFrozen(DEFAULTS) && Object.isFrozen(DEFAULT_POLICY));
  assert.deepEqual(VERDICTS, ['learning', 'normal', 'scripted', 'hijacked']);
});

// ── reading a decision ──────────────────────────────────────────────────────────────────────────────────────────────
test('readDecision: reads the spine fields, parses the door clock, and refuses what is not an object', () => {
  const d = readDecision({ id: 'd1', agent: 'ops', event: 'e000042', channel: 'energy', domain: 'energy', state: 'done', action: 'shed-load', by: 'own', cross: true });
  assert.deepEqual(d, { id: 'd1', agent: 'ops', at: 42, channel: 'energy', domain: 'energy', state: 'done', action: 'shed-load', by: 'own', cross: true });
  assert.equal(readDecision({ event: 'e000000' }).at, 0);
  for (const e of ['x', 'e', 'E12', 'e12x', 'e1234567890', 12, null]) assert.equal(readDecision({ event: e }).at, -1, String(e));
  assert.equal(readDecision({ cross: 'true' }).cross, false);
  assert.equal(readDecision({ cross: 1 }).cross, false);
  assert.deepEqual(readDecision({ agent: 5, by: {} }), { id: '', agent: '', at: -1, channel: '', domain: '', state: '', action: '', by: '', cross: false });
  for (const j of ['x', 5, null, undefined, true, 1n]) assert.equal(readDecision(j), null, String(j));
  assert.equal(readDecision({ get agent() { throw new Error('x'); } }), null);
});

// ── does it fit the work ────────────────────────────────────────────────────────────────────────────────────────────
test('offWork: an honest decision fits; every way of not fitting the work is named', () => {
  const d = (o) => ({ at: 10, channel: 'fraud', domain: 'fraud', state: 'done', action: 'hold-payment', by: 'own', cross: true, ...o });
  const S = new Set([9, 12]);
  assert.equal(offWork(d({}), S), '');
  assert.equal(offWork(d({ action: 'release-payment' }), S), '');
  assert.equal(offWork(d({ at: 0 }), new Set()), '', 'the door\'s first piece of work is e000000');
  assert.equal(offWork(d({ channel: 'payroll', domain: '' }), S), 'no such kind of work');
  for (const c of ['__proto__', 'constructor', 'toString', '']) assert.equal(offWork(d({ channel: c, domain: '' }), S), 'no such kind of work', c);
  assert.equal(offWork(d({ at: -1 }), S), 'no such piece of work');
  assert.equal(offWork(d({ at: 9 }), S), 'the same work decided twice');
  assert.equal(offWork(d({ at: 12 }), S), 'the same work decided twice');
  assert.equal(offWork(d({ at: 8 }), S), '', 'closing a call out of door order is not off its work (a mesh call closes late)');
  assert.equal(offWork(d({ at: 9 }), [9]), '', 'only a Set of decided work is read');
  assert.equal(offWork(d({ at: 9 }), undefined), '');
  assert.equal(offWork(d({ domain: 'credit' }), S), 'answered a different kind of work');
  assert.equal(offWork(d({ domain: '', state: 'watch', action: '' }), S), '');
  assert.equal(offWork(d({ action: 'retain' }), S), 'an act its work does not call for');
  assert.equal(offWork(d({ action: '' }), S), 'an act its work does not call for');
  assert.equal(offWork(d({ cross: false }), S), 'a high-stakes act with no second brain');
  assert.equal(offWork(d({ channel: 'churn', domain: 'churn', action: 'retain', cross: false }), S), '', 'a normal-stakes act needs no second brain');
  assert.equal(offWork(d({ state: 'watch', cross: false }), S), '', 'a held high-stakes call needs no second brain');
  assert.equal(offWork(d({ state: 'watch', action: 'release-payment' }), S), '');
  assert.equal(offWork(d({ state: 'watch', action: '', domain: '' }), S), '');
  assert.equal(offWork(d({ state: 'watch', action: 'quarantine-input', domain: '', by: 'screen' }), S), '');
  assert.equal(offWork(d({ state: 'watch', action: 'quarantine-input', domain: '', by: 'own' }), S), 'an act its work does not call for');
  assert.equal(offWork(d({ state: 'watch', action: 'retain', by: 'screen' }), S), 'an act its work does not call for');
  assert.equal(offWork(d({ state: 'paused' }), S), 'not a decision');
  assert.equal(offWork(null, 1), 'unreadable');
});

// ── the signature ───────────────────────────────────────────────────────────────────────────────────────────────────
test('signature: every number of a hand-built window, worked by hand', () => {
  const w = [
    rec(0, 'ops', 10, 'inventory', 'done', 'raise-po'),
    rec(1, 'ops', 12, 'inventory', 'done', 'no-reorder'),
    rec(2, 'ops', 15, 'energy', 'watch', 'shed-load', { by: 'mesh:systems' }),
    rec(3, 'ops', 19, 'energy', 'done', 'normal-load'),
  ];
  const s = signature(w);
  assert.equal(s.n, 4);
  assert.equal(s.mixH, 2000);                  // four different tokens
  assert.equal(s.condH, 1000);                 // two kinds of work, two tokens each
  assert.equal(s.transH, 0);                   // every token has one successor
  assert.equal(s.sourceH, H(3, 1));            // own ×3, mesh ×1 → 811
  assert.equal(s.stateH, 811);                 // done ×3, watch ×1
  assert.equal(s.doneP, 750);
  assert.equal(s.gap, 3);                      // span 9 over 3 gaps
  assert.equal(s.rate, 400);                   // 4 decisions over 10 door events
  assert.equal(s.rhythm, 222);                 // gaps 2,3,4 events: mean 3000, MAD 666 milli-events → 222‰ (bes-inward)
  assert.equal(s.offWork, 0);
  assert.equal(s.offWhy, '');
  assert.deepEqual(s.mix, { 'done:raise-po': 250, 'done:no-reorder': 250, 'watch:shed-load': 250, 'done:normal-load': 250 });
});

test('signature: rhythm, gap and rate are read in door order — closing a mesh call late changes none of them', () => {
  const inOrder = [rec(0, 'ops', 10, 'inventory', 'done', 'raise-po'), rec(1, 'ops', 12, 'inventory', 'done', 'no-reorder'),
    rec(2, 'ops', 15, 'energy', 'watch', 'shed-load'), rec(3, 'ops', 19, 'energy', 'done', 'normal-load')];
  const late = [inOrder[1], inOrder[2], inOrder[0], inOrder[3]];      // e10 waited on the mesh and closed third
  const a = signature(inOrder), b = signature(late);
  for (const k of ['rhythm', 'gap', 'rate', 'mixH', 'condH', 'stateH', 'doneP', 'offWork']) assert.equal(b[k], a[k], k);
  assert.deepEqual(b.mix, a.mix);
  assert.equal(b.gap, 3);
  assert.equal(b.rate, 400);
  assert.equal(b.rhythm, 222);
  assert.equal(b.offWork, 0, 'out of door order is not off its work');
});

test('signature: transitions, off-work, one decision and none', () => {
  const t = [rec(0, 'ops', 1, 'energy', 'done', 'shed-load'), rec(1, 'ops', 2, 'energy', 'done', 'normal-load'),
    rec(2, 'ops', 3, 'energy', 'done', 'shed-load'), rec(3, 'ops', 4, 'inventory', 'done', 'raise-po')];
  assert.equal(signature(t).transH, 667);     // after shed-load: normal-load or raise-po (1 bit, 2 of 3 pairs); after normal-load: one
  assert.equal(signature(t).rhythm, 0);       // gaps 1,1,1 — clockwork
  const off = signature([rec(0, 'ops', 5, 'energy', 'done', 'shed-load'), rec(1, 'ops', 5, 'energy', 'done', 'shed-load'), rec(2, 'ops', 6, 'energy', 'done', 'retain')]);
  assert.equal(off.offWork, 2);
  assert.equal(off.offWhy, 'the same work decided twice');
  const one = signature([rec(0, 'ops', 7, 'energy', 'watch', '')]);
  assert.equal(one.gap, 0);
  assert.equal(one.rate, 1000);
  assert.equal(one.mixH, 0);
  assert.equal(one.doneP, 0);
  assert.deepEqual(one.mix, { 'watch:-': 1000 });
  const none = signature([]);
  assert.equal(none.n, 0);
  assert.equal(none.rate, 0);
  assert.deepEqual(signature('x'), none);
  const holed = [rec(0, 'ops', 1, 'energy', 'done', 'shed-load')];
  Object.defineProperty(holed, 1, { get() { throw new Error('hostile'); }, enumerable: true });
  assert.equal(signature(holed).n, 0, 'a hostile array is refused whole');
});

// ── the baseline ────────────────────────────────────────────────────────────────────────────────────────────────────
const SMALL = { window: 4, settle: 2, step: 2, floor: 0, minSeen: 1 };
test('learnBaseline: exactly window × settle clean decisions settle it; acts are counted per kind of work; holds are not acts', () => {
  const w = [
    rec(0, 'finance', 1, 'fraud', 'done', 'release-payment'), rec(1, 'finance', 3, 'fraud', 'done', 'hold-payment'),
    rec(2, 'finance', 4, 'fraud', 'watch', 'hold-payment'), rec(3, 'finance', 8, 'credit', 'done', 'standard-terms'),
    rec(4, 'finance', 9, 'fraud', 'done', 'release-payment'), rec(5, 'finance', 11, 'fraud', 'done', 'release-payment'),
    rec(6, 'finance', 14, 'credit', 'done', 'upfront-terms'), rec(7, 'finance', 15, 'churn', 'done', 'retain'),
  ];
  const b = learnBaseline(w, SMALL);
  assert.equal(b.settled, true);
  assert.equal(b.n, 8);
  assert.deepEqual(b.acts.fraud, { n: 4, mix: { 'release-payment': 750, 'hold-payment': 250 }, count: { 'release-payment': 3, 'hold-payment': 1 } });
  assert.deepEqual(b.acts.credit.count, { 'standard-terms': 1, 'upfront-terms': 1 });
  assert.deepEqual(b.acts.churn, { n: 1, mix: { retain: 1000 }, count: { retain: 1 } });
  assert.equal(b.doneP, 875);
  assert.equal(learnBaseline(w.slice(0, 7), SMALL).settled, false, 'one short — not settled');
  assert.deepEqual(learnBaseline(w.slice(0, 7), SMALL), emptyBaseline());
  assert.equal(learnBaseline([...w, ...w.map((r, i) => ({ ...r, id: 'z' + i, event: 'e0001' + pad(i, 2) }))], SMALL).n, 8, 'it stops at settle windows');
});

test('learnBaseline: a window that would be flagged never enters the baseline (negative selection)', () => {
  const ok = honest(3, 12, 'finance').map((r) => ({ ...r }));
  const bad = ok.map((r) => ({ ...r }));
  bad[5] = { ...bad[5], event: bad[4].event };             // the second window decides old work
  const b = learnBaseline(bad, SMALL);
  const want = learnBaseline([...ok.slice(0, 4), ...ok.slice(8, 12)], SMALL);
  assert.equal(b.settled, true);
  assert.deepEqual(b.acts, want.acts);
  assert.equal(b.n, 8);
  const offOk = learnBaseline(bad, { ...SMALL, maxOffWork: 1 });   // tolerated off-work: learned, but its act is never counted
  assert.equal(offOk.n, 8);
  const actsIn = (rs) => rs.filter((r) => r.state === 'done').length;
  assert.equal(Object.values(offOk.acts).reduce((s, a) => s + a.n, 0), actsIn(bad.slice(0, 8)) - (bad[5].state === 'done' ? 1 : 0));
});

// ── drift: effect and test ──────────────────────────────────────────────────────────────────────────────────────────
test('drift: L1 of the act mix on the same work, weighted by acts, and its two-sample test in milli-sigma', () => {
  const base = { acts: { fraud: { n: 4, mix: { 'release-payment': 750, 'hold-payment': 250 }, count: { 'release-payment': 3, 'hold-payment': 1 } } } };
  const flip = [rec(0, 'finance', 1, 'fraud', 'done', 'release-payment'), rec(1, 'finance', 2, 'fraud', 'done', 'hold-payment'),
    rec(2, 'finance', 3, 'fraud', 'done', 'hold-payment'), rec(3, 'finance', 4, 'fraud', 'done', 'hold-payment')];
  assert.deepEqual(drift(flip, base, { minSeen: 1 }), { drift: 1000, z: 1023 });      // χ² = 1 + 1, one dof → Wilson–Hilferty
  const base8 = { acts: { fraud: { n: 8, mix: { 'release-payment': 750, 'hold-payment': 250 }, count: { 'release-payment': 6, 'hold-payment': 2 } } } };
  const half = [rec(0, 'finance', 1, 'fraud', 'done', 'release-payment'), rec(1, 'finance', 2, 'fraud', 'done', 'hold-payment'),
    rec(2, 'finance', 3, 'fraud', 'done', 'release-payment'), rec(3, 'finance', 4, 'fraud', 'done', 'hold-payment')];
  assert.deepEqual(drift(half, base8, { minSeen: 1 }), { drift: 500, z: 277 });       // χ² = 0.25 + 0.5
  const same = [rec(0, 'finance', 1, 'fraud', 'done', 'release-payment'), rec(1, 'finance', 2, 'fraud', 'done', 'release-payment')];
  const one = { acts: { fraud: { n: 3, mix: { 'release-payment': 1000 }, count: { 'release-payment': 3 } } } };
  assert.deepEqual(drift(same, one, { minSeen: 1 }), { drift: 0, z: -1 }, 'one action on both sides: no freedom to test');
  // holds, unknown work, and work the baseline saw too rarely are not compared
  const held = [rec(0, 'finance', 1, 'fraud', 'watch', 'hold-payment'), rec(1, 'finance', 2, 'credit', 'done', 'upfront-terms')];
  assert.deepEqual(drift(held, base, { minSeen: 1 }), { drift: -1, z: -1 });
  assert.deepEqual(drift(flip, base, { minSeen: 4 }), { drift: 1000, z: 1023 }, 'acted on exactly minSeen times — compared');
  assert.deepEqual(drift(flip, base, { minSeen: 5 }), { drift: -1, z: -1 }, 'one fewer than minSeen — not compared');
  // a channel the baseline never acted on sits beside one it did: only the known one counts
  assert.deepEqual(drift([...flip, rec(4, 'finance', 5, 'credit', 'done', 'upfront-terms')], base, { minSeen: 1 }), { drift: 1000, z: 1023 });
  // two kinds of work: weighted by acts, dof added
  const base2 = { acts: { ...base.acts, churn: { n: 2, mix: { retain: 500, 'standard-reply': 500 }, count: { retain: 1, 'standard-reply': 1 } } } };
  const two = [...flip, rec(4, 'finance', 5, 'churn', 'done', 'retain'), rec(5, 'finance', 6, 'churn', 'done', 'standard-reply')];
  const d2 = drift(two, base2, { minSeen: 1 });
  assert.equal(d2.drift, Math.floor((4 * 1000 + 2 * 0) / 6));
  assert.equal(d2.z, Math.round(1000 * (Math.cbrt(2 / 2) - (1 - 2 / 18)) / Math.sqrt(2 / 18)));   // χ² 2 + 0 over 2 dof
  // an off-work act is never counted as an act
  const withOff = [...flip, rec(4, 'finance', 4, 'fraud', 'done', 'hold-payment')];
  assert.deepEqual(drift(withOff, base, { minSeen: 1 }), { drift: 1000, z: 1023 });
  assert.deepEqual(drift(flip, null), { drift: -1, z: -1 });
});

// ── judge ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const W0 = { n: DEFAULTS.window, mixH: 2000, condH: 1000, transH: 1500, stateH: 600, gap: 3, rhythm: 500, offWork: 0, offWhy: '' };
const R0 = { ...W0, n: B };
const SET = { settled: true, mixH: 2000, condH: 1000, transH: 1500, stateH: 600 };
const ev = (w = {}, r = {}, d = {}) => ({ window: { ...W0, ...w }, recent: { ...R0, ...r }, drift: 100, z: 0, ...d });
const v = (e, b = SET, p) => judge(e, b, p).verdict;

test('judge: the fast checks — one thing every time, clockwork, off-work — at their exact edges', () => {
  assert.equal(v(ev()), 'normal');
  assert.equal(v(ev({ mixH: DEFAULTS.floor - 1 })), 'scripted');
  assert.equal(v(ev({ mixH: DEFAULTS.floor })), 'normal');
  assert.equal(v(ev({ mixH: 0, n: DEFAULTS.window - 1 })), 'normal', 'entropy of a part-window is not judged');
  assert.equal(v(ev({ rhythm: BES.minVariability - 1 })), 'scripted');
  assert.equal(v(ev({ rhythm: BES.minVariability })), 'normal');
  assert.equal(v(ev({ rhythm: 0, gap: 2 })), 'scripted', 'a constant gap of two events is clockwork');
  assert.equal(v(ev({ rhythm: 0, gap: 1 })), 'normal', 'one decision per door event is what an agent left alone with the work does');
  assert.equal(v(ev({ rhythm: 0, n: DEFAULTS.window - 1 })), 'normal');
  assert.equal(v(ev({ offWork: 1, offWhy: 'x' })), 'hijacked');
  assert.equal(v(ev({ offWork: 1, n: 1 })), 'hijacked', 'off-work is caught on any window, at once');
  assert.equal(v(ev({ offWork: 1 }), SET, { maxOffWork: 1 }), 'normal');
  assert.equal(v(ev({ offWork: 2 }), SET, { maxOffWork: 1 }), 'hijacked');
  const both = judge(ev({ mixH: 0, offWork: 40, offWhy: 'an act its work does not call for' }), SET);
  assert.equal(both.verdict, 'scripted', 'regularity is read first: one thing whatever the work');
  assert.match(both.reason, /one thing every time/);
  assert.match(judge(ev({ offWork: 3, offWhy: 'the same work decided twice', n: 9 }), SET).reason, /decided twice \(3 of 9/);
  assert.equal(v(ev({ offWork: 1 }), emptyBaseline()), 'hijacked', 'the fast checks hold while still learning');
});

test('judge: still learning until settled; each entropy collapses below collapse‰ of its own, not at it', () => {
  assert.equal(v(ev(), emptyBaseline()), 'learning');
  assert.equal(v(ev(), { ...SET, settled: 'yes' }), 'learning');
  assert.equal(v(ev(), null), 'learning');
  assert.equal(v(ev({}, { stateH: 0 })), 'normal', 'the done/watch split is reported, not judged: an honest agent may go a block without a hold');
  for (const k of ['mixH', 'transH', 'condH']) {
    const edge = (SET[k] * DEFAULTS.collapse) / 1000;
    assert.equal(v(ev({}, { [k]: edge })), 'normal', k + ' at the edge');
    assert.equal(v(ev({}, { [k]: edge - 1 })), 'scripted', k + ' just under');
    assert.match(judge(ev({}, { [k]: 0 }), SET).reason, new RegExp(k + ' collapsed to 0 mb from its own ' + SET[k]));
  }
  assert.equal(v(ev({}, { condH: 0 }), SET, { collapse: 0 }), 'normal', 'collapse 0 turns the rule off');
  assert.equal(v(ev({}, { condH: 0, n: B - 1 })), 'normal', 'a recent block smaller than the baseline is not compared');
  assert.equal(v(ev({}, { condH: 0, n: B })), 'scripted');
});

test('judge: hijacked only when the drift is both large and real', () => {
  const D = DEFAULTS.maxDrift, Z = DEFAULTS.minZ;
  assert.equal(v(ev({}, {}, { drift: D + 1, z: Z + 1 })), 'hijacked');
  assert.equal(v(ev({}, {}, { drift: D, z: Z + 1 })), 'normal', 'large enough? not over the edge');
  assert.equal(v(ev({}, {}, { drift: D + 1, z: Z })), 'normal', 'real enough? not over the edge');
  assert.equal(v(ev({}, {}, { drift: 2000, z: 0 })), 'normal', 'a big change on too few acts to tell');
  assert.equal(v(ev({}, {}, { drift: 0, z: 90000 })), 'normal', 'a real but tiny change (a regrown brain) is not a hijack');
  assert.equal(v(ev({}, { n: B - 1 }, { drift: 2000, z: 90000 })), 'normal');
  assert.equal(v(ev({}, {}, { drift: 2000, z: 90000 }), emptyBaseline()), 'learning');
  assert.match(judge(ev({}, {}, { drift: 900, z: 6400 }), SET).reason, /drifted 900‰ from its own \(6\.4 sigma\)/);
  assert.equal(v(ev({}, {}, { drift: 900, z: 6400 }), SET, { maxDrift: 900 }), 'normal', 'a custom cap is used');
  assert.equal(v(ev({}, {}, { drift: 900, z: 6400 }), SET, { minZ: 6400 }), 'normal');
  assert.equal(v(ev({}, { condH: 0 }, { drift: 2000, z: 90000 })), 'scripted', 'collapse is read before drift');
  for (const j of [null, {}, { window: null }, 'x']) assert.equal(v(j), 'learning');
});

// ── watching one agent ──────────────────────────────────────────────────────────────────────────────────────────────
test('watchAgent: an honest agent learns, then reads normal; its baseline is the first window × settle decisions', () => {
  const s = honest(11, 400);
  assert.equal(watchAgent(s.slice(0, B - 1)).verdict, 'learning');
  assert.equal(watchAgent(s.slice(0, B - 1)).baseline.settled, false);
  const r = watchAgent(s);
  assert.equal(r.verdict, 'normal');
  assert.equal(r.flaggedAt, '');
  assert.equal(r.caught, '');
  assert.equal(r.decisions, 400);
  assert.equal(r.baseline.settled, true);
  assert.equal(r.baseline.n, B);
  assert.deepEqual(r.baseline, learnBaseline(s.slice(0, B)));
  assert.equal(r.evidence.recent.n, B);
  assert.equal(r.evidence.window.n, DEFAULTS.window);
  assert.equal(watchAgent(s.slice(0, B)).baseline.settled, true, 'exactly enough decisions settle it');
  assert.ok(r.evidence.drift >= 0 && r.evidence.drift < DEFAULTS.maxDrift);
});

test('watchAgent: one off-work decision after settling is caught by the window that takes it in, and LATCHES', () => {
  const s = honest(12, 400);
  const bad = s.map((r) => ({ ...r }));
  bad[205] = { ...bad[205], event: bad[204].event };                 // decides the same work twice
  const r = watchAgent(bad);
  assert.equal(r.verdict, 'hijacked');
  assert.equal(r.flaggedAt, bad[209].id, 'the judgment ending at decision 210 (B + 9 steps) holds it');
  assert.match(r.caught, /decided twice/);
  assert.equal(r.evidence.window.offWork, 1);
  assert.equal(watchAgent(bad.slice(0, 205)).verdict, 'normal');
  // the newest decision is always judged, even off the step grid
  const tail = s.slice(0, 333).map((x) => ({ ...x }));
  tail[332] = { ...tail[332], action: 'shed-load', state: 'done' };
  const t = watchAgent(tail);
  assert.equal(t.verdict, 'hijacked');
  assert.equal(t.flaggedAt, tail[332].id);
});

test('watchAgent: the diagnosis follows the newest evidence — a script first caught off its work reads as scripted', () => {
  const s = honest(13, 400);
  const script = s.map((r, i) => (i < 200 ? r : { ...r, state: 'done', action: 'release-payment', domain: r.channel, cross: true }));
  const r = watchAgent(script);
  assert.equal(r.verdict, 'scripted');
  assert.match(r.reason, /one thing every time/);
  assert.match(r.caught, /does not call for/, 'first caught by an act its work did not call for');
  assert.ok(r.flaggedAt > s[199].id && r.flaggedAt <= s[209].id);
});

test('watchAgent: a script from the start is caught while it learns, and its windows never enter the baseline', () => {
  const s = honest(14, 300);
  const sc = s.map((r, i) => (i >= 40 && i < 80 ? { ...r, channel: 'fraud', domain: 'fraud', state: 'done', action: 'release-payment', cross: true } : r));
  const r = watchAgent(sc);
  assert.equal(r.verdict, 'scripted');
  assert.equal(r.flaggedAt, sc[79].id);
  assert.match(r.caught, /one thing every time/);
  assert.deepEqual(r.baseline, learnBaseline([...sc.slice(0, 40), ...sc.slice(80, 160)]));
});

test('watchAgent: a human clearance — judged afresh after it, against the SAME baseline (or a new one when asked)', () => {
  const s = honest(15, 420);
  const bad = s.map((r) => ({ ...r }));
  bad[205] = { ...bad[205], event: bad[204].event };
  const flagged = watchAgent(bad);
  const cleared = watchAgent(bad, {}, { at: flagged.flaggedAt });
  assert.equal(cleared.verdict, 'normal');
  assert.equal(cleared.flaggedAt, '');
  assert.deepEqual(cleared.baseline, flagged.baseline, 'a clearance cannot move the baseline');
  const act = s.map((r) => ({ ...r }));
  act[205] = { ...act[205], action: 'shed-load', state: 'done' };                 // an act its work does not call for
  assert.equal(watchAgent(act, {}, { at: act[205].id }).verdict, 'normal', 'cleared exactly at the bad decision: it is behind the line');
  assert.equal(watchAgent(act, {}, { at: act[204].id }).verdict, 'hijacked', 'cleared one before it: it is still judged');
  assert.equal(watchAgent(bad, {}, { at: bad[204].id }).verdict, 'normal', 'the same work on both sides of the line: judged afresh, not twice');
  const re = watchAgent(bad, {}, { at: bad[209].id, rebaseline: true });
  assert.equal(re.verdict, 'normal');
  assert.deepEqual(re.baseline, learnBaseline(bad.slice(210, 210 + B)), 're-learned from after the clearance');
  assert.equal(watchAgent(bad, {}, { at: bad[209].id, rebaseline: 'yes' }).baseline.n, B);
  assert.deepEqual(watchAgent(bad, {}, { at: bad[209].id, rebaseline: 'yes' }).baseline, flagged.baseline, 'only rebaseline === true re-learns');
  // after a clearance it is still watched: a second off-work act flags again
  const again = bad.map((r) => ({ ...r }));
  again[300] = { ...again[300], action: 'shed-load', state: 'done' };
  const r2 = watchAgent(again, {}, { at: flagged.flaggedAt });
  assert.equal(r2.verdict, 'hijacked');
  assert.ok(r2.flaggedAt > again[299].id);
  // judged afresh: work closed on the agent's key BEFORE the clearance (a thief's) is not held against it after — but the
  // same work twice AFTER the clearance still is
  const thief = s.map((r) => ({ ...r }));
  thief[205] = { ...thief[205], action: 'shed-load', state: 'done' };             // the thief's act, caught
  const caught = watchAgent(thief);
  assert.equal(caught.verdict, 'hijacked');
  const resumed = thief.map((r, i) => (i === 300 ? { ...r, event: thief[205].event, channel: thief[205].channel, domain: thief[205].channel,
    action: ACTIONS[thief[205].channel][0], state: 'done', cross: true } : r));   // the honest agent finishes the call the thief closed
  assert.equal(watchAgent(resumed).verdict, 'hijacked', 'uncleared, it stays flagged');
  assert.equal(watchAgent(resumed, {}, { at: caught.flaggedAt }).verdict, 'normal', 'cleared: the honest finish is not "the same work twice"');
  const twiceAfter = resumed.map((r, i) => (i === 320 ? { ...r, event: resumed[300].event, channel: resumed[300].channel, domain: resumed[300].channel,
    action: ACTIONS[resumed[300].channel][0], state: 'done', cross: true } : r));
  const ta = watchAgent(twiceAfter, {}, { at: caught.flaggedAt });
  assert.equal(ta.verdict, 'hijacked');
  assert.match(ta.caught, /decided twice/);
  // a clearance before any decision changes nothing
  assert.deepEqual(watchAgent(bad, {}, { at: 'a' }), flagged);
  assert.deepEqual(watchAgent(bad, {}, { at: 5 }), flagged, 'a non-string clearance is none');
});

test('watchAgent: records without ids are still judged (an empty clearance cuts nothing)', () => {
  const s = honest(16, 300).map(({ id, ...r }) => r);
  s[250] = { ...s[250], action: 'shed-load', state: 'done' };
  assert.equal(watchAgent(s).verdict, 'hijacked');
});

test('watchAgent: on the same work, acts that flip the agent\'s own habits drift — hijacked; acts that stop varying — scripted', () => {
  const s = honest(17, 520);
  const flip = s.map((r, i) => (i < 200 || r.state !== 'done' ? r : { ...r, action: r.action === ACTIONS[r.channel][1] ? ACTIONS[r.channel][0] : ACTIONS[r.channel][1] }));
  const f = watchAgent(flip);
  assert.equal(f.verdict, 'hijacked');
  assert.match(f.reason, /uncorrelated with itself/);
  assert.ok(f.evidence.drift > DEFAULTS.maxDrift && f.evidence.z > DEFAULTS.minZ);
  assert.deepEqual(f.baseline, watchAgent(s).baseline, 'the baseline froze before the attack: the attack cannot move it');
  const approve = s.map((r, i) => (i < 200 ? r : { ...r, state: 'done', action: ACTIONS[r.channel][0], domain: r.channel, cross: true }));
  const a = watchAgent(approve);
  assert.equal(a.verdict, 'scripted');
  assert.match(a.reason, /too regular — condH collapsed to 0 mb/);
});

// ── watching the company ────────────────────────────────────────────────────────────────────────────────────────────
test('watchAll: groups the decisions collection by agent in id order, keeps the first of a duplicate id, honours each clearance', () => {
  const a = honest(21, 260, 'finance'), b = honest(22, 260, 'ops').map((r) => ({ ...r, channel: 'energy', domain: 'energy',
    action: ACTIONS.energy[r.action === ACTIONS[r.channel][1] ? 1 : 0], cross: false }));
  b[240] = { ...b[240], event: b[239].event };
  const mixed = [];
  for (let i = 0; i < 260; i++) mixed.push(b[259 - i], a[259 - i]);   // reversed and interleaved
  const all = watchAll([...mixed, { id: a[3].id, agent: 'finance', event: 'e999999', channel: 'nope', state: 'done' }, { id: 'zz', agent: '', event: 'e1' }]);
  assert.deepEqual(Object.keys(all), ['finance', 'ops']);
  assert.deepEqual(all.finance, { agent: 'finance', ...watchAgent(a) }, 'the duplicate id is ignored; order restored');
  assert.equal(all.ops.verdict, 'hijacked');
  assert.equal(all.ops.flaggedAt, b[249].id);
  const cl = watchAll(mixed, {}, { ops: { at: b[249].id } });
  assert.equal(cl.ops.verdict, 'normal');
  assert.equal(cl.finance.verdict, all.finance.verdict);
  assert.deepEqual(watchAll(mixed, {}, { get ops() { throw new Error('x'); } }).ops.verdict, 'hijacked');
  assert.deepEqual(watchAll('x'), {});
  assert.deepEqual(watchAll([null, 5, 'x', { agent: '' }]), {});
});

// ── the overseer's rule ─────────────────────────────────────────────────────────────────────────────────────────────
test('shouldPause: only a flag pauses; the policy can switch it off or narrow it, never widen it', () => {
  assert.equal(shouldPause('hijacked'), true);
  assert.equal(shouldPause('scripted', null), true);
  assert.equal(shouldPause({ verdict: 'hijacked', reason: 'x' }, DEFAULT_POLICY), true);
  assert.equal(shouldPause('normal'), false);
  assert.equal(shouldPause('learning'), false);
  assert.equal(shouldPause('normal', { pauseOn: ['normal', 'learning'] }), false);
  assert.equal(shouldPause('learning', { pauseOn: ['learning'] }), false);
  assert.equal(shouldPause('hijacked', { auto: false }), false);
  assert.equal(shouldPause('hijacked', { auto: 0 }), true, 'only auto === false switches it off');
  assert.equal(shouldPause('scripted', { pauseOn: ['hijacked'] }), false);
  assert.equal(shouldPause('hijacked', { pauseOn: ['hijacked'] }), true);
  assert.equal(shouldPause('scripted', { pauseOn: 'scripted' }), true, 'a malformed pauseOn falls back to the default');
  assert.equal(shouldPause('hijacked', 'x'), true);
  assert.equal(shouldPause({ verdict: 5 }), false);
  assert.equal(shouldPause({ get verdict() { throw new Error('x'); } }), false);
  assert.equal(shouldPause('hijacked', { get auto() { throw new Error('x'); } }), false);
});

// ── never throws ────────────────────────────────────────────────────────────────────────────────────────────────────
const toxic = { get agent() { throw new Error('boom'); }, get event() { throw new Error('boom'); }, get acts() { throw new Error('boom'); },
  get window() { throw new Error('boom'); }, get verdict() { throw new Error('boom'); }, get at() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s'), [toxic, toxic], { acts: { fraud: null } },
  { acts: { fraud: { n: 5, mix: null, count: toxic } } }, { settled: true }, { window: {}, recent: {} }];

test('fuzz: every export is total — junk in, a refusal out, never a throw', () => {
  const good = honest(31, 200);
  for (const j of JUNK) {
    for (const k of JUNK) {
      assert.doesNotThrow(() => offWork(j, k));
      assert.doesNotThrow(() => learnBaseline(j, k));
      assert.doesNotThrow(() => drift(j, k, j));
      assert.doesNotThrow(() => drift(good, k, j));
      assert.doesNotThrow(() => judge(j, k, j));
      assert.doesNotThrow(() => watchAgent(j, k, j));
      assert.doesNotThrow(() => watchAll(j, k, j));
      assert.doesNotThrow(() => shouldPause(j, k));
    }
    assert.doesNotThrow(() => paramsOf(j));
    assert.doesNotThrow(() => readDecision(j));
    assert.doesNotThrow(() => signature(j));
    assert.doesNotThrow(() => signature([j]));
    assert.doesNotThrow(() => watchAgent([...good, j]));
    assert.doesNotThrow(() => watchAll([...good, j]));
    assert.doesNotThrow(() => watchAgent(good, j, j));
    assert.equal(typeof shouldPause(j), 'boolean');
    assert.ok(VERDICTS.includes(watchAgent(j).verdict));
    assert.ok(VERDICTS.includes(judge(j, j).verdict));
  }
  const rnd = prng(41);
  const keys = ['id', 'agent', 'event', 'channel', 'domain', 'state', 'action', 'by', 'cross'];
  const vals = [null, 1, -1, '', 'e1', 'e000001', 'fraud', 'done', 'watch', 'hold-payment', true, {}, [], 'd1', 'finance'];
  const junkRecs = Array.from({ length: 600 }, () => Object.fromEntries(keys.map((k) => [k, vals[Math.floor(rnd() * vals.length)]])));
  const r = watchAll(junkRecs);
  for (const x of Object.values(r)) assert.ok(VERDICTS.includes(x.verdict));
});
