// receipt.test.mjs — the per-planting receipt: built from real plans grown on the real samples, every number checked against a
// count this file makes for itself, signed with real keys, tampered with field by field, reproduced byte for byte, redacted
// for the next prospect, rendered for the client — and the live results read off a real company's spine, counted the way
// its own board summary counts them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlantingReceipt, verifyPlantingReceipt, reproducePlantingReceipt, afterFromSpine, showcase, receiptHtml, bandOf,
  RECEIPT_MODEL, SHOWCASE_MODEL, MAX_BRIDGES, MAX_TOTALS, BANDS } from '../src/receipt.mjs';
import { differentiate, hashPlan } from '../src/plant.mjs';
import { fitPlan, fitInput, formFields } from '../src/adopt.mjs';
import { canonical, utf8 } from '../src/canon.mjs';
import { sha256 } from '../src/sha256.mjs';
import { fromSeed, sign, verify } from '../src/keys.mjs';
import { createCompany } from '../src/runtime.mjs';
import { prepare } from '../vendor/csv-forge/csv.mjs';
import { hostileInputs } from '../.witness/witness.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const INDEX = read('brains/index.json');
const OFFICE = read('data/office.json'), BASIS = read('data/basis.json');
const PATTERNS = Object.fromEntries(Object.entries(INDEX).map(([d, m]) => [d, read('brains/' + m.file)]));
const SHIPPED = { index: INDEX, patterns: PATTERNS, office: OFFICE, basis: BASIS };
const OFFICE_IN = { base: OFFICE, basis: BASIS };
const clone = (x) => JSON.parse(JSON.stringify(x));
const KEYS = await fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const OTHER = await fromSeed(new Uint8Array(32).fill(9));

// ── the business's files: the real samples exported as CSV, and a credit decision log built from the real credit sample ──
const toCsv = (j, target) => [[...j.features, target].join(','), ...j.data.map((r) => r.slice(0, j.features.length).concat(r[j.features.length] ? 'yes' : 'no').join(','))].join('\n');
const CHURN = toCsv(read('brains/real/churn.sample.json'), 'Churned');
const CREDIT = read('brains/real/credit.sample.json'), CF = CREDIT.features, ci = (n) => CF.indexOf(n), LABEL = CF.length;
const LOG_ROWS = CREDIT.data.slice(0, 600);
const oldRule = (r) => (r[ci('payStatusSep')] >= 2 || r[ci('utilisationSep')] > 0.9 ? 'decline' : 'approve');
const LOG = [[...CF, 'oldRuleDecision', 'Outcome'].join(','), ...LOG_ROWS.map((r) => [...r.slice(0, LABEL), oldRule(r), r[LABEL] ? 'defaulted' : 'repaid'].join(','))].join('\n');
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function table(header, n, row, seed) { const r = lcg(seed); return [header.join(','), ...Array.from({ length: n }, () => row(r).join(','))].join('\n'); }
const yn = (r) => (r() < 0.5 ? 'yes' : 'no');
const RANDOM = table(['alpha', 'beta', 'gamma', 'Fraud'], 400, (r) => [Math.floor(r() * 100), Math.floor(r() * 100), Math.floor(r() * 100), yn(r)], 11);
const TINY = table(['airTempK', 'torqueNm', 'MachineFailure'], 50, (r) => [300 + Math.floor(r() * 10), Math.floor(r() * 60), yn(r)], 5);
const BANK = 'Date,Description,Paid out,Paid in,Balance\n2026-01-02,Rent,1200,,5000\n2026-01-03,Card sale,,300,5300\n2026-01-04,Supplier,250,,5050\n';
const BRIDGE = { kind: 'bank statement into the books', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64), rows: 3, rejected: 0, totals: { paidIn: 30000, paidOut: -145000 } };

// A: an online shop with a credit decision log (the old rule and what really happened), its churn outcomes, 12 service staff
const IN_A = { business: { type: 'retail', pairs: [{ id: 'service', value: 12 }] },
  files: [{ name: 'credit-decisions.csv', text: LOG, positiveDecision: 'decline' }, { name: 'churn.csv', text: CHURN }] };
const PLAN_A = differentiate(IN_A, SHIPPED, { seed: 1 });
const A = { plan: PLAN_A, before: IN_A, office: OFFICE_IN, bridges: [BRIDGE], after: null, at: '2026-10-15' };
// B: 'other', no headcount, no shipped brains — a brain that fails its check, a log whose decisions do not read as yes/no,
// a file too small to grow from, and a bank statement
const LOG_SHORT = LOG.split('\n').slice(0, 401).join('\n');
const IN_B = { business: { type: 'other' }, files: [{ name: 'fraud-random.csv', text: RANDOM }, { name: 'credit-old.csv', text: LOG_SHORT }, { name: 'maint-tiny.csv', text: TINY }, { name: 'bank.csv', text: BANK }] };
const PLAN_B = differentiate(IN_B, {}, { seed: 1 });
const B = { plan: PLAN_B, before: IN_B, office: OFFICE_IN, bridges: [], after: null, at: '2026-11-02' };
// C: a services firm that gives every line of its headcount and hands over nothing a brain can grow from
const ALL_LINES = formFields(OFFICE).map((f) => ({ id: f.id, value: f.value }));
const IN_C = { business: { type: 'services', pairs: ALL_LINES }, files: [null, { name: '', text: 'a,b\n1,2' }, { name: 5, text: 5 }] };
const PLAN_C = differentiate(IN_C, SHIPPED, { seed: 1 });
const C = { plan: PLAN_C, before: IN_C, office: OFFICE_IN, bridges: [], after: null, at: '2026-12-31' };

const RA = await buildPlantingReceipt(A, KEYS);
const RB = await buildPlantingReceipt(B, KEYS);
const RC = await buildPlantingReceipt(C, KEYS);
const body = (r) => JSON.parse(r.body);
const BA = body(RA), BB = body(RB), BC = body(RC);
const jobOf = (b, d) => b.jobs.find((j) => j.job === d);
const planJob = (p, d) => p.jobs.find((j) => j.domain === d);
/** re-sign a changed body with the same key: a receipt whose bytes are honest about a body that may not be */
async function resign(r, change) {
  const b = body(r);
  change(b);
  const text = canonical(b);
  return { ...r, body: text, hash: sha256(text), sig: await sign(KEYS, utf8(text)) };
}
const unsigned = (b) => { const text = canonical(b); return { v: RECEIPT_MODEL, body: text, hash: sha256(text), sig: '', pub: '' }; };

// ── this file's own count of the held-out rows: csv-forge's encoding, the grower's split (3 rows in every 10), a scorer
//    written here from the pattern's rules ──
function heldCount(text, job, decisionOf) {
  const p = prepare(text, { targetName: job.target });
  const at = Object.fromEntries(job.features.map((f) => [f.name, p.featureNames.indexOf(f.from)]));
  const held = p.cases.map((c, i) => ({ c, i })).filter(({ i }) => i % 10 < 3);
  const score = (c) => job.pattern.rules.reduce((s, r) => { const x = c.x[at[r.feat]]; return s + ((r.op === '>' ? x > r.v : x <= r.v) ? r.w : 0); }, 0);
  const count = (calls) => ({
    right: held.filter((h, k) => calls[k] === h.c.y).length,
    flagged: calls.filter((x) => x === 1).length,
    caught: held.filter((h, k) => calls[k] === 1 && h.c.y === 1).length,
  });
  return { n: held.length, positives: held.filter((h) => h.c.y === 1).length, brain: count(held.map((h) => (score(h.c) > job.pattern.threshold ? 1 : 0))),
    past: decisionOf ? count(held.map((h) => (decisionOf(h.i) === 'decline' ? 1 : 0))) : null };
}
const permille = (a, b) => Math.round(a / b * 1000);

