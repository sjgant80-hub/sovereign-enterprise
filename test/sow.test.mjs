// sow.test.mjs — carrying a plan into a company, on REAL devices: the planter's device publishes a sealed plan through its own
// gate; agent devices read who really signed each planted brain from the spine, refuse one signed by a key that may not plant
// that job (another agent writing in the job owner's name, a part-overwritten record, a revoked admin) BEFORE reading it, and
// re-check the rest on their own rows against the brain they would replace; what they decided comes back to the planter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../src/sow.mjs';
import { differentiate, planRecords, hashPlan } from '../src/plant.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { AGENTS } from '../src/company.mjs';
import { toRecord, verifyOn, adopt } from '../src/brain.mjs';
import { signersOf, SIGNED_FIELDS } from '../src/shell.mjs';
import { prepare } from '../vendor/csv-forge/csv.mjs';

const R = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const INDEX = R('brains/index.json');
const PATTERNS = Object.fromEntries(Object.entries(INDEX).map(([d, m]) => [d, R('brains/' + m.file)]));
const SHIPPED = { index: INDEX, patterns: PATTERNS, office: R('data/office.json'), basis: R('data/basis.json') };
const toCsv = (j, target) => [[...j.features, target].join(','), ...j.data.map((r) => r.slice(0, j.features.length).concat(r[j.features.length] ? 'yes' : 'no').join(','))].join('\n');
const SAMPLE = { fraud: R('brains/real/fraud.sample.json'), credit: R('brains/real/credit.sample.json') };
const CSV = { fraud: toCsv(SAMPLE.fraud, 'Fraud'), credit: toCsv(SAMPLE.credit, 'Defaulted') };
const INPUT = { business: { type: 'other' }, files: [{ name: 'fraud.csv', text: CSV.fraud }, { name: 'credit.csv', text: CSV.credit }] };
const PLAN = differentiate(INPUT, SHIPPED, { seed: 1 });
const TAG = PLAN.planHash.slice(0, 16);
const clone = (x) => JSON.parse(JSON.stringify(x));
const reseal = (p) => ({ ...p, planHash: hashPlan(p) });
/** The published sample as rows keyed by its own column names (what a device without the business's file holds). */
const sampleRows = (j) => j.data.map((r) => ({ ...Object.fromEntries(j.features.map((f, k) => [f, r[k]])), y: r[j.features.length] ? 1 : 0 }));
const ROWS = { fraud: sampleRows(SAMPLE.fraud), credit: sampleRows(SAMPLE.credit) };
const FRAUD = PATTERNS.fraud;   // the shipped card-fraud brain (real data)
const flip = (p, all) => { const order = p.rules.map((x, i) => [i, Math.abs(x.w)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]); return { ...p, patternId: all ? 'flippedall0000000' : 'flippedone0000000', rules: p.rules.map((x, i) => (all || i === order[1][0] ? { ...x, w: -x.w } : x)) }; };
const planted = (p, plan = TAG, source = 'grown', by = 'finance') => ({ ...toRecord(p), by, source, localAuc: Math.round(p.heldAuc * 1000), n: 100, plan });

async function company(names = ['owner', 'admin', 'gone', 'finance', 'sales', 'clerk']) {
  const k = {}, n = {};
  for (const x of names) k[x] = await fromSeed(sha256Bytes('sow-test/' + x));
  for (const x of names) n[x] = createNode({ keys: k[x], genesis: k.owner.pub, name: x });
  const agentCols = (id) => [...AGENTS.find((a) => a.id === id).cols, 'wire', 'model'];
  const grant = (id, who, role, cols) => (k[who] ? n.owner.grant(id, k[who].pub, role, cols) : null);
  await grant('admin-1', 'admin', 'admin', ['*']);
  await grant('admin-2', 'gone', 'admin', ['*']);
  await grant('agent-finance', 'finance', 'agent', agentCols('finance'));
  await grant('agent-sales', 'sales', 'agent', agentCols('sales'));
  await grant('staff-1', 'clerk', 'staff', ['tasks', 'msg', 'docs', 'crm', 'wire']);
  const sync = async () => { for (let i = 0; i < 2; i++) for (const a of names) for (const b of names) if (a !== b) await pull(n[a], n[b]); };
  await sync();
  return { k, n, sync };
}

