// exportco.test.mjs — the company leaves with you, on the REAL spine: real devices, the owner's key made by the key store
// (non-extractable, src/store.mjs over an in-memory IndexedDB) with its recovery cards (src/recovery.mjs), the runtime's
// own posting. Export → the owner's device is lost → a new machine restores the owner from two cards, then the file →
// the very same company, its own earlier writes back, its hold released, its next write continuing its own history.
// Tamper with any part of the file and it is refused before a write is fed; a forged write inside a re-signed export is
// refused by the gate. A locked file opens only with its passphrase. The file never holds a key. Junk never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, pull, signEnvelope } from '../src/node.mjs';
import { fromSeed, sign } from '../src/keys.mjs';
import { sha256, sha256Bytes } from '../src/sha256.mjs';
import { canonical, utf8, toHex } from '../src/canon.mjs';
import { GENESIS_PREV } from '../src/gate.mjs';
import { createCompany } from '../src/runtime.mjs';
import { createKeyStore } from '../src/store.mjs';
import { split, combine } from '../src/recovery.mjs';
import { fakeIndexedDB } from './fake-idb.mjs';
import * as E from '../src/exportco.mjs';

const subtle = globalThis.crypto.subtle;
const seed = (s) => sha256Bytes('sovereign-enterprise/export-test/' + s);
const AT = '2026-10-14T12:00:00.000Z';
// the owner: founded in the key store — its key non-extractable, its seed split into three cards, any two of which restore it
const KS1 = createKeyStore({ idb: fakeIndexedDB(), subtle, name: 'machine-1' });
const founded = await KS1.found('owner');
const CARDS = split(founded.seed, { k: 2, n: 3 }).cards;
founded.seed.fill(0);
const K = { owner: founded.keys, finance: await fromSeed(seed('finance')), stranger: await fromSeed(seed('stranger')) };
const G = K.owner.pub;
const owner = createNode({ keys: K.owner, genesis: G, name: 'Owner' });
owner.onChange((r) => { KS1.append('owner', owner.bytes(r.hash)); });          // what the page does: every admitted write, sealed at rest
const fin = createNode({ keys: K.finance, genesis: G, name: 'Finance agent' });
await owner.grant('agent-finance', K.finance.pub, 'agent', ['journal', 'vault', 'vault_head']);
await pull(fin, owner);
const co = createCompany({}, { date: () => '2026-10-14' });
for (let i = 0; i < 4; i++) assert.equal((await co.postEntry(fin, { date: '2026-10-14', memo: i ? 'Card sale, order "' + i + '"' : 'Opening capital', lines: [['1200', 10000 * i + 5, 0], ['4000', 0, 10000 * i + 5]] })).ok, true);
await pull(owner, fin);
await owner.put('tasks', 't1', { title: '=HYPERLINK("http://evil")', status: 'todo', owner: 'Owner' });
await owner.put('tasks', 't2', { title: 'Restock line 4', status: 'done', owner: 'Ops agent', due: '2026-10-20' });
await owner.put('crm', 'c1', { name: 'Acme, Ltd', contact: '+44 113 000', stage: 'lead', value: 123456, owner: 'Owner' });
await owner.put('people', 'p-owner', { name: 'Owner', title: 'Director', kind: 'human', device: G.slice(0, 16), privateSealed: 'sealed:abc' });
await owner.typeAt('docs', 'policy', 0, 'Policy');
const file = (await E.exportCompany(owner, K.owner, { at: AT })).file;
const TEXT = JSON.stringify(file);
const OWN = owner.hashes().filter((h) => JSON.parse(new TextDecoder().decode(owner.bytes(h))).from === G).length;
const resignFile = async (f, keys = K.stranger) => { const { envelopes, sig, ...body } = f; return { ...body, envelopes, sig: await sign(keys, utf8(canonical(body))) }; };
const reason = async (f) => { const r = await E.restoreCompany(typeof f === 'string' ? f : JSON.stringify(f)); assert.equal(r.ok, false); return r.why; };

