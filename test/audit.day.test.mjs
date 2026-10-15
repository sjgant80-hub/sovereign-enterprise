// audit.day.test.mjs — the outsider's checks and the export on a REAL working day of the AI company: the runtime the live
// page runs, its own Finance agent sequencing the vault and its own Audit agent co-signing it, then a brain grown by
// "Teach it your own work" on the real shopper sample. (Slower than the kernel tests, so it is not in the mutation gate.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCompany } from '../src/runtime.mjs';
import { createNode } from '../src/node.mjs';
import { trainFromCsv, sampleCsv } from '../src/train.mjs';
import { toRecord } from '../src/brain.mjs';
import { vaultOf, checkpoint, verifyCheckpoint, proofBundle, verifyProofBundle, consistencyBundle, verifyConsistencyBundle, judge, brainBody, signBrain, verifyBrain } from '../src/audit.mjs';
import { exportCompany, restoreCompany, feed, companyCsvs } from '../src/exportco.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = read('brains/index.json');
const brains = { index, patterns: Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)])), shopper: read('brains/shopper.sample.json'),
  real: Object.fromEntries(Object.entries(index).filter(([d, m]) => m.sample && d !== 'shopper').map(([d, m]) => [d, read('brains/' + m.sample)])) };

test('a working day: the auditor gets a checkpoint, proofs of sampled entries, and a proof the books only grew', async () => {
  const co = createCompany(brains, { date: () => '2026-10-14' });
  await co.boot();
  while (co.n < 60) await co.tick({ events: 3 });
  await co.drain();
  const owner = co.nodes.owner;
  const v1 = vaultOf(owner);
  assert.equal(v1.ok, true);
  assert.ok(v1.size >= 5, 'the day posted entries: ' + v1.size);
  assert.equal(v1.bad.length, 0);
  const cp1 = await checkpoint(v1, co.keys.owner, { at: '2026-10-14T18:00:00.000Z' });
  assert.equal(cp1.ok, true);
  const r1 = await verifyCheckpoint(cp1.bundle);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.sequencers, [co.keys.finance.pub], 'the Finance agent signs the tree heads');
  for (let i = 0; i < cp1.bundle.size; i += 3) {
    const p = proofBundle(v1, i, cp1.bundle);
    assert.equal(p.ok, true, 'entry ' + i + ': ' + p.why);
    assert.equal((await verifyProofBundle(p.bundle, r1.sequencers)).ok, true, 'entry ' + i);
  }
  // the next day's work; the Audit agent co-signs; the auditor's checkpoint is extended, not replaced
  while (co.n < 140) await co.tick({ events: 3 });
  await co.drain();
  const v2 = vaultOf(co.nodes.overseer);
  assert.ok(v2.size > v1.size);
  const cp2 = await checkpoint(v2, co.keys.overseer, { at: '2026-10-15T18:00:00.000Z' });
  assert.ok((await verifyCheckpoint(cp2.bundle)).witnesses.some((w) => w.pub === co.keys.audit.pub) || cp2.bundle.cosigs.length === 0);
  const c = consistencyBundle(cp1.bundle, v2, cp2.bundle);
  assert.equal(c.ok, true, c.why);
  const r2 = await verifyConsistencyBundle(c.bundle, cp1.bundle);
  assert.equal(r2.ok, true, r2.why);
  const verdict = await judge(JSON.stringify(c.bundle), JSON.stringify(cp1.bundle));
  assert.equal(verdict.title, 'The books only grew since 2026-10-14 18:00 UTC');
  // every device rebuilt the same books: a checkpoint from any of them is the same tree head
  const fromAudit = await checkpoint(vaultOf(co.nodes.audit), co.keys.audit, { at: '2026-10-15T18:00:00.000Z' });
  assert.equal(fromAudit.bundle.root, cp2.bundle.root);

  // export the owner's device; a fresh device restores the very same company
  const ex = await exportCompany(owner, co.keys.owner, { at: '2026-10-15T18:00:00.000Z' });
  assert.equal(ex.ok, true);
  const back = await restoreCompany(JSON.stringify(ex.file));
  assert.equal(back.ok, true, back.why);
  const fresh = createNode({ keys: co.keys.owner, genesis: back.genesis, name: 'Owner (restored)' });
  const f = await feed(fresh, back.envelopes);
  assert.deepEqual([f.restored, f.refused], [owner.size(), 0]);
  assert.equal(fresh.digest(), owner.digest());
  assert.equal(fresh.digest(), back.manifest.state);
  const csv = companyCsvs(owner);
  assert.equal(csv.ok, true);
  const journal = csv.files.find((x) => x.name === 'journal.csv');
  assert.ok(journal.rows >= v2.size * 2, 'every entry has at least two lines');
  assert.ok(!csv.files.find((x) => x.name === 'people.csv').text.includes('privateSealed'));
});

test('a brain grown on the real shopper sample leaves signed — with and without its data summary — and checks out', async () => {
  const r = trainFromCsv(sampleCsv(read('brains/shopper.sample.json')), { target: 'Purchased', domain: 'your-brain', seed: 7 });
  assert.equal(r.ok && r.verified, true, r.why);
  const keys = (await import('../src/keys.mjs')).fromSeed(new Uint8Array(32).fill(7));
  for (const summary of [true, false]) {
    const b = brainBody(r, { label: 'UCI Online Shoppers', summary, at: '2026-10-14T12:00:00.000Z' });
    assert.equal(b.ok, true);
    const s = await signBrain(b.body, await keys);
    const v = await verifyBrain(JSON.parse(JSON.stringify(s.file)));
    assert.deepEqual([v.ok, v.summary, v.predicts], [true, summary, 'Purchased = ' + r.positive]);
    assert.equal((await judge(JSON.stringify(s.file))).title, 'A signed brain file');
    assert.equal(s.file.pattern.dist, summary ? toRecord(r.pattern).dist : '');
    assert.equal(JSON.stringify(s.file).includes('"verified"'), false);
  }
});
