import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validOp, inspect, admit, proveFork, proveLink, MAX_BYTES, L_MAX, GENESIS_PREV, VERSION } from '../src/gate.mjs';
import { canonical, utf8 } from '../src/canon.mjs';
import { fromSeed, sign } from '../src/keys.mjs';
import { sha256Bytes, sha256 } from '../src/sha256.mjs';

const H = 'a'.repeat(64);
const TAG = H + '.1';
const put = (o = {}) => ({ k: 'put', c: 'tasks', id: 't1', f: { title: 'x' }, l: 1, ...o });

test('put: valid shapes and every boundary', () => {
  assert.equal(validOp(put()), true);
  const f32 = {}; for (let i = 0; i < 32; i++) f32['f' + i] = i;
  assert.equal(validOp(put({ f: f32 })), true);
  const f33 = { ...f32, g: 1 };
  assert.equal(validOp(put({ f: f33 })), false);
  assert.equal(validOp(put({ f: {} })), false);
  assert.equal(validOp(put({ f: ['x'] })), false);
  assert.equal(validOp(put({ f: 'x' })), false);
  assert.equal(validOp(put({ f: null })), false);
  assert.equal(validOp(put({ f: { t: 'x'.repeat(2000) } })), true);
  assert.equal(validOp(put({ f: { t: 'x'.repeat(2001) } })), false);
  assert.equal(validOp(put({ f: { t: null, u: true, v: -5 } })), true);
  assert.equal(validOp(put({ f: { t: 1.5 } })), false);
  assert.equal(validOp(put({ f: { t: [1] } })), false);
  assert.equal(validOp(put({ f: { t: {} } })), false);
  assert.equal(validOp(put({ f: { id: 'x' } })), false);          // 'id' is reserved
  assert.equal(validOp(put({ f: { Title: 'x' } })), false);       // fields start lowercase
  assert.equal(validOp(put({ f: { __proto__x: 1 } })), false);
  assert.equal(validOp(put({ c: 'Tasks' })), false);
  assert.equal(validOp(put({ c: '_x' })), false);
  assert.equal(validOp(put({ c: 'a'.repeat(32) })), true);
  assert.equal(validOp(put({ c: 'a'.repeat(33) })), false);
  assert.equal(validOp(put({ id: '__proto__' })), false);
  assert.equal(validOp(put({ id: 'A'.repeat(64) })), true);
  assert.equal(validOp(put({ id: 'A'.repeat(65) })), false);
  assert.equal(validOp(put({ id: 'a b' })), false);
  assert.equal(validOp(put({ l: 0 })), false);
  assert.equal(validOp(put({ l: L_MAX })), true);
  assert.equal(validOp(put({ l: L_MAX + 1 })), false);
  assert.equal(validOp(put({ l: 1.5 })), false);
  assert.equal(validOp({ ...put(), extra: 1 }), false);
  const { f, ...noF } = put();
  assert.equal(validOp(noF), false);
});

test('del: tags must be 1..256 well-formed tags', () => {
  const del = (o = {}) => ({ k: 'del', c: 'tasks', id: 't1', tags: [TAG], l: 2, ...o });
  assert.equal(validOp(del()), true);
  assert.equal(validOp(del({ tags: [] })), false);
  assert.equal(validOp(del({ tags: new Array(256).fill(TAG) })), true);
  assert.equal(validOp(del({ tags: new Array(257).fill(TAG) })), false);
  assert.equal(validOp(del({ tags: [H + '.0'] })), false);
  assert.equal(validOp(del({ tags: ['x.1'] })), false);
  assert.equal(validOp(del({ tags: TAG })), false);
  assert.equal(validOp(del({ tags: [5] })), false);
});