test('export: every signed write, sorted, under a manifest the device signs — and no key, of any kind', () => {
  assert.deepEqual(Object.keys(file).sort(), ['envelopes', 'kind', 'manifest', 'sig', 'v']);
  assert.deepEqual([file.kind, file.v], ['se-export', 1]);
  assert.deepEqual(file.manifest, { genesis: G, count: owner.size(), digest: E.setDigest(owner.hashes()), state: owner.digest(), at: AT, by: K.owner.pub });
  const hashes = owner.hashes().slice().sort();
  assert.deepEqual(file.envelopes, hashes.map((h) => toHex(owner.bytes(h))));
  assert.equal(E.setDigest(hashes), sha256(hashes.join('\n')));
  assert.equal(E.setDigest(['b', 'a']), sha256('a\nb'));
  assert.equal(K.owner.priv.extractable, false, 'the owner key cannot be exported by anything — so the file cannot carry it');
  assert.doesNotMatch(TEXT, /priv|pkcs8|seed|"key"|SE1 /i);
});

test('the owner’s device is lost: two recovery cards on a new machine, then the file — the same company, its hold released, its history continued', async () => {
  // a new machine: the owner's key comes back from two of the three cards, non-extractable, in a store of its own
  const KS2 = createKeyStore({ idb: fakeIndexedDB(), subtle, name: 'machine-2' });
  const c = combine([CARDS[2], CARDS[0]]);
  assert.equal(c.ok, true);
  const back = await KS2.restore('owner', c.secret);
  c.secret.fill(0);
  assert.equal(back.keys.pub, G);
  assert.equal(back.keys.priv.extractable, false);
  // the page's rule (index.html holdIfRestored / startReal): a restored owner signs nothing until its own earlier writes
  // are back — its next write must name its last one — and a write of its own key arriving releases the hold
  let catchingUp = true;
  const restored = createNode({ keys: back.keys, genesis: G, name: 'Owner (restored)' });
  const can = restored.canWrite;
  restored.canWrite = (col) => !catchingUp && can(col);
  const appended = [];
  restored.onChange((r) => { appended.push(KS2.append('owner', restored.bytes(r.hash))); if (r.env.from === restored.pub) catchingUp = false; });
  assert.equal((await restored.put('tasks', 'too-early', { title: 'x' })).reason, 'not-authorised', 'held: nothing signed before it has caught up');
  // the file: read, checked, fed through the gate
  const r = await E.restoreCompany(TEXT);
  assert.equal(r.ok, true);
  const progress = [];
  const f = await E.feed(restored, r.envelopes, (d, n) => progress.push([d, n]));
  assert.deepEqual(f, { restored: owner.size(), held: 0, refused: 0, reasons: {}, own: OWN });
  assert.ok(OWN > 0);
  assert.deepEqual(progress, [[owner.size(), owner.size()]]);
  assert.equal(catchingUp, false, 'the restore brought back the owner’s own writes: the hold is released, as a peer’s copy would');
  assert.equal(restored.digest(), r.manifest.state);
  assert.equal(restored.fingerprint(), owner.fingerprint());
  assert.deepEqual(restored.tip(), owner.tip());
  // persisted sealed in the new machine's store — every restored write, readable on the next start
  await Promise.all(appended);
  assert.equal((await KS2.stat('owner')).size, owner.size());
  const reread = await KS2.entries('owner');
  assert.deepEqual(reread.items.map((b) => sha256(b)).sort(), r.hashes.slice().sort());
  // its next write continues its own chain: a device that still holds the old history takes it without a fork
  const w = await restored.put('tasks', 't3', { title: 'after the restore' });
  assert.equal(w.ok, true);
  assert.deepEqual([w.env.seq, w.env.prev], [owner.tip().seq + 1, owner.tip().hash]);
  const witness = createNode({ keys: K.stranger, genesis: G, name: 'another device' });
  await pull(witness, owner);
  await pull(witness, restored);
  assert.deepEqual([witness.view().report.forks.length, witness.view().report.burned.length], [0, 0]);
  assert.ok(witness.list('tasks').some((t) => t.id === 't3'));
  // feeding the same file again changes nothing
  assert.deepEqual(await E.feed(restored, r.envelopes), { restored: 0, held: owner.size(), refused: 0, reasons: {}, own: 0 });
});