// ── bands ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('bandOf: the UK size bands at every edge; anything but a whole number of people is no band', () => {
  assert.deepEqual(BANDS.map(([n]) => n), [1, 10, 50, 250]);
  const want = [[1, '1–9'], [9, '1–9'], [10, '10–49'], [49, '10–49'], [50, '50–249'], [249, '50–249'], [250, '250 or more'], [100000, '250 or more']];
  for (const [n, b] of want) assert.equal(bandOf(n), b, String(n));
  for (const n of [0, -3, 1.5, 9.5, '10', null, undefined, NaN, Infinity, 2 ** 60]) assert.equal(bandOf(n), null, String(n));
});

// ── a real planting, measured ───────────────────────────────────────────────────────────────────────────────────────────
test('the receipt carries the plan, the business by kind and size band only, the agents and every file’s hash', () => {
  assert.equal(PLAN_A.ok, true);
  assert.equal(RA.ok, true, RA.why);
  assert.equal(RA.why, '');
  assert.equal(RA.v, RECEIPT_MODEL);
  assert.equal(RA.hash, sha256(RA.body));
  assert.equal(RA.pub, KEYS.pub);
  assert.equal(BA.v, RECEIPT_MODEL);
  assert.equal(BA.at, '2026-10-15');
  assert.deepEqual(BA.plan, { hash: PLAN_A.planHash, seed: 1 });
  assert.equal(PLAN_A.office.headcountToday, 52);      // 12 service staff given; every other line at the model office's numbers
  assert.deepEqual(BA.business, { type: 'retail', kind: 'Online retail', headcount: 52, band: '50–249', modelled: true });
  assert.deepEqual(BA.agents, { on: PLAN_A.suite.agents.map((a) => a.id), off: PLAN_A.suite.off.map((a) => a.id) });
  assert.deepEqual(BA.files, IN_A.files.map((f, i) => ({ name: f.name, hash: sha256(f.text), chars: f.text.length, rows: PLAN_A.files[i].rows,
    kind: PLAN_A.files[i].kind, job: PLAN_A.files[i].domain, used: PLAN_A.files[i].used })));
  assert.deepEqual(BA.files.map((f) => [f.kind, f.job, f.rows]), [['decisions', 'credit', 600], ['outcomes', 'churn', 855]]);
  assert.equal(BA.live, null);
});

test('each job grown from an outcomes file: before (doing nothing) and after (the brain) on the same rows it never grew on', () => {
  for (const [d, text] of [['churn', CHURN]]) {
    const pj = planJob(PLAN_A, d), j = jobOf(BA, d), c = j.checked;
    const mine = heldCount(text, pj);
    assert.equal(mine.n, pj.pattern.held, d);
    assert.equal(mine.brain.right, Math.round(pj.pattern.heldAcc * pj.pattern.held), d + ': this file’s scorer agrees with the grower’s own held-out accuracy');
    assert.deepEqual({ job: j.job, agent: j.agent, source: j.source, verified: j.verified, reverify: j.reverify, file: j.file, shippedAuc: j.shippedAuc, logs: j.logs },
      { job: d, agent: pj.agent, source: 'grown', verified: true, reverify: false, file: d + '.csv', shippedAuc: null, logs: [] });
    assert.equal(c.rows, mine.n);
    assert.equal(c.train, pj.pattern.train);
    assert.equal(c.positives, mine.positives);
    const neg = mine.n - mine.positives;
    assert.deepEqual(c.doNothing, { right: neg, permille: permille(neg, mine.n), flagged: 0, caught: 0, caughtPermille: 0, flaggedRealPermille: null });
    assert.equal(c.past, null, 'an outcomes file records no past decisions');
    const b = mine.brain;
    assert.deepEqual(c.brain, { right: b.right, permille: permille(b.right, mine.n), flagged: b.flagged, caught: b.caught, caughtPermille: permille(b.caught, mine.positives),
      flaggedRealPermille: permille(b.caught, b.flagged), auc: Math.round(pj.heldAuc * 1000),
      // every held-out row lies inside what the brain grew on, so it answers them all itself
      answered: mine.n, answeredPermille: 1000, answeredRight: b.right, answeredRightPermille: permille(b.right, mine.n) });
  }
});

test('a brain grown from the business’s own decision log: its past decisions and the brain, side by side on the same rows', () => {
  const pj = planJob(PLAN_A, 'credit'), j = jobOf(BA, 'credit'), c = j.checked;
  assert.equal(pj.file, 'credit-decisions.csv');
  const mine = heldCount(LOG, pj, (i) => oldRule(LOG_ROWS[i]));
  assert.equal(c.rows, mine.n);
  assert.equal(c.rows, 180);
  assert.equal(c.positives, mine.positives);
  const p = mine.past;
  assert.deepEqual(c.past, { right: p.right, permille: permille(p.right, mine.n), flagged: p.flagged, caught: p.caught, caughtPermille: permille(p.caught, mine.positives), flaggedRealPermille: permille(p.caught, p.flagged) });
  assert.ok(p.flagged > 0 && p.caught > 0 && p.caught < mine.positives, 'the old rule caught some defaults and missed some');
  assert.equal(c.brain.right, mine.brain.right);
  assert.equal(c.brain.caught, mine.brain.caught);
  assert.equal(c.brain.flagged, mine.brain.flagged);
  // the log's own check, as the plan measured it — over every logged decision, not the brain's rows
  const g = pj.legacy[0];
  assert.deepEqual(j.logs, [{ file: 'credit-decisions.csv', held: g.n, agree: g.same, agreePermille: permille(g.same, g.n), pastN: 600, pastPermille: Math.round(g.pastAccuracy * 1000) }]);
  const right = LOG_ROWS.filter((r) => (oldRule(r) === 'decline') === (r[LABEL] === 1)).length;
  assert.equal(j.logs[0].pastPermille, permille(right, 600), 'the plan’s past accuracy is this file’s own count over all 600');
});

test('a shipped brain is reported on its published data, never as measured on theirs', () => {
  for (const d of ['shopper', 'fraud', 'inventory', 'maintenance', 'energy', 'intrusion']) {
    const j = jobOf(BA, d), pj = planJob(PLAN_A, d);
    assert.deepEqual(j, { job: d, agent: pj.agent, source: 'shipped', verified: true, reverify: true, file: null, checked: null, shippedAuc: Math.round(PATTERNS[d].heldAuc * 1000), logs: [] });
  }
  assert.deepEqual(BA.jobs.map((j) => j.job), PLAN_A.jobs.map((j) => j.domain));
});