test('grant / revoke', () => {
  const g = (o = {}) => ({ k: 'grant', id: 'g1', to: H, role: 'staff', cols: ['tasks'], l: 1, ...o });
  assert.equal(validOp(g()), true);
  assert.equal(validOp(g({ cols: ['*'] })), true);
  assert.equal(validOp(g({ cols: [] })), false);
  assert.equal(validOp(g({ cols: new Array(32).fill('a') })), true);
  assert.equal(validOp(g({ cols: new Array(33).fill('a') })), false);
  assert.equal(validOp(g({ cols: ['Bad'] })), false);
  assert.equal(validOp(g({ cols: 'tasks' })), false);
  assert.equal(validOp(g({ to: 'A'.repeat(64) })), false);
  assert.equal(validOp(g({ role: 'Staff' })), false);
  assert.equal(validOp(g({ role: 'a'.repeat(24) })), true);
  assert.equal(validOp(g({ role: 'a'.repeat(25) })), false);
  const r = (o = {}) => ({ k: 'revoke', id: 'g1', cut: 0, l: 3, ...o });
  assert.equal(validOp(r()), true);
  assert.equal(validOp(r({ cut: -1 })), false);
  assert.equal(validOp(r({ cut: 1.2 })), false);
  assert.equal(validOp(r({ id: '-bad' })), false);
});

test('ins / rm (RGA)', () => {
  const ins = (o = {}) => ({ k: 'ins', c: 'docs', id: 'd1', at: '^', ch: 'a', l: 1, ...o });
  assert.equal(validOp(ins()), true);
  assert.equal(validOp(ins({ at: TAG })), true);
  assert.equal(validOp(ins({ at: 'x' })), false);
  assert.equal(validOp(ins({ at: 5 })), false);
  assert.equal(validOp(ins({ ch: '' })), false);
  assert.equal(validOp(ins({ ch: 'x'.repeat(64) })), true);
  assert.equal(validOp(ins({ ch: 'x'.repeat(65) })), false);
  assert.equal(validOp(ins({ ch: 7 })), false);
  const rm = (o = {}) => ({ k: 'rm', c: 'docs', id: 'd1', e: TAG, l: 2, ...o });
  assert.equal(validOp(rm()), true);
  assert.equal(validOp(rm({ e: '^' })), false);
});

test('unknown kinds and non-objects are rejected', () => {
  for (const x of [null, undefined, 1, 'put', [], { k: 'nope' }, { k: 'put' }]) assert.equal(validOp(x), false);
});

// ── inspect: the synchronous gate ──
const env = (o = {}) => ({ from: H, op: put(), prev: GENESIS_PREV, seq: 1, sig: 'b'.repeat(128), v: 2, ...o });
const enc = (o) => utf8(canonical(o));

test('the envelope is v2 and a first write names the genesis prev (64 zeros)', () => {
  assert.equal(VERSION, 2);
  assert.equal(GENESIS_PREV, '0'.repeat(64));
});

test('inspect accepts a canonical envelope and returns the signed body — prev is signed', () => {
  const r = inspect(enc(env()));
  assert.equal(r.ok, true);
  assert.equal(r.body, canonical({ from: H, op: put(), prev: GENESIS_PREV, seq: 1, v: 2 }));
  assert.equal(r.env.seq, 1);
  const later = inspect(enc(env({ seq: 7, prev: 'c'.repeat(64) })));
  assert.equal(later.ok, true);
  assert.equal(later.body, canonical({ from: H, op: put(), prev: 'c'.repeat(64), seq: 7, v: 2 }));
});

test('inspect rejects, each with its reason, in gate order', () => {
  assert.equal(inspect('x').reason, 'not-bytes');
  assert.equal(inspect(new Uint8Array(0)).reason, 'size');
  assert.equal(inspect(new Uint8Array(MAX_BYTES + 1).fill(123)).reason, 'size');
  assert.equal(inspect(new Uint8Array([0xff])).reason, 'utf8');
  assert.equal(inspect(utf8('[1]')).reason, 'magic');
  assert.equal(inspect(utf8('{bad')).reason, 'json');
  assert.equal(inspect(utf8('{"a":1}')).reason, 'version');                     // no version at all
  assert.equal(inspect(utf8('{"a":1,"v":2}')).reason, 'envelope');
  assert.equal(inspect(enc({ ...env(), x: 1 })).reason, 'envelope');
  const { prev, ...noPrev } = env();
  assert.equal(inspect(enc(noPrev)).reason, 'envelope');                         // v2 without its prev
  assert.equal(inspect(enc({ ...noPrev, w: H })).reason, 'envelope');            // right count, wrong key name
  assert.equal(inspect(enc(env({ v: 1 }))).reason, 'version');
  assert.equal(inspect(enc(env({ v: 3 }))).reason, 'version');
  assert.equal(inspect(enc(env({ from: 'zz' }))).reason, 'from');
  assert.equal(inspect(enc(env({ seq: 0 }))).reason, 'seq');
  assert.equal(inspect(enc(env({ sig: 'b'.repeat(127) }))).reason, 'sig-shape');
  assert.equal(inspect(enc(env({ op: { k: 'nope' } }))).reason, 'schema');
  assert.equal(inspect(utf8(' ' + canonical(env()))).reason, 'magic');
  assert.equal(inspect(utf8('{ ' + canonical(env()).slice(1))).reason, 'non-canonical');
  const swapped = '{"op":' + canonical(put()) + ',"from":"' + H + '","prev":"' + GENESIS_PREV + '","seq":1,"sig":"' + 'b'.repeat(128) + '","v":2}';
  assert.equal(inspect(utf8(swapped)).reason, 'non-canonical');
});

