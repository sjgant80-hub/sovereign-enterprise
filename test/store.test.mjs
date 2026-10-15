import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyStore, sealRecord, openRecord, isRoleWrite, staleDevices, LOG_MAX, PIN_MAX, TAB_TTL, LEGACY, DB_VERSION, FILE_MAX, FILES_MAX } from '../src/store.mjs';
import { split, combine } from '../src/recovery.mjs';
import { createNode, pull, signEnvelope } from '../src/node.mjs';
import { generate, exportPriv, fromSeed, verify } from '../src/keys.mjs';
import { admit, GENESIS_PREV, MAX_BYTES } from '../src/gate.mjs';
import { canonical, utf8, toHex } from '../src/canon.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { hostileInputs } from '../.witness/witness.mjs';
import { fakeIndexedDB } from './fake-idb.mjs';

const subtle = globalThis.crypto.subtle;
const mk = (idb, more) => createKeyStore({ idb, subtle, name: 'se-test', ...more });
const fresh = (more, fake = fakeIndexedDB()) => ({ fake, ks: mk(fake, more) });
const bytesOf = (s) => utf8(s);
const has = (hay, needle) => { for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((b, j) => hay[i + j] === b)) return true; return false; };
/** Everything in the store's committed data, flattened to byte strings — what a dump of the browser's disk would show. */
const onDisk = (fake) => [...fake.raw('se-test')].flatMap(([k, v]) => [utf8(k), ...(v instanceof Uint8Array ? [v] : [utf8(JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? [...x] : x)) || '')])]);
const legacyFrom = (map) => ({ get: (k) => (map.has(k) ? map.get(k) : null), remove: (k) => map.delete(k) });
const notExtractable = async (key) => {
  assert.equal(key.extractable, false);
  for (const f of ['pkcs8', 'jwk', 'raw']) await assert.rejects(subtle.exportKey(f, key), f);
};

test('device(): an Ed25519 key made non-extractable, kept as a CryptoKey in IndexedDB, the same key on every reload', async () => {
  const { fake, ks } = fresh();
  assert.deepEqual(await ks.keys('owner'), { ok: true, keys: null });
  const a = await ks.device('owner');
  assert.equal(a.ok, true);
  assert.equal(a.fresh, true);
  assert.match(a.keys.pub, /^[0-9a-f]{64}$/);
  await notExtractable(a.keys.priv);
  assert.equal(a.keys.priv.type, 'private');
  assert.ok(Object.isFrozen(a.keys));
  // what sits in storage is the CryptoKey itself — structured-cloned, still non-extractable
  const rec = fake.raw('se-test').get('dev|owner');
  assert.equal(rec.pub, a.keys.pub);
  assert.equal(rec.how, 'made');
  await notExtractable(rec.priv);
  // a reload: a new store over the same database gives back the same key, and it still signs
  const again = await mk(fake).device('owner');
  assert.equal(again.fresh, false);
  assert.equal(again.keys.pub, a.keys.pub);
  const sig = await again.keys.sign(bytesOf('hello'));
  assert.ok(sig instanceof Uint8Array && sig.length === 64);
  assert.equal(await verify(a.keys.pub, toHex(sig), bytesOf('hello')), true);
  assert.equal(await verify(a.keys.pub, toHex(sig), bytesOf('hellp')), false);
  assert.equal((await mk(fake).keys('owner')).keys.pub, a.keys.pub);
  // namespaces are separate devices
  const b = await ks.device('tab.x1');
  assert.notEqual(b.keys.pub, a.keys.pub);
  assert.equal((await ks.device('owner')).keys.pub, a.keys.pub);
  // two calls at once never mint two keys for one namespace
  const [p, q] = await Promise.all([ks.device('join.ab'), ks.device('join.ab')]);
  assert.equal(p.keys.pub, q.keys.pub);
  assert.equal(p.fresh, true);
  assert.equal(q.fresh, false);
  assert.equal(DB_VERSION, 1);
  assert.equal(ks.name, 'se-test');
  assert.deepEqual(fake.names(), ['se-test']);
  assert.equal(createKeyStore({ idb: fake, subtle }).name, 'sovereign-enterprise');
});

test('a stored record that is not a whole device key is never used as one: a new key is made in its place', async () => {
  const good = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const pub = 'a'.repeat(64);
  const bad = [null, 'x', { pub }, { pub, priv: null }, { pub, priv: good.publicKey }, { pub: 'x', priv: good.privateKey },
    { pub: 7, priv: good.privateKey }, { pub: pub.toUpperCase(), priv: good.privateKey }];
  for (const rec of bad) {
    const { fake, ks } = fresh();
    await ks.device('tab.seed');                                       // opens the database
    fake.raw('se-test').set('dev|owner', rec);
    assert.deepEqual(await ks.keys('owner'), { ok: true, keys: null }, JSON.stringify(rec));
    const d = await ks.device('owner');
    assert.equal(d.fresh, true, JSON.stringify(rec));
    assert.notEqual(d.keys.pub, pub);
    assert.equal(fake.raw('se-test').get('dev|owner').how, 'made');
  }
  // the same shape with a real private key IS a device key
  const { fake, ks } = fresh();
  await ks.device('tab.seed');
  fake.raw('se-test').set('dev|owner', { v: 1, pub, priv: good.privateKey, how: 'made' });
  assert.equal((await ks.keys('owner')).keys.pub, pub);
  // a replica key that is not a secret key is not used: a new one is made, and what the old one sealed no longer opens
  const r = fresh();
  await r.ks.append('owner', utf8('a'));
  r.fake.raw('se-test').set('aes|owner', good.publicKey);
  await r.ks.append('owner', utf8('b'));
  assert.equal(r.fake.raw('se-test').get('aes|owner').type, 'secret');
  assert.deepEqual(await r.ks.entries('owner'), { ok: true, items: [utf8('b')], unreadable: 1 });
});

