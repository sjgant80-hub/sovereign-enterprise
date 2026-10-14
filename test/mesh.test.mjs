import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, MAX_FEATURES_CHARS, askRecord, askFeatures, replyFor, repliesTo, heardFrom, pickAnswer, pickSecond } from '../src/mesh.mjs';
import { answer } from '../src/brain.mjs';
import { growPattern } from '../src/grow.mjs';
import { sample } from '../src/streams.mjs';

const brain = (d) => JSON.parse(readFileSync(new URL('../brains/' + d + '.slm.json', import.meta.url)));
const fraud = brain('fraud'), inv = brain('inventory'), churn = brain('churn');
const FRAUD = ['amount', 'hourOfDay', 'distanceKm', 'recentTx', 'merchantRisk', 'cardNotPresent'];
const grown = growPattern('fraud', sample('fraud', 77, 700).rows, FRAUD, { seed: 77 }).pattern;
const row = (d, s = 3) => { const { y, ...f } = sample(d, s, 1).rows[0]; return f; };
const ask = (o) => ({ id: 'a1', ...askRecord(o) });

test('askRecord: carries the case as spine-legal fields; refuses what cannot travel', () => {
  const a = askRecord({ kind: 'answer', item: 'e000001', from: 'service', features: row('inventory') });
  assert.equal(a.kind, 'answer');
  assert.equal(a.domain, '');
  assert.equal(a.pattern, '');
  assert.equal(a.exclude, '');
  for (const v of Object.values(a)) assert.ok(typeof v === 'string' && v.length <= 2000);
  const s = askRecord({ kind: 'second', item: 'e1', from: 'finance', features: row('fraud'), domain: 'fraud', pattern: 'p1', exclude: ['finance', 'BAD NAME', 'ops'] });
  assert.equal(s.exclude, 'finance,ops');
  assert.equal(s.domain, 'fraud');
  assert.equal(askRecord({ kind: 'second', item: 'e1', from: 'finance', features: {}, domain: 'fraud', pattern: '' }), null);
  assert.equal(askRecord({ kind: 'second', item: 'e1', from: 'finance', features: {}, domain: 'Bad', pattern: 'p' }), null);
  assert.equal(askRecord({ kind: 'second', item: 'e1', from: 'finance', features: {}, domain: 'fraud', pattern: 5 }), null);
  assert.equal(askRecord({ kind: 'gossip', item: 'e1', from: 'a', features: {} }), null);
  assert.equal(askRecord({ kind: 'answer', item: '', from: 'a', features: {} }), null);
  assert.equal(askRecord({ kind: 'answer', item: 'x'.repeat(65), from: 'a', features: {} }), null);
  assert.ok(askRecord({ kind: 'answer', item: 'x'.repeat(64), from: 'a', features: {} }));
  assert.equal(askRecord({ kind: 'answer', item: 'e', from: 'A', features: {} }), null);
  assert.equal(askRecord({ kind: 'answer', item: 'e', from: 'a', features: [1] }), null);
  assert.equal(askRecord({ kind: 'answer', item: 'e', from: 'a', features: 'x' }), null);
  const big = {}; for (let i = 0; i < 200; i++) big['f' + i] = 123456.789;
  assert.equal(askRecord({ kind: 'answer', item: 'e', from: 'a', features: big }), null);
  const edge = { k: 'x'.repeat(MAX_FEATURES_CHARS - 8) };
  assert.equal(JSON.stringify(edge).length, MAX_FEATURES_CHARS);
  assert.ok(askRecord({ kind: 'answer', item: 'e', from: 'a', features: edge }));
  assert.deepEqual(KINDS, ['answer', 'second']);
  assert.equal(askRecord(), null);
});

test('askFeatures: only finite numbers under legal names come back', () => {
  assert.deepEqual(askFeatures({ features: '{"a":1,"b":"x","PageValues":2,"c":null,"bad key":3}' }), { a: 1, PageValues: 2 });
  assert.equal(askFeatures({ features: '[1]' }), null);
  assert.equal(askFeatures({ features: 'null' }), null);
  assert.equal(askFeatures({ features: '5' }), null);
  assert.equal(askFeatures({ features: '"x"' }), null);
  assert.equal(askFeatures({ features: '{' }), null);
  assert.equal(askFeatures(null), null);
});

