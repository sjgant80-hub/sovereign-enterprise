import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLease, renew, newKey, seal, open, keyRing } from '../src/lease.mjs';

const L = { issuedAt: 1000, ttl: 800 };   // until 1800, default renew window 200

test('decideLease: keep, renew in the window, lock when expired without a live grant', () => {
  assert.deepEqual(decideLease(L, 1000, true), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1599, true), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1600, true), { state: 'active', action: 'renew', until: 1800 });
  assert.deepEqual(decideLease(L, 1600, false), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1799, false), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1800, false), { state: 'expired', action: 'lock', until: 1800 });
  assert.deepEqual(decideLease(L, 1800, true), { state: 'expired', action: 'renew', until: 1800 });
  assert.deepEqual(decideLease(L, 5000, 'yes'), { state: 'expired', action: 'lock', until: 1800 });
  assert.deepEqual(decideLease(L, 1700, true, 50), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1750, true, 50), { state: 'active', action: 'renew', until: 1800 });
  assert.deepEqual(decideLease(L, 1000, true, 0), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1799, true, 0), { state: 'active', action: 'keep', until: 1800 });
  assert.deepEqual(decideLease(L, 1300, true, -5), { state: 'active', action: 'keep', until: 1800 });
});

test('a junk renew window falls back to ttl/4 (so an in-window lease still renews)', () => {
  assert.deepEqual(decideLease(L, 1700, true, -5), { state: 'active', action: 'renew', until: 1800 });
  assert.deepEqual(decideLease(L, 1700, true, 1.5), { state: 'active', action: 'renew', until: 1800 });
});

test('keyRing.has is false for a subject it has never seen', () => {
  assert.equal(keyRing().has('never-seen'), false);
});

test('decideLease fails closed on junk', () => {
  const lock = { state: 'expired', action: 'lock', until: 0 };
  for (const bad of [null, {}, { issuedAt: 1, ttl: 0 }, { issuedAt: 1, ttl: -1 }, { issuedAt: 1.5, ttl: 9 }, { issuedAt: 1, ttl: 1.5 }]) {
    assert.deepEqual(decideLease(bad, 2, true), lock);
  }
  assert.deepEqual(decideLease(L, 1.5, true), lock);
  assert.deepEqual(decideLease({ get issuedAt() { throw new Error('x'); } }, 1, true), lock);
});

test('renew: only with a live grant, from now, same ttl', () => {
  assert.deepEqual(renew(L, 1700, true), { issuedAt: 1700, ttl: 800 });
  assert.equal(renew(L, 1700, false), null);
  assert.equal(renew(L, 1700, 1), null);
  assert.equal(renew(null, 1700, true), null);
  assert.equal(renew({ ttl: 0 }, 1700, true), null);
  assert.equal(renew(L, 1.2, true), null);
});

test('seal/open: round trip; wrong key, wrong aad, tampering → null', async () => {
  const k = await newKey();
  assert.match(k, /^[0-9a-f]{64}$/);
  const box = await seal(k, 'NI number QQ123456C', 'people/p1');
  assert.equal(await open(k, box, 'people/p1'), 'NI number QQ123456C');
  assert.equal(await open(k, box, 'people/p2'), null);
  assert.equal(await open(await newKey(), box, 'people/p1'), null);
  const [iv, ct] = box.split('.');
  const flipped = iv + '.' + (ct[0] === 'a' ? 'b' : 'a') + ct.slice(1);
  assert.equal(await open(k, flipped, 'people/p1'), null);
  assert.equal(await open(null, box), null);
  assert.equal(await open(k, 'garbage'), null);
  assert.notEqual(await seal(k, 'same', 'a'), await seal(k, 'same', 'a'));   // fresh IV every time
});

test('keyRing.shred: erasure = the key is gone, every copy goes dark', async () => {
  const ring = keyRing();
  const k = await ring.keyFor('p1');
  const box = await seal(k, 'home address', 'people/p1');
  assert.equal(ring.has('p1'), true);
  assert.equal(await ring.keyFor('p1'), k);
  ring.shred('p1');
  assert.equal(ring.has('p1'), false);
  assert.equal(await ring.keyFor('p1'), null);
  assert.deepEqual(ring.shredded(), ['p1']);
  assert.equal(ring.export().p1, undefined);
  assert.equal(await open(await ring.keyFor('p1'), box, 'people/p1'), null);
  const r2 = keyRing({ p9: k });
  assert.equal(r2.has('p9'), true);
});