test('without the file (or a peer), a restored owner that wrote anyway would fork its own key — which is why it is held', async () => {
  const KS3 = createKeyStore({ idb: fakeIndexedDB(), subtle, name: 'machine-3' });
  const c = combine([CARDS[0], CARDS[1]]);
  const back = await KS3.restore('owner', c.secret);
  const blind = createNode({ keys: back.keys, genesis: G, name: 'Owner (blind)' });
  const w = await blind.put('tasks', 'tx', { title: 'written without its history' });
  assert.deepEqual([w.ok, w.env.seq, w.env.prev], [true, 1, GENESIS_PREV]);
  const witness = createNode({ keys: K.stranger, genesis: G, name: 'another device' });
  await pull(witness, owner);
  await pull(witness, blind);
  assert.equal(witness.view().report.forks.length, 1, 'two signed writes for the owner’s first slot');
});

test('restore into a device that already holds part of the company: only what is missing is added', async () => {
  const part = createNode({ keys: K.finance, genesis: G, name: 'Finance agent' });
  await pull(part, fin);
  const before = part.size();
  const f = await E.feed(part, (await E.restoreCompany(TEXT)).envelopes);
  assert.deepEqual([f.restored, f.held, f.refused, f.own], [owner.size() - before, before, 0, 0]);
  assert.equal(part.digest(), owner.digest());
});

test('feed: in batches of 256, telling progress; a broken progress view never stops it; junk is a fault, not a throw', async () => {
  const big = createNode({ keys: K.stranger, genesis: K.stranger.pub, name: 'big' });
  for (let i = 0; i < 300; i++) await big.put('tasks', 't' + i, { title: 'task ' + i });
  const ex = (await E.exportCompany(big, K.stranger, { at: AT })).file;
  const r = await E.restoreCompany(JSON.stringify(ex));
  const seen = [];
  const to = createNode({ keys: K.stranger, genesis: K.stranger.pub, name: 'to' });
  const f = await E.feed(to, r.envelopes, (d, n) => { seen.push(d + '/' + n); throw new Error('a view that breaks'); });
  assert.deepEqual(seen, ['256/300', '300/300']);
  assert.deepEqual([f.restored, f.own], [300, 300]);
  assert.equal(to.digest(), big.digest());
  assert.deepEqual(await E.feed(to, 'x'), { restored: 0, held: 0, refused: 0, reasons: {}, own: 0 });
  const none = [];
  assert.deepEqual(await E.feed(to, [], (d, n) => none.push([d, n])), { restored: 0, held: 0, refused: 0, reasons: {}, own: 0 });
  assert.deepEqual(none, [], 'nothing to restore: no progress to report');
  assert.deepEqual(await E.feed(null, [new Uint8Array(1)]), { restored: 0, held: 0, refused: 0, reasons: {}, own: 0, fault: true });
});

test('a forged write inside a re-signed export is restored by no one: the gate refuses it', async () => {
  const forged = await signEnvelope(K.stranger, { k: 'put', c: 'payments', id: 'p1', f: { status: 'released' }, l: 5 }, 1, GENESIS_PREV);
  // one changed character INSIDE the signature of a write by a seeded key (the Finance agent's): still hex, still the
  // gate's form, so the only thing it can fail is the signature check — the same refusal on every run
  const text = new TextDecoder().decode(fin.bytes(fin.tip().hash));
  const at = text.indexOf('"sig":"') + 7 + 20;
  const flipped = utf8(text.slice(0, at) + (text[at] === '0' ? '1' : '0') + text.slice(at + 1));
  assert.equal(flipped.length, fin.bytes(fin.tip().hash).length);
  const envs = [...file.envelopes, toHex(forged), toHex(flipped)];
  const hashes = envs.map((h) => sha256(Buffer.from(h, 'hex')));
  const evil = await resignFile({ ...file, envelopes: envs, manifest: { ...file.manifest, count: envs.length, digest: E.setDigest(hashes), by: K.stranger.pub } });
  const r = await E.restoreCompany(JSON.stringify(evil));
  assert.equal(r.ok, true, 'the file is intact — it is what the stranger signed');
  assert.equal(r.signedBy, K.stranger.pub);
  const to = createNode({ keys: K.finance, genesis: G, name: 'to' });
  const f = await E.feed(to, r.envelopes);
  assert.equal(f.restored, owner.size() + 1, 'the stranger’s write is stored like any peer’s — and never trusted: no grant');
  assert.equal(f.refused, 1);
  assert.deepEqual(f.reasons, { signature: 1 });
  assert.equal(to.list('payments').length, 0);
  assert.equal(to.view().report.unauthorized, 1);
});

