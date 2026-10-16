import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { growPattern, toDataset, MIN_ROWS, GROW } from '../src/grow.mjs';
import { validPattern, verifyOn, adopt, answer, GATE_AUC } from '../src/brain.mjs';
import { sample, shopperRows } from '../src/streams.mjs';

const FRAUD = ['amount', 'hourOfDay', 'distanceKm', 'recentTx', 'merchantRisk', 'cardNotPresent'];

test('a node grows a verified fraud pattern from its own sample, and it holds on data it never saw', () => {
  const mine = sample('fraud', 101, 700).rows;
  const g = growPattern('fraud', mine, FRAUD, { seed: 101, grownBy: 'audit' });
  assert.equal(g.ok, true);
  assert.equal(g.verified, true);
  assert.match(g.why, /passed held-out/);
  assert.equal(validPattern(g.pattern), true);
  assert.equal(g.pattern.held, 210);                 // 3 in 10 held out
  assert.equal(g.pattern.train, 490);
  assert.equal(g.pattern.grownBy, 'audit');
  // the base rate on those same held-out rows, counted here independently: 3 rows in every 10, how many were fraud
  const yes = mine.filter((r, i) => i % 10 < 3 && r.y === 1).length;
  assert.deepEqual(g.heldBase, { n: 210, yes });
  assert.ok(yes > 0 && yes < 210);
  assert.equal(g.pattern.heldBase, undefined, 'not inside the pattern: brain files are unchanged');
  assert.ok(g.pattern.heldAuc >= GATE_AUC);
  assert.match(g.pattern.patternId, /^[0-9a-f]{16}$/);
  const fresh = sample('fraud', 999, 600).rows;      // another device's data
  assert.ok(verifyOn(g.pattern, fresh).auc > 0.65);
  assert.equal(adopt(g.pattern, fresh).adopt, true);
  assert.equal(answer({ fraud: g.pattern }, fresh[0]).verdict, 'VERIFIED');
});

test('the operating point: threshold and spread recomputed independently from the train rows', () => {
  const rows = sample('fraud', 101, 700).rows;
  const p = growPattern('fraud', rows, FRAUD, { seed: 101 }).pattern;
  const train = rows.filter((_, i) => i % 10 >= 3);
  const ts = train.map((r) => p.rules.reduce((s, x) => s + ((x.op === '>' ? r[x.feat] > x.v : r[x.feat] <= x.v) ? x.w : 0), 0)).sort((a, b) => a - b);
  const base = train.filter((r) => r.y === 1).length / train.length;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  assert.equal(p.base, r6(base));
  assert.equal(p.threshold, r6(ts[Math.floor((1 - base) * ts.length)]));
  assert.equal(p.spread, r6(ts[ts.length - 1] - ts[0]));
  assert.ok(p.spread > 0);
});

test('growth is deterministic, and two nodes on two samples grow independent patterns', () => {
  const a = growPattern('fraud', sample('fraud', 7, 600).rows, FRAUD, { seed: 7 });
  const b = growPattern('fraud', sample('fraud', 7, 600).rows, FRAUD, { seed: 7 });
  const c = growPattern('fraud', sample('fraud', 8, 600).rows, FRAUD, { seed: 8 });
  assert.deepEqual(a.pattern, b.pattern);
  assert.notEqual(a.pattern.patternId, c.pattern.patternId);
});

test('grows on the real UCI sessions too', () => {
  const j = JSON.parse(readFileSync(new URL('../brains/shopper.sample.json', import.meta.url)));
  const g = growPattern('shopper', shopperRows(j), j.features, { seed: 3 });
  assert.equal(g.ok, true);
  assert.ok(g.pattern.heldAuc > 0.7);
});

