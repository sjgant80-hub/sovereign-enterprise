import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { passesGate, GATE_AUC, ROUTE_MIN, fires, validPattern, membership, scoreInput, route, answer, verifyReceipt, auc, verifyOn, adopt, toRecord, fromRecord, meshRoute, secondOpinion } from '../src/brain.mjs';
import { sample, shopperRows, SYNTHETIC, NOTES } from '../src/streams.mjs';

const brain = (d) => JSON.parse(readFileSync(new URL('../brains/' + d + '.slm.json', import.meta.url)));
const fraud = brain('fraud'), churn = brain('churn'), inv = brain('inventory'), shop = brain('shopper');
const mini = () => ({ domain: 'd', features: ['a', 'b'], rules: [{ feat: 'a', op: '>', v: 1, w: 2 }, { feat: 'b', op: '<=', v: 0, w: -1 }],
  threshold: 0.5, spread: 3, base: 0.3, heldAuc: 0.8, patternId: 'p1',
  dist: { a: { min: 0, q1: 1, med: 2, q3: 3, max: 10 }, b: { min: -5, q1: -1, med: 0, q3: 1, max: 5 } } });

test('fires: > is strict, <= includes the cut', () => {
  assert.equal(fires({ op: '>', v: 1 }, 1), false);
  assert.equal(fires({ op: '>', v: 1 }, 1.0001), true);
  assert.equal(fires({ op: '<=', v: 1 }, 1), true);
  assert.equal(fires({ op: '<=', v: 1 }, 1.0001), false);
});

test('validPattern: every dedicated brain file is valid; each malformation alone is refused', () => {
  for (const d of ['shopper', 'churn', 'fraud', 'credit', 'inventory', 'maintenance', 'intrusion', 'energy']) assert.equal(validPattern(brain(d)), true, d);
  assert.equal(validPattern(mini()), true);
  const bad = [
    (p) => { p.domain = ''; }, (p) => { p.features = []; }, (p) => { p.features = new Array(17).fill('a'); },
    (p) => { p.rules = []; }, (p) => { p.rules = new Array(13).fill(p.rules[0]); }, (p) => { p.rules[0].feat = 'zzz'; },
    (p) => { p.rules[0].op = '<'; }, (p) => { p.rules[0].v = NaN; }, (p) => { p.rules[0].w = Infinity; },
    (p) => { p.threshold = 'x'; }, (p) => { p.spread = null; }, (p) => { p.base = undefined; },
    (p) => { p.heldAuc = 1.2; }, (p) => { p.heldAuc = -0.1; }, (p) => { p.dist = null; }, (p) => { delete p.dist.b; },
    (p) => { p.dist.a.q3 = NaN; }, (p) => { p.rules[0] = null; },
  ];
  for (const f of bad) { const p = mini(); f(p); assert.equal(validPattern(p), false, f.toString()); }
  assert.equal(validPattern(null), false);
  assert.equal(validPattern({ get domain() { throw new Error('x'); } }), false);
  for (const k of ['min', 'q1', 'med', 'q3', 'max']) { const p = mini(); p.dist.b[k] = Infinity; assert.equal(validPattern(p), false, k); }
  const num = mini(); num.domain = 5; assert.equal(validPattern(num), false);
  const caps = mini(); caps.domain = 'Fraud'; assert.equal(validPattern(caps), false);
  const str = mini(); str.features = 'ab'; str.rules = [{ feat: 'a', op: '>', v: 1, w: 1 }]; assert.equal(validPattern(str), false);   // a string is not a feature list
  const twelve = mini(); twelve.rules = new Array(12).fill(twelve.rules[0]); assert.equal(validPattern(twelve), true);
  const edge = mini(); edge.heldAuc = 0; assert.equal(validPattern(edge), true);
  edge.heldAuc = 1; assert.equal(validPattern(edge), true);
  edge.features = new Array(16).fill('a'); edge.dist = { a: mini().dist.a }; edge.rules = [{ feat: 'a', op: '>', v: 1, w: 1 }]; assert.equal(validPattern(edge), true);
});