test('the office comparison is re-run on the headcount given at planting: today, AI-native, the move, the payback', () => {
  const f = fitPlan(fitInput(IN_A.business.pairs), OFFICE, BASIS);
  const o = BA.office, po = PLAN_A.office;
  const today = po.todayTotal, aiNative = po.aiNativeTotal, move = Math.round(f.transition.total), investment = Math.round(f.payback.investment), monthly = Math.round(f.payback.monthlySaving);
  const label = new Map(formFields(OFFICE).map((x) => [x.id, x.label]));
  assert.deepEqual(o, { measured: true, years: 5, headcount: 52, aiNativeHeadcount: po.headcountAiNative, today, aiNative, saving: today - aiNative,
    savingPermille: permille(today - aiNative, today), move, net: today - aiNative - move, investment, monthlySaving: monthly, paybackTenths: Math.round(investment / monthly * 10),
    modelled: po.modelled.map((id) => label.get(id)), figures: sha256(JSON.stringify({ base: OFFICE, basis: BASIS })) });
  assert.ok(o.modelled.includes('Leadership') && o.modelled.length === 7);
  assert.ok(move > 0 && monthly > 0 && investment > move);
  // C gives every line: nothing is modelled
  assert.deepEqual(BC.office.modelled, []);
  // files the plan could not use, named as the plan names them; a file with no text has no hash
  assert.deepEqual(BC.files, [
    { name: 'an unnamed file', hash: null, chars: 0, rows: 0, kind: 'unknown', job: null, used: false },
    { name: 'an unnamed file', hash: sha256('a,b\n1,2'), chars: 7, rows: PLAN_C.files[1].rows, kind: 'unknown', job: null, used: false },
    { name: 'an unnamed file', hash: null, chars: 0, rows: 0, kind: 'unknown', job: null, used: false }]);
  assert.equal(BC.business.modelled, false);
  assert.equal(BC.business.headcount, PLAN_C.office.headcountToday);
  assert.equal(BC.business.band, bandOf(PLAN_C.office.headcountToday));
});

test('bridges are carried as reported; a missing or malformed field is null, never invented', () => {
  assert.deepEqual(BA.bridges, [{ kind: 'bank statement into the books', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64), rows: 3, rejected: 0, totals: [['paidIn', 30000], ['paidOut', -145000]] }]);
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['t' + String(i).padStart(2, '0'), i]));
  const long = 'k'.repeat(70);
  return buildPlantingReceipt({ ...C, bridges: [
    { kind: '', inputHash: 'A'.repeat(64), outputHash: 'b'.repeat(63), rows: -1, rejected: 1.5, totals: { b: 2, a: 1.5, c: 'x', d: -7 } },
    null, 'a string', { kind: 5, totals: 'abc', rows: 0, rejected: 2 ** 53 }, { totals: null, inputHash: 5 }, { kind: 'x'.repeat(80), totals: many }, { totals: { [long]: 1 } },
    ...Array.from({ length: MAX_BRIDGES }, () => BRIDGE)] }, KEYS).then((r) => {
    const br = body(r).bridges;
    assert.equal(br.length, MAX_BRIDGES);
    const empty = { kind: null, inputHash: null, outputHash: null, rows: null, rejected: null, totals: [] };
    assert.deepEqual(br[0], { ...empty, totals: [['b', 2], ['d', -7]] });
    assert.deepEqual(br[1], empty);
    assert.deepEqual(br[2], empty);
    assert.deepEqual(br[3], { ...empty, rows: 0 });
    assert.deepEqual(br[4], empty);
    assert.equal(br[5].kind, 'x'.repeat(60));
    assert.deepEqual(br[5].totals.map(([k]) => k), Array.from({ length: MAX_TOTALS }, (_, i) => 't' + String(i).padStart(2, '0')));
    assert.deepEqual(br[6].totals, [['k'.repeat(60), 1]]);
    assert.deepEqual(br[7], body(RA).bridges[0]);
  });
});

test('a plan with no headcount, no shipped brains, a brain that failed its check and a log that does not read as yes/no', () => {
  assert.equal(RB.ok, true, RB.why);
  assert.deepEqual(BB.office, { measured: false, why: PLAN_B.office.why });
  assert.deepEqual(BB.business, { type: 'other', kind: 'Other', headcount: null, band: null, modelled: false });
  const fraud = jobOf(BB, 'fraud');
  assert.equal(fraud.source, 'grown');
  assert.equal(fraud.verified, false);
  assert.ok(planJob(PLAN_B, 'fraud').heldAuc < 0.6, 'random columns teach nothing');
  // below the gate the brain answers nothing itself: every case goes to a person
  assert.deepEqual([fraud.checked.brain.answered, fraud.checked.brain.answeredPermille, fraud.checked.brain.answeredRight, fraud.checked.brain.answeredRightPermille], [0, 0, 0, null]);
  assert.equal(fraud.checked.rows, 120);
  const credit = jobOf(BB, 'credit');
  assert.equal(credit.file, 'credit-old.csv');
  assert.equal(credit.checked.past, null, 'its decisions do not say which means yes, so they are not scored');
  assert.equal(credit.logs[0].pastPermille, null);
  assert.equal(credit.logs[0].file, 'credit-old.csv');
  const maint = jobOf(BB, 'maintenance');
  assert.deepEqual([maint.source, maint.verified, maint.checked, maint.file], ['grown', false, null, 'maint-tiny.csv']);
  for (const d of ['shopper', 'churn', 'inventory', 'energy', 'intrusion']) assert.deepEqual([jobOf(BB, d).source, jobOf(BB, d).checked, jobOf(BB, d).shippedAuc], ['none', null, null]);
  assert.deepEqual(BB.files.map((f) => [f.kind, f.job, f.used]), [['outcomes', 'fraud', true], ['decisions', 'credit', true], ['outcomes', 'maintenance', true], ['bank', null, false]]);
});

// ── signed, checked, reproduced ─────────────────────────────────────────────────────────────────────────────────────
test('the receipt is signed over its exact body bytes, verifies, and reproduces byte for byte from the same inputs', async () => {
  assert.equal(await verify(RA.pub, RA.sig, utf8(RA.body)), true);
  assert.equal(canonical(BA), RA.body, 'the body is canonical JSON');
  for (const r of [RA, RB, RC]) assert.deepEqual(await verifyPlantingReceipt(r), { ok: true, why: '' });
  assert.deepEqual(reproducePlantingReceipt(RA, A), { ok: true, identical: true, why: '', hash: RA.hash });
  const again = await buildPlantingReceipt(clone(A), KEYS);
  assert.equal(again.body, RA.body);
  assert.equal(again.sig, RA.sig, 'Ed25519 is deterministic: the same body, the same signature');
  const other = await buildPlantingReceipt(C, OTHER);
  assert.equal(other.body, RC.body);
  assert.equal(other.pub, OTHER.pub);
  assert.notEqual(other.sig, RC.sig);
  const later = reproducePlantingReceipt(RC, { ...C, at: '2026-10-16' });
  assert.deepEqual(later, { ok: true, identical: false, why: 'the same inputs give a different body: this receipt was not made from them', hash: sha256(canonical({ ...BC, at: '2026-10-16' })) });
  assert.equal(reproducePlantingReceipt(RC, { ...C, bridges: [BRIDGE] }).identical, false);
  assert.deepEqual(reproducePlantingReceipt(RC, { ...C, at: 'today' }), { ok: false, identical: false, why: 'the receipt’s date must be given as YYYY-MM-DD', hash: '' });
  assert.deepEqual(reproducePlantingReceipt(null, C), { ok: false, identical: false, why: 'the inputs could not be read', hash: '' });
});