test('no signal → grows but is CUT; one class or too few rows → refused', () => {
  const noise = Array.from({ length: 400 }, (_, i) => ({ a: (i * 7919) % 101, b: (i * 104729) % 37, y: (i * 31337) % 2 }));
  const g = growPattern('noise', noise, ['a', 'b'], { seed: 5 });
  assert.equal(g.ok, true);
  assert.equal(g.verified, false);
  assert.match(g.why, /CUT/);
  const one = noise.map((r) => ({ ...r, y: 1 }));
  assert.match(growPattern('noise', one, ['a', 'b']).why, /one class/);
  const zero = noise.map((r) => ({ ...r, y: 0 }));
  assert.match(growPattern('noise', zero, ['a', 'b']).why, /one class/);
  assert.equal(growPattern('noise', noise.slice(0, MIN_ROWS - 1), ['a', 'b']).ok, false);
  assert.equal(growPattern('noise', noise.slice(0, MIN_ROWS), ['a', 'b']).ok, true);
  assert.equal(GROW.elites < GROW.population, true);
});

test('toDataset: refuses bad names, features and rows; drops dirty rows', () => {
  const rows = sample('churn', 1, 200).rows;
  const f = ['tenureMonths', 'monthlySpend'];
  const ds = toDataset('churn', rows, f);
  assert.equal(ds.n, 200);
  assert.equal(ds.heldRows.length, 60);
  assert.equal(ds.trainRows.length, 140);
  assert.equal(toDataset('Bad Name', rows, f), null);
  assert.equal(toDataset(5, rows, f), null);
  assert.equal(toDataset('churn', rows, []), null);
  assert.equal(toDataset('churn', rows, new Array(17).fill('tenureMonths')), null);
  assert.ok(toDataset('churn', rows, new Array(16).fill('tenureMonths')));
  assert.equal(toDataset('churn', rows, ['tenureMonths']).features.length, 1);
  assert.equal(toDataset('churn', rows, ['y']), null);
  assert.equal(toDataset('churn', rows, [3]), null);
  assert.equal(toDataset('churn', null, f), null);
  const dirty = [...rows, { tenureMonths: NaN, monthlySpend: 1, y: 1 }, { tenureMonths: 1, monthlySpend: 1, y: 2 }, null, 'x'];
  assert.equal(toDataset('churn', dirty, f).n, 200);
  assert.equal(growPattern('churn', rows, f, { seed: 0 }).ok, true);      // seed 0 is lifted to 1, not refused
});

test('growPattern never throws on junk', () => {
  const toxic = { get y() { throw new Error('boom'); } };
  for (const j of [undefined, null, 0, '', [], {}, [toxic], toxic, [null]]) {
    assert.doesNotThrow(() => growPattern(j, j, j));
    assert.equal(growPattern('fraud', j, FRAUD).ok, false);
  }
  assert.equal(growPattern('fraud', [toxic], FRAUD).ok, false);
});

test('the split: mixed holds out 3 rows in every 10 through the rows; time holds out the newest 3 in 10 of rows given oldest first', () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ a: i % 5, y: i % 2 }));
  const mixed = toDataset('x', rows, ['a']), time = toDataset('x', rows, ['a'], 'time');
  assert.deepEqual([mixed.split, mixed.heldRows.length, mixed.heldRows.slice(0, 4)], ['mixed', 45, [0, 1, 2, 10]]);
  assert.deepEqual([time.split, time.heldRows.length, time.heldRows[0], time.heldRows[44], time.trainRows.length, time.trainRows[104]], ['time', 45, 105, 149, 105, 104]);
  for (const s of [undefined, 'mixed', 'TIME', 7, null]) assert.equal(toDataset('x', rows, ['a'], s).split, 'mixed', String(s));
  // growing on a time split says so, and grades on the newest rows
  const fraud = sample('fraud', 101, 700).rows;
  const g = growPattern('fraud', fraud, FRAUD, { seed: 101, split: 'time' });
  assert.equal(g.split, 'time');
  assert.deepEqual([g.pattern.held, g.pattern.train], [210, 490]);
  assert.equal(growPattern('fraud', fraud, FRAUD, { seed: 101 }).split, 'mixed');
  assert.deepEqual(g.heldBase, { n: 210, yes: fraud.slice(490).filter((r) => r.y === 1).length }, 'the base rate of the newest rows');
});