test('the signer is read the one way: SIGNED_FIELDS covers brains and adopt records, and signersOf maps every record to its one writer', async () => {
  for (const f of ['domain', 'rules', 'dist', 'threshold', 'heldAuc', 'features', 'patternId', 'source', 'plan']) assert.ok(SIGNED_FIELDS.brain.includes(f), f);
  for (const f of ['domain', 'by', 'adopted', 'source', 'plan', 'reason']) assert.ok(SIGNED_FIELDS.adopt.includes(f), f);
  const { k, n, sync } = await company();
  await n.owner.put('brain', 'fraud.finance', planted(FRAUD));
  await n.sales.put('brain', 'fraud.sales', planted(FRAUD));
  await sync();
  const w = signersOf(n.finance, 'brain');
  assert.equal(w.get('fraud.finance'), k.owner.pub);
  assert.equal(w.get('fraud.sales'), k.sales.pub);
  assert.deepEqual(signersOf(n.finance, 'nope').size, 0);
  assert.deepEqual(signersOf(null, 'brain').size, 0);
});

test('jobRecords: beside each brain grown from the business’s own file, the columns it reads and the outcome it learned', () => {
  const jobs = S.jobRecords(PLAN);
  assert.deepEqual(jobs.map((j) => j.id), ['job-fraud-' + TAG, 'job-credit-' + TAG], 'grown jobs only, in the plan’s order — never a shipped one');
  for (const j of jobs) {
    const pj = PLAN.jobs.find((x) => x.domain === j.f.domain);
    assert.equal(j.by, 'admin');
    assert.equal(j.c, 'plan');
    assert.deepEqual(j.f, { kind: 'job', domain: pj.domain, plan: TAG, patternId: pj.pattern.patternId, target: pj.target, positive: 'yes',
      names: JSON.stringify(pj.pattern.features), columns: JSON.stringify(pj.features.map((f) => f.from)) });
  }
  assert.equal(jobs[0].f.target, 'Fraud');
  assert.deepEqual(S.jobRecords({ ...PLAN, planHash: 'x' }), [], 'an unsealed plan gives nothing');
  for (const junk of [null, undefined, 'x', {}, []]) assert.deepEqual(S.jobRecords(junk), []);
  // a column list that does not fit one spine field is left out — exactly at the limit it is kept
  const at = (len) => {
    const p = clone(PLAN);
    const j = p.jobs.find((x) => x.domain === 'fraud');
    const base = JSON.stringify(j.features.map((f) => f.from)).length;
    j.features[0].from += 'x'.repeat(len - base);
    return S.jobRecords(reseal(p)).map((r) => r.f.domain);
  };
  assert.deepEqual(at(S.MAX_COLUMNS), ['fraud', 'credit']);
  assert.deepEqual(at(S.MAX_COLUMNS + 1), ['credit']);
  // a grown brain that did not pass is not planted, so it has no job record
  const failed = clone(PLAN);
  const fj = failed.jobs.find((x) => x.domain === 'credit');
  fj.verified = false;
  assert.deepEqual(S.jobRecords(reseal(failed)).map((r) => r.f.domain), ['fraud']);
});

test('tuneRecords: the confidence floor every agent reads, a pause for each agent switched off, and an un-pause only of this planting’s own', () => {
  const ids = AGENTS.map((a) => a.id);
  assert.deepEqual(S.tuneRecords({ floor: 200, agents: ids }), [{ c: 'policy', id: 'agents', f: { minConfidence: 200, by: 'Planting' } }]);
  for (const f of S.FLOORS) assert.equal(S.tuneRecords({ floor: f, agents: ids })[0].f.minConfidence, f);
  for (const f of [75, '200', null, 0.2]) assert.equal(S.tuneRecords({ floor: f, agents: ids })[0].f.minConfidence, 50, String(f));
  const off = S.tuneRecords({ floor: 50, agents: ids.filter((x) => x !== 'finance' && x !== 'ops') });
  assert.deepEqual(off.slice(1), ['finance', 'ops'].map((id) => ({ c: 'control', id, f: { paused: true, by: 'Planting', why: 'switched off at planting — a person switches it on', watch: '' } })));
  const control = [{ id: 'finance', paused: true, by: 'Planting' }, { id: 'ops', paused: true, by: 'the behaviour watch' }, { id: 'sales', paused: 'true', by: 'Planting' }, null, 'x'];
  assert.deepEqual(S.tuneRecords({ floor: 50, agents: ids }, control).slice(1), [{ c: 'control', id: 'finance', f: { paused: false, by: 'Planting', why: 'switched on at planting', watch: '' } }],
    'only a pause this planting wrote is lifted; the watch’s stays for a person');
  assert.deepEqual(S.tuneRecords({ floor: 50, agents: ['sales'] }, control).map((r) => r.id), ['agents', 'service', 'finance', 'ops', 'systems', 'audit']);
  for (const junk of [null, undefined, 'x', 7]) assert.deepEqual(S.tuneRecords(junk), [{ c: 'policy', id: 'agents', f: { minConfidence: 50, by: 'Planting' } }], String(junk));
  assert.deepEqual(S.tuneRecords({ get floor() { throw new Error('x'); } }), []);
});

