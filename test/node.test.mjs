import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, pull, signEnvelope, SKEW } from '../src/node.mjs';
import { fromSeed, generate, exportPriv, importPriv } from '../src/keys.mjs';
import { sha256Bytes, sha256 } from '../src/sha256.mjs';
import { GENESIS_PREV } from '../src/gate.mjs';
import { prng } from '../src/sim.mjs';

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
  const env = async (op, s) => { const bytes = await signEnvelope(k[1], { ...op, l: 900 }, s, 'e'.repeat(64)); return { bytes, hash: (await scratch.receive(bytes)).hash }; };
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
  await watcher.receive(await signEnvelope(stranger, { k: 'put', c: 'tasks', id: 'x', f: { title: 'free money' }, l: 5 }, 1, GENESIS_PREV));   // signed, no grant
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
  const bytes = await signEnvelope(k[0], { k: 'put', c: 'tasks', id: 'far', f: { title: 'x' }, l: 2 ** 47 }, 50, 'e'.repeat(64));
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

// ───────────────────────── per-writer hash chains, end to end (real Ed25519) ─────────────────────────
const dec = new TextDecoder();
const envOf = (n, h) => JSON.parse(dec.decode(n.bytes(h)));
/** The envelopes a node holds from one writer, by seq (a fork shows up as two at one seq). */
const byWriter = (n, pub) => n.hashes().map((h) => ({ h, e: envOf(n, h) })).filter((x) => x.e.from === pub).sort((a, b) => a.e.seq - b.e.seq);
/** A thief holding `keys` signs op at (seq, prev) — ground until its hash is lower than `beat`, so lowest-hash alone would pick it. */
async function forgeLower(keys, seq, prev, beat, f = (v) => ({ k: 'put', c: 'tasks', id: 'pay', f: { status: 'released', v }, l: 3 })) {
  for (let v = 0; v < 200; v++) { const b = await signEnvelope(keys, f(v), seq, prev); if (sha256(b) < beat) return b; }
  throw new Error('no lower hash found');
}
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; } return a; };
const everything = (...ns) => { const m = new Map(); for (const n of ns) for (const h of n.hashes()) m.set(h, n.bytes(h)); return [...m.values()]; };

test('every write names the one before it: a device signs one contiguous chain from the genesis prev', async () => {
  const { k, ann } = await company();
  assert.deepEqual(ann.tip(), { seq: 1, hash: byWriter(ann, k[1].pub)[0].h });     // ann's grant of bob
  for (let i = 0; i < 6; i++) await ann.put('tasks', 't' + i, { title: 'x' + i });
  const mine = byWriter(ann, k[1].pub);
  assert.equal(mine.length, 7);
  mine.forEach((x, i) => {
    assert.equal(x.e.seq, i + 1);
    assert.equal(x.e.v, 2);
    assert.equal(x.e.prev, i ? mine[i - 1].h : GENESIS_PREV);
  });
  assert.deepEqual(ann.tip(), { seq: 7, hash: mine[6].h });
  const fresh = createNode({ keys: k[3], genesis: k[0].pub });
  assert.deepEqual(fresh.tip(), { seq: 0, hash: GENESIS_PREV });
});

test('writes fired at once are signed one at a time — a device never forks its own chain', async () => {
  const { k, bob } = await company();
  const rs = await Promise.all(Array.from({ length: 16 }, (_, i) => bob.put('tasks', 'c' + i, { title: 'n' + i })));
  assert.ok(rs.every((r) => r.ok));
  const mine = byWriter(bob, k[2].pub);
  assert.deepEqual(mine.map((x) => x.e.seq), Array.from({ length: 16 }, (_, i) => i + 1));
  mine.forEach((x, i) => assert.equal(x.e.prev, i ? mine[i - 1].h : GENESIS_PREV));
  assert.deepEqual(bob.view().report.equivocators, []);
  assert.equal(bob.list('tasks').length, 16);
});

test('a device replaying its own stored envelopes — in any order — resumes on its own chain head', async () => {
  const c = await company();
  const { k, owner, ann } = c;
  let bob = c.bob;
  for (let i = 0; i < 4; i++) await bob.put('tasks', 'b' + i, { title: 'x' });
  const rnd = prng(5);
  for (let i = 0; i < 4; i++) {
    const all = everything(owner, ann, bob);
    const twin = createNode({ keys: k[2], genesis: k[0].pub });
    for (const b of i ? shuffle(all, rnd) : all.slice().reverse()) await twin.receive(b);
    assert.deepEqual(twin.tip(), bob.tip());
    const r = await twin.put('tasks', 'after', { title: 'y' });
    assert.equal(r.env.seq, bob.tip().seq + 1);
    assert.equal(r.env.prev, bob.tip().hash);
    await bob.receive(r.bytes);
    assert.deepEqual(bob.view().report.forks, [], 'resuming never forks');
    const back = createNode({ keys: k[2], genesis: k[0].pub });
    for (const b of everything(bob)) await back.receive(b);
    bob = back;                                                                 // the next twin resumes after this write
  }
});