test('membership: 1 inside the IQR, decays outside, 0 on junk', () => {
  const fp = { min: 0, q1: 2, med: 3, q3: 4, max: 10 };
  assert.equal(membership(2, fp), 1);
  assert.equal(membership(4, fp), 1);
  assert.equal(membership(3, fp), 1);
  assert.equal(membership(9, fp), Math.round(Math.exp(-5 / 5) * 1e6) / 1e6);
  assert.equal(membership(0, fp), Math.round(Math.exp(-2 / 5) * 1e6) / 1e6);
  assert.equal(membership('x', fp), 0);
  assert.equal(membership(3, null), 0);
  const flat = { min: 1, q1: 1, med: 1, q3: 1, max: 1 };
  assert.ok(membership(2, flat) >= 0 && membership(2, flat) < 1e-6);
});

test('scoreInput: sums the weights of the rules that fire', () => {
  assert.equal(scoreInput(mini(), { a: 2, b: 0 }), 1);       // 2 + (−1)
  assert.equal(scoreInput(mini(), { a: 1, b: 5 }), 0);
  assert.equal(scoreInput(mini(), { a: 'x', b: -1 }), -1);
  assert.equal(scoreInput(null, { a: 1 }), 0);
  assert.equal(scoreInput(mini(), null), 0);
});

test('route + answer: verified answer with a valid receipt; abstains when out of distribution or below the gate', () => {
  const lib = { d: mini() };
  const a = answer(lib, { a: 2, b: 0 });
  assert.equal(a.verdict, 'VERIFIED');
  assert.equal(a.label, 1);                                    // score 1 > threshold 0.5
  assert.equal(a.confidence, Math.round(0.5 / 3 * 1e6) / 1e6);
  assert.equal(verifyReceipt(a.receipt), true);
  assert.equal(verifyReceipt({ ...a.receipt, label: 0 }), false);
  assert.equal(verifyReceipt(null), false);
  assert.equal(answer(lib, { a: 0.5, b: 0 }).label, 0);        // a does not fire, b does → −1 ≤ 0.5
  assert.equal(answer(lib, { a: 0.5, b: 0 }).verdict, 'VERIFIED');
  assert.equal(answer(lib, { a: 1000, b: 1000 }).verdict, 'ABSTAIN');       // far outside → out of distribution
  assert.equal(answer(lib, { a: 2 }).verdict, 'ABSTAIN');                   // missing feature → coverage < 1
  assert.equal(answer({}, { a: 2, b: 0 }).verdict, 'ABSTAIN');
  assert.equal(answer(null, { a: 1 }).verdict, 'ABSTAIN');
  const low = mini(); low.heldAuc = GATE_AUC - 0.001;
  assert.equal(answer({ d: low }, { a: 2, b: 0 }).verdict, 'ABSTAIN');
  const at = mini(); at.heldAuc = GATE_AUC;
  assert.equal(answer({ d: at }, { a: 2, b: 0 }).verdict, 'VERIFIED');
  const r = route({ d: mini(), junk: { nope: 1 } }, { a: 2, b: 0 });
  assert.equal(r.ranked.length, 1);
  assert.equal(route(null, {}).ok, false);
  assert.equal(route('abc', { a: 2, b: 0 }).ok, false);
  assert.equal(route({ d: mini() }, 'abc').ok, false);
  assert.equal(route({ d: mini() }, null).ok, false);
  assert.equal(a.receipt.patternId, 'p1');
  const anon = mini(); delete anon.patternId;
  assert.equal(answer({ d: anon }, { a: 2, b: 0 }).receipt.patternId, '');
});

