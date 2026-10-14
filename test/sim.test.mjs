import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    if (k.endsWith(':admitted')) assert.ok(k.startsWith('equivocation') || k.startsWith('unauthorised-write') || k.startsWith('continued-fork'), k + ' x' + n);
  }
});

test('a stolen key re-signing slots the real device built on never wins one; a forged continued history burns the key', async () => {
  const a = await simulate({ seed: 3, nodes: 6, rounds: 12, partitionFrom: 3, partitionTo: 8 });
  assert.ok(a.attackOutcomes['equivocation:admitted'] > 0, 'the insider key was stolen and used');
  assert.ok(a.forks.chain > 0, 'some forks were of slots the real device had continued');
  assert.equal(a.forks.chainKeptReal, a.forks.chain, 'every one of them kept the REAL write');
  assert.equal(a.attackOutcomes['continued-fork:admitted'], 2);
  assert.equal(a.forks.burned, 1);
  assert.equal(a.burnedKeys, 1);
  assert.equal(a.equivocators, 2);                                     // the insider and the burned victim, flagged
  const off = await simulate({ seed: 3, nodes: 6, rounds: 12, partitionFrom: 3, partitionTo: 8, burnAt: -1 });
  assert.equal(off.burnedKeys, 0);
  assert.equal(off.attackOutcomes['continued-fork:admitted'], undefined);
  assert.equal(off.converged, true);
});

test('the committed receipt (16 devices, 30 rounds) shows the real write surviving every continued fork', () => {
  const r = JSON.parse(readFileSync(new URL('../receipts/sim.json', import.meta.url), 'utf8'));
  assert.equal(r.v, 2);
  assert.equal(r.converged, true);
  assert.ok(r.forks.chain > 0);
  assert.equal(r.forks.chainKeptReal, r.forks.chain);
  assert.equal(r.burnedKeys, 1);
});

test('prng is deterministic and in [0,1)', () => {
  const r1 = prng(9), r2 = prng(9);
  for (let i = 0; i < 100; i++) { const x = r1(); assert.equal(x, r2()); assert.ok(x >= 0 && x < 1); }
});
