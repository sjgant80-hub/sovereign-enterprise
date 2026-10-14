import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, pull, SKEW } from '../src/node.mjs';
import { fromSeed, sign, generate, exportPriv, importPriv } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { canonical, utf8 } from '../src/canon.mjs';

const keysFor = async (n) => { const k = []; for (let i = 0; i < n; i++) k.push(await fromSeed(sha256Bytes('node-test/' + i))); return k; };

async function company() {
  const k = await keysFor(4);
  const G = k[0].pub;
  const owner = createNode({ keys: k[0], genesis: G, name: 'owner' });
  const ann = createNode({ keys: k[1], genesis: G, name: 'ann' });
  const bob = createNode({ keys: k[2], genesis: G, name: 'bob' });
  const eve = createNode({ keys: k[3], genesis: G, name: 'eve' });
  await owner.grant('g-ann', k[1].pub, 'admin', ['*']);
  await pull(ann, owner);
  await ann.grant('g-bob', k[2].pub, 'staff', ['tasks', 'docs']);
  await pull(bob, ann);
  return { k, owner, ann, bob, eve };
}

test('a device refuses to sign what it is not authorised for', async () => {
  const { bob, eve } = await company();
  assert.equal(bob.canWrite('tasks'), true);
  assert.equal(bob.canWrite('crm'), false);
  assert.equal(bob.canWrite(null), false);
  assert.equal((await bob.put('crm', 'c', { n: 1 })).reason, 'not-authorised');
  assert.equal((await bob.grant('g', 'a'.repeat(64), 'staff', ['*'])).reason, 'not-authorised');
  assert.equal((await eve.put('tasks', 't', { title: 'x' })).reason, 'not-authorised');
  assert.equal(eve.size(), 0);
});

test('emit → gate → store: lamport and seq advance; replay rejected', async () => {
  const { ann } = await company();
  const before = ann.clock();
  const r = await ann.put('tasks', 't1', { title: 'ship' });
  assert.equal(r.ok, true);
  assert.equal(r.env.op.l, before + 1);
  assert.equal((await ann.receive(r.bytes)).reason, 'replay');
  assert.deepEqual(ann.list('tasks'), [{ id: 't1', title: 'ship' }]);
});

test('three devices converge after concurrent work; delete and text merge', async () => {
  const { owner, ann, bob } = await company();
  await ann.put('tasks', 't1', { title: 'a' });
  await bob.put('tasks', 't2', { title: 'b' });
  await ann.typeAt('docs', 'plan', 0, 'hllo');
  await pull(bob, ann);
  await bob.typeAt('docs', 'plan', 1, 'e');
  await ann.typeAt('docs', 'plan', 4, '!');
  await ann.del('tasks', 't1');
  for (let i = 0; i < 2; i++) for (const a of [owner, ann, bob]) for (const b of [owner, ann, bob]) if (a !== b) await pull(a, b);
  assert.equal(ann.digest(), bob.digest());
  assert.equal(owner.digest(), bob.digest());
  assert.equal(bob.text('docs', 'plan'), 'hello!');
  assert.deepEqual(bob.list('tasks'), [{ id: 't2', title: 'b' }]);
  assert.equal(ann.fingerprint(), bob.fingerprint());               // same envelope set, reached in different orders
  const d0 = bob.digest();
  assert.equal(bob.digest(), d0);                                    // cached until the set changes
  await bob.put('tasks', 't3', { title: 'c' });
  assert.notEqual(bob.digest(), d0);
  assert.notEqual(ann.fingerprint(), bob.fingerprint());
  await pull(ann, bob);
  assert.equal(ann.fingerprint(), bob.fingerprint());
  assert.equal(ann.digest(), bob.digest());
  assert.equal(createNode({ keys: (await keysFor(1))[0], genesis: owner.pub }).fingerprint(), '0'.repeat(64));
  assert.equal((await bob.del('tasks', 'nope')).reason, 'nothing-to-delete');
  await bob.eraseAt('docs', 'plan', 5, 1);
  assert.equal(bob.text('docs', 'plan'), 'hello');
});

