// console.test.mjs — the planter's console (ui/plant.mjs): the demo business from the repository's real samples, the bridges
// on its records, every renderer balanced and escaped, and the controller driven end to end with a fake page over REAL devices
// — a whole planting from cold in one click into a practice company (each agent device refusing what it must), a planting into
// this device's own company with an agent device elsewhere reporting back, and a receipt anyone can check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as U from '../ui/plant.mjs';
import * as W from '../ui/wire.mjs';
import { START_STEPS, TOUR } from '../ui/explainer.mjs';
import { renderBrochure } from '../ui/brochure.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { AGENTS } from '../src/company.mjs';
import { verifyPlantingReceipt, showcase } from '../src/receipt.mjs';
import { loadPlanted, jobFor, rowsFor, plantedReports, publishPlan } from '../src/sow.mjs';
import { parseJournalCsv } from '../src/bridge.mjs';
import { differentiate } from '../src/plant.mjs';

const fetchJson = async (u) => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8'));
const SAMPLES = Object.fromEntries(await Promise.all(Object.entries(U.DEMO_SAMPLE).map(async ([d, u]) => [d, await fetchJson(u)])));
const EVIL = '<img src=x onerror=alert(1)>';
function balanced(html) {
  const VOID = new Set(['br', 'input', 'img', 'hr', 'meta', 'link', 'line', 'rect', 'circle']);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1]) { if (stack.pop() !== tag) return 'mismatched </' + tag + '>'; }
    else if (!m[3] && !VOID.has(tag)) stack.push(tag);
  }
  return stack.length ? 'unclosed <' + stack.at(-1) + '>' : '';
}
const dupIds = (html) => { const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); return ids.filter((x, i) => ids.indexOf(x) !== i); };
let seq = 0;
const keygen = () => fromSeed(sha256Bytes('console-test/' + seq++));
function page(extra = {}) {
  const downloads = [], printed = [];
  let renders = 0, wirePlan = null;
  const env = { node: () => null, keys: () => null, fetchJson, keygen, now: () => Date.UTC(2026, 9, 15, 12), download: (n, t, ty) => downloads.push([n, t, ty]), print: (h) => printed.push(h),
    render: () => { renders++; }, setWirePlan: (a) => { wirePlan = a; }, pause: async () => {}, ...extra };
  const fields = {};
  return { p: U.createPlant(env), env, downloads, printed, fields, read: (id) => fields[id], renders: () => renders, wirePlan: () => wirePlan };
}
const view = (P) => U.renderPlant(P.p.state());