test('restoreCompany: change any part of the file and it is refused before a single write is fed', async () => {
  assert.match(await reason({ ...file, envelopes: file.envelopes.slice(1) }), /manifest says \d+ writes but the file holds \d+/);
  assert.match(await reason(await resignFile({ ...file, envelopes: file.envelopes.slice(1), manifest: { ...file.manifest, count: file.envelopes.length - 1, by: K.stranger.pub } })), /do not match the manifest’s digest/);
  const flip = file.envelopes.slice();
  flip[2] = flip[2].slice(0, 50) + (flip[2][50] === '0' ? '1' : '0') + flip[2].slice(51);
  assert.match(await reason({ ...file, envelopes: flip }), /do not match the manifest’s digest/);
  assert.match(await reason({ ...file, manifest: { ...file.manifest, state: 'ab'.repeat(32) } }), /signature does not match/);
  assert.match(await reason({ ...file, manifest: { ...file.manifest, at: '2026-10-15T12:00:00.000Z' } }), /signature does not match/);
  assert.match(await reason({ ...file, sig: '0'.repeat(128) }), /signature does not match/);
  const twice = [...file.envelopes.slice(1), file.envelopes[1]];
  assert.match(await reason({ ...file, envelopes: twice }), /same write twice/);
  for (const bad of ['zz', '', 'abc', 7, null, 'ab'.repeat(4097)]) assert.match(await reason({ ...file, envelopes: [...file.envelopes.slice(1), bad] }), /a write in the export is malformed/);
  const atLimit = 'ab'.repeat(4096);
  assert.match(await reason({ ...file, envelopes: [...file.envelopes.slice(1), atLimit] }), /do not match the manifest’s digest/);
});

test('restoreCompany: the form is exact', async () => {
  assert.match(await reason(''), /empty/);
  for (const junk of [null, 7, {}]) assert.match((await E.restoreCompany(junk)).why, /empty/);
  assert.match(await reason('not json'), /not JSON/);
  for (const t of ['[]', '7', '"x"', 'null', JSON.stringify({ ...file, kind: 'se-checkpoint' })]) assert.match(await reason(t), /not a company export/);
  assert.match(await reason({ kind: 'se-export-locked' }), /locked — type its passphrase/);
  assert.match(await reason({ ...file, v: 2 }), /not in the form/);
  assert.match(await reason({ ...file, key: null }), /not in the form/);
  const { sig, ...noSig } = file;
  assert.match(await reason(noSig), /not in the form/);
  for (const manifest of [null, 'x', { ...file.manifest, extra: 1 }]) assert.match(await reason({ ...file, manifest }), /manifest is malformed/);
  const { at, ...noAt } = file.manifest;
  assert.match(await reason({ ...file, manifest: noAt }), /manifest is malformed/);
  for (const k of ['genesis', 'digest', 'state', 'by']) assert.match(await reason({ ...file, manifest: { ...file.manifest, [k]: 'x' } }), /manifest is malformed/);
  for (const a of [7, '2026-10-14']) assert.match(await reason({ ...file, manifest: { ...file.manifest, at: a } }), /manifest is malformed/);
  for (const s of [null, 'ab']) assert.match(await reason({ ...file, sig: s }), /not signed/);
  for (const envelopes of [null, 'x', {}]) assert.match(await reason({ ...file, envelopes }), /no list of writes/);
  for (const count of ['4', 1.5, null]) assert.match(await reason({ ...file, manifest: { ...file.manifest, count } }), /manifest says/);
});

test('restoreCompany: the bound on writes is exactly a million', async () => {
  const many = (n) => JSON.stringify({ ...file, envelopes: new Array(n).fill(''), manifest: { ...file.manifest, count: n } });
  assert.match(await reason(many(E.MAX_ENVELOPES + 1)), /no list of writes/);
  assert.match(await reason(many(E.MAX_ENVELOPES)), /signature does not match/);
});

