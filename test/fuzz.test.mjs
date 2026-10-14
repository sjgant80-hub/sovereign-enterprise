import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, validOp } from '../src/gate.mjs';
import { materialize, dedupe, rows, sequence, text, liveTags, lwwBeats, collections, emptyState } from '../src/crdt.mjs';
import { prng } from '../src/sim.mjs';

// The kernels are total: hostile input is refused or ignored, never a throw.
const toxic = { get k() { throw new Error('boom'); }, get op() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, -1, NaN, '', 'x', [], {}, [null], toxic, { k: 'put' }, { env: toxic, hash: 'h' },
  { env: { op: toxic }, hash: 'h' }, new Uint8Array(0), 1n, () => 1, Symbol('s')];

test('validOp never throws, and refuses every piece of junk', () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => validOp(j));
    assert.equal(validOp(j), false);
  }
});

test('inspect never throws on junk or random bytes', () => {
  for (const j of JUNK) assert.doesNotThrow(() => inspect(j));
  const rnd = prng(11);
  for (let i = 0; i < 2000; i++) {
    const b = new Uint8Array(1 + Math.floor(rnd() * 300)).map(() => Math.floor(rnd() * 256));
    if (i % 2) b[0] = 123;
    const r = inspect(b);
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('materialize, dedupe and the views never throw', () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => materialize(j, 'g'));
    assert.doesNotThrow(() => materialize([j], 'g'));
    assert.doesNotThrow(() => dedupe([j]));
  }
  const s = emptyState();
  assert.doesNotThrow(() => rows(s, 'x'));
  assert.doesNotThrow(() => sequence(s, 'x', 'y'));
  assert.doesNotThrow(() => text(s, 'x', 'y'));
  assert.doesNotThrow(() => liveTags(s, 'x', 'y'));
  assert.doesNotThrow(() => collections(s));
  assert.doesNotThrow(() => lwwBeats([1, 'a', 'x'], [1, 'a', 'x']));
});