test('the receipt is refused, with the reason, when its inputs do not hold together', async () => {
  const no = async (input, why, keys = KEYS) => {
    const r = await buildPlantingReceipt(input, keys);
    assert.deepEqual(r, { ok: false, why, v: RECEIPT_MODEL, body: '', hash: '', sig: '', pub: '' });
  };
  const DATE = 'the receipt’s date must be given as YYYY-MM-DD';
  for (const at of [undefined, '2026-1-5', '15/10/2026', 20261015, ' 2026-10-15', ['2026-10-15'], { toString: () => '2026-10-15' }]) await no({ ...A, at }, DATE);
  await no(null, DATE);
  const SEAL = 'the plan is not sealed: its hash does not recompute, so it has been changed since it was made';
  await no({ ...A, plan: null }, SEAL);
  const flipped = clone(PLAN_A); flipped.jobs[1].verified = !flipped.jobs[1].verified;
  await no({ ...A, plan: flipped }, SEAL);
  const reseal = (change) => { const p = clone(PLAN_A); change(p); p.planHash = hashPlan(p); return p; };
  await no({ ...A, plan: reseal((p) => { p.ok = 'yes'; }) }, SEAL);
  await no({ ...A, plan: reseal((p) => { p.model = 'sovereign-enterprise/plant/0'; }) }, SEAL);
  const KIND = 'the planting input names a different kind of business from the plan';
  await no({ ...A, before: { ...IN_A, business: { ...IN_A.business, type: 'services' } } }, KIND);
  await no({ ...A, before: { files: IN_A.files } }, KIND);
  await no({ ...A, before: null }, KIND);
  await no({ ...A, before: { ...IN_A, files: IN_A.files.slice(1) } }, 'the files given are not the plan’s files: the plan read 2, 1 were given');
  await no({ ...A, before: { ...IN_A, files: 'x' } }, 'the files given are not the plan’s files: the plan read 2, 0 were given');
  await no({ ...A, before: { ...IN_A, files: [IN_A.files[0], { ...IN_A.files[1], name: 'leavers.csv' }] } }, 'the files given are not the plan’s files: file 2 is leavers.csv, the plan read churn.csv');
  // the files are tied to the plan by the brains: each must reproduce its own held-out score on the file it grew from
  const NOT_CHURN = 'the churn brain does not reproduce its own held-out score on churn.csv — it is not the file the plan grew it from';
  const lines = CHURN.split('\n');
  const swap = (text) => ({ ...A, before: { ...IN_A, files: [IN_A.files[0], { name: 'churn.csv', text }] } });
  await no(swap([lines[0], ...lines.slice(2), lines[1]].join('\n')), NOT_CHURN);
  await no(swap(lines.slice(0, 100).join('\n')), NOT_CHURN);
  await no(swap(lines.map((l, i) => (i ? l : l.replace('callFailures', 'droppedCalls'))).join('\n')), NOT_CHURN);
  const k = PLAN_A.jobs.findIndex((j) => j.domain === 'churn');
  for (const field of ['heldAuc', 'heldAcc', 'held']) {
    await no({ ...A, plan: reseal((p) => { p.jobs[k].pattern[field] += field === 'held' ? 1 : 0.000001; }) }, NOT_CHURN);
  }
  // the office comparison must re-run to the plan's own totals
  await no({ ...A, office: { basis: BASIS } }, 'the office comparison does not re-run: the modelled office is missing');
  await no({ ...A, office: null }, 'the office comparison does not re-run: the modelled office is missing');
  const TOTALS = 'the office comparison does not re-run: the headcount given at planting does not give the plan’s own totals';
  await no({ ...A, before: { ...IN_A, business: { type: 'retail', pairs: [{ id: 'service', value: 13 }] } } }, TOTALS);
  await no({ ...A, plan: reseal((p) => { p.office.todayTotal += 1; }) }, TOTALS);
  await no({ ...A, plan: reseal((p) => { p.office.aiNativeTotal -= 1; }) }, TOTALS);
  // the signer
  await no(C, 'the keys do not match: the signature does not verify under this public key', { pub: OTHER.pub, priv: KEYS.priv });
  await no(C, 'the receipt could not be made from these inputs', null);
  await no(C, 'the receipt could not be made from these inputs', { pub: KEYS.pub });
});

test('verify: a change to any field, or a body that no longer adds up, is caught — and says which', async () => {
  const fails = async (r, why) => assert.deepEqual(await verifyPlantingReceipt(r), { ok: false, why });
  const CHANGED = 'the body does not match its hash: it has been changed';
  await fails({ ...RA, body: RA.body.replace('"at":"2026-10-15"', '"at":"2026-10-16"') }, CHANGED);
  await fails({ ...RA, hash: RB.hash }, CHANGED);
  const SIG = 'the signature does not verify: it was not signed by this key, or it has been changed';
  await fails({ ...RA, sig: RB.sig }, SIG);
  await fails({ ...RA, pub: OTHER.pub }, SIG);
  await fails({ ...RA, sig: '' }, SIG);
  const NOT = 'it is not a planting receipt';
  await fails({ ...RA, v: 'sovereign-enterprise/receipt/2' }, NOT);
  await fails({ ...RA, body: BA }, NOT);
  await fails({ ...RA, body: 5, hash: sha256('5') }, NOT);
  // a signer who signs a body that does not hold up is still caught
  const spaced = JSON.stringify(BA, null, 1);
  await fails({ ...RA, body: spaced, hash: sha256(spaced), sig: await sign(KEYS, utf8(spaced)) }, 'the body is not in canonical form');
  await fails(await resign(RA, (b) => { b.v = 'x'; }), 'the body is not a planting receipt');
  const BAND = 'the size band does not follow from the headcount';
  await fails(await resign(RA, (b) => { b.business.band = '10–49'; }), BAND);
  const BIZ = 'the business does not match its office comparison';
  await fails(await resign(RA, (b) => { b.business.headcount = 53; }), BIZ);
  await fails(await resign(RA, (b) => { b.business.modelled = false; }), BIZ);
  await fails(await resign(RC, (b) => { b.business.modelled = true; }), BIZ);
  await fails(await resign(RB, (b) => { b.business.headcount = 5; b.business.band = '1–9'; }), BIZ);
  await fails(await resign(RB, (b) => { b.business.modelled = true; }), BIZ);
  const OFF = 'the office figures do not add up';
  for (const f of ['saving', 'savingPermille', 'net', 'paybackTenths']) await fails(await resign(RA, (b) => { b.office[f] += 1; }), OFF);
  // the payback boundary: no monthly saving, no payback
  const noSaving = await resign(RA, (b) => { b.office.monthlySaving = 0; b.office.paybackTenths = null; });
  assert.deepEqual(await verifyPlantingReceipt(noSaving), { ok: true, why: '' });
  await fails(await resign(RA, (b) => { b.office.monthlySaving = 0; }), OFF);
  // the jobs: every share follows from its counts
  const job = (b, d) => b.jobs.find((j) => j.job === d);
  const SH = 'the credit job: its before and after shares do not follow from its counts';
  for (const line of ['doNothing', 'past', 'brain']) {
    for (const f of ['permille', 'caughtPermille', 'flaggedRealPermille']) {
      await fails(await resign(RA, (b) => { const s = job(b, 'credit').checked[line]; s[f] = s[f] === null ? 1 : s[f] + 1; }), SH);
    }
  }
  const counts = (b) => job(b, 'credit').checked;
  await fails(await resign(RA, (b) => { const c = counts(b), s = c.brain; s.right = c.rows + 1; s.permille = Math.round(s.right / c.rows * 1000); }), SH);
  await fails(await resign(RA, (b) => { const c = counts(b), s = c.brain; s.right = -1; s.permille = Math.round(-1 / c.rows * 1000); }), SH);
  await fails(await resign(RA, (b) => { const c = counts(b), s = c.past; s.flagged = c.rows + 1; s.flaggedRealPermille = Math.round(s.caught / s.flagged * 1000); }), SH);
  await fails(await resign(RA, (b) => { const c = counts(b), s = c.past; s.caught = s.flagged + 1; s.caughtPermille = Math.round(s.caught / c.positives * 1000); s.flaggedRealPermille = Math.round(s.caught / s.flagged * 1000); }), SH);
  await fails(await resign(RA, (b) => { const c = counts(b), s = c.brain; s.flagged = c.rows; s.caught = c.positives + 1; s.caughtPermille = Math.round(s.caught / c.positives * 1000); s.flaggedRealPermille = Math.round(s.caught / s.flagged * 1000); }), SH);
  await fails(await resign(RA, (b) => { counts(b).positives += 1; }), 'the credit job: its count of cases to catch does not follow from the do-nothing line');
  const ANS = 'the credit job: its answered share does not follow from its counts';
  await fails(await resign(RA, (b) => { const c = counts(b); c.brain.answered = c.rows + 1; c.brain.answeredPermille = Math.round(c.brain.answered / c.rows * 1000); }), ANS);
  await fails(await resign(RA, (b) => { counts(b).brain.answeredPermille -= 1; }), ANS);
  await fails(await resign(RA, (b) => { const a = counts(b).brain; a.answeredRight = a.answered + 1; a.answeredRightPermille = Math.round(a.answeredRight / a.answered * 1000); }), ANS);
  await fails(await resign(RA, (b) => { counts(b).brain.answeredRightPermille += 1; }), ANS);
  const LOGW = 'the credit job: a past-decision check does not follow from its counts';
  await fails(await resign(RA, (b) => { job(b, 'credit').logs[0].agreePermille += 1; }), LOGW);
  await fails(await resign(RA, (b) => { const g = job(b, 'credit').logs[0]; g.agree = g.held + 1; g.agreePermille = Math.round(g.agree / g.held * 1000); }), LOGW);
  await fails(await resign(RB, (b) => { job(b, 'credit').logs[0].agreePermille += 1; }), LOGW);
  // a log on a job with no checked rows is still checked
  await fails(await resign(RA, (b) => { job(b, 'shopper').logs = [{ file: 'x.csv', held: 10, agree: 5, agreePermille: 499, pastN: 10, pastPermille: null }]; }), 'the shopper job: a past-decision check does not follow from its counts');
  await fails(await resign(RA, (b) => { b.jobs = 'x'; }), 'the receipt could not be read');
});