test('the demo business: the real samples as a business’s exports, a decision log on real data, and three example records — each read for what it is', () => {
  const files = U.demoFiles(SAMPLES);
  assert.deepEqual(files.map((f) => f.name), ['web-sessions.csv', 'churn.csv', 'fraud.csv', 'credit.csv', 'energy.csv', 'intrusion.csv', 'maintenance.csv', 'credit-decisions.csv',
    'example-bank-statement.csv', 'example-trial-balance.csv', 'example-customers.csv']);
  for (const [d, j] of Object.entries(SAMPLES)) {
    const f = files.find((x) => x.name === (d === 'shopper' ? 'web-sessions.csv' : d + '.csv'));
    assert.equal(f.text.split('\n').length, j.data.length + 1, d);
    assert.equal(f.text.split('\n')[0], [...j.features, U.DEMO_TARGET[d]].join(','));
    assert.match(f.note, /^Real published data: /);
  }
  const log = files.find((f) => f.name === 'credit-decisions.csv');
  assert.deepEqual(log.hints, { positiveDecision: 'decline' });
  assert.ok(log.text.includes(',decline,defaulted') && log.text.includes(',approve,repaid'));
  // the bank statement's running balances are worked out, not typed: they reconcile to the penny
  const bank = U.bridgeOf('bank', files.find((f) => f.name === 'example-bank-statement.csv').text);
  assert.equal(bank.ok, true);
  assert.deepEqual([bank.read.rows.length, bank.read.rejected.length], [12, 0]);
  const bal = bank.out.reconciliation.balances;
  assert.deepEqual([bal.ok, bal.opening, bal.closing, bal.order], [true, 1248000, 787367, 'oldest-first']);
  assert.equal(bank.out.totals.net, 787367 - 1248000);
  assert.deepEqual(bank.out.suspense.map((x) => x.desc), ['CARD TAKINGS', 'CARD TAKINGS', 'SUPPLIER 0042', 'CARD TAKINGS', 'CARD TAKINGS'], 'what no rule knows waits for a person');
  assert.equal(parseJournalCsv(bank.sage.text).entries.length, 12, 'the Sage journal reads back, every entry');
  assert.match(bank.xero, /^Xero takes the bank statement itself through its own bank import/);
  assert.equal(bank.receipt.ok, true);
  // the opening books balance, and agree with the statement's opening balance
  const tb = U.bridgeOf('trial-balance', files.find((f) => f.name === 'example-trial-balance.csv').text, { date: '2026-08-31' });
  assert.equal(tb.ok, true);
  assert.deepEqual([tb.read.totals.debit, tb.read.totals.credit], [4165000, 4165000]);
  assert.deepEqual(tb.read.entry.lines.find((l) => l[0] === '1200'), ['1200', bal.opening, 0]);
  assert.equal(parseJournalCsv(tb.sage.text).entries[0].id, 'OPENING');
  const noDate = U.bridgeOf('trial-balance', files.find((f) => f.name === 'example-trial-balance.csv').text, {});
  assert.deepEqual([noDate.ok, noDate.sage, noDate.receipt], [false, null, null]);
  // the customer list: six read, one refused with its reason
  const crm = U.bridgeOf('crm', files.find((f) => f.name === 'example-customers.csv').text);
  assert.deepEqual([crm.read.records.length, crm.read.rejected.length], [6, 1]);
  assert.match(crm.read.rejected[0].why, /the stage “on hold” is not one of/);
  assert.equal(crm.crm.ok, true);
  assert.ok(!/[A-Z][a-z]+ [A-Z][a-z]+son\b|@/.test(files.slice(-3).map((f) => f.text).join('\n')), 'no personal names or e-mail addresses in the made-up records');
  // junk never throws
  for (const k of ['bank', 'crm', 'trial-balance', 'other', null]) for (const t of [null, '', 'a,b\n1,2', EVIL]) assert.equal(U.bridgeOf(k, t, null).ok, false);
  assert.deepEqual(U.demoFiles(null), []);
  assert.deepEqual(U.demoFiles({}), []);
  assert.deepEqual(U.levelsOf(log.text, 'oldRuleDecision'), ['approve', 'decline']);
  assert.deepEqual(U.levelsOf(log.text, 'creditLimit'), []);
  assert.deepEqual(U.levelsOf(null, 'x'), []);
});

test('renderers: every state balanced, no id twice, and every name a client hands over shown only as text', () => {
  for (const s of [undefined, null, {}, { files: [] }]) {
    const h = U.renderPlant(s);
    assert.equal(balanced(h), '');
    assert.deepEqual(dupIds(h), []);
    assert.match(h, /Plant — the planter’s console/);
    assert.match(h, /data-act="plant-all"/);
  }
  assert.equal(U.renderPlant({ get files() { throw new Error('x'); } }), '<p class="bad">This view could not be drawn. Reload the page.</p>');
  const P = page();
  P.p.addFiles([{ name: EVIL + '.csv', text: 'a' + EVIL + ',Fraud\n1,yes\n2,no\n' }]);
  const h = view(P);
  assert.equal(balanced(h), '');
  assert.ok(!h.includes(EVIL), 'a hostile file name and column reach the page only as text');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;.csv'));
  assert.match(U.PLANT_CSS, /@media print\{body\.print-receipt/);
  // every colour the console uses is one the page defines
  const ROOT = new Set([...readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/:root\{[^}]*\}/)[0].matchAll(/--([a-z0-9]+):/g)].map((m) => m[1]));
  for (const m of U.PLANT_CSS.matchAll(/var\(--([a-z0-9-]+)\)/g)) assert.ok(ROOT.has(m[1]), m[1]);
});