test('a write the gate refuses leaves no gap: seq, clock and chain head move only when it is admitted', async () => {
  const { ann } = await company();
  const before = ann.tip();
  const clock = ann.clock();
  const big = { a: 'x'.repeat(2000), b: 'y'.repeat(2000), c: 'z'.repeat(2000) };        // > MAX_BYTES once signed
  const r = await ann.put('tasks', 'huge', big);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'size');
  assert.deepEqual(ann.tip(), before);
  assert.equal(ann.clock(), clock);
  const ok = await ann.put('tasks', 'small', { title: 'fits' });
  assert.equal(ok.env.seq, before.seq + 1);
  assert.equal(ok.env.prev, before.hash);
  assert.equal(ok.env.op.l, clock + 1);
});

test('STOLEN KEY: a thief re-signs a slot the device already built on — every device keeps the real write, whatever the delivery order, and proves the fork', async () => {
  const { k, owner, ann, bob } = await company();
  await bob.put('tasks', 'pre', { title: 'before' });
  await bob.put('tasks', 'pay', { status: 'held' });                            // the slot the thief wants
  for (let i = 0; i < 5; i++) await bob.put('tasks', 'n' + i, { title: 'built on it ' + i });
  const mine = byWriter(bob, k[2].pub);
  const real = mine.find((x) => x.e.op.id === 'pay');
  const forged = await forgeLower(k[2], real.e.seq, real.e.prev, real.h);      // prev = the real k-1; lower hash than the real k
  const all = [...everything(owner, ann, bob), forged];
  const rnd = prng(17);
  const digests = new Set();
  for (let i = 0; i < 12; i++) {
    const d = createNode({ keys: k[3], genesis: k[0].pub });
    for (const b of shuffle(all, rnd)) await d.receive(b);
    assert.equal(d.list('tasks').find((t) => t.id === 'pay').status, 'held', 'order ' + i);
    const f = d.view().report.forks;
    assert.deepEqual(f, [{ writer: k[2].pub, seq: real.e.seq, rule: 'chain', kept: real.h, hashes: [real.h, sha256(forged)].sort(), next: [mine.find((x) => x.e.seq === real.e.seq + 1).h] }]);
    assert.deepEqual(d.view().report.equivocators, [k[2].pub]);
    digests.add(d.digest());
    if (i === 0) {
      const proofs = await d.forkProofs();
      assert.equal(proofs.length, 1);
      assert.equal(proofs[0].proven, true);
      assert.equal(proofs[0].links[0].parent, real.h);
    }
  }
  assert.equal(digests.size, 1, 'one company on every device');
  // the real device hears of the forgery and carries on — on its OWN chain, never the thief's
  await bob.receive(forged);
  const r = await bob.put('tasks', 'later', { title: 'still me' });
  assert.equal(r.ok, true);
  assert.equal(r.env.prev, mine[mine.length - 1].h);
  assert.equal(bob.list('tasks').find((t) => t.id === 'pay').status, 'held');
});