test('verify never throws, and refuses every piece of junk', async () => {
  for (const [label, j] of hostileInputs()) {
    const r = await verifyPlantingReceipt(j);
    assert.equal(r.ok, false, label);
    assert.equal(typeof r.why, 'string');
  }
  assert.equal((await verifyPlantingReceipt({ ...RA, body: '5', hash: sha256('5'), sig: await sign(KEYS, utf8('5')) })).ok, false);
});

// ── live: read from a real company's spine ──────────────────────────────────────────────────────────────────────────
test('afterFromSpine counts by hand-built decisions: held, finished with a known outcome, right — per agent', () => {
  const D = [
    { agent: 'service', event: 'e1', domain: 'churn', action: 'retain', state: 'done' },           // yes, and it was: right
    { agent: 'service', event: 'e2', domain: 'churn', action: 'standard-reply', state: 'done' },   // no, but it was: wrong
    { agent: 'service', event: 'e3', domain: 'churn', action: 'retain', state: 'watch' },          // held for a person
    { agent: 'finance', event: 'e4', domain: 'fraud', action: 'release-payment', state: 'done' },  // no, and it was not: right
    { agent: 'finance', event: 'e5', domain: 'fraud', action: 'hold-payment', state: 'done' },     // outcome not known yet
    { agent: 'door', event: 'e6', domain: '', action: '', label: -1, status: 'open', channel: 'fraud' },   // no agent free: held
    { agent: 'ops', event: 'e7', domain: 'constructor', state: 'done' },                           // no action for this domain: wrong
    { agent: 'ops', event: 'e8', domain: 'energy', action: 'shed-load', state: 'done' },           // outcome 2: not an outcome
    { agent: 'sales', event: 'toString', domain: 'shopper', action: 'fast-track', state: 'done' },  // no such outcome (not inherited)
    null, 'junk', 7, { agent: 5, state: 'done', event: 'e1' }, { agent: 'sales', event: 'e1', status: 'open' }, { agent: 'sales', event: 'e1', state: 'maybe' },
  ];
  const OUT = { e1: 1, e2: 1, e3: 0, e4: 0, e5: undefined, e6: 1, e7: 0, e8: 2 };
  const want = { decisions: 9, held: 2, done: 4, right: 2, automatedPermille: 778, rightPermille: 500, perAgent: [
    { agent: 'door', decisions: 1, held: 1, done: 0, right: 0, rightPermille: null },
    { agent: 'finance', decisions: 2, held: 0, done: 1, right: 1, rightPermille: 1000 },
    { agent: 'ops', decisions: 2, held: 0, done: 1, right: 0, rightPermille: 0 },
    { agent: 'sales', decisions: 1, held: 0, done: 0, right: 0, rightPermille: null },
    { agent: 'service', decisions: 3, held: 1, done: 2, right: 1, rightPermille: 500 },
  ] };
  assert.deepEqual(afterFromSpine(D, OUT), want);
  assert.deepEqual(afterFromSpine(D, new Map(Object.entries(OUT))), want);
  // a label is read back from the action in its own job only
  assert.deepEqual(afterFromSpine([{ agent: 'service', event: 'x', domain: 'churn', action: 'hold-payment', state: 'done' }], { x: 0 }).right, 0);
  assert.deepEqual(afterFromSpine([{ agent: 'service', event: 'x', domain: 'churn', action: 'standard-reply', state: 'done' }], { x: 0 }).right, 1);
  const inherited = afterFromSpine([{ agent: 'service', event: 'e9', domain: 'churn', action: 'retain', state: 'done' }], Object.create({ e9: 1 }));
  assert.deepEqual([inherited.done, inherited.right], [0, 0], 'an outcome the object only inherits is not an outcome');
  // no outcomes yet: nothing is finished with a known outcome
  const blind = afterFromSpine(D, null);
  assert.deepEqual([blind.decisions, blind.held, blind.done, blind.right, blind.rightPermille], [9, 2, 0, 0, null]);
  assert.deepEqual(afterFromSpine(D, 'outcomes'), blind);
  const NONE = { decisions: 0, held: 0, done: 0, right: 0, automatedPermille: null, rightPermille: null, perAgent: [] };
  assert.deepEqual(afterFromSpine([], OUT), NONE);
  assert.deepEqual(afterFromSpine('x', OUT), NONE);
  const toxic = { agent: 'sales', state: 'done', get event() { throw new Error('boom'); } };
  assert.deepEqual(afterFromSpine([toxic], OUT), NONE);
  for (const [label, j] of hostileInputs()) {
    assert.doesNotThrow(() => afterFromSpine(j, j), label);
    assert.doesNotThrow(() => afterFromSpine([j], j), label);
  }
});

// the company, run on its own spine: a working day with a spell where every agent is away (the door holds that work)
const index = INDEX, real = Object.fromEntries(Object.entries(INDEX).filter(([d, m]) => m.sample && d !== 'shopper').map(([d, m]) => [d, read('brains/' + m.sample)]));
const CO = createCompany({ index, patterns: PATTERNS, shopper: read('brains/shopper.sample.json'), real }, { seed: 7, date: () => '2026-10-15', log: () => {} });
await CO.boot();
const WORKERS = ['sales', 'service', 'finance', 'ops', 'systems'];
while (CO.n < 30) await CO.tick({ events: 3 });
for (const id of WORKERS) CO.online[id] = false;
await CO.tick({ events: 2 });
for (const id of WORKERS) CO.online[id] = true;
while (CO.n < 45) await CO.tick({ events: Math.min(3, 45 - CO.n) });
await CO.drain();
const SPINE = [...CO.nodes.owner.list('decisions'), ...CO.nodes.owner.list('watch').filter((w) => w.agent === 'door')];