test('one click, from cold: the demo business planted end to end into a practice company — and a receipt anyone can check', async () => {
  const P = page();
  await P.p.act('plant-all', { dataset: {} }, P.read);
  const s = P.p.state();
  assert.match(s.say, /^The whole planting ran/);
  assert.equal(s.type, 'retail');
  assert.equal(s.plan.ok, true);
  assert.equal(s.stale, false);
  assert.equal(s.files.length, 11);
  assert.deepEqual(s.files.map((f) => f.cls.kind), ['outcomes', 'outcomes', 'outcomes', 'outcomes', 'outcomes', 'outcomes', 'outcomes', 'decisions', 'bank', 'trial-balance', 'crm']);
  assert.equal(s.plan.office.ok, true);
  assert.equal(s.plan.office.headcountToday, 23);
  const credit = s.plan.jobs.find((j) => j.domain === 'credit');
  assert.equal(credit.legacy.length, 1, 'the decision log was re-grown and checked');
  assert.ok(credit.legacy[0].pastAccuracy > 0 && credit.legacy[0].n > 0);
  assert.deepEqual(Object.values(s.bridges).map((b) => [b.kind, b.ok]), [['bank', true], ['trial-balance', true], ['crm', true]]);
  // planted into the practice company: the planter's key is its owner; every agent device that runs a job judged its brains
  const d = s.planted;
  assert.equal(d.target, 'practice');
  assert.equal(d.publish.ok, true);
  assert.deepEqual(d.devices.map((x) => x.agent), ['sales', 'service', 'finance', 'ops', 'systems']);
  const all = d.devices.flatMap((x) => x.judged.results);
  assert.ok(all.length >= 7 && all.every((r) => r.trusted && r.role === 'owner'), 'every planted brain was signed by the owner — you');
  assert.ok(all.some((r) => r.adopted), 'some planted brains were adopted');
  for (const r of all.filter((x) => !x.adopted)) assert.match(r.reason, /^Refused: worse than the brain it would replace/, 'only a brain the shipped one beats on the device’s own records is refused');
  for (const x of d.devices) for (const r of x.judged.results) assert.equal(x.judged.kept[r.domain] === 'planted', r.adopted || x.judged.results.some((y) => y.domain === r.domain && y.adopted));
  // the receipt: built, signed, checked, reproducible
  assert.equal(s.receipt.ok, true);
  assert.deepEqual(s.check, { ok: true, words: 'Checked: its hash and signature hold, every share re-derives from its counts, and the same inputs make the same receipt, byte for byte.' });
  const body = JSON.parse(s.receipt.body);
  assert.equal(body.bridges.length, 3);
  assert.equal(body.business.band, '10–49');
  assert.equal(s.receipt.pub, d.keys.pub);
  const h = U.renderPlant(s);
  assert.equal(balanced(h), '');
  assert.deepEqual(dupIds(h), []);
  for (const w of ['Grown from your own records', 'Their old decisions — credit-decisions.csv', 'Every mismatch', 'Every running balance checks', 'Download the Sage journal', 'Download the customer list for the CRM',
    'On each agent device', 'Another agent signs a brain in the job owner’s name', 'Print it for the client', 'Download the showcase copy for the next prospect', 'Thomas Frumkin', 'Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC']) {
    assert.ok(h.includes(w), w);
  }
  assert.equal((h.match(/pl-chip done/g) || []).length, 7, 'every step done');
  // the downloads and the print
  for (const w of ['sage-bank', 'sage-tb', 'crm', 'receipt', 'showcase', 'nothing']) await P.p.act('plant-dl', { dataset: { what: w } }, P.read);
  assert.deepEqual(P.downloads.map(([n]) => n.replace(/[0-9a-f]{16}/, 'H')), ['sage-journal-statement-2026-10-15.csv', 'sage-journal-opening-2026-10-15.csv', 'customers-2026-10-15.csv', 'planting-receipt-H.json', 'planting-showcase-H.json']);
  const full = JSON.parse(P.downloads[3][1]);
  assert.deepEqual(await verifyPlantingReceipt(full), { ok: true, why: '' });
  const show = JSON.parse(P.downloads[4][1]);
  assert.deepEqual(show, showcase(full));
  assert.ok(!P.downloads[4][1].includes('.csv') && !P.downloads[4][1].includes('£'), 'the showcase copy names no file and no money');
  await P.p.act('plant-print', { dataset: {} }, P.read);
  assert.equal(P.printed.length, 1);
  assert.match(P.printed[0], /Planting receipt/);
  assert.equal(balanced(P.printed[0]), '');
  // anyone checks a receipt on the page; a changed one is caught
  P.fields['plant-check-in'] = P.downloads[3][1];
  await P.p.act('plant-check', { dataset: {} }, P.read);
  assert.match(P.p.state().checkOut, /^Genuine: /);
  const changedR = JSON.parse(P.downloads[3][1]);
  changedR.body = changedR.body.replace('"retail"', '"saas"');
  P.fields['plant-check-in'] = JSON.stringify(changedR);
  await P.p.act('plant-check', { dataset: {} }, P.read);
  assert.match(P.p.state().checkOut, /^Not genuine: /);
  P.fields['plant-check-in'] = 'not json';
  await P.p.act('plant-check', { dataset: {} }, P.read);
  assert.equal(P.p.state().checkOut, 'Not genuine: the receipt could not be read.');
});