test('publishPlan: only the owner’s or an admin’s device plants; every record goes through its own gate', async () => {
  const { n, sync } = await company();
  const all = planRecords(PLAN).length + S.jobRecords(PLAN).length + 1;
  for (const who of ['clerk', 'finance']) {
    const r = await S.publishPlan(n[who], PLAN, { floor: 100 });
    assert.deepEqual(r, { ok: false, why: 'only the owner’s device or an admin’s can plant — this device is neither, in this company', records: 0, wrote: 0, refused: [] }, who);
  }
  assert.equal((await S.publishPlan(n.owner, { ...PLAN, planHash: 'x' })).why, 'the plan is not sealed: grow it again');
  const r = await S.publishPlan(n.admin, PLAN, { floor: 100, agents: AGENTS.map((a) => a.id).filter((x) => x !== 'ops') });
  assert.deepEqual(r, { ok: true, why: '', records: all + 1, wrote: all + 1, refused: [] });
  await sync();
  assert.equal(n.finance.list('policy').find((x) => x.id === 'agents').minConfidence, 100);
  assert.equal(n.finance.list('control').find((x) => x.id === 'ops').paused, true);
  assert.deepEqual(n.finance.list('plan').filter((x) => x.kind === 'job').map((x) => x.domain).sort(), ['credit', 'fraud']);
  assert.equal(signersOf(n.finance, 'brain').get('fraud.finance'), n.admin.pub, 'the planter’s device signed the brains');
  // a refused write is reported, never hidden
  const fake = { canWrite: () => true, list: () => [], put: async (c, id) => (id.startsWith('job-') ? { ok: false } : c === 'policy' ? { ok: false, reason: 'size' } : { ok: true }) };
  const f = await S.publishPlan(fake, PLAN, {});
  assert.equal(f.ok, false);
  assert.equal(f.why, '3 of ' + all + ' records were refused');
  assert.deepEqual(f.refused, [{ id: 'job-fraud-' + TAG, reason: 'refused' }, { id: 'job-credit-' + TAG, reason: 'refused' }, { id: 'agents', reason: 'size' }]);
  assert.equal(f.wrote, all - 3);
  for (const junk of [null, undefined, {}, { canWrite: () => 'yes' }]) assert.equal((await S.publishPlan(junk, PLAN)).ok, false);
  assert.equal((await S.publishPlan({ canWrite: () => true, list: () => [], put: async () => { throw new Error('x'); } }, PLAN)).why, 'the plan could not be published');
});

