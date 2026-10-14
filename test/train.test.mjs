import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_FEATURES, safeNames, relevance, trainFromCsv, sampleCsv } from '../src/train.mjs';
import { validPattern, answer, toRecord, fromRecord, GATE_AUC } from '../src/brain.mjs';
import { MIN_ROWS } from '../src/grow.mjs';

const shop = JSON.parse(readFileSync(new URL('../brains/shopper.sample.json', import.meta.url)));
const csv = sampleCsv(shop);

test('a real CSV becomes a verified brain on the device — same shape as the shipped brains, travels on the spine', () => {
  const t = trainFromCsv(csv, { domain: 'my-shop', seed: 3 });
  assert.equal(t.ok, true);
  assert.equal(t.verified, true);
  assert.equal(t.target, 'Purchased');
  assert.equal(t.positive, 'yes');
  assert.equal(t.rows, 1182);
  assert.ok(t.pattern.heldAuc >= GATE_AUC);
  assert.equal(validPattern(t.pattern), true);
  assert.equal(t.pattern.domain, 'my-shop');
  assert.ok(t.features.length >= 1 && t.features.length <= MAX_FEATURES);
  for (let k = 1; k < t.features.length; k++) assert.ok(t.features[k - 1].relevance >= t.features[k].relevance, 'most related first');
  assert.equal(t.features[0].from, 'PageValues');                                 // the one feature everyone who knows this data expects
  const back = fromRecord(toRecord(t.pattern));
  assert.deepEqual(back.rules, t.pattern.rules);
  const row = {}; for (const f of t.features) row[f.name] = shop.data[1][shop.features.indexOf(f.from)];
  assert.ok(['VERIFIED', 'ABSTAIN'].includes(answer({ 'my-shop': t.pattern }, row).verdict));
  assert.equal(trainFromCsv(csv, { domain: 'my-shop', seed: 3 }).pattern.patternId, t.pattern.patternId);   // deterministic
});

test('choosing the column to predict, and refusing what cannot be learned honestly', () => {
  const t = trainFromCsv(csv, { target: 'purchased', domain: 'x' });                // case-insensitive
  assert.equal(t.target, 'Purchased');
  assert.match(trainFromCsv(csv, { domain: 'Bad Name' }).why, /lower-case name/);
  assert.match(trainFromCsv('', {}).why, /empty file/);
  assert.match(trainFromCsv('   \n ', {}).why, /empty file/);
  assert.match(trainFromCsv(42, {}).why, /empty file/);
  const tiny = csv.split('\n').slice(0, MIN_ROWS).join('\n');                       // header + MIN_ROWS-1 rows
  assert.match(trainFromCsv(tiny, {}).why, new RegExp('at least ' + MIN_ROWS + ' rows'));
  const three = 'a,b,outcome\n' + Array.from({ length: 300 }, (_, i) => `${i},${i % 7},${['x', 'y', 'z'][i % 3]}`).join('\n');
  assert.match(trainFromCsv(three, { target: 'outcome' }).why, /exactly two values/);
  const noSignal = 'id,const,flag\n' + Array.from({ length: 300 }, (_, i) => `id${i},5,${i % 2 ? 'yes' : 'no'}`).join('\n');
  assert.match(trainFromCsv(noSignal, {}).why, /nothing to learn/);
  // exactly MIN_ROWS rows is enough rows (it may still fail to verify, but not for want of rows)
  assert.doesNotMatch(String(trainFromCsv(csv.split('\n').slice(0, MIN_ROWS + 1).join('\n'), {}).why), /at least/);
  // a column that varies but does not move with the outcome at all (r exactly 0) is not a feature
  const flat = 'v,flag\n' + Array.from({ length: 300 }, (_, i) => `${[7, 3, 3, 7][i % 4]},${['no', 'no', 'yes', 'yes'][i % 4]}`).join('\n');
  assert.equal(relevance([7, 3, 3, 7], [0, 0, 1, 1]), 0);
  assert.match(trainFromCsv(flat, {}).why, /nothing to learn/);
  // the column you name is the one predicted, whichever the reader would have picked on its own
  const two = 'n,first,second\n' + Array.from({ length: 300 }, (_, i) => `${i % 10},${i % 10 > 4 ? 'yes' : 'no'},${i % 10 < 3 ? 'yes' : 'no'}`).join('\n');
  assert.equal(trainFromCsv(two, { target: 'first' }).target, 'first');
  assert.equal(trainFromCsv(two, { target: 'second' }).target, 'second');
  // equally related columns keep the file's order
  const twins = 'zeta,alpha,flag\n' + Array.from({ length: 300 }, (_, i) => `${i % 10},${i % 10},${i % 10 > 4 ? 'yes' : 'no'}`).join('\n');
  assert.deepEqual(trainFromCsv(twins, {}).features.map((f) => f.from), ['zeta', 'alpha']);
  const coin = 'a,b,flag\n' + Array.from({ length: 400 }, (_, i) => `${(i * 7919) % 101},${(i * 104729) % 37},${(i * 31337) % 2 ? 'yes' : 'no'}`).join('\n');
  const c = trainFromCsv(coin, {});
  assert.equal(c.verified, false);                                                  // grows, fails held-out, CUT
  assert.match(c.why, /CUT/);
});