test('the practice company refuses what it must: another agent writing in the job owner’s name, and the planter’s own key signing a tampered brain', async () => {
  const P = page();
  await P.p.act('plant-attack', { dataset: { kind: 'forged' } }, P.read);
  assert.equal(P.p.state().say, 'Plant into the practice company first.');
  await P.p.act('plant-all', { dataset: {} }, P.read);
  await P.p.act('plant-attack', { dataset: { kind: 'forged' } }, P.read);
  let a = P.p.state().planted.attack;
  assert.match(a, /^The Service agent’s device wrote a buyers \(sales\) brain over the Sales agent’s own record, in its name\. The Sales agent’s device: Refused before it was read: signed by the Service agent’s device/);
  await P.p.act('plant-attack', { dataset: { kind: 'tampered' } }, P.read);
  a = P.p.state().planted.attack;
  assert.match(a, /^Your own key — the owner’s — signed a tampered buyers \(sales\) brain \(every rule turned around\)\. The Sales agent’s device: Refused: did not re-verify here \(AUC [\d.]+ < 0\.6\)\./);
  assert.match(a, /Plant it again to put the planter’s brain back\.$/);
  // plant again: the planter's brain is back, and the device takes it again
  await P.p.act('plant-plant', { dataset: {} }, P.read);
  assert.equal(P.p.state().planted.attack, '');
  assert.equal(P.p.state().planted.publish.ok, true);
  // one agent switched on: no other agent device to forge with
  const Q = page();
  await Q.p.act('plant-demo', { dataset: {} }, Q.read);
  await Q.p.act('plant-grow', { dataset: {} }, Q.read);
  for (const x of AGENTS.map((y) => y.id).filter((y) => y !== 'finance')) await Q.p.act('plant-agent', { dataset: { agent: x, checked: false } }, Q.read);
  assert.deepEqual(Q.p.state().agents, ['finance']);
  await Q.p.act('plant-plant', { dataset: {} }, Q.read);
  assert.deepEqual(Q.p.state().planted.devices.map((x) => x.agent), ['finance']);
  await Q.p.act('plant-attack', { dataset: { kind: 'forged' } }, Q.read);
  assert.equal(Q.p.state().say, 'Only one agent device here — switch on another agent to try this.');
  // the agents switched off are paused in the company, with this planting's words
  const owner = Q.p.state().planted.node;
  assert.deepEqual(owner.list('control').map((c) => [c.id, c.paused, c.by]), ['audit', 'ops', 'sales', 'service', 'systems'].map((id) => [id, true, 'Planting']));
});

