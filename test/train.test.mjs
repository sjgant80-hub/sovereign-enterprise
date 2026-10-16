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
  // the base rate on the graded rows, counted from the file itself: 3 rows in every 10 are held out
  const [head, ...lines] = csv.trim().split('\n'); const col = head.split(',').indexOf('Purchased');
  const held = lines.filter((_, i) => i % 10 < 3);
  assert.deepEqual(t.heldBase, { n: 356, yes: held.filter((l) => l.split(',')[col] === 'yes').length });
  assert.equal(held.length, 356);
  assert.ok(t.heldBase.yes > 0 && t.heldBase.yes < 356);
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

test('a dated file is graded on what came after: grown on its older rows, graded on its newest — undated, 3 rows in 10', async () => {
  const { datedOrder } = await import('../src/train.mjs');
  const { prepare } = await import('../vendor/csv-forge/csv.mjs');
  const { toDataset } = await import('../src/grow.mjs');
  const lines = csv.trim().split('\n'), head = lines[0], body = lines.slice(1);
  const day = (i) => new Date(Date.UTC(2025, 0, 1) + ((i * 7919) % 365) * 86400000).toISOString().slice(0, 10);
  const dated = (name, f = day) => [name + ',' + head, ...body.map((l, i) => f(i) + ',' + l)].join('\n');
  const text = dated('Visit date');
  const o = datedOrder(text, prepare(text, {}));
  assert.equal(o.split, 'time');
  assert.equal(o.column, 'Visit date');
  assert.deepEqual([...o.order].sort((a, b) => a - b), body.map((_, i) => i), 'every case once');
  assert.deepEqual(o.days, body.map((_, i) => day(i)).sort(), 'oldest first');
  for (let k = 1; k < o.order.length; k++) if (o.days[k] === o.days[k - 1]) assert.ok(o.order[k] > o.order[k - 1], 'the same day keeps the file’s order');
  const t = trainFromCsv(text, { domain: 'my-shop', seed: 3 });
  assert.equal(t.ok, true);
  assert.equal(t.split, 'time');
  assert.equal(t.heldBase.n, 355);
  assert.deepEqual(t.graded, { column: 'Visit date', from: o.days[1182 - 355], to: o.days[1181] });
  assert.ok(!t.features.some((f) => f.from === 'Visit date'), 'a date is never a feature');
  // the time split holds out exactly the newest rows of what it is given
  const rows = Array.from({ length: 200 }, (_, i) => ({ a: i % 7, y: i % 2 }));
  const ds = toDataset('x', rows, ['a'], 'time');
  assert.deepEqual([ds.split, ds.heldRows[0], ds.heldRows.length, ds.trainRows[ds.trainRows.length - 1]], ['time', 140, 60, 139]);
  assert.equal(toDataset('x', rows, ['a']).split, 'mixed');
  assert.equal(toDataset('x', rows, ['a'], 'nope').split, 'mixed');
  // a date column with any case undated, or no date column at all: the file's own order, 3 in 10
  const gap = dated('Visit date', (i) => (i === 500 ? '' : day(i)));
  assert.equal(datedOrder(gap, prepare(gap, {})).split, 'mixed');
  assert.equal(trainFromCsv(csv, { domain: 'my-shop', seed: 3 }).split, 'mixed');
  assert.equal(trainFromCsv(csv, { domain: 'my-shop', seed: 3 }).graded, null);
  // a column named for a date is tried first; any column of days serves when none is named
  const two = [['Created', 'Visit date', head].join(','), ...body.map((l, i) => [day(i + 3), day(i), l].join(','))].join('\n');
  assert.equal(datedOrder(two, prepare(two, {})).column, 'Visit date');
  const unnamed = dated('Joined');
  assert.equal(datedOrder(unnamed, prepare(unnamed, {})).column, 'Joined');
  for (const junk of [null, undefined, {}, { cases: 7 }]) assert.equal(datedOrder(text, junk).split, 'mixed');
  assert.deepEqual(datedOrder('', prepare('', {})), { order: [], split: 'mixed', column: '', days: [] });
});