test('rowsFor: an agent device reads its own copy of the business’s file exactly the way the grower did', () => {
  const job = S.jobRecords(PLAN)[0].f;
  const r = S.rowsFor(job, CSV.fraud);
  assert.equal(r.ok, true);
  assert.equal(r.why, '');
  const p = prepare(CSV.fraud, { targetName: 'Fraud' });
  const names = JSON.parse(job.names), cols = JSON.parse(job.columns);
  assert.equal(r.rows.length, p.cases.length);
  assert.deepEqual(Object.keys(r.rows[0]), [...names, 'y']);
  for (const i of [0, 7, r.rows.length - 1]) {
    names.forEach((nm, k) => assert.equal(r.rows[i][nm], p.cases[i].x[p.featureNames.indexOf(cols[k])]));
    assert.equal(r.rows[i].y, p.cases[i].y);
  }
  const brain = PLAN.jobs.find((x) => x.domain === 'fraud').pattern;
  assert.ok(verifyOn(brain, r.rows).auc >= 0.9, 'the grown brain reads these rows as it was grown on them');
  const bad = (j, t, why) => assert.deepEqual(S.rowsFor(j, t), { ok: false, why, rows: [] }, why);
  bad({ ...job, names: '"x"' }, CSV.fraud, 'the job record does not say which columns its brain reads');
  bad({ ...job, names: '[]', columns: '[]' }, CSV.fraud, 'the job record does not say which columns its brain reads');
  bad({ ...job, names: '["a",1]', columns: '["a","b"]' }, CSV.fraud, 'the job record does not say which columns its brain reads');
  bad({ ...job, names: '["a"]', columns: '["a",2]' }, CSV.fraud, 'the job record does not say which columns its brain reads');
  bad({ ...job, names: '["a","b"]', columns: '["a"]' }, CSV.fraud, 'the job record does not say which columns its brain reads');
  bad({ ...job, columns: 'not json' }, CSV.fraud, 'the file could not be read');
  bad(job, '', 'the file is empty');
  bad(job, ' \n ', 'the file is empty');
  bad(job, 7, 'the file is empty');
  bad(job, 'x'.repeat(S.MAX_TEXT + 1), 'the file is too large to read here');
  assert.equal(S.rowsFor(job, CSV.fraud + '\n'.repeat(S.MAX_TEXT - CSV.fraud.length)).ok, true, 'exactly at the limit is read');
  bad({ ...job, target: 'Chargeback' }, CSV.fraud, 'the file has no Chargeback column with two values — the outcome this brain learned');
  bad({ ...job, positive: 'no' }, CSV.fraud, 'in this file the case to catch reads yes, not no');
  const gone = (k) => ({ ...job, names: JSON.stringify([...names, ...Array.from({ length: k }, (_, i) => 'g' + i)]), columns: JSON.stringify([...cols, ...Array.from({ length: k }, (_, i) => 'Gone' + i)]) });
  bad(gone(3), CSV.fraud, 'the file has no Gone0, Gone1 and Gone2 — columns this brain reads');
  bad(gone(4), CSV.fraud, 'the file has no Gone0, Gone1 and Gone2 (and 1 more) — columns this brain reads');
  bad(gone(1), CSV.fraud, 'the file has no Gone0 — columns this brain reads');
  bad(null, CSV.fraud, 'the file could not be read');
});

test('planterOf: the owner, a live admin, or the agent that runs the job — and nobody else', async () => {
  const { k, n } = await company();
  await n.owner.revoke('admin-2', 0);
  const f = n.owner;
  assert.deepEqual(S.planterOf(f, k.owner.pub, 'fraud'), { ok: true, role: 'owner', why: '' });
  assert.deepEqual(S.planterOf(f, k.admin.pub, 'fraud'), { ok: true, role: 'admin', why: '' });
  assert.deepEqual(S.planterOf(f, k.finance.pub, 'fraud'), { ok: true, role: 'finance', why: '' });
  assert.deepEqual(S.planterOf(f, k.finance.pub, 'credit'), { ok: true, role: 'finance', why: '' });
  assert.deepEqual(S.planterOf(f, k.sales.pub, 'fraud'), { ok: false, role: 'sales', why: 'signed by the Sales agent’s device — only the owner, an admin, or the Finance agent that runs the card fraud job may plant its brain' });
  assert.deepEqual(S.planterOf(f, k.sales.pub, 'shopper'), { ok: true, role: 'sales', why: '' });
  assert.deepEqual(S.planterOf(f, k.finance.pub, 'shopper').ok, false);
  assert.deepEqual(S.planterOf(f, k.gone.pub, 'fraud'), { ok: false, role: '', why: 'signed by a device with no live grant to plant brains — only the owner, an admin, or the Finance agent that runs the card fraud job may plant its brain' }, 'a revoked admin plants nothing');
  assert.deepEqual(S.planterOf(f, k.clerk.pub, 'fraud').ok, false);
  assert.deepEqual(S.planterOf(f, k.finance.pub, 'telepathy'), { ok: false, role: 'finance', why: 'signed by the Finance agent’s device — only the owner or an admin may plant a brain for a job this company does not run' });
  assert.equal(S.planterOf(f, k.finance.pub, '__proto__').ok, false);
  for (const pub of ['', 'x', k.owner.pub.toUpperCase(), null, 7]) assert.deepEqual(S.planterOf(f, pub, 'fraud'), { ok: false, role: '', why: 'no one device wrote all of it — another device wrote over part of it' }, String(pub));
  assert.deepEqual(S.planterOf({ genesis: 'a', view() { throw new Error('x'); } }, k.admin.pub, 'fraud'), { ok: false, role: '', why: 'the company’s role tree could not be read' });
  // an agent's grant revoked: it no longer plants its own job
  await n.owner.revoke('agent-finance', 0);
  assert.equal(S.planterOf(n.owner, k.finance.pub, 'fraud').ok, false);
});

