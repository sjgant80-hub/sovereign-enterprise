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
  assert.equal((await bob.del('tasks', 'nope')).reason, 'nothing-to-delete');
  await bob.eraseAt('docs', 'plan', 5, 1);
  assert.equal(bob.text('docs', 'plan'), 'hello');
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
