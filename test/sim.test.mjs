import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, prng } from '../src/sim.mjs';
import { canonical } from '../src/canon.mjs';

test('a small hostile network converges, and the receipt is byte-reproducible', async () => {
  const cfg = { seed: 3, nodes: 6, rounds: 12, partitionFrom: 3, partitionTo: 8 };
  const a = await simulate(cfg);
  const b = await simulate(cfg);
  assert.equal(a.converged, true);
  assert.equal(canonical(a), canonical(b));
  assert.ok(a.attacks > 0);
  assert.ok(a.partitionRounds === 5);
  for (const [k, n] of Object.entries(a.attackOutcomes)) {
    // the only attacks that may be admitted are the validly-signed ones the materialiser neutralises
    if (k.endsWith(':admitted')) assert.ok(k.startsWith('equivocation') || k.startsWith('unauthorised-write'), k + ' x' + n);
  }
});

test('prng is deterministic and in [0,1)', () => {
  const r1 = prng(9), r2 = prng(9);
  for (let i = 0; i < 100; i++) { const x = r1(); assert.equal(x, r2()); assert.ok(x >= 0 && x < 1); }
});