// ── the file, locked under a passphrase ─────────────────────────────────────────────────────────────────────────────
const PASS = 'correct horse battery staple';
const SALT = '00112233445566778899aabbccddeeff', IV = '0102030405060708090a0b0c';
const locked = (await E.lockFile(TEXT, PASS, { iter: 100000, salt: SALT, iv: IV })).file;
const relock = (patch) => ({ ...locked, ...patch });

test('locked: the whole file sealed under a passphrase; only that passphrase opens it, and opens exactly what was locked', async () => {
  assert.deepEqual(Object.keys(locked).sort(), ['alg', 'data', 'iter', 'iv', 'kind', 'salt', 'v']);
  assert.deepEqual([locked.kind, locked.v, locked.alg, locked.iter, locked.salt, locked.iv], ['se-export-locked', 1, 'PBKDF2-SHA256/AES-GCM-256', 100000, SALT, IV]);
  const shown = JSON.stringify(locked);
  for (const s of [G, 'HYPERLINK', 'Acme', file.envelopes[0].slice(0, 40)]) assert.ok(!shown.includes(s), 'nothing of the company shows: ' + s.slice(0, 12));
  assert.deepEqual(await E.unlockFile(locked, PASS), { ok: true, text: TEXT });
  assert.match((await E.unlockFile(locked, PASS + '!')).why, /does not open this file/);
  const o = await E.openExport(JSON.stringify(locked), PASS);
  assert.deepEqual([o.ok, o.locked, o.genesis, o.envelopes.length], [true, true, G, owner.size()]);
  assert.deepEqual([(await E.openExport(JSON.stringify(locked), 'wrong passphrase')).locked, (await E.openExport(JSON.stringify(locked), 'wrong passphrase')).why], [true, 'that passphrase does not open this file (or the file was changed)']);
  assert.match((await E.openExport(JSON.stringify(locked))).why, /type the passphrase/);
  const plainOpen = await E.openExport(TEXT, 'ignored for a plain file');
  assert.deepEqual([plainOpen.ok, plainOpen.locked, plainOpen.envelopes.length], [true, false, owner.size()]);
  assert.match((await E.openExport('not json')).why, /not JSON/);
  // the header is bound in: change the rounds or the salt (and fix the shape) and it does not open
  assert.match((await E.unlockFile(relock({ iter: 100001 }), PASS)).why, /does not open/);
  assert.match((await E.unlockFile(relock({ salt: 'ff' + SALT.slice(2) }), PASS)).why, /does not open/);
  assert.match((await E.unlockFile(relock({ iv: 'ff' + IV.slice(2) }), PASS)).why, /does not open/);
  const flipped = locked.data.slice(0, 40) + (locked.data[40] === 'A' ? 'B' : 'A') + locked.data.slice(41);
  assert.match((await E.unlockFile(relock({ data: flipped }), PASS)).why, /does not open/);
  // a fresh salt and IV each time; the default rounds are 600,000
  const fresh = await E.lockFile(TEXT, PASS);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.file.iter, E.LOCK_ITER);
  assert.notEqual(fresh.file.salt, (await E.lockFile(TEXT, PASS, { iter: 100000 })).file.salt);
  // a large file goes through in pieces and comes back byte for byte
  const big = 'é€'.repeat(40000);
  const lb = await E.lockFile(big, PASS, { iter: 100000 });
  assert.equal((await E.unlockFile(lb.file, PASS)).text, big);
});

test('lockFile / unlockFile refuse what they cannot do safely', async () => {
  assert.match((await E.lockFile(TEXT, 'short')).why, /at least 10 characters/);
  assert.equal((await E.lockFile(TEXT, '0123456789', { iter: 100000 })).ok, true);
  assert.match((await E.lockFile(TEXT, '012345678', { iter: 100000 })).why, /at least 10/);
  assert.match((await E.lockFile(TEXT, 7)).why, /at least 10/);
  for (const t of [null, '', 7]) assert.match((await E.lockFile(t, PASS, { iter: 100000 })).why, /nothing to lock/);
  assert.equal((await E.lockFile('x', PASS, { iter: 100000 })).ok, true);
  for (const o of [{ iter: 99999 }, { iter: 10000001 }, { iter: 100000, salt: 'zz' }, { iter: 100000, iv: '00' }]) assert.match((await E.lockFile(TEXT, PASS, o)).why, /could not be locked with those settings/);
  assert.match((await E.lockFile(TEXT, PASS, { iter: 100000, salt: 'zz'.repeat(16) })).why, /could not be locked/);
  assert.match((await E.unlockFile(relock({ alg: 'x' }), PASS)).why, /malformed/);
  assert.match((await E.unlockFile(locked, '')).why, /type the passphrase/);
  assert.match((await E.unlockFile(locked, 7)).why, /type the passphrase/);
});

