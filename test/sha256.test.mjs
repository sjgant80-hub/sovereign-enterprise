import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, sha256Bytes } from '../src/sha256.mjs';

test('NIST FIPS 180-4 vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
});

test('one million "a" (multi-block, padding across blocks)', () => {
  assert.equal(sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('bytes and string agree; output is 32 bytes', () => {
  const b = sha256Bytes(new TextEncoder().encode('abc'));
  assert.equal(b.length, 32);
  assert.equal(Buffer.from(b).toString('hex'), sha256('abc'));
});

test('padding boundaries (55, 56, 63, 64 bytes) match node:crypto', async () => {
  const { createHash } = await import('node:crypto');
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
    const s = 'x'.repeat(n);
    assert.equal(sha256(s), createHash('sha256').update(s).digest('hex'), 'len ' + n);
  }
});