test('founding refuses a crypto layer that does not export an Ed25519 PKCS#8 — it never stores a key it could not print', async () => {
  const wrap = (fn) => new Proxy(subtle, { get: (t, k) => (k === 'exportKey' ? (f, key) => (f === 'pkcs8' ? fn(t, key) : t.exportKey(f, key)) : t[k].bind(t)) });
  const prefixOff = wrap(async (t, key) => { const b = new Uint8Array(await t.exportKey('pkcs8', key)); b[5] ^= 1; return b.buffer; });
  const short = wrap(async (t, key) => new Uint8Array(await t.exportKey('pkcs8', key)).slice(0, 47).buffer);
  const long = wrap(async (t, key) => { const b = new Uint8Array(await t.exportKey('pkcs8', key)); return Uint8Array.of(...b, 0).buffer; });
  for (const s of [prefixOff, short, long]) {
    const fake = fakeIndexedDB();
    const ks = createKeyStore({ idb: fake, subtle: s, name: 'se-test' });
    assert.deepEqual(await ks.found('owner'), { ok: false, reason: 'pkcs8' });
    assert.deepEqual(await ks.keys('owner'), { ok: true, keys: null });
  }
  assert.equal((await createKeyStore({ idb: fakeIndexedDB(), subtle: wrap((t, key) => t.exportKey('pkcs8', key)), name: 'se-test' }).found('owner')).ok, true);
});

test('createNode signs with a store key exactly as with keys.mjs; a second device verifies every write through its gate', async () => {
  const { fake, ks } = fresh();
  const me = (await ks.device('owner')).keys;
  const staff = await fromSeed(sha256Bytes('store-test/staff'));
  const owner = createNode({ keys: me, genesis: me.pub, name: 'owner' });
  const other = createNode({ keys: staff, genesis: me.pub, name: 'staff' });
  assert.equal((await owner.grant('g1', staff.pub, 'staff', ['tasks'])).ok, true);
  const w = await owner.put('tasks', 't1', { title: 'ship it' });
  assert.equal(w.ok, true);
  assert.equal(await pull(other, owner), 2);
  assert.deepEqual(other.list('tasks'), [{ id: 't1', title: 'ship it' }]);
  assert.equal((await other.put('tasks', 't2', { title: 'from staff' })).ok, true);
  assert.equal(await pull(owner, other), 1);
  assert.equal(owner.digest(), other.digest());
  // the raw gate, on a device that has never seen this company
  assert.equal((await admit(w.bytes, new Map())).ok, true);
  const env = await signEnvelope(me, { k: 'put', c: 'tasks', id: 'x', f: { title: 'y' }, l: 1 }, 1, GENESIS_PREV);
  assert.equal((await admit(env, new Map())).ok, true);
  // the device's chain survives a reload: persist, reopen, replay, and the next write names the last one
  for (const h of owner.hashes()) assert.equal((await ks.append('owner', owner.bytes(h))).ok, true);
  const ks2 = mk(fake);
  const me2 = (await ks2.device('owner')).keys;
  const back = createNode({ keys: me2, genesis: me2.pub, name: 'owner' });
  for (const b of (await ks2.entries('owner')).items) assert.equal((await back.receive(b)).ok, true);
  assert.deepEqual(back.tip(), owner.tip());
  const next = await back.put('tasks', 't3', { title: 'after reload' });
  assert.equal(next.ok, true);
  assert.equal(next.env.prev, owner.tip().hash);
  assert.equal(next.env.seq, owner.tip().seq + 1);
  assert.equal((await other.receive(next.bytes)).ok, true);
  assert.deepEqual(other.view().report.forks, [], 'no fork: the reloaded device continued its own chain');
});

test('the log on disk is ciphertext; it opens back in order; a changed bit or a record moved to another device does not open', async () => {
  const { fake, ks } = fresh();
  const me = (await ks.device('owner')).keys;
  const node = createNode({ keys: me, genesis: me.pub });
  const secret = 'Quarterly numbers: confidential-marker-7f3a';
  const w = await node.put('docs', 'd1', { body: secret });
  const g = await node.grant('g1', 'b'.repeat(64), 'staff', ['tasks']);
  assert.deepEqual(await ks.append('owner', w.bytes), { ok: true, size: 1, pinned: false });
  assert.deepEqual(await ks.append('owner', g.bytes), { ok: true, size: 2, pinned: true });
  const got = await ks.entries('owner');
  assert.deepEqual(got.items.map((b) => toHex(b)), [toHex(g.bytes), toHex(w.bytes)], 'role-tree lane first');
  assert.equal(got.unreadable, 0);
  for (const blob of onDisk(fake)) {
    assert.ok(!has(blob, utf8('confidential-marker')), 'plain text on disk');
    assert.ok(!has(blob, utf8('"op"')), 'an envelope on disk');
    assert.ok(!has(blob, w.bytes.slice(0, 24)));
  }
  assert.deepEqual(await ks.stat('owner'), { ok: true, pub: me.pub, how: 'made', size: 2, pins: 1, sealed: true });
  const raw = fake.raw('se-test');
  assert.equal(raw.get('aes|owner').extractable, false);
  await notExtractable(raw.get('aes|owner'));
  assert.equal(raw.get('rec|owner|0').length, 12 + w.bytes.length + 16, 'IV ‖ ciphertext ‖ tag');
  // tamper: one bit of the stored record → it does not open, and the rest still do
  raw.get('rec|owner|0')[20] ^= 1;
  const t = await ks.entries('owner');
  assert.deepEqual(t.items.map(toHex), [toHex(g.bytes)]);
  assert.equal(t.unreadable, 1);
  // a record copied under another device's namespace does not open there (the namespace is bound in)
  await ks.append('tab.t1', utf8('x'));
  raw.set('rec|tab.t1|1', raw.get('pin|owner|0'));
  raw.set('log|tab.t1', { first: 0, next: 2, pins: 0 });
  const moved = await ks.entries('tab.t1');
  assert.deepEqual(moved.items.map(toHex), [toHex(utf8('x'))]);
  assert.equal(moved.unreadable, 1);
  // a namespace with nothing stored
  assert.deepEqual(await ks.entries('join.none'), { ok: true, items: [], unreadable: 0 });
  assert.deepEqual(await ks.stat('join.none'), { ok: true, pub: null, how: null, size: 0, pins: 0, sealed: false });
});