test('end to end on the real spine: the live results match the company’s own board summary, decision for decision', async () => {
  const s = CO.summary('owner');
  const live = afterFromSpine(SPINE, CO.truthOf);
  // of the two pieces of work that arrived while every agent was away, the card payment waits for the Finance agent (money
  // work is decided only by its own agent, which was offline, not fired); the web session no agent could take went to the door
  assert.equal(SPINE.filter((x) => x.agent === 'door').length, 1, 'the one piece of work no agent could take');
  assert.equal(live.decisions, s.decisions);
  assert.equal(live.decisions, 45);
  assert.equal(live.held, s.toHumans);
  assert.equal(live.done, s.done);
  assert.equal(live.right, s.correct);
  assert.equal(live.automatedPermille, s.automatedPermille);
  assert.equal(live.rightPermille, s.rightPermille);
  for (const id of WORKERS) {
    const a = live.perAgent.find((x) => x.agent === id);
    assert.deepEqual({ done: a.done, correct: a.right, watched: a.held }, { done: s.perAgent[id].done, correct: s.perAgent[id].correct, watched: s.perAgent[id].watched }, id);
  }
  assert.deepEqual(live.perAgent.find((x) => x.agent === 'door'), { agent: 'door', decisions: 1, held: 1, done: 0, right: 0, rightPermille: null });
  // the receipt made after the company has run carries them, signed
  const r = await buildPlantingReceipt({ ...A, after: { decisions: SPINE, outcomes: CO.truthOf } }, KEYS);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(body(r).live, live);
  assert.deepEqual(await verifyPlantingReceipt(r), { ok: true, why: '' });
  assert.equal(reproducePlantingReceipt(r, { ...A, after: { decisions: SPINE, outcomes: CO.truthOf } }).identical, true);
  assert.notEqual(r.body, RA.body, 'the planting-day receipt is a different receipt');
  const fails = async (change, why) => assert.deepEqual(await verifyPlantingReceipt(await resign(r, change)), { ok: false, why });
  const LIVE = 'the live shares do not follow from the live counts';
  await fails((b) => { b.live.automatedPermille += 1; }, LIVE);
  await fails((b) => { b.live.rightPermille -= 1; }, LIVE);
  await fails((b) => { b.live.held = b.live.decisions + 1; b.live.automatedPermille = Math.round(-1 / b.live.decisions * 1000); }, LIVE);
  await fails((b) => { b.live.done = b.live.decisions - b.live.held + 1; b.live.rightPermille = Math.round(b.live.right / b.live.done * 1000); }, LIVE);
  await fails((b) => { b.live.right = b.live.done + 1; b.live.rightPermille = Math.round(b.live.right / b.live.done * 1000); }, LIVE);
  const PER = 'the per-agent counts do not add up to the totals';
  for (const f of ['decisions', 'held', 'done', 'right']) await fails((b) => { b.live.perAgent[1][f] += 1; }, PER);
  await fails((b) => { b.live.perAgent[1].rightPermille -= 1; }, PER);
  await fails((b) => { const a = b.live.perAgent[1], z = b.live.perAgent[2]; a.right = a.done + 1; z.right -= 1; a.rightPermille = Math.round(a.right / a.done * 1000); z.rightPermille = Math.round(z.right / z.done * 1000); }, PER);
  // the boundary: a held count equal to the decisions, a finished count of zero, is a real company with nothing automated
  const allHeld = await resign(r, (b) => { b.live = { decisions: 2, held: 2, done: 0, right: 0, automatedPermille: 0, rightPermille: null, perAgent: [{ agent: 'door', decisions: 2, held: 2, done: 0, right: 0, rightPermille: null }] }; });
  assert.deepEqual(await verifyPlantingReceipt(allHeld), { ok: true, why: '' });
  const html = receiptHtml(r);
  assert.equal(balanced(html), '');
  assert.ok(html.includes('<div class="kpi"><div class="v">45</div><div class="l">decisions made</div></div>'));
  assert.ok(html.includes('right, of the ' + live.done + ' finished calls whose outcome is known'));
  assert.ok(html.includes('<td>The door (no agent free)</td><td>1</td><td>1</td><td>0</td><td>not measured</td>'));
  assert.ok(html.includes('<td>Finance agent</td>'));
  assert.ok(!html.includes('The company has not run yet'));
  const sc = showcase(r);
  assert.deepEqual(sc.live, { decisions: live.decisions, held: live.held, done: live.done, right: live.right, automatedPermille: live.automatedPermille, rightPermille: live.rightPermille });
});

// ── the showcase for the next prospect ──────────────────────────────────────────────────────────────────────────────
const keysIn = (x, out = new Set()) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (!Array.isArray(x)) out.add(k); keysIn(v, out); } return out; };
test('showcase: the before → after numbers and the hashes, and nothing that names the business or its files', () => {
  const s = showcase(RA);
  assert.equal(s.v, SHOWCASE_MODEL);
  assert.equal(s.receipt, RA.hash);
  assert.equal(s.plan, PLAN_A.planHash);
  assert.equal(s.month, '2026-10');
  assert.deepEqual(s.business, { type: 'retail', kind: 'Online retail', band: '50–249', modelled: true });
  assert.deepEqual(s.files, IN_A.files.map((f, i) => ({ hash: sha256(f.text), kind: PLAN_A.files[i].kind, job: PLAN_A.files[i].domain })));
  const credit = s.jobs.find((j) => j.job === 'credit');
  const full = jobOf(BA, 'credit');
  assert.deepEqual(credit, { job: 'credit', source: 'grown', verified: true, reverify: false, shippedAuc: null,
    checked: { rows: full.checked.rows, doNothing: full.checked.doNothing, past: full.checked.past, brain: full.checked.brain },
    logs: [{ held: full.logs[0].held, agree: full.logs[0].agree, agreePermille: full.logs[0].agreePermille, pastPermille: full.logs[0].pastPermille }] });
  assert.deepEqual(s.jobs.find((j) => j.job === 'shopper'), { job: 'shopper', source: 'shipped', verified: true, reverify: true, shippedAuc: jobOf(BA, 'shopper').shippedAuc, checked: null, logs: [] });
  assert.deepEqual(s.office, { measured: true, years: 5, savingPermille: BA.office.savingPermille, paybackTenths: BA.office.paybackTenths });
  assert.deepEqual(s.bridges, [{ kind: BRIDGE.kind, inputHash: BRIDGE.inputHash, outputHash: BRIDGE.outputHash, rows: 3, rejected: 0 }]);
  assert.equal(s.live, null);
  // nothing that identifies: no names, no headcount, no money, no bridge totals, no date finer than the month
  const text = JSON.stringify(s);
  for (const leak of ['credit-decisions.csv', 'churn.csv', 'oldRuleDecision', '2026-10-15', 'paidIn', String(BA.office.today), String(BA.office.aiNative), String(BA.office.move), String(BA.office.monthlySaving)]) {
    assert.ok(!text.includes(leak), 'the showcase leaks ' + leak);
  }
  const keys = keysIn(s);
  for (const k of ['name', 'file', 'headcount', 'aiNativeHeadcount', 'today', 'aiNative', 'saving', 'move', 'net', 'investment', 'monthlySaving', 'totals', 'chars', 'rows_in_file', 'at', 'pastN', 'train', 'modelled_lines', 'figures', 'perAgent', 'pub', 'sig']) {
    assert.ok(!keys.has(k), 'the showcase carries ' + k);
  }
  assert.deepEqual(showcase(RB).office, { measured: false });
  assert.equal(showcase(RB).business.band, null);
});

