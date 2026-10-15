// audit.test.mjs — what an outsider can check, on the REAL spine: real devices (createNode), real Ed25519 keys (fromSeed),
// the runtime's own posting (co.postEntry: journal → vault leaf → tree head) and the Audit agent's own co-signature
// (co.witnessHead). Every byte that can be tampered with is, and each failure names its reason. Junk never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNode, pull, signEnvelope } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { canonical, utf8, toHex, fromHex } from '../src/canon.mjs';
import { sign } from '../src/keys.mjs';
import { GENESIS_PREV } from '../src/gate.mjs';
import { createCompany } from '../src/runtime.mjs';
import { toRecord, fromRecord, validPattern } from '../src/brain.mjs';
import * as A from '../src/audit.mjs';

const seed = (s) => sha256Bytes('sovereign-enterprise/audit-test/' + s);
const AT = '2026-10-14T12:00:00.000Z', AT2 = '2026-10-21T12:00:00.000Z';
const sale = (i, memo = 'Card sale ' + i) => ({ date: '2026-10-14', memo, lines: [['1200', 1000 + i, 0], ['4000', 0, 1000 + i]] });
const dec = new TextDecoder();
const envOf = (hex) => JSON.parse(dec.decode(fromHex(hex)));
const copy = (o) => JSON.parse(JSON.stringify(o));

/** A company: owner → Finance (journal, vault, tree heads), Audit (co-signatures), a clerk (tasks only). */
async function company(ownerSeed = 'owner', rewriteAt = -1) {
  const K = {};
  for (const id of ['finance', 'audit', 'clerk']) K[id] = await fromSeed(seed(id));
  K.owner = await fromSeed(seed(ownerSeed));
  const G = K.owner.pub;
  const mk = (id) => createNode({ keys: K[id], genesis: G, name: id });
  const owner = mk('owner'), fin = mk('finance'), au = mk('audit'), clerk = mk('clerk');
  await owner.grant('agent-finance', K.finance.pub, 'agent', ['journal', 'vault', 'vault_head']);
  await owner.grant('agent-audit', K.audit.pub, 'agent', ['vault_cosig']);
  await owner.grant('staff-clerk', K.clerk.pub, 'staff', ['tasks']);
  for (const n of [fin, au, clerk]) await pull(n, owner);
  const co = createCompany({}, { date: () => '2026-10-14' });
  const post = async (from, n) => { for (let i = from; i < from + n; i++) assert.equal((await co.postEntry(fin, sale(i, i === rewriteAt ? 'Refund ' + i : undefined))).ok, true); };
  const sync = async () => { await pull(au, fin); await pull(owner, fin); await pull(owner, au); };
  return { K, G, owner, fin, au, clerk, co, post, sync };
}

// ── fixtures: 12 entries, co-signed; then 20; a rewritten twin; a company with another owner but the same agents ────
const C = await company();
await C.post(0, 12);
await C.sync();
assert.equal((await C.co.witnessHead(C.au)).ok, true);
await C.sync();
const vs12 = A.vaultOf(C.owner);
const cp12 = (await A.checkpoint(vs12, C.K.owner, { at: AT })).bundle;
const proof3 = A.proofBundle(vs12, 3, cp12).bundle;
await C.post(12, 8);
await C.sync();
const vs20 = A.vaultOf(C.owner);
const cp20 = (await A.checkpoint(vs20, C.K.owner, { at: AT2 })).bundle;
const grew = A.consistencyBundle(cp12, vs20, cp20).bundle;
const R = await company('owner', 3);                   // the same keys, entry #3 rewritten
await R.post(0, 12);
await R.sync();
const cpR = (await A.checkpoint(A.vaultOf(R.owner), R.K.owner, { at: AT2 })).bundle;
const O = await company('owner-2');                    // another owner, the same Finance and Audit keys
await O.post(0, 12);
await O.sync();
const vsO = A.vaultOf(O.owner);
const cpO = (await A.checkpoint(vsO, O.K.owner, { at: AT2 })).bundle;
/** Re-sign a changed checkpoint with the owner's key, so only the change inside it is tested. */
async function resign(cp, keys = C.K.owner) {
  const { sig, ...body } = cp;
  return { ...body, sig: await sign(keys, utf8(canonical(body))) };
}
/** A signed write by `keys` that no device holds — for building forged or mislabelled contents. */
const loose = (keys, op, seq = 900) => signEnvelope(keys, { l: 77, ...op }, seq, 'ab'.repeat(32)).then(toHex);