test('retention: the newest data writes are kept up to the bound; grants and revokes have a lane of their own, kept regardless of age', async () => {
  assert.equal(LOG_MAX, 20000);
  assert.equal(PIN_MAX, 5000);
  assert.deepEqual(createKeyStore({ idb: fakeIndexedDB(), subtle }).limits, { log: LOG_MAX, pins: PIN_MAX });
  assert.deepEqual(createKeyStore({ idb: fakeIndexedDB(), subtle, limits: { log: 0, pins: -1 } }).limits, { log: LOG_MAX, pins: PIN_MAX });
  assert.deepEqual(createKeyStore({ idb: fakeIndexedDB(), subtle, limits: { log: 1, pins: 0 } }).limits, { log: 1, pins: 0 });
  const { fake, ks } = fresh({ limits: { log: 4, pins: 2 } });
  const role = (i) => utf8(canonical({ op: { k: i % 2 ? 'revoke' : 'grant', id: 'g' + i }, n: i }));
  const data = (i) => utf8(canonical({ op: { k: 'put', id: 'p' + i }, n: i }));
  const sent = [role(0), data(0), data(1), role(1), data(2), role(2), data(3), data(4), data(5)];
  const sizes = [];
  for (const b of sent) sizes.push((await ks.append('owner', b)).size);
  assert.deepEqual(sizes, [1, 2, 3, 4, 5, 6, 6, 6, 6]);
  // pins: role 0 and role 1; the third role write overflows into the bounded lane, which keeps its newest four
  const got = (await ks.entries('owner')).items.map((b) => new TextDecoder().decode(b));
  assert.deepEqual(got, [role(0), role(1), role(2), data(3), data(4), data(5)].map((b) => new TextDecoder().decode(b)));
  const raw = fake.raw('se-test');
  assert.deepEqual(raw.get('log|owner'), { first: 3, next: 7, pins: 2 });
  for (const i of [0, 1, 2]) assert.equal(raw.has('rec|owner|' + i), false, 'dropped records are deleted, not hidden');
  assert.equal(raw.has('rec|owner|3'), true);
  // one more data write moves the window by exactly one
  await ks.append('owner', data(6));
  assert.deepEqual(raw.get('log|owner'), { first: 4, next: 8, pins: 2 });
  assert.equal((await ks.entries('owner')).items.length, 6);
  // a pin lane of 0 sends every write to the bounded lane
  const { ks: none } = fresh({ limits: { log: 2, pins: 0 } });
  for (const b of [role(0), role(1), data(0)]) await none.append('owner', b);
  assert.deepEqual((await none.entries('owner')).items.map((b) => new TextDecoder().decode(b)), [role(1), data(0)].map((b) => new TextDecoder().decode(b)));
  // what can be appended
  assert.deepEqual(await ks.append('owner', new Uint8Array(0)), { ok: false, reason: 'record' });
  assert.deepEqual(await ks.append('owner', new Uint8Array(MAX_BYTES + 1)), { ok: false, reason: 'record' });
  assert.equal((await ks.append('owner', new Uint8Array(MAX_BYTES))).ok, true);
  assert.deepEqual(await ks.append('owner', 'text'), { ok: false, reason: 'record' });
  assert.deepEqual(await ks.append('owner', [1, 2]), { ok: false, reason: 'record' });
});

test('tab devices: every device record says when it was last opened; one not opened for 7 days is due for deletion', async () => {
  assert.equal(TAB_TTL, 7 * 24 * 60 * 60 * 1000);
  let clock = 1000;
  const fake = fakeIndexedDB();
  const ks = mk(fake, { now: () => clock });
  await ks.device('owner');
  clock = 2000;
  await ks.device('tab.a1');
  await ks.found('tab.b2');
  clock = 3000;
  await ks.restore('tab.c3', sha256Bytes('store-test/tab-c3'));
  await ks.migrate('join.d4', legacyFrom(new Map([[LEGACY.priv, await exportPriv(await generate())]])));
  const l = await ks.list();
  assert.equal(l.ok, true);
  assert.deepEqual(l.devices.map((d) => [d.ns, d.how, d.seen]), [['join.d4', 'migrated', 3000], ['owner', 'made', 1000], ['tab.a1', 'made', 2000], ['tab.b2', 'founded', 2000], ['tab.c3', 'restored', 3000]]);
  assert.ok(l.devices.every((d) => /^[0-9a-f]{64}$/.test(d.pub)));
  // touch: opened again now
  clock = 5000;
  assert.deepEqual(await ks.touch('tab.a1'), { ok: true, seen: 5000 });
  assert.deepEqual(await ks.touch('tab.none'), { ok: true, seen: null });
  assert.equal((await ks.list()).devices.find((d) => d.ns === 'tab.a1').seen, 5000);
  assert.equal((await ks.device('tab.a1')).fresh, false, 'touch keeps the key');
  // a device record with no stamp (from before) counts as never opened; a record that is not a key is not listed
  fake.raw('se-test').set('dev|tab.old', { ...fake.raw('se-test').get('dev|tab.a1'), seen: undefined });
  fake.raw('se-test').set('dev|tab.junk', { pub: 'x' });
  const l2 = (await ks.list()).devices;
  assert.equal(l2.find((d) => d.ns === 'tab.old').seen, 0);
  assert.equal(l2.some((d) => d.ns === 'tab.junk'), false);
  // the rule
  const devs = [{ ns: 'owner', seen: 0 }, { ns: 'join.x', seen: 0 }, { ns: 'tab.mine', seen: 0 }, { ns: 'tab.fresh', seen: 100 }, { ns: 'tab.edge', seen: 50 }, { ns: 'tab.old', seen: 49 }, { ns: 'tab.nostamp' }];
  assert.deepEqual(staleDevices(devs, { now: 50 + TAB_TTL, mine: 'tab.mine' }), ['tab.old', 'tab.nostamp']);
  assert.deepEqual(staleDevices(devs, { now: 51 + TAB_TTL, mine: 'tab.mine' }), ['tab.edge', 'tab.old', 'tab.nostamp']);
  assert.deepEqual(staleDevices(devs, { now: 200, ttl: 100 }), ['tab.mine', 'tab.edge', 'tab.old', 'tab.nostamp']);
  assert.deepEqual(staleDevices(devs, { now: 200, ttl: 100, prefix: 'join.' }), ['join.x']);
  assert.deepEqual(staleDevices([{ ns: 'tab.a', seen: 'x' }], { now: TAB_TTL + 1 }), ['tab.a'], 'a stamp that is not a time counts as never');
  for (const [, v] of hostileInputs()) {
    assert.deepEqual(staleDevices(v, { now: 1 }), []);
    assert.deepEqual(staleDevices(devs, v), []);
    assert.deepEqual(staleDevices([v], { now: TAB_TTL + 1 }), []);
  }
  assert.deepEqual(staleDevices(devs, { now: '9'.repeat(20) }), []);
  assert.deepEqual(staleDevices(devs, { get now() { throw new Error('boom'); } }), []);
  // list on a store with no IndexedDB, or a broken one
  assert.deepEqual(await createKeyStore({ subtle }).list(), { ok: false, reason: 'no-store' });
  assert.deepEqual(await mk(fakeIndexedDB({ failOpen: true })).list(), { ok: false, reason: 'store' });
  assert.deepEqual(await mk(fakeIndexedDB()).list(), { ok: true, devices: [] });
  // the default clock is the real one
  const t0 = Date.now();
  const real = mk(fakeIndexedDB());
  await real.device('owner');
  const seen = (await real.list()).devices[0].seen;
  assert.ok(seen >= t0 && seen <= Date.now());
});