test('each step, by hand: business, files and corrections, grow, tune, bridge — and a stale plan is never planted', async () => {
  const P = page();
  await P.p.ready();
  let s = P.p.state();
  assert.ok(s.office, 'the model office is loaded for the headcount form');
  let h = view(P);
  assert.match(h, /data-plant-pair="service"/);
  assert.match(h, /<button class="primary" data-act="plant-grow" disabled>/);
  await P.p.act('plant-type', { dataset: { value: 'saas' } }, P.read);
  await P.p.act('plant-type', { dataset: { value: 'nonsense' } }, P.read);
  assert.equal(P.p.state().type, '');
  await P.p.act('plant-type', { dataset: { value: 'services' } }, P.read);
  await P.p.act('plant-pair', { dataset: { pair: 'service', value: '9' } }, P.read);
  await P.p.act('plant-pair', { dataset: { pair: 'nope', value: '9' } }, P.read);
  assert.deepEqual(P.p.state().pairs, { service: '9' });
  // a file the console cannot place is named, and the planter says what it is
  const files = U.demoFiles(SAMPLES);
  const fraud = files.find((f) => f.name === 'fraud.csv');
  P.p.addFiles([{ name: 'export-2026.csv', text: fraud.text.replace('Fraud', 'Flag'), size: 10 }]);
  s = P.p.state();
  assert.equal(s.files[0].cls.kind, 'outcomes');
  await P.p.act('plant-hint', { dataset: { file: s.files[0].id, hint: 'domain', value: 'fraud' } }, P.read);
  assert.equal(P.p.state().files[0].cls.domain, 'fraud');
  assert.match(P.p.state().files[0].cls.reason, /You said it teaches the card fraud job/);
  await P.p.act('plant-hint', { dataset: { file: s.files[0].id, hint: 'domain', value: '' } }, P.read);
  assert.equal(P.p.state().files[0].hints.domain, undefined);
  await P.p.act('plant-hint', { dataset: { file: s.files[0].id, hint: 'evil', value: 'x' } }, P.read);
  assert.deepEqual(P.p.state().files[0].hints, {});
  await P.p.act('plant-hint', { dataset: { file: s.files[0].id, hint: 'domain', value: 'fraud' } }, P.read);
  // refusals when adding files
  P.p.addFiles([{ name: 'big.csv', text: 'x', size: U.MAX_FILE_BYTES + 1 }]);
  assert.equal(P.p.state().say, 'big.csv is over 8 MB — split it and add the parts.');
  P.p.addFiles([{ name: 'bin.csv', text: null }, null]);
  assert.equal(P.p.state().files.length, 1);
  P.p.addFiles(Array.from({ length: 20 }, (_, i) => ({ name: 'f' + i + '.csv', text: 'a,b\n1,2' })));
  assert.equal(P.p.state().files.length, 16);
  assert.equal(P.p.state().say, 'At most 16 files in one planting.');
  await P.p.act('plant-clear', { dataset: {} }, P.read);
  assert.equal(P.p.state().files.length, 0);
  P.p.addFiles([{ name: 'export-2026.csv', text: fraud.text.replace('Fraud', 'Flag'), hints: { domain: 'fraud' } }, files.find((f) => f.name === 'example-bank-statement.csv'), files.find((f) => f.name === 'example-trial-balance.csv')]);
  const bankId = P.p.state().files[1].id;
  await P.p.act('plant-remove', { dataset: { file: bankId } }, P.read);
  assert.deepEqual(P.p.state().files.map((f) => f.name), ['export-2026.csv', 'example-trial-balance.csv']);
  // grow
  await P.p.act('plant-grow', { dataset: {} }, P.read);
  s = P.p.state();
  assert.equal(s.plan.ok, true);
  assert.equal(s.plan.jobs.find((j) => j.domain === 'fraud').source, 'grown');
  h = view(P);
  assert.equal(balanced(h), '');
  assert.match(h, /readable rules/);
  assert.match(h, /What it reads/);
  // tune: switch an agent off and on; an agent the plan keeps off cannot be switched on; the floor
  await P.p.act('plant-agent', { dataset: { agent: 'finance', checked: false } }, P.read);
  assert.ok(!P.p.state().agents.includes('finance'));
  await P.p.act('plant-agent', { dataset: { agent: 'finance', checked: true } }, P.read);
  assert.ok(P.p.state().agents.includes('finance'));
  const offId = s.plan.suite.off.length ? s.plan.suite.off[0].id : null;
  if (offId) { await P.p.act('plant-agent', { dataset: { agent: offId, checked: true } }, P.read); assert.ok(!P.p.state().agents.includes(offId)); }
  await P.p.act('plant-floor', { dataset: { value: '200' } }, P.read);
  await P.p.act('plant-floor', { dataset: { value: '7' } }, P.read);
  assert.equal(P.p.state().floor, 200);
  // bridge: the trial balance needs its date
  await P.p.act('plant-tbdate', { dataset: { value: '' } }, P.read);
  await P.p.act('plant-bridge', { dataset: {} }, P.read);
  const b = Object.values(P.p.state().bridges)[0];
  assert.equal(b.ok, false);
  assert.match(b.why, /say the date the balances are at/);
  assert.match(view(P), /say the date the balances are at/);
  await P.p.act('plant-tbdate', { dataset: { value: '2026-08-31' } }, P.read);
  await P.p.act('plant-bridge', { dataset: {} }, P.read);
  assert.equal(Object.values(P.p.state().bridges)[0].ok, true);
  // a change after growing makes the plan stale: Plant is refused until it is grown again
  await P.p.act('plant-pair', { dataset: { pair: 'service', value: '12' } }, P.read);
  assert.equal(P.p.state().stale, true);
  assert.match(view(P), /grow it again before you plant/);
  await P.p.act('plant-plant', { dataset: {} }, P.read);
  assert.equal(P.p.state().say, 'Grow the plan again first — something changed since it was grown.');
  await P.p.act('plant-receipt', { dataset: {} }, P.read);
  assert.equal(P.p.state().say, 'Plant first.');
  await P.p.act('plant-grow', { dataset: {} }, P.read);
  await P.p.act('plant-plant', { dataset: {} }, P.read);
  assert.equal(P.p.state().planted.publish.ok, true);
  await P.p.act('plant-receipt', { dataset: {} }, P.read);
  assert.equal(P.p.state().check.ok, true);
  // junk never throws
  for (const n of ['plant-nothing', 'plant-hint', 'plant-remove', 'plant-dl', 'plant-target', 'plant-refresh', 'plant-print']) await P.p.act(n, null, null);
  await P.p.act('plant-grow', { dataset: {} }, () => { throw new Error('x'); });
  const broken = U.createPlant({ fetchJson: async () => { throw new Error('offline'); }, render: () => { throw new Error('x'); } });
  await broken.act('plant-demo', { dataset: {} });
  assert.match(broken.state().say, /^That did not work: offline/);
  assert.equal(U.createPlant(null).state().company.has, false);
});