test('plantedFor: who really signed each planted brain — another agent writing in the job owner’s name is refused before it is read', async () => {
  const { k, n, sync } = await company();
  await n.owner.put('brain', 'fraud.finance', planted(FRAUD));
  await n.finance.put('brain', 'credit.finance', planted(PATTERNS.credit, TAG, 'planted'));
  await n.sales.put('brain', 'fraud.sales', planted(FRAUD, TAG, 'grown', 'finance'));          // claims finance; signed by sales
  await n.finance.put('brain', 'energy.finance', planted(PATTERNS.energy));                     // not a job finance runs
  await n.finance.put('brain', 'fraud.factory', { ...toRecord(FRAUD), by: 'finance', source: 'factory', localAuc: 900, n: 100 });   // a shipped publish, no plan
  await n.finance.put('brain', 'fraud.old', planted(FRAUD, TAG, 'factory'));                     // a plan tag, but not a planted source
  await n.finance.put('brain', 'fraud.short', planted(FRAUD, TAG.slice(1)));                      // not a plan tag
  await sync();
  let e = S.plantedFor(n.finance, 'finance');
  assert.deepEqual(e.map((x) => [x.id, x.signer === k.owner.pub ? 'owner' : x.signer === k.finance.pub ? 'finance' : x.signer === k.sales.pub ? 'sales' : x.signer, x.role, x.trusted]),
    [['credit.finance', 'finance', 'finance', true], ['fraud.finance', 'owner', 'owner', true], ['fraud.sales', 'sales', 'sales', false]]);
  const own = e.find((x) => x.id === 'fraud.finance');
  assert.equal(own.domain, 'fraud');
  assert.equal(own.plan, TAG);
  assert.equal(own.patternId, FRAUD.patternId);
  assert.equal(own.why, '');
  assert.deepEqual(own.pattern.rules, FRAUD.rules);
  assert.equal(e.find((x) => x.id === 'fraud.sales').pattern, null, 'never read: its signer may not plant that job');
  // THE FORGERY: the Sales agent's key writes a brain over the Finance agent's own record, in the Finance agent's name
  await n.sales.put('brain', 'fraud.finance', planted(flip(FRAUD, true), TAG, 'grown', 'finance'));
  await sync();
  e = S.plantedFor(n.finance, 'finance');
  const forged = e.find((x) => x.id === 'fraud.finance');
  assert.equal(forged.signer, k.sales.pub);
  assert.equal(forged.trusted, false);
  assert.equal(forged.pattern, null);
  assert.match(forged.why, /^signed by the Sales agent’s device/);
  // part of a record written over by another device: no one key wrote all of it
  await n.owner.put('brain', 'credit.finance', planted(PATTERNS.credit, TAG, 'planted'));
  await n.sales.put('brain', 'credit.finance', { threshold: '9' });
  await sync();
  const mixed = S.plantedFor(n.finance, 'finance').find((x) => x.id === 'credit.finance');
  assert.deepEqual([mixed.signer, mixed.trusted, mixed.why], ['', false, 'no one device wrote all of it — another device wrote over part of it']);
  // a record whose patternId is not text
  await n.owner.put('brain', 'fraud.odd', { ...planted(FRAUD), patternId: 7 });
  await sync();
  assert.equal(S.plantedFor(n.finance, 'finance').find((x) => x.id === 'fraud.odd').patternId, '');
  assert.deepEqual(S.plantedFor(n.finance, 'audit'), [], 'the Audit agent runs no job of its own to plant');
  assert.deepEqual(S.plantedFor(n.finance, 'nobody'), []);
  assert.deepEqual(S.plantedFor(null, 'finance'), []);
});