test('the locked file’s form is exact — every field, every bound', async () => {
  const shape = async (k) => (await E.unlockFile(k, PASS)).why !== 'the locked file is malformed';
  assert.equal(await shape(locked), true);
  for (const [k, v] of [['iter', 10000000], ['iter', 100000], ['data', 'A'.repeat(24)], ['data', 'AB+/'.repeat(6)], ['data', 'A'.repeat(22) + '==']]) assert.equal(await shape(relock({ [k]: v })), true, k + '=' + v);
  for (const [k, v] of [['kind', 'se-export'], ['v', 2], ['alg', 'AES'], ['iter', 99999], ['iter', 10000001], ['iter', 1.5], ['salt', SALT.slice(2)], ['salt', 7], ['iv', IV + '00'], ['iv', null],
    ['data', 'A'.repeat(20)], ['data', 'A'.repeat(25)], ['data', 'A'.repeat(23) + '!'], ['data', 'A'.repeat(21) + '==='], ['data', 7]]) {
    assert.equal(await shape(relock({ [k]: v })), false, k + '=' + v);
  }
  assert.equal(await shape({ ...locked, extra: 1 }), false);
  const { iv, ...noIv } = locked;
  assert.equal(await shape(noIv), false);
  for (const junk of [null, 'x', [], 7]) assert.equal(await shape(junk), false);
});

test('exportCompany refuses: a bad date, no key to sign, a device that cannot be read', async () => {
  assert.match((await E.exportCompany(owner, K.owner, { at: 'now' })).why, /not a valid date/);
  assert.match((await E.exportCompany(owner, null, { at: AT })).why, /no device key/);
  assert.match((await E.exportCompany(owner, { pub: 7 }, { at: AT })).why, /no device key/);
  assert.match((await E.exportCompany(owner, { pub: 'x' }, { at: AT })).why, /no device key/);
  assert.match((await E.exportCompany(owner, { pub: G, priv: null }, { at: AT })).why, /could not export/);
  assert.match((await E.exportCompany(null, K.owner, { at: AT })).why, /could not export/);
  const now = await E.exportCompany(owner, K.owner);
  assert.ok(Math.abs(Date.parse(now.file.manifest.at) - Date.now()) < 60000);
  assert.equal((await E.exportCompany(owner, K.owner, 'x')).ok, true);
});

// ── the spreadsheets ────────────────────────────────────────────────────────────────────────────────────────────────
test('the spreadsheets: tasks, CRM in pounds, the journal line by line, people without a sealed field', () => {
  const r = E.companyCsvs(owner);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => [f.name, f.rows]), [['tasks.csv', 2], ['crm.csv', 1], ['journal.csv', 8], ['people.csv', 1]]);
  const [tasks, crm, journal, people] = r.files.map((f) => f.text);
  assert.equal(tasks, 'id,title,status,owner,due\r\nt1,"\'=HYPERLINK(""http://evil"")",todo,Owner,\r\nt2,Restock line 4,done,Ops agent,2026-10-20\r\n');
  assert.equal(crm, 'id,name,contact,stage,value_gbp,owner\r\nc1,"Acme, Ltd",\'+44 113 000,lead,1234.56,Owner\r\n');
  const jl = journal.split('\r\n');
  assert.equal(jl[0], 'entry,date,memo,account,account_name,debit_gbp,credit_gbp');
  assert.ok(jl[1].endsWith(',2026-10-14,Opening capital,1200,Bank current account,0.05,'));
  assert.ok(jl[2].endsWith(',2026-10-14,Opening capital,4000,Sales,,0.05'));
  assert.ok(jl[3].endsWith(',2026-10-14,"Card sale, order ""1""",1200,Bank current account,100.05,'));
  assert.equal(people, 'id,name,title,kind,device\r\np-owner,Owner,Director,human,' + G.slice(0, 16) + '\r\n');
  assert.ok(!r.files.some((f) => f.text.includes('sealed:abc')));
});