test('replyFor: answers from its own library, abstains out loud, stays silent on its own or an excluded ask', () => {
  const q = ask({ kind: 'answer', item: 'e1', from: 'service', features: row('inventory') });
  const r = replyFor(q, { inventory: inv }, 'ops');
  const direct = answer({ inventory: inv }, row('inventory'));
  assert.equal(r.verdict, 'VERIFIED');
  assert.deepEqual([r.ask, r.item, r.by, r.kind, r.domain, r.label], ['a1', 'e1', 'ops', 'answer', 'inventory', direct.label]);
  assert.equal(r.conf, Math.round(direct.confidence * 1000));
  assert.equal(r.route, Math.round(direct.routeScore * 1000));
  assert.equal(r.pattern, inv.patternId);
  assert.equal(r.receipt, direct.receipt.receiptHash.slice(0, 16));
  const no = replyFor(q, { churn }, 'sales');
  assert.equal(no.verdict, 'ABSTAIN');
  assert.ok(no.why.length > 0 && no.why.length <= 120);
  assert.equal(no.why, answer({ churn }, row('inventory')).why);                          // the brain's own reason, passed on faithfully
  assert.equal(replyFor(q, {}, 'sales').why, 'no pattern to route to');
  assert.equal(replyFor(q, { inventory: inv }, 'service'), null);                      // its own ask
  assert.equal(replyFor({ ...q, exclude: 'ops,finance' }, { inventory: inv }, 'ops'), null);
  assert.equal(replyFor({ ...q, exclude: 'opsx' }, { inventory: inv }, 'ops').verdict, 'VERIFIED');
  assert.equal(replyFor({ ...q, features: '[' }, { inventory: inv }, 'ops').verdict, 'ABSTAIN');
  assert.equal(replyFor({ ...q, kind: 'gossip' }, { inventory: inv }, 'ops'), null);
  assert.equal(replyFor(q, { inventory: inv }, 'Bad'), null);
  assert.equal(replyFor(null, {}, 'ops'), null);
});

test('replyFor (second): only an independent pattern for the same domain is a second opinion', () => {
  const f = row('fraud', 5);
  const first = answer({ fraud }, f);
  const q = ask({ kind: 'second', item: 'e2', from: 'finance', features: f, domain: 'fraud', pattern: first.receipt.patternId, exclude: ['finance'] });
  const copy = replyFor(q, { fraud }, 'ops');
  assert.equal(copy.verdict, 'COPY');                                                    // ops learned finance's brain — not independent
  const ind = replyFor(q, { fraud: grown }, 'audit');
  assert.equal(ind.verdict, 'VERIFIED');
  assert.equal(ind.pattern, grown.patternId);
  assert.equal(ind.domain, 'fraud');
  assert.equal(replyFor(q, { churn }, 'sales').verdict, 'ABSTAIN');
  assert.match(replyFor(q, { churn }, 'sales').why, /no brain for fraud/);
  const ood = { ...q, features: JSON.stringify({ amount: 1e9, hourOfDay: 1e9, distanceKm: 1e9, recentTx: 1e9, merchantRisk: 1e9, cardNotPresent: 1e9 }) };
  assert.equal(replyFor(ood, { fraud: grown }, 'audit').verdict, 'ABSTAIN');
  assert.equal(replyFor(q, { fraud: grown }, 'finance'), null);                          // the asker never confirms itself
});

test('repliesTo + heardFrom: one reply per device, the first wins; know when everyone has answered', () => {
  const rs = [{ ask: 'a1', by: 'ops', v: 1 }, { ask: 'a2', by: 'ops' }, { ask: 'a1', by: 'ops', v: 2 }, { ask: 'a1', by: 'sales' }, null, 'x'];
  const mine = repliesTo(rs, 'a1');
  assert.deepEqual(mine.map((r) => r.by), ['ops', 'sales']);
  assert.equal(mine[0].v, 1);
  assert.equal(heardFrom(mine, ['ops', 'sales']), true);
  assert.equal(heardFrom(mine, ['ops', 'sales', 'audit']), false);
  assert.equal(heardFrom(mine, []), true);
  assert.equal(heardFrom(null, ['ops']), false);
  assert.deepEqual(repliesTo(null, 'a1'), []);
});