test('planting into this device’s own company: only as its owner or an admin; an agent device elsewhere loads the brains and reports back', async () => {
  const k = {}, n = {};
  for (const x of ['owner', 'finance', 'clerk']) k[x] = await fromSeed(sha256Bytes('console-company/' + x));
  for (const x of ['owner', 'finance', 'clerk']) n[x] = createNode({ keys: k[x], genesis: k.owner.pub, name: x });
  await n.owner.grant('agent-finance', k.finance.pub, 'agent', [...AGENTS.find((a) => a.id === 'finance').cols, 'wire', 'model']);
  await n.owner.grant('staff-1', k.clerk.pub, 'staff', ['tasks', 'wire']);
  const sync = async () => { for (let i = 0; i < 2; i++) for (const a of Object.keys(n)) for (const b of Object.keys(n)) if (a !== b) await pull(n[a], n[b]); };
  await sync();
  // a staff device cannot plant here: the choice is offered but disabled, and the practice company stays the target
  const C = page({ node: () => n.clerk, keys: () => k.clerk });
  await C.p.act('plant-target', { dataset: { value: 'company' } }, C.read);
  const cs = C.p.state();
  assert.deepEqual([cs.company.has, cs.company.admin, cs.target], [true, false, 'practice']);
  await C.p.act('plant-demo', { dataset: {} }, C.read);
  await C.p.act('plant-grow', { dataset: {} }, C.read);
  assert.match(view(C), /is not its owner or an admin — ask the owner to grant this device as an admin/);
  // the owner plants into its own company
  const P = page({ node: () => n.owner, keys: () => k.owner });
  await P.p.act('plant-demo', { dataset: {} }, P.read);
  await P.p.act('plant-grow', { dataset: {} }, P.read);
  await P.p.act('plant-target', { dataset: { value: 'company' } }, P.read);
  await P.p.act('plant-plant', { dataset: {} }, P.read);
  const s = P.p.state();
  assert.equal(s.planted.target, 'company');
  assert.equal(s.planted.publish.ok, true);
  assert.match(s.say, /^Planted into company /);
  assert.deepEqual(P.wirePlan(), s.agents, 'Wire it plans for the agents switched on');
  assert.match(view(P), /No agent device has reported yet/);
  // the Finance agent's device, elsewhere: it reads its own copy of each file, judges, records — and the planter sees it
  await sync();
  const tag = s.plan.planHash.slice(0, 16);
  const files = Object.fromEntries(U.demoFiles(SAMPLES).map((f) => [f.name, f.text]));
  const fileOf = (d) => files[s.plan.jobs.find((j) => j.domain === d).file];
  const r = await loadPlanted({ node: n.finance, agentId: 'finance', rows: (d) => rowsFor(jobFor(n.finance, d, tag), fileOf(d)).rows, shipped: {} });
  assert.ok(r.results.length >= 2 && r.results.every((x) => x.adopted && x.role === 'owner'));
  await sync();
  const rep = P.p.state().planted.reports;
  assert.deepEqual(rep.map((x) => x.agent + ':' + x.domain + ':' + x.adopted).sort(), r.results.map((x) => 'finance:' + x.domain + ':true').sort());
  assert.equal(plantedReports(n.owner, tag).length, rep.length);
  const h = view(P);
  assert.equal(balanced(h), '');
  assert.match(h, /What the agent devices reported/);
  // the receipt, signed by this device's own key; the company has made no decisions yet, so it reports none
  await P.p.act('plant-receipt', { dataset: {} }, P.read);
  assert.equal(P.p.state().receipt.pub, k.owner.pub);
  assert.equal(JSON.parse(P.p.state().receipt.body).live, null);
  // once the company has decided something, the receipt carries it (outcomes unknown yet)
  await n.finance.put('decisions', 'd1', { agent: 'finance', event: 'e000001', domain: 'fraud', action: 'release-payment', state: 'done', by: 'own', cross: true, second: 'audit', conf: 500, receipt: '', customer: 'C1', channel: 'fraud' });
  await sync();
  await P.p.act('plant-receipt', { dataset: {} }, P.read);
  const live = JSON.parse(P.p.state().receipt.body).live;
  assert.deepEqual([live.decisions, live.held, live.done], [1, 0, 0]);
  assert.equal(P.p.state().check.ok, true);
});

