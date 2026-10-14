import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leafHash, nodeHash, root, inclusionProof, consistencyProof, verifyInclusion, verifyConsistency, audit } from '../src/vault.mjs';

// Each guard, alone, against an input the RFC loop would otherwise ACCEPT — so a slack guard is observable.
const L0 = leafHash('a'), L1 = leafHash('b');
const H62 = 'ab'.repeat(31);                       // valid hex for the hasher, but not a 64-hex digest
const EMPTY = root([]);
const toxicArray = (len) => { const a = new Array(len).fill(L1); Object.defineProperty(a, 0, { get() { throw new Error('boom'); } }); return a; };

test('inclusion: every guard refuses an input the loop alone would accept', () => {
  assert.equal(verifyInclusion(L0, 0, 1, [], L0), true);                       // the honest size-1 case
  assert.equal(verifyInclusion(L0, 1, 1, [], L0), false);                      // index == size
  assert.equal(verifyInclusion(L0, 0.5, 1, [], L0), false);                    // non-integer index
  assert.equal(verifyInclusion(L0, 0, 2.5, [L1], nodeHash(L0, L1)), false);    // non-integer size
  assert.equal(verifyInclusion(L0, -1, 1, [], L0), false);                     // negative index
  assert.equal(verifyInclusion(L0, 0, 1, '', L0), false);                      // proof not an array
  assert.equal(verifyInclusion(H62, 0, 2, [L1], nodeHash(H62, L1)), false);    // leaf not a digest
  assert.equal(verifyInclusion(L1, 1, 2, [H62], nodeHash(H62, L1)), false);    // sibling not a digest
  assert.equal(verifyInclusion(L0, 0, 2, toxicArray(1), nodeHash(L0, L1)), false); // a throwing proof → false, never true
});

test('consistency: every guard refuses an input the loop alone would accept', () => {
  const L = ['x', 'y', 'z', 'w', 'v'].map(leafHash);
  const R3 = root(L.slice(0, 3)), R5 = root(L);
  assert.equal(verifyConsistency(3, 3, R3, R3, []), true);
  assert.equal(verifyConsistency(1.5, 1.5, R3, R3, []), false);               // non-integer m
  assert.equal(verifyConsistency(3, 3.5, R3, R3, []), false);                 // non-integer n
  assert.equal(verifyConsistency(-1, -1, R3, R3, []), false);                 // negative m
  assert.equal(verifyConsistency(3, 3, R3, R3, ''), false);                   // proof not an array
  assert.equal(verifyConsistency(3, 3, 'zz', 'zz', []), false);               // first root not a digest
  assert.equal(verifyConsistency(0, 3, 'zz', R3, []), false);                 // first root not a digest (m = 0)
  assert.equal(verifyConsistency(0, 3, EMPTY, 'zz', []), false);              // second root not a digest
  assert.equal(verifyConsistency(4, 3, R3, R3, consistencyProof(3, L)), false); // m > n
  const p = consistencyProof(3, L);
  assert.equal(verifyConsistency(3, 5, R3, R5, p), true);
  assert.equal(verifyConsistency(3, 5, R3, R5, [...p, L[0]]), false);         // over-long proof
  assert.equal(verifyConsistency(3, 5, R3, R5, [...p.slice(0, -1), H62]), false); // a non-digest element
  assert.equal(verifyConsistency(3, 5, R3, R5, toxicArray(2)), false);         // a throwing proof → false
});

test('audit: each malformed record is skipped on its own; each malformed head is caught on its own', () => {
  const L = Array.from({ length: 5 }, (_, i) => leafHash('r' + i));
  const recs = L.map((leaf, index) => ({ index, leaf }));
  const heads = [{ size: 5, root: root(L) }];
  const base = audit(recs, heads);
  assert.equal(base.ok, true);
  for (const junk of [{ index: 1.5, leaf: L[0] }, { index: -1, leaf: L[0] }, { index: 5, leaf: 'zz' },
    { index: 5, leaf: { toString: () => 'a'.repeat(64) } }, null, { leaf: L[0] }]) {
    const a = audit([...recs, junk], heads);
    assert.equal(a.ok, true, JSON.stringify(junk));
    assert.equal(a.size, 5);
    assert.equal(a.gaps, 0);
  }
  assert.equal(audit(recs, [{ size: 0, root: EMPTY }]).ok, true);           // the empty prefix is a valid head
  assert.equal(audit(recs, [{ size: -5, root: EMPTY }]).ok, false);         // negative size
  assert.equal(audit(recs, [{ size: 2.5, root: root(L.slice(0, 2)) }]).ok, false);
  assert.equal(audit(recs, [null]).ok, false);
  assert.equal(audit(recs, [{ size: 5, root: root(L.slice(0, 4)) }]).ok, false);
  assert.equal(inclusionProof(0, [L0]).length, 0);
});