test('answer: score exactly at the threshold is label 0 (strictly greater wins)', () => {
  const p = mini(); p.threshold = 1;
  assert.equal(answer({ d: p }, { a: 2, b: 0 }).label, 0);
  assert.equal(verifyOn(p, [{ a: 2, b: 0, y: 0 }]).acc, 1);          // the same rule when grading on local rows
  assert.equal(verifyOn(p, [{ a: 2, b: 0, y: 1 }]).acc, 0);
});

test('route: an input exactly at the out-of-distribution line is still answered', () => {
  const one = { domain: 'o', features: ['a'], rules: [{ feat: 'a', op: '>', v: 1, w: 1 }], threshold: 0.5, spread: 1, base: 0.5, heldAuc: 0.9, patternId: 'o1',
    dist: { a: { min: 0, q1: 0, med: 0.5, q3: 1, max: 2 } } };                       // span = max(IQR 1, half-range 1) = 1
  const x = 1 + -Math.log(ROUTE_MIN);
  assert.equal(route({ o: one }, { a: x }).best.routeScore, ROUTE_MIN);              // the test is only meaningful if this lands exactly
  assert.equal(answer({ o: one }, { a: x }).verdict, 'VERIFIED');
  assert.equal(answer({ o: one }, { a: x + 0.01 }).verdict, 'ABSTAIN');
});

test('route picks the best-fitting pattern; ties broken by name', () => {
  const r = route({ fraud, churn }, sample('fraud', 3, 2).rows[0]);
  assert.equal(r.best.domain, 'fraud');
  const twin = { b2: mini(), a1: mini() };
  assert.equal(route(twin, { a: 2, b: 0 }).best.domain, 'a1');
  assert.ok(ROUTE_MIN > 0 && ROUTE_MIN < 1);
});

test('auc: perfect, inverse, ties and degenerate', () => {
  assert.equal(auc([1, 2, 3, 4], [0, 0, 1, 1]), 1);
  assert.equal(auc([4, 3, 2, 1], [0, 0, 1, 1]), 0);
  assert.equal(auc([1, 1, 1, 1], [0, 1, 0, 1]), 0.5);
  assert.equal(auc([1, 2], [1, 1]), 0.5);
  assert.equal(auc([1, 2], [0, 0]), 0.5);
  assert.equal(auc([], []), 0.5);
  assert.equal(passesGate(GATE_AUC), true);
  assert.equal(passesGate(GATE_AUC - 1e-9), false);
  assert.equal(auc([1, 2, 2, 3], [0, 0, 1, 1]), 0.875);
});

test('verifyOn + adopt: re-verified on the node\'s OWN data; refused when it does not hold there', () => {
  const rows = sample('fraud', 1234, 600).rows;
  const v = verifyOn(fraud, rows);
  assert.equal(v.n, 600);
  assert.ok(v.auc > 0.65);
  assert.ok(v.acc > 0.6);
  const ok = adopt(fraud, rows);
  assert.equal(ok.adopt, true);
  assert.match(ok.reason, /re-verified/);
  assert.equal(adopt(fraud, rows.slice(0, 49)).adopt, false);
  assert.equal(adopt(fraud, rows.slice(0, 50)).n, 50);
  assert.doesNotMatch(adopt(fraud, rows.slice(0, 50)).reason, /not enough/);       // exactly 50 is enough to judge
  assert.equal(adopt(fraud, rows, v.auc).adopt, true);                              // a pattern exactly at the gate is adopted
  assert.equal(adopt(fraud, rows, v.auc + 1e-6).adopt, false);
  assert.equal(adopt(fraud, sample('churn', 9, 600).rows.map((r) => ({ ...r }))).adopt, false); // wrong domain's data
  const wrongWay = { ...fraud, rules: fraud.rules.map((r) => ({ ...r, w: -r.w })) };       // a sabotaged pattern
  const s = adopt(wrongWay, rows);
  assert.equal(s.adopt, false);
  assert.match(s.reason, /did not re-verify/);
  assert.equal(adopt(null, rows).reason, 'malformed pattern');
  assert.equal(adopt(fraud, rows, 0.99).adopt, false);
  assert.deepEqual(verifyOn(null, rows), { auc: 0.5, acc: 0, n: 0 });
  assert.deepEqual(verifyOn({}, rows), { auc: 0.5, acc: 0, n: 0 });
  assert.deepEqual(verifyOn(fraud, []), { auc: 0.5, acc: 0, n: 0 });
  assert.deepEqual(verifyOn(fraud, 'abc'), { auc: 0.5, acc: 0, n: 0 });
});