// ── the vault as a device holds it ──────────────────────────────────────────────────────────────────────────────────
test('vaultOf: the sealed leaves, every prefix root, the signed head of every size, the co-signature, the journal', () => {
  assert.equal(vs12.ok, true);
  assert.equal(vs12.genesis, C.G);
  assert.equal(vs12.size, 12);
  assert.equal(vs12.leaves.length, 12);
  assert.equal(vs12.roots.length, 13);
  assert.deepEqual(vs12.heads.map((h) => h.size).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(vs12.heads.every((h) => h.from === C.K.finance.pub && h.root === vs12.roots[h.size]));
  assert.deepEqual(vs12.cosigs.map((c) => [c.size, c.from]), [[12, C.K.audit.pub]]);
  assert.equal(vs12.bad.length, 0);
  assert.equal(vs12.gaps + vs12.dupes, 0);
  assert.equal(vs12.journal.size, 12);
  assert.equal(vs12.entryAt.get(3), C.owner.list('vault').find((r) => r.index === 3).entry);
  assert.equal(vs20.size, 20);
});

test('vaultOf: a head for a leaf this device has not got yet is waited for, not called bad', async () => {
  const x = createNode({ keys: C.K.clerk, genesis: C.G, name: 'late' });
  for (const h of C.fin.hashes()) {
    const e = JSON.parse(dec.decode(C.fin.bytes(h)));
    if (e.op.c === 'vault' && e.op.f.index === 19) continue;           // the last leaf has not arrived
    await x.receive(C.fin.bytes(h));
  }
  for (const h of C.owner.hashes()) await x.receive(C.owner.bytes(h));
  // the owner holds the last leaf too — so take it back out by building from Finance's writes alone
  const y = createNode({ keys: C.K.clerk, genesis: C.G, name: 'late2' });
  for (const h of C.owner.hashes()) { const e = JSON.parse(dec.decode(C.owner.bytes(h))); if (!(e.op.c === 'vault' && e.op.f.index === 19)) await y.receive(C.owner.bytes(h)); }
  const v = A.vaultOf(y);
  assert.equal(v.size, 19);
  assert.equal(v.bad.length, 0);
  assert.equal(Math.max(...v.heads.map((h) => h.size)), 19);
  const cp = await A.checkpoint(v, C.K.clerk, { at: AT2 });
  assert.equal(cp.ok, true);
  assert.equal(cp.bundle.size, 19);
  assert.equal(A.vaultOf(x).size, 20);
});

test('vaultOf: writes from keys the role tree does not authorise are ignored; a deletion is not a head', async () => {
  const y = createNode({ keys: C.K.clerk, genesis: C.G, name: 'y' });
  for (const h of C.owner.hashes()) await y.receive(C.owner.bytes(h));
  // the clerk (tasks only) signs a matching head and a lying one; the role tree refuses both
  await y.receive(await signEnvelope(C.K.clerk, { k: 'put', c: 'vault_head', id: 'h000012', f: { size: 12, root: vs20.roots[12] }, l: 900 }, 1, GENESIS_PREV));
  await y.receive(fromHex(await loose(C.K.clerk, { k: 'put', c: 'vault_head', id: 'h000005', f: { size: 5, root: 'ab'.repeat(32) } }, 2)));
  // Finance signs a head for no entries at all, and one for a negative size: neither is a head of anything
  await y.receive(await signEnvelope(C.K.finance, { k: 'put', c: 'vault_head', id: 'h000000', f: { size: 0, root: 'ab'.repeat(32) }, l: 900 }, 9998, 'cd'.repeat(32)));
  await y.receive(await signEnvelope(C.K.finance, { k: 'put', c: 'vault_head', id: 'hneg', f: { size: -1, root: 'ab'.repeat(32) }, l: 900 }, 9997, 'cd'.repeat(32)));
  // Finance deletes a head record: a 'del' is not a tree head
  const tags = [C.K.finance.pub + '.3'];
  await y.receive(await signEnvelope(C.K.finance, { k: 'del', c: 'vault_head', id: 'h000001', tags, l: 900 }, 9999, 'cd'.repeat(32)));
  const v = A.vaultOf(y);
  assert.equal(v.ok, true);
  assert.equal(v.bad.length, 0);
  assert.equal(v.heads.length, 20);
  assert.ok(v.heads.every((h) => h.from === C.K.finance.pub));
});

test('vaultOf: a signed head or co-signature that contradicts the rebuilt books is bad — and no checkpoint is signed', async () => {
  for (const [keys, c] of [[C.K.finance, 'vault_head'], [C.K.audit, 'vault_cosig']]) {
    const y = createNode({ keys: C.K.clerk, genesis: C.G, name: 'y' });
    for (const h of C.owner.hashes()) await y.receive(C.owner.bytes(h));
    await y.receive(await signEnvelope(keys, { k: 'put', c, id: 'x5', f: { size: 5, root: vs20.roots[6], by: 'liar' }, l: 950 }, 9000, 'ef'.repeat(32)));
    const v = A.vaultOf(y);
    assert.equal(v.bad.length, 1, c);
    assert.equal(v.bad[0].size, 5);
    const t = A.treeHead(v);
    assert.equal(t.ok, false);
    assert.match(t.why, /do not audit/);
    assert.equal((await A.checkpoint(v, C.K.clerk, { at: AT })).ok, false);
  }
});

test('vaultOf: a journal entry edited after it was sealed keeps both signed writes; the proof uses the sealed one', async () => {
  const y = createNode({ keys: C.K.clerk, genesis: C.G, name: 'y' });
  for (const h of C.owner.hashes()) await y.receive(C.owner.bytes(h));
  const id = vs12.entryAt.get(2);
  await y.receive(await signEnvelope(C.K.finance, { k: 'put', c: 'journal', id, f: { memo: 'quietly edited' }, l: 990 }, 9001, 'aa'.repeat(32)));
  const v = A.vaultOf(y);
  assert.equal(v.journal.get(id).length, 2);
  assert.equal(y.list('journal').find((j) => j.id === id).memo, 'quietly edited');
  const p = A.proofBundle(v, 2, cp20);
  assert.equal(p.ok, true);
  assert.equal(p.bundle.entry.memo, 'Card sale 2');
  assert.equal((await A.verifyProofBundle(p.bundle)).ok, true);
});

test('vaultOf / treeHead refuse what they cannot read', () => {
  for (const junk of [null, undefined, {}, { auth: () => null }, 7, 'x']) assert.equal(A.vaultOf(junk).ok, false);
  assert.match(A.vaultOf(null).why, /could not read its vault/);
  for (const junk of [null, undefined, {}, { ok: false }, { ok: 'yes' }, { ok: true }]) assert.equal(A.treeHead(junk).ok, false);
  assert.match(A.treeHead({ ...vs12, ok: false }).why, /could not read its vault/);
  assert.match(A.treeHead({ ...vs12, gaps: 1 }).why, /incomplete/);
  assert.match(A.treeHead({ ...vs12, dupes: 1 }).why, /incomplete/);
  assert.match(A.treeHead({ ...vs12, heads: [] }).why, /nothing has been sealed/);
  assert.match(A.treeHead({ ...vs12, bad: [{}] }).why, /do not audit/);
});

test('treeHead: the largest signed size, every distinct head and co-signature for it, sorted; a log of one entry counts', () => {
  const t = A.treeHead(vs12);
  assert.deepEqual([t.ok, t.size, t.root, t.heads.length, t.cosigs.length], [true, 12, vs12.roots[12], 1, 1]);
  assert.equal(t.heads[0], vs12.heads.find((h) => h.size === 12).hex);
  const twice = A.treeHead({ ...vs12, heads: [...vs12.heads, ...vs12.heads], cosigs: [...vs12.cosigs, ...vs12.cosigs] });
  assert.deepEqual([twice.heads.length, twice.cosigs.length], [1, 1]);
  const one = A.treeHead({ ...vs12, heads: vs12.heads.filter((h) => h.size === 1), cosigs: [] });
  assert.deepEqual([one.ok, one.size, one.root, one.cosigs.length], [true, 1, vs12.roots[1], 0]);
  const fake = { ...vs12.heads[0], hex: 'ff', size: 12 };
  assert.deepEqual(A.treeHead({ ...vs12, heads: [...vs12.heads, fake] }).heads, [vs12.heads.find((h) => h.size === 12).hex, 'ff'].sort());
});

// ── checkpoints ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('checkpoint: signed by the sending device over the tree head, its signed writes and the time — byte-reproducible', async () => {
  assert.deepEqual(Object.keys(cp12).sort(), ['at', 'by', 'cosigs', 'genesis', 'heads', 'kind', 'root', 'sig', 'size', 'v']);
  assert.deepEqual([cp12.kind, cp12.v, cp12.genesis, cp12.size, cp12.root, cp12.at, cp12.by], ['se-checkpoint', 1, C.G, 12, vs12.roots[12], AT, C.K.owner.pub]);
  assert.equal(envOf(cp12.heads[0]).from, C.K.finance.pub);
  assert.equal(envOf(cp12.cosigs[0]).from, C.K.audit.pub);
  assert.deepEqual((await A.checkpoint(vs12, C.K.owner, { at: AT })).bundle, cp12);
  const now = await A.checkpoint(vs12, C.K.owner);
  assert.equal(now.ok, true);
  assert.ok(Math.abs(Date.parse(now.bundle.at) - Date.now()) < 60000);
  assert.equal((await A.checkpoint(vs12, C.K.owner, {})).ok, true);
});