test('the cached role tree always equals a from-scratch replay — through grants, revokes and an equivocating admin', async () => {
  const { k, owner, ann, bob } = await company();
  const twinOf = async (n, keys) => { const t = createNode({ keys, genesis: k[0].pub }); await t.take(n.give(n.have())); return t; };
  const same = async (n, keys, cols) => { const t = await twinOf(n, keys); for (const c of cols) assert.equal(n.canWrite(c), t.canWrite(c), c); };
  const COLS = ['tasks', 'docs', 'crm', null];
  await same(bob, k[2], COLS);
  for (let i = 0; i < 5; i++) await bob.put('tasks', 't' + i, { title: 'x' + i });   // data ops leave the cached tree in place
  await same(bob, k[2], COLS);
  await ann.revoke('g-bob', 3);                                                         // revoke: the tree must refresh
  await pull(bob, ann);
  assert.equal(bob.canWrite('tasks'), false);
  await same(bob, k[2], COLS);
  // ann equivocates: a grant and a put signed for ONE (writer, seq) slot. dedupe keeps the lowest hash — so the put can
  // displace the grant, and a device that cached the tree with the grant in it must notice the collision.
  const scratch = createNode({ keys: k[3], genesis: k[0].pub });
  const env = async (op, s) => { const body = { from: k[1].pub, op: { ...op, l: 900 }, seq: s, v: 1 }; const bytes = utf8(canonical({ ...body, sig: await sign(k[1], utf8(canonical(body))) })); return { bytes, hash: (await scratch.receive(bytes)).hash }; };
  const slot = 50;
  const A = await env({ k: 'grant', id: 'g-eq', to: k[3].pub, role: 'staff', cols: ['crm'] }, slot);
  let B = null;
  for (let v = 0; v < 64 && !B; v++) { const b = await env({ k: 'put', c: 'tasks', id: 'eq', f: { title: 'v' + v } }, slot); if (b.hash < A.hash) B = b; }
  assert.ok(B, 'found a put that out-ranks the grant in its slot');
  const eve = createNode({ keys: k[3], genesis: k[0].pub });
  await pull(eve, owner);
  await pull(eve, ann);
  await eve.receive(A.bytes);
  assert.equal(eve.canWrite('crm'), true);                                              // cached with the grant live
  await eve.receive(B.bytes);
  assert.equal(eve.canWrite('crm'), false);                                             // the collision dropped the grant
  await same(eve, k[3], COLS);
  assert.deepEqual(eve.view().report.equivocators, [k[1].pub]);
});

test('the incrementally-folded company equals a full rebuild, after every single write — data, deletes, text, grants, revokes, strangers', async () => {
  const { k, owner, ann, bob } = await company();
  const watcher = createNode({ keys: k[3], genesis: k[0].pub });
  const check = async () => {
    const fresh = createNode({ keys: k[3], genesis: k[0].pub });
    await fresh.take(watcher.give(watcher.have()));
    assert.equal(watcher.digest(), fresh.digest());
    assert.deepEqual(watcher.view().report, fresh.view().report);
  };
  const feed = async (from) => { for (const b of from.give(watcher.want(from.have()))) { await watcher.receive(b); watcher.view(); await check(); } };
  await feed(owner); await feed(ann); await feed(bob);
  await bob.put('tasks', 't1', { title: 'a', n: 1 });
  await ann.put('tasks', 't1', { title: 'b' });
  await bob.typeAt('docs', 'd', 0, 'hey');
  await pull(ann, bob);
  await ann.eraseAt('docs', 'd', 1, 1);
  await ann.del('tasks', 't1');
  await bob.put('crm', 'c', { n: 1 });                                        // refused by bob's own device: never signed
  const stranger = await fromSeed(sha256Bytes('stranger'));
  const sb = { from: stranger.pub, op: { k: 'put', c: 'tasks', id: 'x', f: { title: 'free money' }, l: 5 }, seq: 1, v: 1 };
  await watcher.receive(utf8(canonical({ ...sb, sig: await sign(stranger, utf8(canonical(sb))) })));   // signed, no grant
  watcher.view(); await check();
  assert.equal(watcher.view().report.unauthorized, 1);
  await feed(bob); await feed(ann);
  await ann.revoke('g-bob', 2);
  await bob.put('tasks', 't9', { title: 'after the cut' });                 // bob's device has not heard yet
  await feed(bob); await feed(ann);
  assert.equal(watcher.list('tasks').some((t) => t.id === 't9'), false);    // the revoke reached back and cut it
});

test('a fresh device fed the same bytes rebuilds the identical company (persistence = replay through the gate)', async () => {
  const { k, ann, bob } = await company();
  await ann.put('tasks', 't', { title: 'x' });
  await pull(bob, ann);
  const twin = createNode({ keys: k[2], genesis: k[0].pub });
  await twin.take(bob.give(bob.have()));
  assert.equal(twin.digest(), bob.digest());
  const r = await twin.put('tasks', 'u', { title: 'y' });       // resumes its own seq past what it replayed
  assert.equal(r.ok, true);
  assert.ok(r.env.seq > Math.max(...bob.hashes().map((h) => JSON.parse(new TextDecoder().decode(bob.bytes(h)))).filter((e) => e.from === k[2].pub).map((e) => e.seq), 0));
});

test('a hostile clock can move a device forward by at most SKEW per envelope', async () => {
  const { k, ann } = await company();
  const body = { from: k[0].pub, op: { k: 'put', c: 'tasks', id: 'far', f: { title: 'x' }, l: 2 ** 47 }, seq: 50, v: 1 };
  const bytes = utf8(canonical({ ...body, sig: await sign(k[0], utf8(canonical(body))) }));
  const before = ann.clock();
  assert.equal((await ann.receive(bytes)).ok, true);
  assert.equal(ann.clock(), before + SKEW);
});

test('onChange fires on admit; a throwing listener never breaks the node', async () => {
  const { ann } = await company();
  let n = 0;
  const off = ann.onChange(() => { n++; });
  ann.onChange(() => { throw new Error('boom'); });
  await ann.put('tasks', 't', { title: 'x' });
  assert.equal(n, 1);
  off();
  await ann.put('tasks', 'u', { title: 'y' });
  assert.equal(n, 1);
});

test('identity persists: export → import gives the same public key', async () => {
  const k = await generate();
  const back = await importPriv(await exportPriv(k));
  assert.equal(back.pub, k.pub);
  assert.match(k.pub, /^[0-9a-f]{64}$/);
});