test('the real sales brain re-verifies on real held-out UCI sessions', () => {
  const rows = shopperRows(JSON.parse(readFileSync(new URL('../brains/shopper.sample.json', import.meta.url))));
  assert.equal(rows.length, 1182);
  assert.equal(rows.filter((r) => r.y === 1).length, 248);
  assert.equal(adopt(shop, rows).adopt, true);
  assert.deepEqual(shopperRows(null), []);
});

test('a pattern travels as a spine record and comes back identical; junk records are refused', () => {
  for (const p of [fraud, churn, inv, shop]) {
    const rec = toRecord(p);
    for (const v of Object.values(rec)) assert.ok(typeof v === 'string' || typeof v === 'boolean' || Number.isSafeInteger(v));
    for (const v of Object.values(rec)) if (typeof v === 'string') assert.ok(v.length <= 2000);
    assert.equal(rec.title, p.title);
    assert.equal(rec.role, p.role);
    assert.equal(rec.patternId, p.patternId);
    assert.equal(rec.heldAcc, String(p.heldAcc));
    assert.ok(p.title !== p.domain && p.role && p.heldAcc > 0 && p.patternId);   // so the four lines above can tell
    const back = fromRecord(rec);
    assert.ok(back);
    assert.equal(back.patternId, p.patternId);
    assert.deepEqual(back.rules, p.rules);
    assert.equal(back.threshold, p.threshold);
    assert.deepEqual(back.dist, p.dist);
  }
  assert.equal(fromRecord(null), null);
  assert.equal(fromRecord({ features: 'a', rules: 'a|>|x|1', dist: 'a:0,0,0,0,0' }), null);
  assert.equal(fromRecord({ ...toRecord(fraud), rules: 5 }), null);
  assert.equal(fromRecord({ ...toRecord(fraud), dist: 'zz' }), null);
});

test('meshRoute: the abstaining node is answered by the peer that covers the input', () => {
  const q = sample('inventory', 5, 3).rows[0];
  assert.equal(answer({ churn }, q).verdict, 'ABSTAIN');
  const peers = [{ node: 'service', library: { churn } }, { node: 'ops', library: { inventory: inv } }, { node: 'finance', library: { fraud } }];
  const m = meshRoute(peers, q, 'service');
  assert.equal(m.node, 'ops');
  assert.equal(m.answer.domain, 'inventory');
  assert.equal(meshRoute(peers, q, 'ops'), null);                  // the only cover is excluded
  assert.equal(meshRoute([], q), null);
  assert.equal(meshRoute(null, q), null);
  const twin = meshRoute([{ node: 'z', library: { inventory: inv } }, { node: 'a', library: { inventory: inv } }], q);
  assert.equal(twin.node, 'a');                                    // equal routes → the lower name, deterministically
  const alt = { ...inv, patternId: 'alt', rules: inv.rules.map((r) => ({ ...r, w: -r.w })) };   // same shape, same route score
  const dup = meshRoute([{ node: 'a', library: { inventory: inv } }, { node: 'a', library: { inventory: alt } }], q);
  assert.equal(dup.answer.receipt.patternId, inv.patternId);       // a duplicate name never displaces the first answer
  const far = { ...inv, patternId: 'far', dist: Object.fromEntries(Object.entries(inv.dist).map(([f, d]) => [f, { ...d, q1: d.q3, q3: d.q3 + 1e-6 }])) };
  const weaker = answer({ inventory: far }, q);
  assert.equal(weaker.verdict, 'VERIFIED');
  assert.ok(weaker.routeScore < answer({ inventory: inv }, q).routeScore);
  assert.equal(meshRoute([{ node: 'z', library: { inventory: inv } }, { node: 'a', library: { inventory: far } }], q).node, 'z');   // the better route wins over the lower name
  assert.equal(meshRoute([{ node: 'a', library: { inventory: far } }, { node: 'z', library: { inventory: inv } }], q).node, 'z');
});