test('showcase: junk, a changed body or a body that is not a receipt gives nothing', async () => {
  assert.equal(showcase({ ...RA, body: RA.body.replace('"retail"', '"trades"') }), null);
  const notReceipt = { ...BA, v: 'something-else' };
  assert.equal(showcase(unsigned(notReceipt)), null);
  assert.notEqual(showcase(unsigned(BA)), null, 'the showcase reads the body its hash vouches for; the signature is verify’s job');
  for (const [label, j] of hostileInputs()) assert.equal(showcase(j), null, label);
});

/** '' when every opened tag is closed in order (the same check test/explain.test.mjs makes of the page's own views) */
function balanced(html) {
  const VOID = new Set(['br', 'input', 'img', 'hr', 'meta', 'link']);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1]) { if (stack.pop() !== tag) return 'mismatched </' + tag + '>'; }
    else if (!m[3] && !VOID.has(tag)) stack.push(tag);
  }
  return stack.length ? 'unclosed <' + stack.at(-1) + '>' : '';
}

// ── the printable receipt ─────────────────────────────────────────────────────────────────────────────────────────────
const pct = (p) => (p === null ? 'not measured' : (p / 10).toFixed(1) + '%');
test('receiptHtml: one page in plain words — every number beside where it comes from', () => {
  const h = receiptHtml(RA);
  for (const r of [RA, RB, RC]) assert.equal(balanced(receiptHtml(r)), '');
  assert.ok(h.startsWith('<div class="xp"><div class="panel xp-sec"><h3>Planting receipt</h3>'));
  assert.ok(h.includes('<tr><td>Kind of business</td><td>Online retail</td></tr>'));
  assert.ok(h.includes('<tr><td>Size</td><td>50–249 people (counting the model office’s numbers for the lines not given)</td></tr>'));
  assert.ok(h.includes('<tr><td>Date</td><td>2026-10-15</td></tr>'));
  assert.ok(h.includes(PLAN_A.planHash) && h.includes(RA.hash) && h.includes(KEYS.pub));
  assert.ok(h.includes('<tr><td>Agents switched on</td><td>Sales agent, Service agent, Finance agent, Ops agent, Systems agent, Audit agent</td></tr>'));
  // the churn row: doing nothing, then the brain, on the same rows
  const c = jobOf(BA, 'churn').checked;
  assert.ok(h.includes('<b>Customers about to leave</b><br><span class="dim">Service agent</span>'));
  assert.ok(h.includes('Grown from your file <span class="mono">churn.csv</span></td><td>' + c.rows + ' cases from that file it never learned from</td>'));
  assert.ok(h.includes('<td>If nobody had acted: ' + pct(c.doNothing.permille) + ' right; caught 0 of the ' + c.positives + ' cases to catch</td>'));
  assert.ok(h.includes('<td>The brain: ' + pct(c.brain.permille) + ' right; caught ' + c.brain.caught + ' of the ' + c.positives + ' cases to catch (' + pct(c.brain.flaggedRealPermille) +
    ' of the yes calls were real)<br><span class="dim">AUC ' + (c.brain.auc / 1000).toFixed(3) + '</span></td>'));
  assert.ok(h.includes('<td>100.0% (' + c.rows + ' of ' + c.rows + ')<br><span class="dim">right on ' + pct(c.brain.answeredRightPermille) + ' of those</span></td>'));
  // the credit row: the business's own past decisions first
  const k = jobOf(BA, 'credit').checked;
  assert.ok(h.includes('<td>Your past decisions: ' + pct(k.past.permille) + ' right; caught ' + k.past.caught + ' of the ' + k.positives + ' cases to catch (' + pct(k.past.flaggedRealPermille) +
    ' of the yes calls were real)<br><span class="dim">If nobody had acted: ' + pct(k.doNothing.permille) + ' right; caught 0 of the ' + k.positives + ' cases to catch</span></td>'));
  // a shipped brain says it was measured elsewhere
  assert.ok(h.includes('<td>The shipped brain — it must pass again on your own records before it acts</td><td>Its published data, not yours</td><td>not measured — no file of yours</td><td>AUC ' +
    (jobOf(BA, 'shopper').shippedAuc / 1000).toFixed(3) + ' on its published data</td><td>—</td>'));
  // the log: its own check, over every logged decision — and it IS the brain's file here
  const g = jobOf(BA, 'credit').logs[0];
  assert.ok(h.includes('<li>Your old decisions in <span class="mono">credit-decisions.csv</span> (Credit risk): the rule re-grown from them agrees with them on ' + g.agree + ' of ' + g.held +
    ' cases it never learned from (' + pct(g.agreePermille) + '). Over all 600 logged decisions, they matched what really happened ' + pct(g.pastPermille) + ' of the time.</li>'));
  // the office, in pounds, with where it comes from
  const o = BA.office;
  const gbp = (n) => '£' + n.toLocaleString('en-GB');
  assert.ok(h.includes('<tr><td>Your office today (52 people), over 5 years</td><td>' + gbp(o.today) + '</td></tr>'));
  assert.ok(h.includes('<tr><td>The AI-native office (' + o.aiNativeHeadcount + ' people), over 5 years</td><td>' + gbp(o.aiNative) + '</td></tr>'));
  assert.ok(h.includes('<tr><td>The saving over 5 years</td><td>' + gbp(o.saving) + ' (' + pct(o.savingPermille) + ' of today’s cost)</td></tr>'));
  assert.ok(h.includes('<td>' + gbp(o.move) + '</td>') && h.includes('<tr><td>The machines and the set-up</td><td>' + gbp(o.investment - o.move) + '</td></tr>'));
  assert.ok(h.includes('<tr><td>The saving after the move</td><td>' + gbp(o.net) + '</td></tr>'));
  assert.ok(h.includes('<tr><td>Pays back in</td><td>' + (o.paybackTenths / 10).toFixed(1) + ' months — the machines, set-up and move over the first year’s monthly saving of ' + gbp(o.monthlySaving) + '</td></tr>'));
  assert.ok(h.includes('No headcount was given for ' + o.modelled.join(', ') + ' — those lines are counted at the model office’s numbers.'));
  assert.ok(h.includes('<td>bank statement into the books</td><td>3</td><td>0</td><td>paidIn: 30,000<br>paidOut: -145,000</td><td><span class="mono">aaaaaaaaaaaaaaaa… → bbbbbbbbbbbbbbbb…</span></td>'));
  assert.ok(h.includes('The company has not run yet: this receipt was made at planting.'));
  assert.ok(h.includes('<tr><td><span class="mono">credit-decisions.csv</span></td><td>a log of past decisions</td><td>600</td><td>yes</td><td><span class="mono">' + sha256(LOG).slice(0, 16) + '…</span></td></tr>'));
  assert.ok(h.includes('Thomas Frumkin') && h.includes('Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC'));
  assert.ok(!h.includes('undefined') && !h.includes('NaN') && !h.includes('null'));
});