test('judgePlanted: signer first, then the device’s own rows, against the brain it would replace', async () => {
  const { k, n, sync } = await company();
  const rows = (d) => ROWS[d];
  // a good planted brain, validly signed: adopted, and the device holds it
  await n.owner.put('brain', 'fraud.finance', planted(FRAUD));
  await sync();
  let j = S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: PATTERNS });
  const want = adopt(FRAUD, ROWS.fraud, 0.65, FRAUD);
  assert.equal(j.ok, true);
  assert.equal(j.why, '');
  assert.equal(j.agent, 'finance');
  assert.deepEqual(j.held, ['fraud']);
  assert.deepEqual(j.kept, { fraud: 'planted' });
  assert.equal(j.results.length, 1);
  assert.deepEqual({ ...j.results[0], pattern: !!j.results[0].pattern }, { id: 'fraud.finance', domain: 'fraud', plan: TAG, patternId: FRAUD.patternId, signer: k.owner.pub, role: 'owner', trusted: true,
    adopted: true, localAuc: want.localAuc, n: ROWS.fraud.length, reason: 'Adopted: ' + want.reason + '.', pattern: true });
  assert.deepEqual(j.library.fraud.rules, FRAUD.rules);
  // subtly tampered, validly signed: it clears the gate but is worse than the shipped brain on this device's own cases
  await n.owner.put('brain', 'fraud.finance', planted(flip(FRAUD, false)));
  await sync();
  j = S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: PATTERNS });
  assert.equal(j.results[0].adopted, false);
  assert.match(j.results[0].reason, /^Refused: worse than the brain it would replace on \d+ of this device’s own cases/);
  assert.ok(j.results[0].localAuc >= 0.65, 'it would have cleared the gate on its own');
  assert.equal(j.results[0].pattern, null);
  assert.deepEqual(j.kept, { fraud: 'shipped' });
  assert.equal(j.library.fraud, PATTERNS.fraud);
  // no shipped brain to fall back on: it is the subtle one alone — it passes the gate and is adopted (nothing better is held)
  j = S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: {} });
  assert.equal(j.results[0].adopted, true);
  assert.deepEqual(j.kept, { fraud: 'planted' });
  // blatantly tampered, validly signed: it does not re-verify here; nothing shipped either → the job has no brain
  await n.owner.put('brain', 'fraud.finance', planted(flip(FRAUD, true)));
  await sync();
  j = S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: {} });
  assert.match(j.results[0].reason, /^Refused: did not re-verify here \(AUC [\d.]+ < 0\.65\)\.$/);
  assert.deepEqual(j.kept, { fraud: 'none' });
  assert.deepEqual(j.library, {});
  // a shipped brain of another job, or one that does not re-verify on these rows, is no fall-back
  assert.deepEqual(S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: { fraud: PATTERNS.credit } }).kept, { fraud: 'none' });
  assert.deepEqual(S.judgePlanted({ node: n.finance, agentId: 'finance', rows: () => ROWS.credit, shipped: PATTERNS }).kept, { fraud: 'none' });
  assert.deepEqual(S.judgePlanted({ node: n.finance, agentId: 'finance', rows, shipped: { fraud: { ...FRAUD, rules: [] } } }).kept, { fraud: 'none' });
});