test('isRoleWrite: grants and revokes only; anything unreadable is not', async () => {
  const me = await fromSeed(sha256Bytes('store-test/role'));
  const n = createNode({ keys: me, genesis: me.pub });
  assert.equal(isRoleWrite((await n.grant('g', 'c'.repeat(64), 'staff', ['tasks'])).bytes), true);
  assert.equal(isRoleWrite((await n.revoke('g', 0)).bytes), true);
  assert.equal(isRoleWrite((await n.put('tasks', 't', { title: 'x' })).bytes), false);
  assert.equal(isRoleWrite(utf8('{"op":{"k":"del"}}')), false);
  assert.equal(isRoleWrite(utf8('{"op":{}}')), false);
  for (const [, v] of hostileInputs()) assert.equal(isRoleWrite(v), false);
  assert.equal(isRoleWrite(utf8('{"op":null}')), false);
});

test('found(): the owner key, its seed exported once for the cards, then stored non-extractable — and the cards bring it back', async () => {
  const { fake, ks } = fresh();
  const f = await ks.found('owner');
  assert.equal(f.ok, true);
  assert.ok(f.seed instanceof Uint8Array && f.seed.length === 32);
  await notExtractable(f.keys.priv);
  assert.equal(fake.raw('se-test').get('dev|owner').how, 'founded');
  // the seed IS the key: keys.mjs derives the same public key from it
  assert.equal((await fromSeed(f.seed)).pub, f.keys.pub);
  // a key that exists is not replaced unless asked — and replacing it takes its log with it
  await ks.append('owner', utf8('old company'));
  assert.deepEqual(await ks.found('owner'), { ok: false, reason: 'exists' });
  assert.equal((await ks.device('owner')).keys.pub, f.keys.pub);
  const f2 = await ks.found('owner', { replace: true });
  assert.equal(f2.ok, true);
  assert.notEqual(f2.keys.pub, f.keys.pub);
  assert.deepEqual((await ks.entries('owner')).items, []);
  assert.equal(fake.raw('se-test').has('rec|owner|0'), false);
  assert.equal(fake.raw('se-test').has('aes|owner'), false, 'the old replica key is shredded with it');
  assert.equal((await mk(fake).device('owner')).keys.pub, f2.keys.pub);
  // the cards: 2 of 3, printed once; a new machine restores the owner from any two
  const cards = split(f2.seed).cards;
  f2.seed.fill(0);
  const other = fresh().ks;
  const c = combine([cards[2], cards[0]]);
  assert.equal(c.ok, true);
  const r = await other.restore('owner', c.secret);
  assert.equal(r.ok, true);
  assert.equal(r.same, false);
  assert.equal(r.keys.pub, f2.keys.pub);
  await notExtractable(r.keys.priv);
  // and the restored owner signs writes the first machine's devices accept
  const staff = await fromSeed(sha256Bytes('store-test/staff2'));
  const orig = createNode({ keys: f2.keys, genesis: f2.keys.pub });
  await orig.grant('g1', staff.pub, 'staff', ['tasks']);
  const peer = createNode({ keys: staff, genesis: f2.keys.pub });
  await pull(peer, orig);
  const restored = createNode({ keys: r.keys, genesis: r.keys.pub });
  await pull(restored, peer);                                     // catch up first: its own writes come back to it
  assert.deepEqual(restored.tip(), orig.tip());
  const w = await restored.put('tasks', 't9', { title: 'restored owner' });
  assert.equal((await peer.receive(w.bytes)).ok, true);
  assert.deepEqual(peer.view().report.forks, []);
  assert.deepEqual(peer.list('tasks'), [{ id: 't9', title: 'restored owner' }]);
});

test('restore(): seed or PKCS#8, never a stranger over an existing key unless asked; junk refused', async () => {
  const { fake, ks } = fresh();
  const legacy = await generate();
  const pkcs8 = await exportPriv(legacy);
  const p8 = Uint8Array.from(pkcs8.match(/../g).map((h) => parseInt(h, 16)));
  const r = await ks.restore('owner', p8);
  assert.equal(r.keys.pub, legacy.pub);
  await notExtractable(r.keys.priv);
  assert.equal(fake.raw('se-test').get('dev|owner').how, 'restored');
  assert.deepEqual([...p8.slice(0, 16)], [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20], 'the caller’s copy is left as it was');
  // the same key again: nothing changes
  await ks.append('owner', utf8('kept'));
  const same = await ks.restore('owner', p8.slice(16));
  assert.equal(same.same, true);
  assert.equal((await ks.entries('owner')).items.length, 1);
  // a different key over it: refused, unless replace — which takes the old log with it
  const seed = sha256Bytes('store-test/other');
  assert.deepEqual(await ks.restore('owner', seed), { ok: false, reason: 'exists' });
  assert.equal((await ks.device('owner')).keys.pub, legacy.pub);
  const rep = await ks.restore('owner', seed, { replace: true });
  assert.equal(rep.keys.pub, (await fromSeed(seed)).pub);
  assert.deepEqual((await ks.entries('owner')).items, []);
  // junk
  const bad = p8.slice();
  bad[3] ^= 1;
  for (const s of [bad, new Uint8Array(31), new Uint8Array(33), new Uint8Array(47), new Uint8Array(49), 'seed', Array.from(seed), null]) {
    assert.deepEqual(await ks.restore('tab.z', s), { ok: false, reason: 'secret' });
  }
  assert.equal((await ks.restore('tab.z', new Uint8Array(32))).ok, true, 'any 32 bytes are an Ed25519 seed');
  // a 48-byte PKCS#8 whose prefix matches but whose key bytes are another key's: the key it names
  const other = Uint8Array.of(...p8.slice(0, 16), ...seed);
  assert.equal((await ks.restore('tab.y', other)).keys.pub, (await fromSeed(seed)).pub);
});