test('checkpoint refuses: a bad date, no key, books that do not audit, a key that cannot sign', async () => {
  assert.match((await A.checkpoint(vs12, C.K.owner, { at: 'yesterday' })).why, /not a valid date/);
  assert.match((await A.checkpoint(vs12, C.K.owner, { at: 7 })).why, /not a valid date/);
  assert.match((await A.checkpoint(vs12, null, { at: AT })).why, /no device key/);
  assert.match((await A.checkpoint(vs12, { pub: 'x' }, { at: AT })).why, /no device key/);
  assert.match((await A.checkpoint({ ...vs12, gaps: 2 }, C.K.owner, { at: AT })).why, /incomplete/);
  assert.match((await A.checkpoint(vs12, { pub: C.K.owner.pub, priv: null }, { at: AT })).why, /could not be signed/);
});

test('verifyCheckpoint: a genuine checkpoint names the sequencer and the witness', async () => {
  const r = await A.verifyCheckpoint(cp12);
  assert.equal(r.ok, true);
  assert.deepEqual([r.genesis, r.size, r.root, r.at, r.by], [C.G, 12, cp12.root, AT, C.K.owner.pub]);
  assert.deepEqual(r.sequencers, [C.K.finance.pub]);
  assert.deepEqual(r.witnesses, [{ pub: C.K.audit.pub, name: 'audit' }]);
  assert.equal((await A.verifyCheckpoint(cp20)).witnesses.length, 0);
  assert.equal((await A.verifyCheckpoint(cp12, [C.K.finance.pub])).ok, true);
  assert.equal((await A.verifyCheckpoint(cp12, null)).ok, true);
  assert.equal((await A.verifyCheckpoint(cp12, ['junk', C.K.finance.pub])).ok, true);
});

test('verifyCheckpoint: change any byte and it fails, saying what failed', async () => {
  const why = async (cp, expected) => { const r = await A.verifyCheckpoint(cp, expected); assert.equal(r.ok, false); return r.why; };
  assert.match(await why({ ...cp12, at: AT2 }), /own signature does not match/);
  assert.match(await why({ ...cp12, size: 11 }), /own signature does not match/);
  assert.match(await why({ ...cp12, sig: '0'.repeat(128) }), /own signature does not match/);
  const flip = (hex) => hex.slice(0, 200) + (hex[200] === '0' ? '1' : '0') + hex.slice(201);
  assert.match(await why(await resign({ ...cp12, heads: [flip(cp12.heads[0])] })), /tree head inside the checkpoint is not a validly signed write/);
  assert.match(await why(await resign({ ...cp12, heads: [cp12.cosigs[0]] })), /not a tree head/);
  assert.match(await why(await resign({ ...cp12, heads: [vs12.journal.get(vs12.entryAt.get(0))[0].hex] })), /not a tree head/);
  assert.match(await why(await resign({ ...cp12, heads: [await loose(C.K.finance, { k: 'del', c: 'vault_head', id: 'h1', tags: [C.K.finance.pub + '.1'] })] })), /not a tree head/);
  const head11 = vs12.heads.find((h) => h.size === 11).hex;
  assert.match(await why(await resign({ ...cp12, heads: [head11] })), /different size or root/);           // size and root both differ
  for (const cosigs of [cp12.cosigs, []]) {
    assert.match(await why(await resign({ ...cp12, cosigs, size: 11 })), /a signed tree head says a different size or root/);       // only the size
    assert.match(await why(await resign({ ...cp12, cosigs, root: vs12.roots[11] })), /a signed tree head says a different size or root/);   // only the root
  }
  assert.match(await why(await resign({ ...cp12, cosigs: [flip(cp12.cosigs[0])] })), /co-signature inside the checkpoint is not a validly signed write/);
  assert.match(await why(await resign({ ...cp12, cosigs: [cp12.heads[0]] })), /not a co-signature/);
  assert.match(await why(await resign({ ...cp12, cosigs: [await loose(C.K.audit, { k: 'del', c: 'vault_cosig', id: 'c1', tags: [C.K.audit.pub + '.1'] })] })), /not a co-signature/);
  const cosRoot = await loose(C.K.audit, { k: 'put', c: 'vault_cosig', id: 'c12', f: { size: 12, root: vs12.roots[11], by: 'audit' } });
  const cosSize = await loose(C.K.audit, { k: 'put', c: 'vault_cosig', id: 'c12', f: { size: 11, root: vs12.roots[12], by: 'audit' } });
  assert.match(await why(await resign({ ...cp12, cosigs: [cosRoot] })), /co-signature is for a different size or root/);
  assert.match(await why(await resign({ ...cp12, cosigs: [cosSize] })), /co-signature is for a different size or root/);
  assert.match(await why(cp12, [C.K.clerk.pub]), /not in the checkpoint you hold/);
  assert.match(await why(cp12, 'not a list'), /keys to check against are malformed/);
  assert.match(await why(cp12, {}), /keys to check against are malformed/);
});