test('the journal spreadsheet says plainly when lines cannot be read, and names an unknown account', async () => {
  const x = createNode({ keys: K.stranger, genesis: K.stranger.pub, name: 'x' });
  await x.put('journal', 'j1', { date: '2026-10-14', memo: 'broken', lines: 'garbage' });
  await x.put('journal', 'j2', { date: '2026-10-14', memo: 'odd', lines: '9999:5:0|1200:0:5' });
  const t = E.companyCsvs(x).files.find((f) => f.name === 'journal.csv').text.split('\r\n');
  assert.equal(t[1], 'j1,2026-10-14,broken,,unreadable lines,,');
  assert.equal(t[2], 'j2,2026-10-14,odd,9999,unknown account,0.05,');
  assert.equal(t[3], 'j2,2026-10-14,odd,1200,Bank current account,,0.05');
  assert.equal(E.companyCsvs(null).ok, false);
  assert.match(E.companyCsvs({}).why, /could not write its records/);
});

test('csvCell / poundsText / toCsv: RFC 4180, formulas defused, pence exact', () => {
  const cases = [[null, ''], [undefined, ''], [0, '0'], [-5, '-5'], [true, 'true'], ['plain', 'plain'], ['a,b', '"a,b"'], ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'], ['cr\r', '"cr\r"'], ['=1+1', "'=1+1"], ['+44', "'+44"], ['-3', "'-3"], ['@SUM(A1)', "'@SUM(A1)"], ['\tx', "'\tx"],
    ['\rx', '"\'\rx"'], ['=a,b', '"\'=a,b"'], ['a=1', 'a=1']];
  for (const [v, want] of cases) assert.equal(E.csvCell(v), want, JSON.stringify(v));
  for (const [p, want] of [[0, '0.00'], [5, '0.05'], [100, '1.00'], [123456, '1234.56'], [-1205, '-12.05'], [-5, '-0.05'], [1.5, 1.5], ['x', 'x'], [null, null]]) assert.equal(E.poundsText(p), want, String(p));
  assert.equal(E.toCsv(['a', 'b'], [[1, 'x,y'], [null, 2]]), 'a,b\r\n1,"x,y"\r\n,2\r\n');
  assert.equal(E.toCsv(['a'], []), 'a\r\n');
});

test('fuzz: no export throws on junk', async () => {
  const circular = {}; circular.self = circular;
  const toxic = { get genesis() { throw new Error('boom'); }, get kind() { throw new Error('boom'); }, hashes() { throw new Error('boom'); }, list() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], true, 10n, () => 1, circular, toxic];
  const fns = Object.entries(E).filter(([, v]) => typeof v === 'function');
  assert.deepEqual(fns.map(([k]) => k).sort(), ['companyCsvs', 'csvCell', 'exportCompany', 'feed', 'lockFile', 'openExport', 'poundsText', 'restoreCompany', 'setDigest', 'toCsv', 'unlockFile']);
  const TEXT_OUT = new Set(['setDigest', 'toCsv', 'csvCell', 'poundsText']);
  for (const [name, fn] of fns) {
    for (const a of JUNK) for (const b of [undefined, null, a, K.owner]) {
      let out;
      try { out = await fn(a, b, a); } catch (e) { assert.fail(name + ' threw on junk: ' + e.message); }
      if (!TEXT_OUT.has(name)) assert.ok(out && typeof out === 'object', name);
    }
  }
  assert.equal(E.setDigest(null), '');
  assert.equal(E.setDigest([toxic]), '');
  assert.equal(E.csvCell(toxic), '');
  assert.equal(E.toCsv(['a'], [[toxic]]), 'a\r\n\r\n');
  assert.equal(E.toCsv(null, null), '');
  assert.match((await E.openExport(toxic)).why, /could not be read|empty|not JSON/);
});