test('migrate(): an old device’s plaintext key and log move in once — non-extractable, sealed — and the plaintext is deleted', async () => {
  const { fake, ks } = fresh();
  const old = await generate();
  const staff = await fromSeed(sha256Bytes('store-test/mig-staff'));
  const node = createNode({ keys: old, genesis: old.pub });
  const writes = [await node.grant('g1', staff.pub, 'staff', ['tasks']), await node.put('tasks', 't1', { title: 'secret plan 42' }), await node.put('tasks', 't2', { title: 'b' })];
  const ls = new Map([[LEGACY.priv, await exportPriv(old)], [LEGACY.env, JSON.stringify(writes.map((w) => toHex(w.bytes)))], ['se.genesis', old.pub]]);
  const m = await ks.migrate('owner', legacyFrom(ls));
  assert.equal(m.ok, true);
  assert.equal(m.moved, true);
  assert.equal(m.envelopes, 3);
  assert.equal(m.cleared, true);
  assert.equal(m.keys.pub, old.pub);
  await notExtractable(m.keys.priv);
  assert.deepEqual([...ls.keys()], ['se.genesis'], 'the plaintext key and log are gone; the company id stays');
  assert.equal(fake.raw('se-test').get('dev|owner').how, 'migrated');
  for (const blob of onDisk(fake)) assert.ok(!has(blob, utf8('secret plan')));
  const got = await ks.entries('owner');
  assert.deepEqual(got.items.map(toHex).sort(), writes.map((w) => toHex(w.bytes)).sort());
  assert.equal((await ks.stat('owner')).pins, 1);
  // the migrated device carries on its own chain — no fork
  const back = createNode({ keys: (await ks.device('owner')).keys, genesis: old.pub });
  for (const b of got.items) await back.receive(b);
  assert.deepEqual(back.tip(), node.tip());
  const next = await back.put('tasks', 't3', { title: 'c' });
  assert.equal(next.env.prev, node.tip().hash);
  // nothing left to move: a second run is a no-op
  assert.deepEqual(await ks.migrate('owner', legacyFrom(ls)), { ok: true, moved: false });
});

test('migrate(): a failure leaves the plaintext where it was; a crash after the commit re-runs harmlessly; a different key is a conflict', async () => {
  const old = await generate();
  const hex = await exportPriv(old);
  const env = JSON.stringify([toHex(utf8('{"op":{"k":"put"}}'))]);
  // the store fails mid-write: nothing lands, nothing is deleted
  let failing = true;
  const fake = fakeIndexedDB({ fail: (op, k) => failing && op === 'put' && String(k).startsWith('rec|') });
  const ks = mk(fake);
  const ls = new Map([[LEGACY.priv, hex], [LEGACY.env, env]]);
  assert.deepEqual(await ks.migrate('owner', legacyFrom(ls)), { ok: false, reason: 'store' });
  assert.equal(ls.size, 2, 'the plaintext stays until the encrypted copy has committed');
  assert.equal(fake.raw('se-test').has('dev|owner'), false, 'one transaction: the key did not land without its log');
  failing = false;
  assert.equal((await ks.migrate('owner', legacyFrom(ls))).envelopes, 1);
  assert.equal(ls.size, 0);
  // a crash between the commit and the delete: the plaintext is back — the re-run deletes it, copies nothing twice
  ls.set(LEGACY.priv, hex);
  ls.set(LEGACY.env, env);
  const again = await ks.migrate('owner', legacyFrom(ls));
  assert.equal(again.moved, true);
  assert.equal(again.envelopes, 0);
  assert.equal(ls.size, 0);
  assert.equal((await ks.entries('owner')).items.length, 1);
  // a key already here but its log lost: the log is moved in under the key that is here
  const { ks: k3 } = fresh();
  await k3.restore('owner', Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16))));
  const l3 = new Map([[LEGACY.priv, hex], [LEGACY.env, env]]);
  assert.equal((await k3.migrate('owner', legacyFrom(l3))).envelopes, 1);
  assert.equal(fakeIndexedDB && (await k3.stat('owner')).how, 'restored');
  // a different key already here: refused, nothing touched
  const { ks: k2 } = fresh();
  await k2.device('owner');
  const l2 = new Map([[LEGACY.priv, hex], [LEGACY.env, env]]);
  assert.deepEqual(await k2.migrate('owner', legacyFrom(l2)), { ok: false, reason: 'conflict' });
  assert.equal(l2.size, 2);
  // a plaintext copy that cannot be deleted is reported, and the next run deletes it
  const { ks: k4 } = fresh();
  const l4 = new Map([[LEGACY.priv, hex]]);
  const stuck = await k4.migrate('owner', { get: (k) => l4.get(k) ?? null, remove: () => { throw new Error('blocked'); } });
  assert.equal(stuck.ok, true);
  assert.equal(stuck.cleared, false);
  assert.equal((await k4.migrate('owner', legacyFrom(l4))).cleared, true);
  assert.equal(l4.size, 0);
});

test('migrate(): what the old page stored is read as leniently as it read it — and nothing that is not hex gets in', async () => {
  const old = await generate();
  const hex = await exportPriv(old);
  const good = toHex(utf8('{"op":{"k":"grant"}}'));
  const cases = [
    [null, 0], ['', 0], ['not json', 0], ['{"a":1}', 0], ['[]', 0],
    [JSON.stringify([good, 'zz', 12, null, 'abc', 'AB', 'ab'.repeat(MAX_BYTES + 1), 'ab'.repeat(MAX_BYTES)]), 2],
  ];
  for (const [env, n] of cases) {
    const { ks } = fresh();
    const ls = new Map([[LEGACY.priv, hex]]);
    if (env !== null) ls.set(LEGACY.env, env);
    const m = await ks.migrate('owner', legacyFrom(ls));
    assert.equal(m.envelopes, n, String(env).slice(0, 40));
    assert.equal(ls.size, 0);
  }
  // the old bound: only the newest LOG_MAX are kept
  const { ks: small } = fresh({ limits: { log: 2, pins: 0 } });
  const many = [1, 2, 3].map((i) => toHex(utf8('{"n":' + i + '}')));
  assert.equal((await small.migrate('owner', legacyFrom(new Map([[LEGACY.priv, hex], [LEGACY.env, JSON.stringify(many)]])))).envelopes, 2);
  assert.deepEqual((await small.entries('owner')).items.map((b) => new TextDecoder().decode(b)), ['{"n":2}', '{"n":3}']);
  // a legacy key that is not a PKCS#8 Ed25519 key: refused, left in place
  for (const bad of ['zz', hex.slice(2), hex + 'ab', hex.toUpperCase(), 42, hex.replace(/^30/, '31')]) {
    const { ks } = fresh();
    const ls = new Map([[LEGACY.priv, bad]]);
    assert.deepEqual(await ks.migrate('owner', legacyFrom(ls)), { ok: false, reason: 'legacy-key' }, String(bad).slice(0, 12));
    assert.equal(ls.size, 1);
  }
  const { ks } = fresh();
  assert.deepEqual(await ks.migrate('owner', { get: () => undefined, remove: () => {} }), { ok: true, moved: false });
});

