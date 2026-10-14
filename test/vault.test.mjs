import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leafHash, nodeHash, split, root, inclusionProof, verifyInclusion, consistencyProof, verifyConsistency, audit, prefixRoots } from '../src/vault.mjs';

// RFC 6962 reference leaves (the certificate-transparency test vectors)
const hex = (s) => Uint8Array.from(s.match(/../g) || [], (b) => parseInt(b, 16));
const DATA = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(hex);
const ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];
const leaves8 = DATA.map(leafHash);

test('RFC 6962 reference roots for sizes 1..8', () => {
  for (let n = 1; n <= 8; n++) assert.equal(root(leaves8.slice(0, n)), ROOTS[n - 1], 'size ' + n);
  assert.equal(root([]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('split: largest power of two strictly below n', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 17].map(split), [1, 2, 2, 4, 4, 8, 16]);
});

test('leaf and node hashes are domain-separated', async () => {
  const { sha256 } = await import('../src/sha256.mjs');
  assert.notEqual(leafHash('abc'), sha256('abc'));                       // 0x00 prefix
  const a = leaves8[2], b = leaves8[3];
  assert.notEqual(nodeHash(a, b), leafHash(hex(a + b)));                  // 0x01 vs 0x00 — no second-preimage splice
  assert.equal(nodeHash(leaves8[0], leaves8[1]), ROOTS[1]);
  assert.equal(leafHash('abc'), leafHash(new TextEncoder().encode('abc')));
});

const many = Array.from({ length: 24 }, (_, i) => leafHash('entry-' + i));

test('every inclusion proof, every size 1..24, verifies — and fails when anything is wrong', () => {
  for (let n = 1; n <= 24; n++) {
    const L = many.slice(0, n), R = root(L);
    for (let m = 0; m < n; m++) {
      const p = inclusionProof(m, L);
      assert.equal(verifyInclusion(L[m], m, n, p, R), true, `m=${m} n=${n}`);
      if (n > 1) assert.equal(verifyInclusion(L[(m + 1) % n], m, n, p, R), false);   // wrong leaf
      assert.equal(verifyInclusion(L[m], m, n, p, leafHash('wrong-root')), false);      // wrong root
      if (p.length) {
        const bad = p.slice(); bad[0] = leafHash('tampered');
        assert.equal(verifyInclusion(L[m], m, n, bad, R), false);
        assert.equal(verifyInclusion(L[m], m, n, p.slice(1), R), false);      // short proof
      }
      assert.equal(verifyInclusion(L[m], m, n, [...p, leafHash('extra')], R), false); // long proof
    }
  }
});

test('inclusion: index/size bounds and junk', () => {
  const L = many.slice(0, 5), R = root(L);
  assert.equal(inclusionProof(5, L), null);
  assert.equal(inclusionProof(-1, L), null);
  assert.equal(inclusionProof(1.5, L), null);
  assert.equal(verifyInclusion(L[0], 5, 5, [], R), false);
  assert.equal(verifyInclusion(L[0], -1, 5, [], R), false);
  assert.equal(verifyInclusion(L[0], 0, 5, 'nope', R), false);
  assert.equal(verifyInclusion('zz', 0, 5, [], R), false);
  assert.equal(verifyInclusion(L[0], 0, 5, [5], R), false);
  assert.equal(verifyInclusion(L[0], 0, 1, [], L[0]), true);
  assert.equal(verifyInclusion(L[0], 0, 1, [], 'q'), false);
});

test('every consistency proof, all (m, n) up to 24, verifies — and a rewritten history fails', () => {
  for (let n = 1; n <= 24; n++) {
    const L = many.slice(0, n), Rn = root(L);
    for (let m = 0; m <= n; m++) {
      const Rm = root(L.slice(0, m));
      const p = consistencyProof(m, L);
      assert.equal(verifyConsistency(m, n, Rm, Rn, p), true, `m=${m} n=${n}`);
      if (m > 0 && m < n) {
        const forked = L.slice(); forked[m - 1] = leafHash('rewritten');
        assert.equal(verifyConsistency(m, n, Rm, root(forked), p), false, 'rewrite m=' + m + ' n=' + n);
        const bad = p.slice(); bad[bad.length - 1] = leafHash('x');
        assert.equal(verifyConsistency(m, n, Rm, Rn, bad), false);
      }
    }
  }
});

test('consistency: edge cases', () => {
  const L = many.slice(0, 6);
  assert.deepEqual(consistencyProof(0, L), []);
  assert.deepEqual(consistencyProof(6, L), []);
  assert.equal(consistencyProof(7, L), null);
  assert.equal(consistencyProof(-1, L), null);
  assert.equal(verifyConsistency(0, 6, root([]), root(L), []), true);
  assert.equal(verifyConsistency(0, 6, root([]), root(L), [L[0]]), false);
  assert.equal(verifyConsistency(6, 6, root(L), root(L), []), true);
  assert.equal(verifyConsistency(6, 6, root(L), root(many.slice(0, 7)), []), false);
  assert.equal(verifyConsistency(3, 6, root(L.slice(0, 3)), root(L), []), false);
  assert.equal(verifyConsistency(7, 6, root(L), root(L), []), false);
  assert.equal(verifyConsistency(3, 6, 'zz', root(L), consistencyProof(3, L)), false);
  assert.equal(verifyConsistency(3, 6, root(L.slice(0, 3)), root(L), [7]), false);
  assert.equal(verifyConsistency(3, 6, root(L.slice(0, 3)), root(L), 'x'), false);
});

test('audit: rebuild the log, check every tree head, catch gaps, duplicates and forged heads', () => {
  const recs = many.slice(0, 5).map((leaf, index) => ({ index, leaf }));
  const heads = [{ size: 3, root: root(many.slice(0, 3)) }, { size: 5, root: root(many.slice(0, 5)) }];
  const a = audit(recs, heads);
  assert.equal(a.ok, true);
  assert.equal(a.size, 5);
  assert.equal(a.root, root(many.slice(0, 5)));
  const forged = audit(recs, [...heads, { size: 4, root: leafHash('lie') }]);
  assert.equal(forged.ok, false);
  assert.equal(forged.bad.length, 1);
  assert.equal(audit(recs, [{ size: 9, root: a.root }]).ok, false);
  const gap = audit([...recs, { index: 7, leaf: many[7] }], heads);
  assert.equal(gap.ok, false);
  assert.equal(gap.gaps, 1);
  const dup = audit([...recs, { index: 2, leaf: many[9] }], heads);
  assert.equal(dup.ok, false);
  assert.equal(dup.dupes, 1);
  assert.equal(audit([null, { index: -1, leaf: many[0] }, { index: 0, leaf: 'zz' }], []).size, 0);
  assert.equal(audit('x', 'y').ok, true);
});

test('prefixRoots: every prefix root in one pass equals the RFC 9162 tree hash of that prefix', () => {
  const leaves = Array.from({ length: 70 }, (_, i) => leafHash('entry ' + i));
  const roots = prefixRoots(leaves);
  assert.equal(roots.length, 71);
  for (let k = 0; k <= 70; k++) assert.equal(roots[k], root(leaves.slice(0, k)), 'prefix ' + k);
  assert.deepEqual(prefixRoots([]), [root([])]);
  const heads = [5, 8, 33, 64, 70].map((k) => ({ size: k, root: roots[k] }));
  assert.equal(audit(leaves.map((leaf, index) => ({ index, leaf })), heads).ok, true);
  assert.equal(audit(leaves.map((leaf, index) => ({ index, leaf })), [{ size: 71, root: roots[70] }]).ok, false);   // a head past the end
  assert.equal(audit(leaves.map((leaf, index) => ({ index, leaf })), [{ size: 71 }]).ok, false);                  // past the end with NO root: undefined must never match undefined
  assert.equal(audit(leaves.map((leaf, index) => ({ index, leaf })), [{ size: 70 }]).ok, false);
  assert.equal(audit(leaves.map((leaf, index) => ({ index, leaf })), [{ size: 70, root: roots[70] }]).root, roots[70]);
});