test('judgePlanted: measurements the device does not hold, junk rows, a signer refused, a record that is not a brain, two plantings of one job', async () => {
  const { n, sync } = await company();
  await n.owner.put('brain', 'fraud.finance', planted(FRAUD));
  await sync();
  const drop = (k) => ROWS.fraud.map((r) => { const x = { ...r }; for (const f of FRAUD.features.slice(0, k)) delete x[f]; return x; });
  const why = (rows) => S.judgePlanted({ node: n.finance, agentId: 'finance', rows: () => rows, shipped: {} }).results[0];
  const f = FRAUD.features;
  assert.equal(why(drop(3)).reason, 'Refused: this device’s own records do not hold ' + f[0] + ', ' + f[1] + ' and ' + f[2] + ' — measurements this brain reads. Give the device its own copy of the business’s records for this job.');
  assert.equal(why(drop(4)).reason, 'Refused: this device’s own records do not hold ' + f[0] + ', ' + f[1] + ' and ' + f[2] + ' (and 1 more) — measurements this brain reads. Give the device its own copy of the business’s records for this job.');
  assert.equal(why(drop(1)).reason, 'Refused: this device’s own records do not hold ' + f[0] + ' — measurements this brain reads. Give the device its own copy of the business’s records for this job.');
  assert.equal(why(drop(1)).n, ROWS.fraud.length);
  // a measurement present in only some rows is held; junk among the rows is dropped, never read
  const some = ROWS.fraud.map((r, i) => (i % 2 ? r : { ...r, [f[0]]: 'n/a' }));
  assert.equal(why(some).adopted, true);
  assert.equal(why([null, 7, 'x', ...ROWS.fraud]).n, ROWS.fraud.length);
  assert.equal(why('rows').n, 0);
  assert.equal(why(undefined).adopted, false);
  // the rows of one job are asked for once
  let calls = 0;
  S.judgePlanted({ node: n.finance, agentId: 'finance', rows: () => { calls++; return ROWS.fraud; }, shipped: PATTERNS });
  assert.equal(calls, 1);
  // two plantings of one job: the later must beat what the earlier gave (ids in order)
  await n.owner.put('brain', 'fraud.zz-second', planted(flip(FRAUD, false), 'aaaaaaaaaaaaaaaa'));
  await n.sales.put('brain', 'fraud.aa-sales', planted(FRAUD));
  await n.owner.put('brain', 'credit.finance', { ...planted(PATTERNS.credit), rules: 'not|rules' });
  await sync();
  const j = S.judgePlanted({ node: n.finance, agentId: 'finance', rows: (d) => ROWS[d], shipped: {} });
  assert.deepEqual(j.results.map((r) => [r.id, r.adopted]), [['credit.finance', false], ['fraud.aa-sales', false], ['fraud.finance', true], ['fraud.zz-second', false]]);
  assert.equal(j.results[0].reason, 'Refused: it does not read as a brain.');
  assert.match(j.results[1].reason, /^Refused before it was read: signed by the Sales agent’s device — only the owner, an admin, or the Finance agent that runs the card fraud job may plant its brain\.$/);
  assert.deepEqual([j.results[1].localAuc, j.results[1].n], [0, 0]);
  assert.match(j.results[3].reason, /^Refused: worse than the brain it would replace/);
  assert.deepEqual(j.held, ['credit', 'fraud']);
  assert.deepEqual(j.kept, { credit: 'none', fraud: 'planted' });
  const fresh = (await company(['owner', 'finance'])).n.finance;   // nothing planted here: only the guard can refuse
  for (const junk of [null, undefined, {}, { node: n.finance, agentId: 'finance' }, { node: fresh, agentId: 'finance' }, { node: null, agentId: 'finance', rows: () => [] },
    { node: n.finance, agentId: 'finance', rows: () => { throw new Error('x'); } }]) {
    assert.deepEqual(S.judgePlanted(junk), { ok: false, why: 'the planted brains could not be read', agent: '', results: [], library: {}, held: [], kept: {} });
  }
  assert.deepEqual(S.judgePlanted({ node: fresh, agentId: 'finance', rows: () => [] }), { ok: true, why: '', agent: 'finance', results: [], library: {}, held: [], kept: {} });
});

