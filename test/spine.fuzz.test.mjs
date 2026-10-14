import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admit, proveFork, proveLink, GENESIS_PREV } from '../src/gate.mjs';
import { materialize, dedupe, authority } from '../src/crdt.mjs';
import { signEnvelope } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';

// The spine's kernels are total: hostile input is refused or ignored, never a throw — including the per-writer
// hash-chain resolution (dedupe), the key cut (authority) and the fork / link proofs (gate).
const toxic = { get k() { throw new Error('boom'); }, get op() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, -1, NaN, '', 'x', [], {}, [null], toxic, { k: 'put' }, { env: toxic, hash: 'h' },
  { env: { op: toxic }, hash: 'h' }, new Uint8Array(0), 1n, () => 1, Symbol('s')];

test('the async doors of the gate — admit, proveFork, proveLink — never throw and admit nothing on junk', async () => {
  const held = new Set();
  for (const j of JUNK) {
    for (const k of [...JUNK, held]) {
      assert.equal((await admit(j, k)).ok, false);
      assert.equal((await proveFork(j, k)).ok, false);
      assert.equal((await proveLink(j, k)).ok, false);
    }
  }
  // a REAL envelope against a junk replay store: refused or admitted, never a throw
  const key = await fromSeed(sha256Bytes('fuzz/admit'));
  const bytes = await signEnvelope(key, { k: 'put', c: 'tasks', id: 't', f: { title: 'x' }, l: 1 }, 1, GENESIS_PREV);
  for (const j of JUNK) assert.equal(typeof (await admit(bytes, j)).ok, 'boolean');
  assert.equal((await admit(bytes, { has: () => { throw new Error('boom'); } })).reason, 'gate-fault');
  assert.equal((await proveFork(bytes, toxic)).ok, false);
  assert.equal((await proveLink(bytes, toxic)).ok, false);
});

test('dedupe, materialize and authority never throw — on junk, junk pairs, and junk that collides on one slot', () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => dedupe(j));
    for (const k of JUNK) {
      assert.doesNotThrow(() => dedupe([j, k]));
      assert.doesNotThrow(() => materialize([j, k], k));
      const au = authority(j, 'g', k);
      assert.equal(typeof au.can, 'function');
      assert.doesNotThrow(() => au.can('g', 'tasks', 1, 1));
      assert.doesNotThrow(() => authority([j, k], j, k).isAdmin(j, 1, 1));
    }
  }
  // junk that collides on one slot — the chain resolution is reached, and must still never throw
  const toxicEnv = { get from() { throw new Error('boom'); }, op: {} };
  const slotJunk = [{ hash: 'a', env: { op: {}, seq: 1 } }, { hash: 'b', env: { op: {}, seq: 1 } }, { hash: 'c', env: { op: toxic, seq: 2, prev: 'a' } },
    { hash: 'd', env: toxicEnv }, { hash: 'e', env: { op: 1, from: 1n, seq: Symbol('s') } }, { hash: 'f', env: { op: {}, seq: 2, prev: toxic } }];
  for (let i = 0; i < slotJunk.length; i++) for (let k = 0; k < slotJunk.length; k++) {
    assert.doesNotThrow(() => dedupe([slotJunk[i], slotJunk[k], ...slotJunk]));
    assert.doesNotThrow(() => materialize([slotJunk[k], slotJunk[i]], 'g'));
  }
});