test('safeNames: names that can travel inside a spine record, unique', () => {
  assert.deepEqual(safeNames(['Page Values', 'page-values', '1st', '', 'a|b;c:d', 'x'.repeat(40), 'x'.repeat(40)]),
    ['Page_Values', 'page_values', 'f2_1st', 'f3', 'a_b_c_d', 'x'.repeat(28), 'x'.repeat(26) + '_2']);
  assert.deepEqual(safeNames(['dup', 'dup', 'dup']), ['dup', 'dup_2', 'dup_3']);
  assert.deepEqual(safeNames(['__a__']), ['a']);
  assert.deepEqual(safeNames(null), []);
  for (const n of safeNames(['Contract = Month-to-month', 'MonthlyCharges', '%'])) assert.match(n, /^[A-Za-z][A-Za-z0-9_]{0,31}$/);
});

test('relevance: |Pearson r| with the label; zero for a constant column or mismatched lengths', () => {
  assert.equal(relevance([1, 2, 3, 4], [0, 0, 1, 1]), Math.abs(relevance([4, 3, 2, 1], [0, 0, 1, 1])));
  assert.ok(Math.abs(relevance([1, 2, 3, 4], [0, 0, 1, 1]) - 0.894427191) < 1e-9);
  assert.equal(relevance([5, 5, 5], [0, 1, 0]), 0);
  assert.equal(relevance([1, 2, 3], [1, 1, 1]), 0);
  assert.equal(relevance([1, 2], [0]), 0);
  assert.equal(relevance([], []), 0);
});

test('sampleCsv: the real sales sample as a CSV a visitor can train on', () => {
  const lines = csv.split('\n');
  assert.equal(lines.length, 1183);
  assert.equal(lines[0], [...shop.features, 'Purchased'].join(','));
  assert.equal(lines[1].split(',').length, shop.features.length + 1);
  assert.equal(sampleCsv(null), '');
});

test('never throws on junk', () => {
  for (const j of [undefined, null, 0, NaN, '', 'x', [], {}, [null], { get target() { throw new Error('x'); } }, 1n, () => 1, Symbol('s')]) {
    assert.doesNotThrow(() => trainFromCsv(j, j));
    assert.doesNotThrow(() => trainFromCsv(csv, j));
    assert.doesNotThrow(() => safeNames(j));
    assert.doesNotThrow(() => sampleCsv(j));
  }
  assert.equal(trainFromCsv(csv, { get target() { throw new Error('x'); } }).ok, false);
});