test('loadPlanted end to end: published by the planter, read through each device’s own copy of the file, written down, reported back', async () => {
  const { k, n, sync } = await company();
  assert.equal((await S.publishPlan(n.owner, PLAN, { floor: 50 })).ok, true);
  await sync();
  const own = (d) => S.rowsFor(S.jobFor(n.finance, d, TAG), CSV[d]).rows;
  assert.equal(S.jobFor(n.finance, 'fraud', TAG).columns, S.jobRecords(PLAN)[0].f.columns);
  assert.equal(S.jobFor(n.finance, 'fraud', 'ffffffffffffffff'), null);
  assert.equal(S.jobFor(null, 'fraud', TAG), null);
  // the shipped brains were grown on these very published records, and on them they score higher: the device keeps them —
  // a planted brain replaces one only if it does at least as well on the device's own records (brain.mjs adopt)
  const kept = S.judgePlanted({ node: n.finance, agentId: 'finance', rows: own, shipped: PATTERNS });
  assert.deepEqual(kept.kept, { credit: 'shipped', fraud: 'shipped' });
  for (const x of kept.results) assert.match(x.reason, /^Refused: worse than the brain it would replace on \d+ of this device’s own cases \(AUC [\d.]+ < [\d.]+\)\.$/);
  assert.equal(kept.library.fraud, PATTERNS.fraud);
  const r = await S.loadPlanted({ node: n.finance, agentId: 'finance', rows: own, shipped: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => [x.domain, x.adopted, x.role]), [['credit', true, 'owner'], ['fraud', true, 'owner']]);
  assert.equal(r.wrote, 4, 'two adopt records and two brains re-published as its own');
  // re-published as the Finance agent's own: the agent that runs the job signs it now, so it is still trusted everywhere
  const mine = S.plantedFor(n.finance, 'finance');
  assert.deepEqual(mine.map((x) => [x.id, x.signer === k.finance.pub, x.role, x.trusted]), [['credit.finance', true, 'finance', true], ['fraud.finance', true, 'finance', true]]);
  const rec = n.finance.list('brain').find((x) => x.id === 'fraud.finance');
  assert.deepEqual([rec.by, rec.source, rec.plan, rec.patternId, rec.n], ['finance', 'planted', TAG, PLAN.jobs.find((x) => x.domain === 'fraud').pattern.patternId, r.results[1].n]);
  assert.equal(rec.localAuc, Math.round(r.results[1].localAuc * 1000));
  const ad = n.finance.list('adopt').filter((x) => x.source === 'planted');
  assert.deepEqual(ad.map((x) => [x.domain, x.from, x.by, x.adopted, x.plan]).sort(), [['credit', 'owner', 'finance', true, TAG], ['fraud', 'owner', 'finance', true, TAG]]);
  // what came back to the planter: only reports the agent named really wrote
  await n.sales.put('adopt', 'forged-1', { domain: 'fraud', patternId: 'x', from: 'owner', by: 'finance', adopted: false, localAuc: 1, n: 1, reason: 'forged', source: 'planted', plan: TAG });
  await n.finance.put('adopt', 'odd-1', { domain: 'credit', by: 'finance', adopted: 'yes', localAuc: 'x', n: 'many', reason: 'odd', source: 'planted', plan: 'other' });
  await sync();
  const back = S.plantedReports(n.owner, TAG);
  assert.deepEqual(back.map((x) => [x.agent, x.domain, x.adopted]).sort(), [['finance', 'credit', true], ['finance', 'fraud', true]]);
  const fr = back.find((x) => x.domain === 'fraud');
  assert.deepEqual(fr, { agent: 'finance', domain: 'fraud', plan: TAG, adopted: true, localAuc: Math.round(r.results[1].localAuc * 1000), n: r.results[1].n, reason: r.results[1].reason });
  const odd = S.plantedReports(n.owner).find((x) => x.reason === 'odd');
  assert.deepEqual(odd, { agent: 'finance', domain: 'credit', plan: 'other', adopted: false, localAuc: 0, n: 0, reason: 'odd' });
  assert.equal(S.plantedReports(n.owner).length, 3, 'with no plan named: every planting');
  assert.deepEqual(S.plantedReports(null), []);
  // a device that may not write adoptions still judges — and writes nothing
  const clerk = await S.loadPlanted({ node: n.clerk, agentId: 'finance', rows: own, shipped: {} });
  assert.deepEqual([clerk.ok, clerk.wrote, clerk.results.length], [true, 0, 2]);
  assert.deepEqual(await S.loadPlanted(null), { ok: false, why: 'the planted brains could not be read', agent: '', results: [], library: {}, held: [], kept: {}, wrote: 0 });
  // a node that fails mid-write: the count so far, never a throw
  let puts = 0;
  const flaky = { ...n.finance, put: async () => { if (++puts > 1) throw new Error('x'); return { ok: true }; } };
  assert.deepEqual(await S.recordPlanted(flaky, 'finance', r), { ok: false, wrote: 1 });
  assert.deepEqual(await S.recordPlanted(n.finance, 'finance', null), { ok: false, wrote: 0 });
  // a refused brain is never re-published as the agent's own
  const refused = { results: [{ ...r.results[1], adopted: false, pattern: null }], library: { fraud: PATTERNS.fraud } };
  const before = n.finance.list('brain').length;
  const fromOwner = () => n.finance.list('adopt').filter((x) => x.from === 'owner' && x.adopted === false).length;
  const was = fromOwner();
  assert.deepEqual(await S.recordPlanted(n.finance, 'finance', refused), { ok: true, wrote: 1 });
  assert.equal(n.finance.list('brain').length, before);
  assert.equal(fromOwner(), was + 1);
  const anon = { results: [{ ...r.results[1], role: '', adopted: false, pattern: null }], library: {} };
  await S.recordPlanted(n.finance, 'finance', anon);
  assert.ok(n.finance.list('adopt').some((x) => x.from === 'unknown'));
  const throwing = { ...n.finance, put: async () => { throw new Error('x'); } };
  const half = await S.loadPlanted({ node: throwing, agentId: 'finance', rows: own, shipped: {} });
  assert.deepEqual([half.ok, half.wrote, half.results.length], [true, 0, 2]);
});