test('inspect: a legacy v1 envelope — validly shaped, no prev — is refused as a version, not as junk', () => {
  const v1 = { from: H, op: put(), seq: 1, sig: 'b'.repeat(128), v: 1 };
  assert.equal(inspect(enc(v1)).reason, 'version');
});

test('inspect: prev must be 64 lowercase hex — and the genesis prev belongs to seq 1 and only seq 1', () => {
  assert.equal(inspect(enc(env({ prev: 'a'.repeat(63) }))).reason, 'prev');
  assert.equal(inspect(enc(env({ prev: 'A'.repeat(64) }))).reason, 'prev');
  assert.equal(inspect(enc(env({ prev: 5 }))).reason, 'prev');
  assert.equal(inspect(enc(env({ prev: null }))).reason, 'prev');
  assert.equal(inspect(enc(env({ seq: 1, prev: 'a'.repeat(64) }))).reason, 'prev-genesis');     // a first write with a past
  assert.equal(inspect(enc(env({ seq: 2, prev: GENESIS_PREV }))).reason, 'prev-genesis');       // a later write with none
  assert.equal(inspect(enc(env({ seq: 2, prev: 'a'.repeat(64) }))).ok, true);
  assert.equal(inspect(enc(env({ seq: 1, prev: GENESIS_PREV }))).ok, true);
  // gate order: seq before prev, prev before the genesis rule, the genesis rule before the signature shape
  assert.equal(inspect(enc(env({ seq: 0, prev: 'x' }))).reason, 'seq');
  assert.equal(inspect(enc(env({ prev: 'x', sig: 'b' }))).reason, 'prev');
  assert.equal(inspect(enc(env({ seq: 2, prev: GENESIS_PREV, sig: 'b' }))).reason, 'prev-genesis');
});

test('inspect: seq must be a positive safe integer; a float is non-canonical-or-rejected', () => {
  assert.equal(inspect(utf8(canonical(env()).replace('"seq":1', '"seq":1.0'))).reason, 'non-canonical');
  assert.equal(inspect(utf8(canonical(env()).replace('"seq":1', '"seq":-1'))).reason, 'seq');
  assert.equal(inspect(utf8(canonical(env()).replace('"seq":1', '"seq":"1"'))).reason, 'seq');
});

test('inspect: exactly MAX_BYTES is allowed through the size check', () => {
  const r = inspect(new Uint8Array(MAX_BYTES).fill(123));
  assert.notEqual(r.reason, 'size');
});

// ── admit: replay + signature ──
const signed = async (k, body) => utf8(canonical({ ...body, sig: await sign(k, utf8(canonical(body))) }));