test('clear() keeps the keys and drops the log; wipe() drops everything — the replica key with it (crypto-shredding)', async () => {
  const { fake, ks } = fresh();
  const me = (await ks.device('owner')).keys;
  await ks.append('owner', utf8('{"op":{"k":"grant"}}'));
  await ks.append('owner', utf8('one'));
  await ks.append('tab.keep', utf8('other device'));
  const aes = fake.raw('se-test').get('aes|owner');
  assert.deepEqual(await ks.clear('owner'), { ok: true });
  assert.equal((await ks.device('owner')).keys.pub, me.pub);
  assert.deepEqual((await ks.entries('owner')).items, []);
  assert.equal(fake.raw('se-test').get('aes|owner').type, aes.type);
  assert.deepEqual([...fake.raw('se-test').keys()].filter((k) => k.includes('owner')).sort(), ['aes|owner', 'dev|owner']);
  await ks.append('owner', utf8('two'));
  assert.deepEqual(await ks.wipe('owner'), { ok: true });
  assert.deepEqual([...fake.raw('se-test').keys()].filter((k) => k.includes('owner')), []);
  assert.deepEqual(await ks.keys('owner'), { ok: true, keys: null });
  assert.notEqual((await ks.device('owner')).keys.pub, me.pub);
  assert.deepEqual((await ks.entries('tab.keep')).items.map((b) => new TextDecoder().decode(b)), ['other device'], 'another device’s records are untouched');
});

test('sealRecord / openRecord: AES-GCM with the namespace bound in; total on junk', async () => {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const other = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const aad = utf8('se-log-v1|owner');
  const s = await sealRecord({ subtle, key, bytes: utf8('hello'), aad });
  assert.equal(s.ok, true);
  assert.equal(s.sealed.length, 12 + 5 + 16);
  assert.deepEqual(await openRecord({ subtle, key, sealed: s.sealed, aad }), { ok: true, bytes: utf8('hello') });
  assert.deepEqual(await openRecord({ subtle, key, sealed: s.sealed, aad: utf8('se-log-v1|tab.x') }), { ok: false, reason: 'open' });
  assert.deepEqual(await openRecord({ subtle, key: other, sealed: s.sealed, aad }), { ok: false, reason: 'open' });
  assert.deepEqual(await openRecord({ subtle, key, sealed: s.sealed }), { ok: false, reason: 'open' }, 'no aad is not this aad');
  // fresh IV every time: the same record seals differently
  const s2 = await sealRecord({ subtle, key, bytes: utf8('hello'), aad });
  assert.notDeepEqual([...s2.sealed], [...s.sealed]);
  // an empty record seals and opens; the shortest sealed form is IV + tag
  const e = await sealRecord({ subtle, key, bytes: new Uint8Array(0) });
  assert.equal(e.sealed.length, 28);
  assert.deepEqual(await openRecord({ subtle, key, sealed: e.sealed }), { ok: true, bytes: new Uint8Array(0) });
  assert.deepEqual(await openRecord({ subtle, key, sealed: e.sealed.slice(0, 27) }), { ok: false, reason: 'record' });
  assert.deepEqual(await openRecord({ subtle, key, sealed: s.sealed.slice(0, 30) }), { ok: false, reason: 'open' });
  // the bound is the gate's: a record no gate would admit is not sealed
  assert.equal((await sealRecord({ subtle, key, bytes: new Uint8Array(MAX_BYTES) })).ok, true);
  assert.deepEqual(await sealRecord({ subtle, key, bytes: new Uint8Array(MAX_BYTES + 1) }), { ok: false, reason: 'record' });
  // the injected random source
  const fixed = await sealRecord({ subtle, key, bytes: utf8('x'), random: (n) => new Uint8Array(n).fill(7) });
  assert.deepEqual([...fixed.sealed.slice(0, 12)], new Array(12).fill(7));
  assert.deepEqual(await sealRecord({ subtle, key, bytes: utf8('x'), random: (n) => new Uint8Array(n - 1) }), { ok: false, reason: 'random' });
  assert.deepEqual(await sealRecord({ subtle, key, bytes: utf8('x'), random: () => [1, 2, 3] }), { ok: false, reason: 'random' });
  for (const [label, v] of hostileInputs()) {
    assert.equal((await sealRecord(v)).ok, false, label);
    assert.equal((await openRecord(v)).ok, false, label);
    assert.equal((await sealRecord({ subtle, key, bytes: v })).ok, false, label);
    assert.equal((await openRecord({ subtle, key, sealed: v })).ok, false, label);
    assert.equal((await sealRecord({ subtle, key: v, bytes: utf8('x') })).ok, false, label);
  }
});