test('pickAnswer: the strongest verified reply; ties to the lower name; abstentions and junk ignored', () => {
  const v = (by, route, extra) => ({ by, verdict: 'VERIFIED', domain: 'inventory', label: 1, conf: 300, route, pattern: 'p' + by, receipt: 'r' + by, ...extra });
  const best = pickAnswer([v('ops', 800), v('finance', 900), { by: 'x', verdict: 'ABSTAIN' }, v('sales', 950, { label: 2 }), v('audit', 990, { conf: 0.5 })]);
  assert.equal(best.node, 'finance');
  assert.deepEqual(best.answer, { verdict: 'VERIFIED', domain: 'inventory', label: 1, confidence: 0.3, routeScore: 0.9, receipt: { patternId: 'pfinance', receiptHash: 'rfinance' } });
  assert.equal(pickAnswer([v('zed', 800), v('abe', 800)]).node, 'abe');
  assert.equal(pickAnswer([v('abe', 800), v('zed', 800)]).node, 'abe');
  assert.equal(pickAnswer([v('abe', 800), v('zed', 801)]).node, 'zed');
  assert.equal(pickAnswer([v('abe', 800, { label: 0 }), v('abe', 800, { label: 1 })]).answer.label, 0);   // a duplicate never displaces the first
  assert.equal(pickAnswer([v('a', 1, { label: 0 })]).answer.label, 0);
  assert.equal(pickAnswer([v('a', 1, { domain: 5 })]), null);
  assert.equal(pickAnswer([v('a', 1, { route: 0.5 })]), null);
  assert.equal(pickAnswer([]), null);
  assert.equal(pickAnswer(null), null);
});

test('pickSecond: same domain, different pattern, not an excluded device', () => {
  const v = (by, pattern, extra) => ({ by, verdict: 'VERIFIED', domain: 'fraud', label: 1, conf: 300, route: 700, pattern, receipt: 'r', ...extra });
  const rs = [v('ops', 'P1'), v('finance', 'P2'), v('audit', 'P3', { route: 600 }), v('sales', 'P4', { domain: 'credit', route: 999 })];
  assert.equal(pickSecond(rs, 'fraud', 'P1', ['finance']).node, 'audit');              // ops is a copy (P1), finance excluded, sales off-domain
  assert.equal(pickSecond(rs, 'fraud', 'P9', 'finance').node, 'ops');
  assert.equal(pickSecond(rs, 'fraud', 'P1', ['finance', 'audit']), null);
  assert.equal(pickSecond(null, 'fraud', 'P1', []), null);
});

test('the protocol end to end, with no shared memory: ask → replies from each device\'s own library → decide', () => {
  const f = row('inventory', 9);
  const libs = { sales: {}, finance: { fraud }, ops: { inventory: inv }, audit: { fraud: grown } };
  const q = ask({ kind: 'answer', item: 'e9', from: 'sales', features: f });
  const replies = Object.entries(libs).map(([me, lib]) => replyFor(q, lib, me)).filter(Boolean);
  assert.deepEqual(replies.map((r) => r.by), ['finance', 'ops', 'audit']);
  assert.equal(heardFrom(replies, ['finance', 'ops', 'audit']), true);
  const m = pickAnswer(replies);
  assert.equal(m.node, 'ops');
  assert.equal(m.answer.label, answer({ inventory: inv }, f).label);
});

test('never throws on junk', () => {
  const toxic = { get kind() { throw new Error('x'); }, get features() { throw new Error('x'); } };
  for (const j of [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s')]) {
    assert.doesNotThrow(() => askRecord(j));
    assert.doesNotThrow(() => askFeatures(j));
    assert.doesNotThrow(() => replyFor(j, j, 'ops'));
    assert.doesNotThrow(() => replyFor(j, {}, j));
    assert.doesNotThrow(() => repliesTo(j, j));
    assert.doesNotThrow(() => heardFrom(j, j));
    assert.doesNotThrow(() => pickAnswer(j));
    assert.doesNotThrow(() => pickAnswer([j]));
    assert.doesNotThrow(() => pickSecond(j, j, j, j));
  }
});