test('admit: valid signature in, replay out, forged out — and prev is covered by the signature', async () => {
  const k = await fromSeed(sha256Bytes('gate-test'));
  const body = { from: k.pub, op: put(), prev: GENESIS_PREV, seq: 1, v: 2 };
  const sig = await sign(k, utf8(canonical(body)));
  const bytes = utf8(canonical({ ...body, sig }));
  const held = new Set();
  const a = await admit(bytes, held);
  assert.equal(a.ok, true);
  assert.equal(a.hash, sha256(bytes));
  held.add(a.hash);
  assert.equal((await admit(bytes, held)).reason, 'replay');
  const forged = utf8(canonical({ ...body, op: put({ f: { title: 'evil' } }), sig }));
  assert.equal((await admit(forged, held)).reason, 'signature');
  const wrongKey = utf8(canonical({ ...body, from: 'c'.repeat(64), sig }));
  assert.equal((await admit(wrongKey, held)).reason, 'signature');
  // re-pointing a signed write at another history breaks its signature
  const later = { ...body, seq: 2, prev: 'd'.repeat(64) };
  const lsig = await sign(k, utf8(canonical(later)));
  assert.equal((await admit(utf8(canonical({ ...later, sig: lsig })), held)).ok, true);
  assert.equal((await admit(utf8(canonical({ ...later, prev: 'e'.repeat(64), sig: lsig })), held)).reason, 'signature');
  assert.equal((await admit(utf8('{x'), held)).reason, 'json');
  assert.equal((await admit(bytes, null)).ok, true);
  // a validly-signed legacy v1 envelope is refused at the door: the switch to chains is clean
  const v1 = { from: k.pub, op: put(), seq: 1, v: 1 };
  assert.equal((await admit(await signed(k, v1), null)).reason, 'version');
});

// ── fork + link proofs ──
test('proveFork: two different signed envelopes for one slot prove the key equivocated — nothing else does', async () => {
  const k = await fromSeed(sha256Bytes('fork-proof'));
  const other = await fromSeed(sha256Bytes('fork-proof/other'));
  const at = (key, seq, title, prev = seq === 1 ? GENESIS_PREV : 'c'.repeat(64)) =>
    signed(key, { from: key.pub, op: put({ f: { title } }), prev, seq, v: 2 });
  const a = await at(k, 3, 'real');
  const b = await at(k, 3, 'forged');
  const p = await proveFork(a, b);
  assert.equal(p.ok, true);
  assert.equal(p.writer, k.pub);
  assert.equal(p.seq, 3);
  assert.deepEqual(p.hashes, [sha256(a), sha256(b)].sort());
  assert.deepEqual((await proveFork(b, a)).hashes, p.hashes);                          // same proof either way round
  assert.equal((await proveFork(a, a)).reason, 'same-envelope');
  assert.equal((await proveFork(a, await at(k, 4, 'real'))).reason, 'different-slot');  // same key, other slot
  assert.equal((await proveFork(a, await at(other, 3, 'forged'))).reason, 'different-slot');   // same slot, other key
  const bad = a.slice(); bad[bad.length - 5] ^= 1;
  assert.equal((await proveFork(bad, b)).reason, 'unverified');
  assert.equal((await proveFork(a, bad)).reason, 'unverified');
  assert.equal((await proveFork(null, b)).reason, 'unverified');
});

test('proveLink: a child continues a parent only if same writer, exactly the next slot, prev = the parent hash', async () => {
  const k = await fromSeed(sha256Bytes('link-proof'));
  const other = await fromSeed(sha256Bytes('link-proof/other'));
  const mk = (key, seq, prev, title = 'x') => signed(key, { from: key.pub, op: put({ f: { title } }), prev, seq, v: 2 });
  const p1 = await mk(k, 1, GENESIS_PREV);
  const p2 = await mk(k, 2, sha256(p1));
  const l = await proveLink(p1, p2);
  assert.equal(l.ok, true);
  assert.equal(l.writer, k.pub);
  assert.equal(l.seq, 1);
  assert.equal(l.parent, sha256(p1));
  assert.equal(l.child, sha256(p2));
  assert.equal((await proveLink(p2, p1)).reason, 'not-next');                          // backwards
  assert.equal((await proveLink(p1, await mk(k, 3, sha256(p1)))).reason, 'not-next');   // skips a slot
  assert.equal((await proveLink(p1, await mk(k, 2, 'd'.repeat(64)))).reason, 'not-linked');
  assert.equal((await proveLink(p1, await mk(other, 2, sha256(p1)))).reason, 'other-writer');
  const bad = p2.slice(); bad[bad.length - 5] ^= 1;
  assert.equal((await proveLink(p1, bad)).reason, 'unverified');
  assert.equal((await proveLink(bad, p1)).reason, 'unverified');
});