test('total: no IndexedDB, a failing one, bad namespaces, junk arguments — refusals, never a throw', async () => {
  const none = createKeyStore({ subtle });
  for (const call of [(s) => s.device('owner'), (s) => s.keys('owner'), (s) => s.found('owner'), (s) => s.entries('owner'), (s) => s.append('owner', utf8('x'))]) {
    assert.deepEqual(await call(none), { ok: false, reason: 'no-store' });
  }
  assert.deepEqual(await createKeyStore({ idb: fakeIndexedDB() }).device('owner'), { ok: false, reason: 'no-store' });
  assert.deepEqual(await createKeyStore({ idb: {}, subtle }).device('owner'), { ok: false, reason: 'no-store' });
  // open fails: refused — and retried on the next call, so a passing hiccup is not permanent
  let failOpen = true;
  const flaky = fakeIndexedDB({ get failOpen() { return failOpen; } });
  const fs = mk(flaky);
  assert.deepEqual(await fs.device('owner'), { ok: false, reason: 'store' });
  failOpen = false;
  assert.equal((await fs.device('owner')).ok, true);
  // a crypto layer that refuses
  const broke = createKeyStore({ idb: fakeIndexedDB(), subtle: { generateKey: () => Promise.reject(new Error('no')) } });
  assert.deepEqual(await broke.device('owner'), { ok: false, reason: 'store' });
  // namespaces
  const { ks } = fresh();
  for (const ns of ['', 'a b', 'x'.repeat(81), 'ok|no', '../x', 7, null, undefined, {}]) {
    assert.deepEqual(await ks.device(ns), { ok: false, reason: 'ns' }, String(ns));
  }
  assert.equal((await ks.device('x'.repeat(80))).ok, true);
  assert.equal((await ks.device('join.0123abcd:tab-1_x')).ok, true);
  // the hostile battery in every position
  const methods = ['keys', 'device', 'found', 'restore', 'migrate', 'append', 'entries', 'stat', 'clear', 'wipe', 'touch'];
  for (const [label, v] of hostileInputs()) {
    for (const m of methods) {
      const a = await ks[m](v, v);
      assert.equal(a.ok, false, m + ' ← ' + label);
      const b = await ks[m]('owner', v);
      assert.equal(typeof b.ok, 'boolean', m + '(owner, ' + label + ')');
    }
    const s = createKeyStore(v);
    assert.equal((await s.device('owner')).ok, false, 'createKeyStore(' + label + ')');
  }
  const toxic = createKeyStore({ get idb() { throw new Error('boom'); } });
  assert.deepEqual(await toxic.device('owner'), { ok: false, reason: 'no-store' });
  assert.deepEqual(await mk(fakeIndexedDB(), { limits: { get log() { throw new Error('boom'); } } }).device('owner'), { ok: false, reason: 'no-store' });
  // the store still works after all of that
  assert.equal((await ks.device('owner')).ok, true);
  assert.deepEqual(await ks.close(), { ok: true });
  assert.deepEqual(await ks.close(), { ok: true });
  assert.equal((await ks.device('owner')).ok, true, 'a closed store reopens on the next call');
});

test('subject keys (D4): one non-extractable key per customer, the same on every reload; forget() erases it for good', async () => {
  const { fake, ks } = fresh();
  const a = await ks.subjectKey('owner', 'c-7');
  assert.equal(a.ok, true);
  assert.equal(a.fresh, true);
  await notExtractable(a.key);
  assert.deepEqual(a.key.algorithm, { name: 'AES-GCM', length: 256 });
  // the same key again — here, and from a second store over the same database (a reload)
  const b = await ks.subjectKey('owner', 'c-7');
  assert.equal(b.fresh, false);
  const again = await mk(fake).subjectKey('owner', 'c-7');
  assert.equal(again.ok, true);
  assert.equal(again.fresh, false);
  const sealed = await sealRecord({ subtle, key: a.key, bytes: bytesOf('jane@example.com'), aad: bytesOf('crm/c-7') });
  assert.equal(new TextDecoder().decode((await openRecord({ subtle, key: again.key, sealed: sealed.sealed, aad: bytesOf('crm/c-7') })).bytes), 'jane@example.com');
  // another subject, another key: one customer's key never opens another's details
  const other = await ks.subjectKey('owner', 'c-8');
  assert.equal(other.fresh, true);
  assert.deepEqual(await openRecord({ subtle, key: other.key, sealed: sealed.sealed, aad: bytesOf('crm/c-7') }), { ok: false, reason: 'open' });
  // namespaces keep devices apart: the same subject on another device namespace is a different key
  const elsewhere = await ks.subjectKey('tab.abc', 'c-7');
  assert.equal(elsewhere.fresh, true);
  assert.deepEqual(await openRecord({ subtle, key: elsewhere.key, sealed: sealed.sealed, aad: bytesOf('crm/c-7') }), { ok: false, reason: 'open' });
  // erase: the key is gone and never made again — the sealed copy stays dark
  assert.deepEqual(await ks.erased('owner', 'c-7'), { ok: true, erased: false });
  assert.deepEqual(await ks.forget('owner', 'c-7'), { ok: true });
  assert.deepEqual(await ks.erased('owner', 'c-7'), { ok: true, erased: true });
  assert.deepEqual(await ks.subjectKey('owner', 'c-7'), { ok: false, reason: 'erased' });
  assert.deepEqual(await mk(fake).subjectKey('owner', 'c-7'), { ok: false, reason: 'erased' }, 'after a reload too');
  assert.ok(![...fake.raw('se-test').keys()].includes('subj|owner|c-7'), 'the key itself is deleted, not just hidden');
  assert.equal((await ks.subjectKey('owner', 'c-8')).fresh, false, 'forgetting one customer leaves the others');
  assert.deepEqual(await ks.erased('owner', 'c-8'), { ok: true, erased: false });
  // forgetting a subject never asked for still leaves a tombstone: no key can be made for it later
  assert.deepEqual(await ks.forget('owner', 'c-9'), { ok: true });
  assert.deepEqual(await ks.subjectKey('owner', 'c-9'), { ok: false, reason: 'erased' });
});

test('subject keys: wipe() takes every one of a namespace’s subject keys with it; bad subjects and namespaces are refused', async () => {
  const { fake, ks } = fresh();
  await ks.device('owner');
  for (const x of ['c-1', 'c-2', 'p-owner']) assert.equal((await ks.subjectKey('owner', x)).ok, true);
  await ks.forget('owner', 'c-2');
  assert.equal((await ks.subjectKey('tab.keep', 'c-1')).ok, true);
  assert.deepEqual(await ks.wipe('owner'), { ok: true });
  const left = [...fake.raw('se-test').keys()];
  assert.deepEqual(left.filter((k) => k.includes('|owner')), [], 'nothing of the wiped device is left');
  assert.ok(left.includes('subj|tab.keep|c-1'), 'another device keeps its own');
  assert.equal((await ks.subjectKey('owner', 'c-1')).fresh, true, 'a wiped device starts again from nothing');
  for (const bad of ['', '-x', 'a b', 'a|b', 'x'.repeat(65), null, 7, undefined, {}]) {
    assert.deepEqual(await ks.subjectKey('owner', bad), { ok: false, reason: 'subject' }, String(bad));
    assert.deepEqual(await ks.forget('owner', bad), { ok: false, reason: 'subject' }, String(bad));
    assert.deepEqual(await ks.erased('owner', bad), { ok: false, reason: 'subject' }, String(bad));
  }
  assert.equal((await ks.subjectKey('owner', 'x'.repeat(64))).ok, true, 'exactly the longest name');
  assert.equal((await ks.subjectKey('owner', 'A.b_c-9')).ok, true);
  assert.equal((await ks.subjectKey('no such ns!', 'c-1')).reason, 'ns');
  assert.equal((await createKeyStore({ idb: null, subtle }).subjectKey('owner', 'c-1')).reason, 'no-store');
});