test('BURN: a thief who forges a CONTINUED history burns the key — every device cuts it there; the device stops signing', async () => {
  const { k, owner, ann, bob } = await company();
  for (let i = 0; i < 5; i++) await bob.put('tasks', 'w' + i, { title: 'real ' + i });
  const mine = byWriter(bob, k[2].pub);
  const at = mine[2];                                                            // bob's seq 3
  const f1 = await signEnvelope(k[2], { k: 'put', c: 'tasks', id: 'w2', f: { title: 'rewritten' }, l: 50 }, at.e.seq, at.e.prev);
  const f2 = await signEnvelope(k[2], { k: 'put', c: 'tasks', id: 'w3', f: { title: 'rewritten' }, l: 51 }, at.e.seq + 1, sha256(f1));
  const watcher = createNode({ keys: k[3], genesis: k[0].pub });
  for (const b of shuffle([...everything(owner, ann, bob), f1, f2], prng(3))) await watcher.receive(b);
  assert.deepEqual(watcher.view().report.burned, [{ writer: k[2].pub, from: at.e.seq }]);
  assert.deepEqual(watcher.list('tasks').map((t) => t.id), ['w0', 'w1']);       // before the cut stands; nobody's version after it
  assert.equal(watcher.list('tasks').some((t) => t.title === 'rewritten'), false);
  const proofs = await watcher.forkProofs();
  const burned = proofs.find((p) => p.rule === 'burned');
  assert.equal(burned.proven, true);
  assert.equal(burned.links.length, 2);
  assert.equal(watcher.forkedAt(), null);                                        // the watcher's own key is fine
  // the device itself learns its key is burned: it refuses to sign anything more
  assert.equal(bob.canWrite('tasks'), true);
  await bob.receive(f1);
  await bob.receive(f2);
  assert.equal(bob.canWrite('tasks'), false);                                    // asked of the role tree alone (no view built yet)
  assert.equal(bob.forkedAt(), at.e.seq);
  assert.equal(bob.canWrite('tasks'), false);                                    // and of the materialised view
  const r = await bob.put('tasks', 'w9', { title: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'key-forked');
  assert.equal((await ann.put('crm', 'c1', { n: 1 })).ok, true);                // nobody else is touched
});

test('the incremental fold equals a full rebuild when a chain FLIPS a slot\'s winner and when a key BURNS — after every single envelope', async () => {
  const { k, owner, ann, bob } = await company();
  for (let i = 0; i < 3; i++) await bob.put('tasks', 'w' + i, { title: 'real ' + i });
  const tipEnv = byWriter(bob, k[2].pub).pop();
  const forged = await forgeLower(k[2], tipEnv.e.seq, tipEnv.e.prev, tipEnv.h, (v) => ({ k: 'grant', id: 'g-thief' + v, to: k[3].pub, role: 'staff', cols: ['crm'], l: 40 }));
  const watcher = createNode({ keys: k[3], genesis: k[0].pub });
  const check = async (label) => {
    watcher.view();
    const fresh = createNode({ keys: k[3], genesis: k[0].pub });
    await fresh.take(watcher.give(watcher.have()));
    assert.equal(watcher.digest(), fresh.digest(), label);
    assert.deepEqual(watcher.view().report, fresh.view().report, label);
    for (const c of ['tasks', 'crm', null]) assert.equal(watcher.canWrite(c), fresh.canWrite(c), label + ' ' + c);
  };
  for (const b of everything(owner, ann, bob)) { await watcher.receive(b); await check('base'); }
  await watcher.receive(forged);
  await check('tip fork');
  // a fork at the tip goes to the lowest hash — the thief's grant (bob is staff, so it cannot grant: unauthorised either way)
  assert.equal(watcher.view().report.forks[0].kept, sha256(forged));
  assert.equal(watcher.list('tasks').some((t) => t.id === 'w2'), false);
  // the real device writes on top of its own tip: the winner flips on a FRESH slot's arrival — the cache must notice
  const next = await bob.put('tasks', 'w3', { title: 'real 3' });
  await watcher.receive(next.bytes);
  await check('chain decides');
  assert.equal(watcher.view().report.forks[0].rule, 'chain');
  assert.equal(watcher.list('tasks').some((t) => t.id === 'w2'), true);
  // the thief continues its forgery: the key burns — again on a fresh slot's arrival
  const cont = await signEnvelope(k[2], { k: 'put', c: 'tasks', id: 'w9', f: { title: 'thief' }, l: 60 }, tipEnv.e.seq + 1, sha256(forged));
  await watcher.receive(cont);
  await check('burned');
  assert.deepEqual(watcher.view().report.burned, [{ writer: k[2].pub, from: tipEnv.e.seq }]);
  // and a burned key's later writes on fresh slots fold in as unauthorised, exactly as a rebuild counts them
  const late = await signEnvelope(k[2], { k: 'put', c: 'tasks', id: 'w10', f: { title: 'late' }, l: 70 }, tipEnv.e.seq + 5, 'e'.repeat(64));
  await watcher.receive(late);
  await check('late write from a burned key');
});

test('a thief envelope for the very slot the device is signing — landing first — never becomes the device\'s chain head', async () => {
  const { k, bob } = await company();
  await bob.put('tasks', 'a', { title: 'one' });
  const t = bob.tip();
  const thief = await signEnvelope(k[2], { k: 'put', c: 'tasks', id: 'a', f: { title: 'thief' }, l: 30 }, t.seq + 1, t.hash);
  const mine = bob.put('tasks', 'b', { title: 'two' });          // signing starts now, naming the real head
  const stolen = await bob.receive(thief);                        // the thief's copy of that slot arrives mid-signature
  const r = await mine;
  assert.equal(stolen.ok, true);
  assert.equal(r.ok, true);
  assert.equal(r.env.seq, t.seq + 1);
  assert.deepEqual(bob.tip(), { seq: t.seq + 1, hash: r.hash });  // what the device signed is its head
  const next = await bob.put('tasks', 'c', { title: 'three' });
  assert.equal(next.env.prev, r.hash);
  assert.equal(bob.view().report.forks[0].kept, r.hash);          // and so its slot is the one the chain keeps
});