test('secondOpinion: only an independent pattern on another node may confirm', () => {
  const q = sample('fraud', 41, 3).rows[0];
  const first = answer({ fraud }, q);
  const other = { ...fraud, patternId: 'grown-elsewhere', rules: fraud.rules.slice(0, Math.max(1, fraud.rules.length - 1)) };
  const peers = [{ node: 'finance', library: { fraud } }, { node: 'ops', library: { fraud } }, { node: 'audit', library: { fraud: other } }, { node: 'x', library: { churn } }];
  const s = secondOpinion(peers, q, first, ['finance']);
  assert.equal(s.node, 'audit');                                   // ops holds a COPY of the same pattern → refused
  assert.equal(s.answer.domain, 'fraud');
  assert.equal(secondOpinion(peers, q, first, ['finance', 'audit']), null);
  assert.equal(secondOpinion(peers, q, first, 'audit'), null);       // a bare name works; finance + ops are copies, x has no fraud
  assert.equal(secondOpinion(peers, q, first, []).node, 'audit');
  assert.equal(secondOpinion(peers, q, { ...first, verdict: 'ABSTAIN' }, []), null);
  assert.equal(secondOpinion(peers, q, { ...first, receipt: { patternId: '' } }, []), null);
  assert.equal(secondOpinion(peers, q, null, []), null);
  assert.equal(secondOpinion(null, q, first, []), null);
  const twin = secondOpinion([{ node: 'z', library: { fraud: other } }, { node: 'b', library: { fraud: other } }], q, first, []);
  assert.equal(twin.node, 'b');
  const alt = { ...other, patternId: 'alt2', rules: other.rules.map((r) => ({ ...r, w: -r.w })) };
  assert.equal(secondOpinion([{ node: 'b', library: { fraud: other } }, { node: 'b', library: { fraud: alt } }], q, first, []).answer.receipt.patternId, 'grown-elsewhere');
  const far = { ...other, patternId: 'far2', dist: Object.fromEntries(Object.entries(other.dist).map(([f, d]) => [f, { ...d, q1: d.q3, q3: d.q3 + 1e-6 }])) };
  assert.equal(secondOpinion([{ node: 'z', library: { fraud: other } }, { node: 'a', library: { fraud: far } }], q, first, []).node, 'z');
  assert.equal(secondOpinion([{ node: 'a', library: { fraud: far } }, { node: 'z', library: { fraud: other } }], q, first, []).node, 'z');
  assert.equal(secondOpinion([{ node: 'q', library: null }, null, { node: 'r', library: { churn } }], q, first, []), null);
});

test('streams: per-device samples are seeded, distinct across seeds, and labelled', () => {
  for (const d of SYNTHETIC) {
    const a = sample(d, 1, 50), b = sample(d, 1, 50), c = sample(d, 2, 50);
    assert.equal(a.ok, true);
    assert.deepEqual(a.rows, b.rows);
    assert.notDeepEqual(a.rows, c.rows);
    assert.equal(a.rows.length, 50);
    assert.ok(NOTES[d].length > 20);
  }
  assert.equal(sample('shopper', 1, 5).ok, false);
  assert.equal(sample('fraud', 1, 0).rows.length, 1);
});