test('the business’s files at rest: sealed under the replica key, the same after a reload, replaced as a set, gone with clear and wipe', async () => {
  const { fake, ks } = fresh();
  assert.deepEqual(await ks.files('owner'), { ok: true, items: [], unreadable: 0 });
  const csv = (n) => bytesOf('case,outcome\n' + Array.from({ length: n }, (_, i) => i + ',' + (i % 2)).join('\n'));
  assert.deepEqual(await ks.keepFiles('owner', [{ name: 'cases.csv', bytes: csv(3) }, { name: 'decisions.csv', bytes: csv(5) }]), { ok: true, kept: 2 });
  const back = await mk(fake).files('owner');   // a reload: a second store over the same database
  assert.deepEqual(back.items.map((f) => [f.name, new TextDecoder().decode(f.bytes)]), [['cases.csv', new TextDecoder().decode(csv(3))], ['decisions.csv', new TextDecoder().decode(csv(5))]]);
  assert.equal(back.unreadable, 0);
  assert.ok(!onDisk(fake).some((b) => has(b, csv(3))), 'no plain copy of the business’s records on disk');
  // a file cannot be moved into another's slot: its slot and name are bound in
  const raw = fake.raw('se-test');
  const [a, b] = [raw.get('file|owner|0'), raw.get('file|owner|1')];
  raw.set('file|owner|0', b); raw.set('file|owner|1', a);
  assert.deepEqual(await ks.files('owner'), { ok: true, items: [], unreadable: 2 });
  raw.set('file|owner|0', a); raw.set('file|owner|1', b);
  raw.set('files|owner', ['renamed.csv', 'decisions.csv']);
  const renamed = await ks.files('owner');
  assert.deepEqual([renamed.items.map((f) => f.name), renamed.unreadable], [['decisions.csv'], 1]);
  // a new set replaces the old one; the slots it no longer uses are deleted
  assert.deepEqual(await ks.keepFiles('owner', [{ name: 'only.csv', bytes: csv(1) }]), { ok: true, kept: 1 });
  assert.deepEqual((await ks.files('owner')).items.map((f) => f.name), ['only.csv']);
  assert.ok(!raw.has('file|owner|1'), 'the second slot is gone');
  assert.deepEqual(await ks.keepFiles('owner', []), { ok: true, kept: 0 });
  assert.deepEqual(await ks.files('owner'), { ok: true, items: [], unreadable: 0 });
  assert.ok(![...raw.keys()].some((k) => k.startsWith('file')), 'keeping none deletes them all');
  // clear (the device joins another company) and wipe both take the files with the log
  for (const how of ['clear', 'wipe']) {
    await ks.keepFiles('owner', [{ name: 'x.csv', bytes: csv(2) }, { name: 'y.csv', bytes: csv(2) }]);
    await ks.keepFiles('tab.keep', [{ name: 'z.csv', bytes: csv(2) }]);
    assert.deepEqual(await ks[how]('owner'), { ok: true });
    assert.deepEqual(await ks.files('owner'), { ok: true, items: [], unreadable: 0 }, how);
    assert.ok(![...raw.keys()].some((k) => k.startsWith('file|owner') || k === 'files|owner'), how);
    assert.equal((await ks.files('tab.keep')).items.length, 1, how + ' leaves another device’s files');
  }
  // a missing replica key: the names are there, the files do not open
  await ks.keepFiles('tab.k2', [{ name: 'a.csv', bytes: csv(1) }]);
  raw.delete('aes|tab.k2');
  assert.deepEqual(await ks.files('tab.k2'), { ok: true, items: [], unreadable: 1 });
});

test('the business’s files: the bounds, and junk refused', async () => {
  const { ks } = fresh();
  const one = (name, bytes) => ({ name, bytes });
  const many = Array.from({ length: FILES_MAX }, (_, i) => one('f' + i + '.csv', bytesOf('a\n' + i)));
  assert.deepEqual(await ks.keepFiles('owner', many), { ok: true, kept: FILES_MAX }, 'exactly the most files');
  assert.equal((await ks.files('owner')).items.length, FILES_MAX);
  assert.deepEqual(await ks.keepFiles('owner', [...many, one('extra.csv', bytesOf('x'))]), { ok: false, reason: 'files' });
  assert.equal((await ks.files('owner')).items.length, FILES_MAX, 'a refused set leaves the kept one');
  const big = new Uint8Array(FILE_MAX);
  assert.deepEqual(await ks.keepFiles('owner', [one('big.csv', big)]), { ok: true, kept: 1 }, 'exactly the largest file');
  assert.equal((await ks.files('owner')).items[0].bytes.length, FILE_MAX);
  assert.deepEqual(await ks.keepFiles('owner', [one('bigger.csv', new Uint8Array(FILE_MAX + 1))]), { ok: false, reason: 'file' });
  assert.deepEqual(await ks.keepFiles('owner', [one('n'.repeat(80), bytesOf('x'))]), { ok: true, kept: 1 }, 'exactly the longest name');
  for (const bad of [one('', bytesOf('x')), one('n'.repeat(81), bytesOf('x')), one(7, bytesOf('x')), one('a.csv', 'text'), null, 'a.csv', {}])
    assert.deepEqual(await ks.keepFiles('owner', [bad]), { ok: false, reason: 'file' }, JSON.stringify(bad));
  for (const bad of ['x', null, undefined, {}, 7]) assert.deepEqual(await ks.keepFiles('owner', bad), { ok: false, reason: 'files' }, String(bad));
  assert.equal((await ks.keepFiles('no such ns!', [])).reason, 'ns');
  assert.equal((await createKeyStore({ idb: null, subtle }).files('owner')).reason, 'no-store');
  // the envelope lane keeps its own bound: a record past MAX_BYTES is still refused there
  assert.deepEqual(await ks.append('owner', new Uint8Array(MAX_BYTES + 1)), { ok: false, reason: 'record' });
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  assert.deepEqual(await sealRecord({ subtle, key, bytes: new Uint8Array(MAX_BYTES + 1) }), { ok: false, reason: 'record' }, 'sealRecord defaults to the envelope bound');
  assert.equal((await sealRecord({ subtle, key, bytes: new Uint8Array(MAX_BYTES + 1), max: MAX_BYTES + 1 })).ok, true);
});
