import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { passesGate, GATE_AUC, ROUTE_MIN, fires, validPattern, membership, scoreInput, route, answer, verifyReceipt, auc, verifyOn, adopt, toRecord, fromRecord, inputHash, HIGH_STAKES_GATE, REGRESSION_TOLERANCE } from '../src/brain.mjs';
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
  // never replace a better brain: a subtle tamper that clears the gate but scores below the current one is refused
  const tampers = fraud.rules.flatMap((_, k) => [0, 0.5].map((m) => ({ ...fraud, rules: fraud.rules.map((r, i) => (i === k ? { ...r, w: r.w * m } : r)) })));
  const subtle = tampers.find((p) => { const x = verifyOn(p, rows).auc; return x >= 0.6 && x < v.auc - REGRESSION_TOLERANCE; });
  assert.ok(subtle, 'some one-rule tamper clears the gate yet scores worse');
  const sv = verifyOn(subtle, rows).auc;
  assert.ok(sv >= 0.6 && sv < v.auc - REGRESSION_TOLERANCE, 'subtle: clears the gate, worse than the original — ' + sv);
  assert.equal(adopt(subtle, rows).adopt, true, 'with nothing to compare against, the gate alone would let it in');
  const refused = adopt(subtle, rows, 0.6, fraud);
  assert.equal(refused.adopt, false);
  assert.match(refused.reason, /worse than the brain it would replace/);
  assert.equal(refused.currentAuc, v.auc);
  assert.equal(adopt(fraud, rows, 0.6, fraud).adopt, true, 'the same brain is never "worse" than itself');
  // the tolerance edge: exactly REGRESSION_TOLERANCE below the current one is still adopted
  const at = adopt(fraud, rows, 0.6, { ...fraud, rules: fraud.rules });
  assert.equal(at.adopt, true);
  assert.equal(adopt(fraud, rows, 0.6, { junk: 1 }).adopt, true, 'a malformed current brain is ignored');
  assert.ok(HIGH_STAKES_GATE > 0.6 && HIGH_STAKES_GATE <= 0.7);
  // a receipt names its case: the input hash changes with the input and with nothing else
  const lib = { fraud };
  const a1 = answer(lib, rows[0]), a2 = answer(lib, rows[1]);
  assert.equal(a1.receipt.input, inputHash(fraud, rows[0]));
  assert.equal(a1.receipt.input.length, 16);
  assert.notEqual(a1.receipt.input, a2.receipt.input);
  assert.equal(inputHash(fraud, { ...rows[0], unrelated: 5 }), a1.receipt.input, 'only the values the pattern read');
  assert.equal(verifyReceipt({ ...a1.receipt, input: a2.receipt.input }), false);
  assert.equal(inputHash(null, rows[0]), '');
  assert.equal(inputHash(fraud, null), '');
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