test('verifyCheckpoint: the form is exact — every field, every bound', async () => {
  const why = async (cp) => (await A.verifyCheckpoint(cp)).why;
  for (const junk of [null, undefined, 7, 'x', [], [cp12], { ...cp12, kind: 'se-proof' }]) assert.match(await why(junk), /not a signed checkpoint/);
  assert.match(await why({ ...cp12, v: 2 }), /not in the form/);
  assert.match(await why({ ...cp12, extra: 1 }), /not in the form/);
  const { at, ...noAt } = cp12;
  assert.match(await why(noAt), /not in the form/);
  for (const size of [0, -1, 1.5, '12', null]) assert.match(await why({ ...cp12, size }), /how many entries/);
  for (const k of ['root', 'genesis', 'by']) assert.match(await why({ ...cp12, [k]: 'AB'.repeat(32) }), /malformed — a root, a key or a signature/);
  assert.match(await why({ ...cp12, sig: 'ab' }), /malformed — a root, a key or a signature/);
  for (const at2 of ['2026-10-14', '2026-10-14T12:00:00', 7, '2026-10-14T12:00:00.0000Z']) assert.match(await why({ ...cp12, at: at2 }), /date is malformed/);
  for (const heads of [[], 'x', null]) assert.match(await why({ ...cp12, heads }), /no tree head signed by the company/);
  assert.match(await why({ ...cp12, heads: Array(17).fill(cp12.heads[0]) }), /no tree head signed by the company/);
  assert.equal((await A.verifyCheckpoint(await resign({ ...cp12, heads: Array(16).fill(cp12.heads[0]) }))).ok, true);
  for (const cosigs of ['x', null, Array(65).fill(cp12.cosigs[0])]) assert.match(await why({ ...cp12, cosigs }), /co-signatures are malformed/);
  assert.equal((await A.verifyCheckpoint(await resign({ ...cp12, cosigs: Array(64).fill(cp12.cosigs[0]) }))).ok, true);
  assert.match(await why({ ...cp12, heads: [1.5] }), /checker can read/);
  const one = (await A.checkpoint({ ...vs12, heads: vs12.heads.filter((h) => h.size === 1), cosigs: [] }, C.K.owner, { at: AT })).bundle;
  assert.equal((await A.verifyCheckpoint(one)).ok, true);
  assert.equal((await A.verifyCheckpoint(await resign({ ...cp12, heads: ['zz'] }))).ok, false);
  assert.equal((await A.verifyCheckpoint(await resign({ ...cp12, heads: ['ab'.repeat(4097)] }))).ok, false);
  assert.equal((await A.verifyCheckpoint(await resign({ ...cp12, heads: [7] }))).ok, false);
});

// ── one entry is in the books ───────────────────────────────────────────────────────────────────────────────────────
test('proofBundle → verifyProofBundle: the entry as sealed, its signed write, its path to the signed root', async () => {
  assert.deepEqual(Object.keys(proof3).sort(), ['checkpoint', 'entry', 'index', 'journal', 'kind', 'proof', 'v']);
  assert.deepEqual(proof3.entry, { id: vs12.entryAt.get(3), date: '2026-10-14', memo: 'Card sale 3', lines: '1200:1003:0|4000:0:1003' });
  const r = await A.verifyProofBundle(proof3);
  assert.equal(r.ok, true);
  assert.deepEqual([r.index, r.size, r.at, r.total], [3, 12, AT, 1003]);
  assert.deepEqual(r.lines, [{ code: '1200', name: 'Bank current account', debit: 1003, credit: 0 }, { code: '4000', name: 'Sales', debit: 0, credit: 1003 }]);
  assert.deepEqual(r.signed, cp12);
  for (const i of [0, 11]) assert.equal((await A.verifyProofBundle(A.proofBundle(vs12, i, cp12).bundle)).ok, true, 'entry ' + i);
  const old = A.proofBundle(vs20, 5, cp12);                     // an older checkpoint still proves its own entries
  assert.equal(old.ok, true);
  assert.equal(old.bundle.proof.length, proof3.proof.length);
  assert.equal((await A.verifyProofBundle(old.bundle)).ok, true);
  assert.equal((await A.verifyProofBundle(A.proofBundle(vs20, 19, cp20).bundle)).ok, true);
  assert.equal((await A.verifyProofBundle(proof3, [C.K.finance.pub])).ok, true);
});