test('Wire it: an agent device loads the planted brains when it starts — from a key that may plant them, re-checked on its own copy of the file', async () => {
  const k = {}, n = {};
  for (const x of ['owner', 'finance', 'sales']) k[x] = await fromSeed(sha256Bytes('console-wire/' + x));
  for (const x of ['owner', 'finance', 'sales']) n[x] = createNode({ keys: k[x], genesis: k.owner.pub, name: x });
  for (const a of ['finance', 'sales']) await n.owner.grant('agent-' + a, k[a].pub, 'agent', [...AGENTS.find((y) => y.id === a).cols, 'wire', 'model']);
  const sync = async () => { for (let i = 0; i < 2; i++) for (const a of Object.keys(n)) for (const b of Object.keys(n)) if (a !== b) await pull(n[a], n[b]); };
  await sync();
  const files = U.demoFiles(SAMPLES);
  const text = (nm) => files.find((f) => f.name === nm).text;
  const plan = differentiate({ business: { type: 'other' }, files: [{ name: 'fraud.csv', text: text('fraud.csv') }, { name: 'credit.csv', text: text('credit.csv') }] },
    { ...(await (async () => { const index = await fetchJson('brains/index.json'); const patterns = {}; for (const [d, m] of Object.entries(index)) patterns[d] = await fetchJson('brains/' + m.file); return { index, patterns }; })()),
      office: await fetchJson('data/office.json'), basis: await fetchJson('data/basis.json') }, { seed: 1 });
  assert.equal((await publishPlan(n.owner, plan, {})).ok, true);
  await sync();
  const store = new Map();
  store.set('se.wire.want', JSON.stringify({ role: 'agent', agent: 'finance' }));
  const env = { node: () => n.finance, keys: () => k.finance, store: { get: (x) => (store.has(x) ? store.get(x) : null), set: (x, v) => store.set(x, v) }, fetchJson, peers: () => [], link: () => '',
    origin: 'https://example.org', os: 'linux', now: () => 1760000000000, print: () => {}, download: () => {}, render: () => {}, probeModel: async () => ({ ok: false }) };
  const w = W.createWire(env);
  await w.act('wire-run', { dataset: {} }, () => '');
  let st = w.state();
  assert.equal(st.agent.running, true);
  const p = st.agent.planted;
  assert.deepEqual(p.held, ['credit', 'fraud']);
  // on the published data this device holds, the shipped brains (grown on that same data) do better: it keeps them
  assert.deepEqual(p.kept, { credit: 'shipped', fraud: 'shipped' });
  assert.ok(p.results.every((r) => /^Refused: worse than the brain it would replace/.test(r.reason)));
  // the planted record was not written over by this device's shipped publish: the owner still signs it
  assert.ok(n.finance.list('brain').filter((r) => r.id === 'fraud.finance').every((r) => r.source === 'grown'));
  let h = W.renderWire(st);
  assert.equal(balanced(h), '');
  assert.match(h, /Brains planted for this agent/);
  assert.match(h, /the shipped brain \(it does better here\)/);
  // given its own copy of the business's files, it re-checks there — and, with no shipped brain over them, adopts
  await w.ownFiles([{ name: 'fraud.csv', text: text('fraud.csv') }, { name: 'credit.csv', text: text('credit.csv') }, { name: 'x', text: 7 }]);
  st = w.state();
  assert.deepEqual(st.agent.own.map((f) => f.name), ['fraud.csv', 'credit.csv']);
  assert.match(st.say, /^This device re-checks its planted brains on fraud\.csv, credit\.csv\./);
  assert.ok(st.agent.planted.results.every((r) => r.n === (r.domain === 'fraud' ? 1070 : 1500)), 'checked on its own copy of each file');
  // another agent writes a brain over the Finance agent's own record, in its name: refused on the next beat, before it is read
  const { id: _id, ...real } = n.owner.list('brain').find((r) => r.id === 'fraud.finance');
  assert.equal((await n.sales.put('brain', 'fraud.finance', { ...real, by: 'finance' })).ok, true);
  await sync();
  await w.beat();
  st = w.state();
  const forged = st.agent.planted.results.find((r) => r.id === 'fraud.finance');
  assert.equal(forged.trusted, false);
  assert.match(forged.reason, /^Refused before it was read: signed by the Sales agent’s device/);
  assert.deepEqual(st.agent.status.brains, ['credit', 'fraud'], 'a forged overwrite takes nothing away: the device keeps the brain it already had for that job');
  h = W.renderWire(st);
  assert.equal(balanced(h), '');
  assert.ok(h.includes('no one device') || h.includes('Sales agent'));
  // the reports reach the owner, counted only as the device that wrote them
  await sync();
  assert.ok(plantedReports(n.owner).some((r) => r.agent === 'finance' && r.domain === 'fraud'));
});

test('the page explains it: the start steps, the tour and the brochure name the planting', () => {
  const s = START_STEPS.find((x) => x.id === 'plant');
  assert.ok(s && s.go === 'plant' && s.text.length > 60);
  const t = TOUR.find((x) => x.view === 'plant');
  assert.ok(t && t.target === '#v-plant' && t.text.length > 60);
  assert.ok(START_STEPS.findIndex((x) => x.id === 'plant') < START_STEPS.findIndex((x) => x.id === 'wire'), 'planting comes before wiring');
  const b = JSON.stringify(renderBrochure.toString());
  assert.ok(b.includes('Do we have to rip out our systems?'));
  assert.ok(b.includes('Xero'));
  assert.ok(b.includes('How it is planted'));
});