test('receiptHtml: the plan with a failed brain, no headcount, no shipped brains and a set-aside bank statement', () => {
  const h = receiptHtml(RB);
  assert.ok(h.includes('<tr><td>Size</td><td>not measured</td></tr>'));
  assert.ok(h.includes('Grown from your file <span class="mono">fraud-random.csv</span> — <span class="warn">it did not pass its check, so this work waits for a person</span>'));
  assert.ok(h.includes('<td>0.0% (0 of 120)</td>'), 'a brain below the gate answers nothing itself');
  assert.ok(h.includes('<td>No brain grew from your file <span class="mono">maint-tiny.csv</span> — this work waits for a person</td><td>—</td><td>—</td><td>—</td><td>—</td>'));
  assert.ok(h.includes('<td>No brain yet — this work waits for a person until data arrives</td>'));
  assert.ok(h.includes('How often they were right is not measured: the file does not record what really happened, or does not say which decision means yes.'));
  assert.ok(h.includes('<p>The office comparison was not made: ' + PLAN_B.office.why + '.</p>'));
  assert.ok(h.includes('<p>No records have been brought across yet.</p>'));
  assert.ok(h.includes('<td>a bank statement — set aside</td><td>3</td><td>no</td>'));
  assert.deepEqual(BB.agents, { on: ['finance', 'audit'], off: ['sales', 'service', 'ops', 'systems'] }, 'only the credit brain passed: Finance, and Audit’s second brain grown from the same file');
  assert.ok(h.includes('<tr><td>Agents switched on</td><td>Finance agent, Audit agent</td></tr>'));
  const hc = receiptHtml(RC);
  assert.ok(!hc.includes('No headcount was given for'), 'every line was given');
  assert.ok(!hc.includes('(counting the model office'));
});

test('receiptHtml: every value from the body is escaped at the sink; the edge cases read plainly; junk gives nothing', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const b = clone(BA);
  b.files[0].name = evil;
  b.files[0].kind = 'something odd';
  b.jobs.find((j) => j.job === 'credit').file = evil;
  b.jobs.find((j) => j.job === 'credit').logs[0].file = 'another-log.csv';
  b.jobs[0].job = 'payroll';
  b.business.kind = '"><script>x</script>';
  b.bridges = [{ kind: null, inputHash: null, outputHash: null, rows: null, rejected: null, totals: [] }, { kind: evil, inputHash: null, outputHash: null, rows: 0, rejected: 0, totals: [['a&b', 0]] }];
  Object.assign(b.office, { today: 0, aiNative: 100, saving: -100, net: -100, move: 0, investment: 0, monthlySaving: -3, paybackTenths: null, modelled: [] });
  b.live = { decisions: 0, held: 0, done: 0, right: 0, automatedPermille: null, rightPermille: null, perAgent: [] };
  b.agents.on = [];
  const h = receiptHtml(unsigned(b));
  assert.equal(balanced(h), '');
  assert.ok(!h.includes('<img') && !h.includes('<script'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;') && h.includes('&quot;&gt;&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(h.includes('<td>something odd</td>') === false && h.includes('<td>not used</td>'));
  assert.ok(h.includes('<b>payroll</b>'), 'a job the page has no words for is named by its id');
  assert.ok(h.includes(' — not the cases the brain was checked on, so the two are not compared.</li>'));
  assert.ok(h.includes('<td>not given</td><td>not given</td><td>not given</td><td>none given</td><td><span class="mono">not given → not given</span></td>'));
  assert.ok(h.includes('<td>&lt;img src=x onerror=alert(1)&gt;</td><td>0</td><td>0</td><td>a&amp;b: 0</td>'));
  assert.ok(h.includes('<td>£0</td>') && h.includes('<td>−£100</td>') && h.includes('<td>£100</td>'));
  assert.ok(h.includes('<tr><td>Pays back in</td><td>no payback from running savings</td></tr>'));
  assert.ok(!h.includes('No headcount was given for'));
  assert.ok(h.includes('<tr><td>Agents switched on</td><td>none yet</td></tr>'));
  assert.ok(h.includes('<div class="v">not measured</div><div class="l">finished by the agents, without a person</div>'));
  // a changed body is shown as changed, never rendered as if it held
  assert.ok(receiptHtml({ ...RA, body: RA.body.replace('"retail"', '"trades"') }).includes('This receipt does not match its own hash: it has been changed since it was signed. Do not rely on it.'));
  assert.equal(receiptHtml(null), '');
  assert.equal(receiptHtml({ body: 5 }), '');
  assert.equal(receiptHtml({ body: '{', hash: sha256('{') }), '');
  for (const [label, j] of hostileInputs()) assert.doesNotThrow(() => receiptHtml(j), label);
});

// ── total ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('fuzz: every export is total — junk in, a refusal out, never a throw or a rejection', async () => {
  for (const [label, j] of hostileInputs()) {
    assert.doesNotThrow(() => bandOf(j), label);
    assert.doesNotThrow(() => afterFromSpine(j, j), label);
    assert.doesNotThrow(() => showcase(j), label);
    assert.doesNotThrow(() => receiptHtml(j), label);
    const rp = reproducePlantingReceipt(j, j);
    assert.equal(rp.ok, false, label);
    const r = await buildPlantingReceipt(j, j);
    assert.equal(r.ok, false, label);
    const r2 = await buildPlantingReceipt({ ...C, before: j }, KEYS);
    assert.equal(r2.ok, false, label);
    const r3 = await buildPlantingReceipt({ ...C, bridges: [j], after: { decisions: [j], outcomes: j } }, KEYS);
    assert.equal(r3.ok, true, label + ': a malformed bridge or decision is shown as not given, not a refusal');
    assert.equal((await verifyPlantingReceipt(j)).ok, false, label);
  }
});

test('a dated file: its brain is graded on the NEWEST rows after growing on the older, and the receipt reproduces that grade from the same file', async () => {
  const j = read('brains/real/churn.sample.json'), F = j.features.length;
  const day = (i) => new Date(Date.UTC(2025, 0, 1) + ((i * 7919) % 365) * 86400000).toISOString().slice(0, 10);   // the file is NOT in date order
  const text = [[...j.features, 'Signup date', 'Churned'].join(','), ...j.data.map((r, i) => [...r.slice(0, F), day(i), r[F] ? 'yes' : 'no'].join(','))].join('\n');
  const IN = { business: { type: 'saas' }, files: [{ name: 'churn-dated.csv', text }] };
  const plan = differentiate(IN, SHIPPED, { seed: 1 });
  const pj = planJob(plan, 'churn');
  assert.ok(pj && pj.pattern, 'a churn brain was grown');
  const r = await buildPlantingReceipt({ plan, before: IN, office: OFFICE_IN, bridges: [], after: null, at: '2026-10-16' }, KEYS);
  const c = jobOf(body(r), 'churn').checked;
  assert.equal(c.split, 'time');
  assert.equal(c.rows, pj.pattern.held);
  assert.equal(c.train + c.rows, j.data.length);
  // the graded rows are the newest: every one is on or after the last day it grew on
  const days = j.data.map((_, i) => day(i)).sort();
  assert.equal(c.gradedTo, days[days.length - 1]);
  assert.equal(c.gradedFrom, days[days.length - c.rows]);
  assert.ok(days[days.length - c.rows - 1] <= c.gradedFrom);
  assert.deepEqual(await verifyPlantingReceipt(r), { ok: true, why: '' });
  assert.ok(receiptHtml(r).includes(c.rows + ' newest cases from that file — ' + c.gradedFrom + ' to ' + c.gradedTo + ', after everything it learned from'), 'the receipt says how it was graded');
  assert.ok(!receiptHtml(RA).includes('newest cases'), 'an undated file says nothing of the kind');
  // the same rows undated: graded 3 in 10 through the file
  assert.equal(jobOf(BA, 'churn').checked.split, 'mixed');
  assert.deepEqual([jobOf(BA, 'churn').checked.gradedFrom, jobOf(BA, 'churn').checked.gradedTo], ['', '']);
});