test('proofBundle refuses what it cannot prove', () => {
  assert.match(A.proofBundle(null, 3, cp12).why, /could not read its vault/);
  assert.match(A.proofBundle({ ok: false }, 3, cp12).why, /could not read its vault/);
  for (const cp of [null, 'x', { ...cp12, kind: 'se-proof' }]) assert.match(A.proofBundle(vs12, 3, cp).why, /make a checkpoint first/);
  assert.match(A.proofBundle(vs12, 3, cpR).why, /not of the books on this device/);
  assert.match(A.proofBundle(vs12, 3, cp20).why, /not of the books on this device/);
  for (const i of [-1, 12, 1.5, '3', null]) assert.match(A.proofBundle(vs12, i, cp12).why, /there is no entry #.* it holds #0 to #11/);
  assert.match(A.proofBundle(vs20, 12, cp12).why, /no entry #12/);
  assert.match(A.proofBundle({ ...vs12, journal: new Map() }, 3, cp12).why, /not held on this device/);
  assert.match(A.proofBundle({ ...vs12, journal: null }, 3, cp12).why, /could not be made/);
});

test('verifyProofBundle: change the entry, its place, its proof, its signed write — it is not proven, and it says why', async () => {
  const why = async (b, expected) => { const r = await A.verifyProofBundle(b, expected); assert.equal(r.ok, false); return r.why; };
  assert.match(await why({ ...proof3, entry: { ...proof3.entry, memo: 'Card sale 3!' } }), /NOT proven/);
  assert.match(await why({ ...proof3, entry: { ...proof3.entry, lines: '1200:2003:0|4000:0:2003' } }), /NOT proven/);
  assert.match(await why({ ...proof3, index: 4 }), /NOT proven/);
  assert.match(await why({ ...proof3, proof: [proof3.proof[1], proof3.proof[0], ...proof3.proof.slice(2)] }), /NOT proven/);
  assert.match(await why({ ...proof3, proof: proof3.proof.slice(1) }), /NOT proven/);
  assert.match(await why({ ...proof3, proof: Array(64).fill(proof3.proof[0]) }), /NOT proven/);
  assert.match(await why({ ...proof3, proof: Array(65).fill(proof3.proof[0]) }), /inclusion proof is malformed/);
  assert.match(await why({ ...proof3, proof: 'x' }), /inclusion proof is malformed/);
  const flip = (hex) => hex.slice(0, 120) + (hex[120] === '0' ? '1' : '0') + hex.slice(121);
  assert.match(await why({ ...proof3, journal: flip(proof3.journal) }), /own signed write is missing or was changed/);
  assert.match(await why({ ...proof3, journal: '' }), /own signed write is missing or was changed/);
  const other = A.proofBundle(vs12, 4, cp12).bundle;
  assert.match(await why({ ...proof3, journal: other.journal }), /not this entry/);                                         // another id
  assert.match(await why({ ...proof3, journal: cp12.heads[0] }), /not this entry/);                                        // another collection
  const del = await loose(C.K.finance, { k: 'del', c: 'journal', id: proof3.entry.id, tags: [C.K.finance.pub + '.2'] });
  assert.match(await why({ ...proof3, journal: del }), /not this entry/);                                                    // not a put
  const edited = await loose(C.K.finance, { k: 'put', c: 'journal', id: proof3.entry.id, f: { date: '2026-10-14', memo: 'Card sale 3', lines: '1200:9:0|4000:0:9' } });
  assert.match(await why({ ...proof3, journal: edited }), /says something different/);
  const { id, ...f } = proof3.entry;
  const byOwner = await loose(C.K.owner, { k: 'put', c: 'journal', id, f });
  assert.match(await why({ ...proof3, journal: byOwner }), /different key from the one that signs the books/);
  assert.match(await why({ ...proof3, checkpoint: { ...cp12, at: AT2 } }), /checkpoint inside the proof does not verify: the checkpoint’s own signature/);
  assert.match(await why(proof3, [C.K.clerk.pub]), /checkpoint inside the proof does not verify: .*not in the checkpoint you hold/);
});

test('verifyProofBundle: the form is exact', async () => {
  const why = async (b) => (await A.verifyProofBundle(b)).why;
  for (const junk of [null, 7, 'x', [], { ...proof3, kind: 'se-checkpoint' }]) assert.match(await why(junk), /not a proof of an entry/);
  assert.match(await why({ ...proof3, v: 2 }), /not in the form/);
  assert.match(await why({ ...proof3, extra: 1 }), /not in the form/);
  for (const entry of [null, 'x', { ...proof3.entry, extra: '1' }, { ...proof3.entry, memo: 7 }, { ...proof3.entry, id: 1 }, { ...proof3.entry, date: null }, { ...proof3.entry, lines: [] }]) {
    assert.match(await why({ ...proof3, entry }), /not in the form the books seal/);
  }
  const { memo, ...noMemo } = proof3.entry;
  assert.match(await why({ ...proof3, entry: noMemo }), /not in the form the books seal/);
});

// ── the books only grew ─────────────────────────────────────────────────────────────────────────────────────────────
test('consistency: the books at 20 extend the checkpoint at 12 — proven with and without the auditor’s own copy', async () => {
  assert.deepEqual(Object.keys(grew).sort(), ['checkpoint', 'from', 'kind', 'proof', 'v']);
  assert.deepEqual(grew.from, { size: 12, root: cp12.root, at: AT });
  const held = await A.verifyConsistencyBundle(grew, cp12);
  assert.equal(held.ok, true);
  assert.deepEqual(held.from, { size: 12, root: cp12.root, at: AT, confirmed: true });
  assert.equal(held.checkpoint.size, 20);
  assert.deepEqual(held.signed, cp20);
  const alone = await A.verifyConsistencyBundle(grew);
  assert.deepEqual([alone.ok, alone.from.confirmed, alone.from.at], [true, false, AT]);
  const same = A.consistencyBundle(cp12, vs12, cp12);              // nothing new: an empty proof, still proven
  assert.equal(same.ok, true);
  assert.deepEqual(same.bundle.proof, []);
  assert.equal((await A.verifyConsistencyBundle(same.bundle, cp12)).ok, true);
  const one = (await A.checkpoint({ ...vs12, heads: vs12.heads.filter((h) => h.size === 1), cosigs: [] }, C.K.owner, { at: AT })).bundle;
  const fromOne = A.consistencyBundle(one, vs20, cp20);                 // from the very first entry
  assert.equal(fromOne.ok, true);
  assert.equal((await A.verifyConsistencyBundle(fromOne.bundle, one)).ok, true);
  const undated = A.consistencyBundle({ ...cp12, at: 'whenever' }, vs20, cp20);
  assert.equal(undated.bundle.from.at, '');
});

test('consistencyBundle refuses what is not a past state of these books', () => {
  assert.match(A.consistencyBundle(cp12, null, cp20).why, /could not read its vault/);
  for (const old of [null, 'x', { ...cp12, kind: 'se-proof' }, { ...cp12, size: 0 }, { ...cp12, size: '12' }]) assert.match(A.consistencyBundle(old, vs20, cp20).why, /not a checkpoint/);
  assert.match(A.consistencyBundle(cp12, vs20, cpR).why, /make a checkpoint of these books first/);
  assert.match(A.consistencyBundle(cp12, vs20, null).why, /make a checkpoint of these books first/);
  assert.match(A.consistencyBundle({ ...cp12, genesis: 'ab'.repeat(32) }, vs20, cp20).why, /different company/);
  assert.match(A.consistencyBundle(cp20, vs12, cp12).why, /newer than the books on this device/);
  assert.match(A.consistencyBundle({ ...cp12, size: 13, root: vs20.roots[13] }, vs20, cp12).why, /newer than the books on this device/);
  assert.match(A.consistencyBundle(cpR, vs20, cp20).why, /NOT a past state of these books/);
  assert.match(A.consistencyBundle({ ...cp12, size: 13 }, vs20, cp20).why, /NOT a past state/);
  assert.match(A.consistencyBundle(cp12, { ...vs20, leaves: null }, cp20).why, /could not be made/);
});

test('verifyConsistencyBundle: change the old root, the new books or the proof — not proven, and it says why', async () => {
  const why = async (b, held) => { const r = await A.verifyConsistencyBundle(b, held); assert.equal(r.ok, false); return r.why; };
  assert.match(await why({ ...grew, from: { ...grew.from, root: vs20.roots[11] } }), /did NOT only grow/);
  assert.match(await why({ ...grew, from: { ...grew.from, size: 11 } }), /did NOT only grow/);
  assert.match(await why({ ...grew, proof: grew.proof.slice(1) }), /did NOT only grow/);
  assert.match(await why({ ...grew, proof: [...grew.proof].reverse() }), /did NOT only grow/);
  assert.match(await why({ ...grew, proof: Array(64).fill(grew.proof[0]) }), /did NOT only grow/);
  assert.match(await why({ ...grew, proof: Array(65).fill(grew.proof[0]) }), /consistency proof is malformed/);
  assert.match(await why({ ...grew, proof: null }), /consistency proof is malformed/);
  assert.match(await why({ ...grew, checkpoint: cpR }), /did NOT only grow/);
  assert.match(await why({ ...grew, checkpoint: { ...cp20, at: AT } }), /new checkpoint does not verify: the checkpoint’s own signature/);
  assert.match(await why(grew, cpR), /different checkpoint from the one you hold/);
  assert.match(await why(grew, cp20), /different checkpoint from the one you hold/);
  assert.match(await why(grew, { ...cp12, at: AT2 }), /checkpoint you hold does not verify/);
  assert.match(await why(grew, null), /checkpoint you hold does not verify/);
  // another owner whose books carry the same agents' keys and the same entries: same roots, a different company
  assert.equal(cpO.root, cp12.root);
  const fromO = A.consistencyBundle({ ...cp12, genesis: O.G }, vsO, cpO).bundle;
  assert.match(await why(fromO, cp12), /different company from the one you hold/);
});

test('verifyConsistencyBundle: the form is exact', async () => {
  const why = async (b) => (await A.verifyConsistencyBundle(b)).why;
  for (const junk of [null, 7, 'x', { ...grew, kind: 'se-proof' }]) assert.match(await why(junk), /not a proof that the books only grew/);
  assert.match(await why({ ...grew, v: 2 }), /not in the form/);
  assert.match(await why({ ...grew, extra: 1 }), /not in the form/);
  for (const from of [null, 'x', { ...grew.from, extra: 1 }, { ...grew.from, size: '12' }, { ...grew.from, root: 'x' }, { ...grew.from, at: null }]) {
    assert.match(await why({ ...grew, from }), /does not say which checkpoint it starts from/);
  }
});

// ── the verdict an auditor reads ────────────────────────────────────────────────────────────────────────────────────
const J = (o) => JSON.stringify(o, null, 1);
test('judge: a checkpoint alone, against the same, against an older and a newer one — and a rewrite caught', async () => {
  const alone = await A.judge(J(cp12));
  assert.deepEqual([alone.tone, alone.title, alone.kind], ['ok', 'A genuine signed checkpoint', 'checkpoint']);
  assert.deepEqual(alone.keep, cp12);
  assert.ok(alone.lines[0].includes('held 12 entries on 2026-10-14 12:00 UTC'));
  assert.ok(alone.lines.some((l) => l.includes('Co-signed by audit (key ' + C.K.audit.pub.slice(0, 16))));
  assert.ok(alone.lines.some((l) => l.includes('sequencer key ' + C.K.finance.pub.slice(0, 16))));
  assert.ok((await A.judge(cp20)).lines.some((l) => l.startsWith('Not co-signed yet')));
  const same = await A.judge(cp12, J(cp12));
  assert.deepEqual([same.tone, same.title, same.keep], ['ok', 'The same books as the checkpoint you hold', null]);
  const newer = await A.judge(cp20, cp12);
  assert.deepEqual([newer.tone, newer.title, newer.keep], ['warn', 'Newer than yours — not yet proven to extend it', null]);
  assert.ok(newer.lines.at(-1).includes('since yours (12 entries)'));
  const older = await A.judge(cp12, cp20);
  assert.deepEqual([older.tone, older.title], ['warn', 'Checkpoint older than the checkpoint you hold']);
  const rewrite = await A.judge(cpR, cp12);
  assert.deepEqual([rewrite.tone, rewrite.title, rewrite.kind], ['bad', 'Two different signed versions of the books', 'checkpoint']);
  assert.ok(rewrite.lines[1].includes('prove the company signed a rewrite'));
  const other = await A.judge(cpO, cp12);
  assert.deepEqual([other.tone, other.title], ['bad', 'A different company']);
  const forged = await A.judge({ ...cp12, at: AT2 });
  assert.deepEqual([forged.tone, forged.title], ['bad', 'This checkpoint does not verify']);
  assert.match(forged.lines[0], /own signature does not match/);
});

test('judge: an entry proven, against what you hold; a changed entry refused', async () => {
  const p = await A.judge(J(proof3));
  assert.deepEqual([p.tone, p.title, p.kind], ['ok', 'This entry is in the books', 'proof']);
  assert.equal(p.lines[0], '“Card sale 3” · 2026-10-14 · £10.03 debited and credited — entry #3 of the 12 in the books signed on 2026-10-14 12:00 UTC.');
  assert.equal(p.lines[1], '1200 Bank current account: debit £10.03');
  assert.equal(p.lines[2], '4000 Sales: credit £10.03');
  assert.deepEqual(p.keep, cp12);
  const held = await A.judge(proof3, cp12);
  assert.equal(held.lines.at(-1), 'Proven against the very checkpoint you hold.');
  assert.equal(held.keep, null);
  const p20 = A.proofBundle(vs20, 3, cp20).bundle;
  const newer = await A.judge(p20, cp12);
  assert.equal(newer.tone, 'ok');
  assert.ok(newer.lines.at(-1).startsWith('Your checkpoint holds 12 entries'));
  assert.deepEqual([(await A.judge(proof3, cp20)).tone], ['warn']);
  const rw = await A.judge(proof3, cpR);
  assert.deepEqual([rw.tone, rw.title, rw.kind], ['bad', 'Two different signed versions of the books', 'proof']);
  const bad = await A.judge({ ...proof3, entry: { ...proof3.entry, memo: 'Cash sale 3' } });
  assert.deepEqual([bad.tone, bad.title], ['bad', 'This entry is not proven']);
  assert.match(bad.lines[0], /NOT proven/);
  assert.ok(bad.lines[0].startsWith('This entry is NOT proven') && bad.lines[0].endsWith('was changed.'), 'a refusal reads as a sentence');
});

test('judge: the books only grew — confirmed with your copy; unconfirmed without; refused when they did not', async () => {
  const ok = await A.judge(J(grew), J(cp12));
  assert.deepEqual([ok.tone, ok.title, ok.kind], ['ok', 'The books only grew since 2026-10-14 12:00 UTC', 'consistency']);
  assert.equal(ok.lines[0], 'Then: 12 entries. Now: 20 entries, signed on 2026-10-21 12:00 UTC.');
  assert.deepEqual(ok.keep, cp20);
  const alone = await A.judge(grew);
  assert.deepEqual([alone.tone, alone.keep], ['warn', null]);
  assert.ok(alone.lines.at(-1).startsWith('Drop your own copy'));
  const undated = await A.judge({ ...grew, from: { ...grew.from, at: '' } });
  assert.equal(undated.title, 'The books only grew since the checkpoint of 12 entries');
  const no = await A.judge(grew, cpR);
  assert.deepEqual([no.tone, no.title], ['bad', 'Not proven: the books may have been rewritten']);
  const held = await A.judge(grew, { ...cp12, size: 13 });
  assert.deepEqual([held.tone, held.title], ['bad', 'The checkpoint you hold does not verify']);
  assert.deepEqual([(await A.judge(grew, 'not json')).title], ['The checkpoint you hold does not verify']);
});

test('judge: files it does not check, and junk', async () => {
  for (const junk of [null, undefined, '', 'not json', '[1,2]', '7', 7, [], { kind: 'se-mystery' }]) {
    const v = await A.judge(junk);
    assert.equal(v.tone, 'bad');
    assert.match(v.title, /Not a file this checker reads/);
  }
  const ex = await A.judge({ kind: 'se-export', v: 1 });
  assert.deepEqual([ex.tone, ex.title, ex.kind], ['warn', 'A full company export', 'export']);
  assert.equal((await A.judge(cp12, '')).title, 'A genuine signed checkpoint');
  assert.equal((await A.judge(cp12, null)).title, 'A genuine signed checkpoint');
  // the size bound: a file of exactly the limit is read; one character more is not
  const text = J(cp12);
  const exact = text + ' '.repeat(A.MAX_FILE - text.length);
  assert.equal((await A.judge(exact)).title, 'A genuine signed checkpoint');
  assert.match((await A.judge(exact + ' ')).title, /Not a file this checker reads/);
  const toxic = { get kind() { throw new Error('boom'); } };
  assert.equal((await A.judge(toxic)).title, 'This file could not be checked');
});

// ── signed brain files ──────────────────────────────────────────────────────────────────────────────────────────────
const FRAUD = JSON.parse(readFileSync(new URL('../brains/fraud.slm.json', import.meta.url), 'utf8'));
const RESULT = { ok: true, verified: true, pattern: FRAUD, target: 'Class', positive: '1', rows: 2400,
  features: FRAUD.features.map((name, i) => ({ name, from: 'col ' + name, relevance: 0.5 - i / 100 })) };
const KEYS = await fromSeed(seed('brain-device'));
const fullBody = A.brainBody(RESULT, { label: 'card-payments.csv', at: AT }).body;
const bareBody = A.brainBody(RESULT, { label: 'card-payments.csv', at: AT, summary: false }).body;
const full = (await A.signBrain(fullBody, KEYS)).file;
const bare = (await A.signBrain(bareBody, KEYS)).file;
const resignBrain = async (f) => { const { sig, ...s } = f; return { ...s, sig: await sign(KEYS, utf8(canonical(s))) }; };

test('brain files: the pattern as it travels on the spine, where it came from, signed by the device — no self-asserted “verified”', async () => {
  assert.deepEqual(Object.keys(full).sort(), ['kind', 'pattern', 'provenance', 'sig', 'signedBy', 'v']);
  assert.deepEqual(full.pattern, toRecord(FRAUD));
  assert.equal(full.signedBy, KEYS.pub);
  assert.ok(!JSON.stringify(full).includes('"verified"'));
  assert.deepEqual(full.provenance, { app: 'Sovereign Enterprise', at: AT, grownOn: 'card-payments.csv', predicts: 'Class = 1', rows: 2400, summary: true,
    features: FRAUD.features.map((name, i) => ({ name, from: 'col ' + name, relevance: Math.round((0.5 - i / 100) * 1000) })) });
  const r = await A.verifyBrain(full);
  assert.equal(r.ok, true);
  assert.deepEqual([r.signedBy, r.summary, r.predicts, r.grownOn, r.at, r.rows, r.heldAuc, r.clears, r.rules], [KEYS.pub, true, 'Class = 1', 'card-payments.csv', AT, 2400, FRAUD.heldAuc, true, FRAUD.rules.length]);
  assert.deepEqual(r.pattern, fromRecord(toRecord(FRAUD)));
  assert.equal(validPattern(r.pattern), true);
  assert.deepEqual(r.features, FRAUD.features.map((name) => ({ name, from: 'col ' + name })));
  assert.ok(Math.abs(Date.parse(A.brainBody(RESULT).body.provenance.at) - Date.now()) < 60000);
  assert.equal(A.brainBody(RESULT, 'x').body.provenance.summary, true);
});

test('brain files: without the data summary — no quartiles of your data leave; a receiver rebuilds them from its own rows', async () => {
  assert.equal(bare.pattern.dist, '');
  assert.equal(bare.provenance.summary, false);
  assert.ok(!JSON.stringify(bare).includes(full.pattern.dist));
  const r = await A.verifyBrain(bare);
  assert.deepEqual([r.ok, r.summary, r.pattern.dist], [true, false, null]);
  assert.equal(validPattern(r.pattern), false, 'a brain without a summary cannot route until one is rebuilt');
  const rows = Array.from({ length: 60 }, (_, i) => Object.fromEntries(FRAUD.features.map((f, k) => [f, i * (k + 1)])));
  const w = A.withSummary(r.pattern, rows);
  assert.equal(w.ok, true);
  assert.equal(validPattern(w.pattern), true);
  const f0 = FRAUD.features[0];
  assert.deepEqual(w.pattern.dist[f0], { min: 0, q1: 14.75, med: 29.5, q3: 44.25, max: 59 });
  assert.match(A.withSummary(r.pattern, rows.slice(0, 49)).why, /too few values for .*at least 50/);
  assert.equal(A.withSummary(r.pattern, rows.slice(0, 50)).ok, true);
  assert.match(A.withSummary(r.pattern, rows.map((x) => ({ ...x, [f0]: 'n/a' }))).why, /too few values for/);
  assert.match(A.withSummary({ ...r.pattern, rules: [] }, rows).why, /malformed/);
  for (const [p, rs] of [[null, rows], [r.pattern, null], [{}, rows], [{ features: 'x' }, rows], [r.pattern, 'x']]) assert.match(A.withSummary(p, rs).why, /a brain and your own rows are needed/);
  assert.match(A.withSummary({ features: [f0] }, [{ get [f0]() { throw new Error('x'); } }]).why, /could not be rebuilt/);
});

test('brain files: change any byte, or lie about the summary — refused, with the reason', async () => {
  const why = async (f) => { const r = await A.verifyBrain(f); assert.equal(r.ok, false); return r.why; };
  assert.match(await why({ ...full, pattern: { ...full.pattern, threshold: '0.9' } }), /signature does not match/);
  assert.match(await why({ ...full, provenance: { ...full.provenance, rows: 9 } }), /signature does not match/);
  assert.match(await why({ ...full, signedBy: C.K.owner.pub }), /signature does not match/);
  assert.match(await why(await resignBrain({ ...full, pattern: { ...full.pattern, dist: '' } })), /says it carries a data summary and does not/);
  assert.match(await why(await resignBrain({ ...bare, provenance: { ...bare.provenance, summary: true } })), /says it carries a data summary and does not/);
  assert.match(await why(await resignBrain({ ...full, provenance: { ...full.provenance, summary: 'yes' } })), /malformed/);
  assert.match(await why(await resignBrain({ ...full, provenance: { ...full.provenance, rows: '2400' } })), /malformed/);
  const { title, ...noTitle } = full.pattern;
  assert.match(await why(await resignBrain({ ...full, pattern: noTitle })), /malformed/);
  const { app, ...noApp } = full.provenance;
  assert.match(await why(await resignBrain({ ...full, provenance: noApp })), /malformed/);
  assert.match(await why(await resignBrain({ ...full, pattern: 'x' })), /malformed/);
  assert.match(await why(await resignBrain({ ...full, provenance: null })), /malformed/);
  assert.match(await why(await resignBrain({ ...full, pattern: { ...full.pattern, rules: 'nonsense' } })), /brain inside the file is malformed/);
  for (const junk of [null, 7, 'x', { ...full, kind: 'se-checkpoint' }]) assert.match(await why(junk), /not a brain file/);
  for (const f of [{ ...full, v: 2 }, { ...full, extra: 1 }, { ...full, signedBy: 'x' }, { ...full, sig: 'ab' }]) assert.match(await why(f), /not in the form/);
  assert.match(await why({ ...full, provenance: { ...full.provenance, rows: 1.5 } }), /checker can read/);
});

test('brain files: what is refused before signing', async () => {
  assert.match(A.brainBody(null).why, /no verified brain/);
  assert.match(A.brainBody({ ...RESULT, ok: false }).why, /no verified brain/);
  assert.match(A.brainBody({ ...RESULT, pattern: { ...FRAUD, heldAuc: 0.55 } }).why, /no verified brain/);
  assert.equal(A.brainBody({ ...RESULT, pattern: { ...FRAUD, heldAuc: 0.6 } }).ok, true);
  assert.match(A.brainBody({ ...RESULT, pattern: { ...FRAUD, rules: [] } }).why, /no verified brain/);
  assert.match(A.brainBody(RESULT, { at: 'today' }).why, /not valid/);
  assert.equal(A.brainBody({ ...RESULT, rows: 1.5 }, { at: AT }).body.provenance.rows, 0);
  assert.match(A.brainBody({ ...RESULT, features: null }, { at: AT }).why, /could not be prepared/);
  assert.match((await A.signBrain(fullBody, null)).why, /nothing to sign/);
  assert.match((await A.signBrain({ ...fullBody, kind: 'x' }, KEYS)).why, /nothing to sign/);
  assert.match((await A.signBrain(null, KEYS)).why, /nothing to sign/);
  assert.match((await A.signBrain(fullBody, { pub: KEYS.pub, priv: null })).why, /could not be signed/);
});

test('judge: a brain file, with and without its summary', async () => {
  const v = await A.judge(J(full));
  assert.deepEqual([v.tone, v.title, v.kind, v.keep], ['ok', 'A signed brain file', 'brain', null]);
  assert.equal(v.lines[0], 'It predicts “Class = 1”, from ' + FRAUD.features.length + ' columns, with ' + FRAUD.rules.length + ' readable rules.');
  assert.ok(v.lines[1].includes('AUC ' + FRAUD.heldAuc.toFixed(3) + ' (clears the 0.6 gate).'));
  assert.ok(v.lines[3].startsWith('It carries a summary'));
  assert.ok((await A.judge(bare)).lines[3].startsWith('It was shared without the summary'));
  const low = await A.signBrain({ ...fullBody, pattern: { ...fullBody.pattern, heldAuc: '0.55' } }, KEYS);
  assert.ok((await A.judge(low.file)).lines[1].includes('(below the 0.6 gate).'));
  const bad = await A.judge({ ...full, sig: '0'.repeat(128) });
  assert.deepEqual([bad.tone, bad.title], ['bad', 'This brain file does not verify']);
});

// ── fuzz: every export, junk in every position — a refusal, never a throw ───────────────────────────────────────────
test('fuzz: no export throws on junk', async () => {
  const circular = {}; circular.self = circular;
  const toxic = { get ok() { throw new Error('boom'); }, get kind() { throw new Error('boom'); }, get size() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], true, 10n, () => 1, circular, toxic, { ok: true }, { kind: 'se-checkpoint' }];
  const fns = Object.entries(A).filter(([, v]) => typeof v === 'function');
  assert.deepEqual(fns.map(([k]) => k).sort(), ['brainBody', 'checkpoint', 'consistencyBundle', 'judge', 'proofBundle', 'signBrain', 'treeHead', 'vaultOf',
    'verifyBrain', 'verifyCheckpoint', 'verifyConsistencyBundle', 'verifyProofBundle', 'withSummary']);
  for (const [name, fn] of fns) for (const a of JUNK) for (const b of [undefined, null, a, vs12, cp12]) {
    let out;
    try { out = await fn(a, b, a); } catch (e) { assert.fail(name + ' threw on junk: ' + e.message); }
    assert.ok(out && typeof out === 'object', name);
    if (name !== 'judge') assert.equal(out.ok, false, name);
  }
});
