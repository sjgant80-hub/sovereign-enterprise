// plant.test.mjs — the differentiation layer: real files classified to the right job, brains grown from them, a decision
// log re-grown and checked against the old rule, records set aside, files that cannot teach refused in words, and the
// plan sealed by its hash and published through the real gate and role tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../src/plant.mjs';
import { tokensOf, classifyFile, jobsFor, differentiate, hashPlan, plannedLibrary, planRecords, JOBS, KINDS, MAX_FILES, MAX_CHARS, MIN_SCORE, MARGIN, PLAN_MODEL } from '../src/plant.mjs';
import { trainFromCsv } from '../src/train.mjs';
import { MIN_ROWS } from '../src/grow.mjs';
import { fromRecord, validPattern, GATE_AUC } from '../src/brain.mjs';
import { AGENTS, OWNER_OF } from '../src/company.mjs';
import { ADOPTION } from '../src/explain.mjs';
import { fitPlan, fitInput, formFields } from '../src/adopt.mjs';
import { canonical } from '../src/canon.mjs';
import { sha256, sha256Bytes } from '../src/sha256.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sliceOf } from '../vendor/discombobulator/relearn.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const INDEX = read('brains/index.json');
const OFFICE = read('data/office.json'), BASIS = read('data/basis.json');
const PATTERNS = Object.fromEntries(Object.entries(INDEX).map(([d, m]) => [d, read('brains/' + m.file)]));
const SHIPPED = { index: INDEX, patterns: PATTERNS, office: OFFICE, basis: BASIS };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── the real data, as the CSV exports a business would hand over ──────────────────────────────────────────────────
const TARGET = { shopper: 'Purchased', churn: 'Churned', fraud: 'Fraud', credit: 'Defaulted', energy: 'PeakNextHour', intrusion: 'Attack', maintenance: 'MachineFailure' };
const SAMPLE = Object.fromEntries(Object.keys(TARGET).map((d) => [d, read(d === 'shopper' ? 'brains/shopper.sample.json' : 'brains/real/' + d + '.sample.json')]));
const toCsv = (j, target) => [[...j.features, target].join(','), ...j.data.map((r) => r.slice(0, j.features.length).concat(r[j.features.length] ? 'yes' : 'no').join(','))].join('\n');
const CSV = Object.fromEntries(Object.entries(TARGET).map(([d, t]) => [d, toCsv(SAMPLE[d], t)]));
const REAL_FILES = Object.keys(TARGET).map((d) => ({ name: d + '.csv', text: CSV[d] }));

// a decision log built from the real credit sample: a deterministic "old rule" the business ran, and what really happened
const CREDIT = SAMPLE.credit, CF = CREDIT.features, ci = (n) => CF.indexOf(n), LABEL = CF.length;
const oldRule = (r) => (r[ci('payStatusSep')] >= 2 || r[ci('utilisationSep')] > 0.9 ? 'decline' : 'approve');
const happened = (r) => (r[LABEL] ? 'defaulted' : 'repaid');
const LOG = [[...CF, 'oldRuleDecision', 'Outcome'].join(','), ...CREDIT.data.map((r) => [...r.slice(0, LABEL), oldRule(r), happened(r)].join(','))].join('\n');
const LOG_NO_DECISION = [[...CF, 'Outcome'].join(','), ...CREDIT.data.map((r) => [...r.slice(0, LABEL), happened(r)].join(','))].join('\n');
const LOG_YESNO = [[...CF, 'ruleDecision', 'Defaulted'].join(','), ...CREDIT.data.map((r) => [...r.slice(0, LABEL), oldRule(r) === 'decline' ? 'yes' : 'no', r[LABEL] ? 'yes' : 'no'].join(','))].join('\n');
const logRows = (n) => LOG.split('\n').slice(0, n + 1).join('\n');
// a card-payment log with the old hold/release rule, and NO record of what really happened
const FRAUD = SAMPLE.fraud, FF = FRAUD.features;
const HOLDS = [[...FF, 'actionTaken'].join(','), ...FRAUD.data.map((r) => [...r.slice(0, FF.length), r[0] > 200 ? 'hold' : 'release'].join(','))].join('\n');

// small hand-made tables (a seeded generator, so every run is the same)
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function table(header, n, row, seed = 7) { const r = lcg(seed); return [header.join(','), ...Array.from({ length: n }, (_, i) => row(r, i).join(','))].join('\n'); }
const yn = (r) => (r() < 0.5 ? 'yes' : 'no');
const int = (r, k) => Math.floor(r() * k);
const RANDOM = table(['alpha', 'beta', 'gamma', 'Fraud'], 400, (r) => [int(r, 100), int(r, 100), int(r, 100), yn(r)], 11);
const TINY = table(['amount', 'V1', 'Fraud'], 50, (r) => [int(r, 500), (r() * 4 - 2).toFixed(3), yn(r)]);
const BANK = 'Date,Description,Paid out,Paid in,Balance\n2026-01-02,Rent,1200,,5000\n2026-01-03,Card sale,,300,5300\n2026-01-04,Supplier,250,,5050\n';
const BANK2 = 'Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n02/01/2026,DD,00-00-00,0001,RENT,1200,,5000\n03/01/2026,FPI,00-00-00,0001,SALE,,300,5300\n';
const TB = 'Account Code,Account Name,Debit,Credit\n1200,Bank,5000,\n3000,Capital,,5000\n4000,Sales,,300\n';
const CRM = 'Company,Contact,Deal Stage,Owner,Value\nNorthwind,A Buyer,qualified,Sam,1000\nContoso,B Buyer,won,Sam,2000\nFabrikam,C Buyer,lost,Jo,500\n';
const CRM2 = 'Work Email,Lead Status,Notes\na@example.test,open,first call\nb@example.test,closed,no reply\nc@example.test,open,sent quote\n';
const STAFF = 'Name,Role,Salary\nA Person,clerk,21000\nB Person,manager,35000\nC Person,driver,22000\n';

// the plans this file checks (grown once, shared by the tests)
const P1_INPUT = { business: { type: 'retail', pairs: [{ id: 'service', value: 12 }] },
  files: [...REAL_FILES, { name: 'credit-decisions.csv', text: LOG, positiveDecision: 'decline' }, { name: 'bank.csv', text: BANK }, { name: 'crm.csv', text: CRM }, { name: 'staff.csv', text: STAFF }] };
const P1 = differentiate(P1_INPUT, SHIPPED, { seed: 1 });
const ALL_BUT_LEADERSHIP = formFields(OFFICE).filter((f) => f.id !== 'leadership').map((f) => ({ id: f.id, value: f.value }));
const P2 = differentiate({ business: { type: 'services', pairs: ALL_BUT_LEADERSHIP },
  files: [{ name: 'credit-decisions.csv', text: LOG, positiveDecision: 'decline' }, { name: 'energy.csv', text: CSV.energy }, { name: 'fraud-random.csv', text: RANDOM }, { name: 'card-holds.csv', text: HOLDS }] }, SHIPPED, { seed: 1 });
const P3 = differentiate({ business: { type: 'other' } }, SHIPPED);
const P4 = differentiate({ business: { type: 'manufacturing', pairs: [{ id: 'service', value: 3 }] } }, {});
const P5 = differentiate({ business: { type: 'trades', pairs: [] }, files: [{ name: 'rule-log.csv', text: LOG_YESNO }, { name: 'credit-log-2.csv', text: LOG }] }, SHIPPED, { seed: 1 });
const LOG_NO_OUTCOME = [[...CF, 'oldRuleDecision'].join(','), ...CREDIT.data.slice(0, 300).map((r) => [...r.slice(0, LABEL), oldRule(r)].join(','))].join('\n');
const P7 = differentiate({ business: { type: 'other' }, files: [{ name: 'credit-old-calls.csv', text: LOG_NO_OUTCOME }] }, SHIPPED);
const P6 = differentiate({ business: { type: 'other', pairs: [{ id: 'service', value: 1 }] },
  files: [{ name: 'credit-119.csv', text: logRows(MIN_ROWS - 1) }, { name: 'credit-120.csv', text: logRows(MIN_ROWS) }, { name: 'fraud-tiny.csv', text: TINY }] }, SHIPPED, { seed: 1 });

const job = (plan, d) => plan.jobs.find((j) => j.domain === d);
const file = (plan, n) => plan.files.find((f) => f.name === n);
const SHIPPED_GAP = (name, agent) => 'No file of yours for the ' + name + ' job: the ' + agent + ' starts on the shipped brain, which must re-verify on your own records before it acts.';
const NONE_GAP = (name) => 'No data and no brain for the ' + name + ' job: its work waits on the Watch list until data arrives.';
const OFF_WORKER = 'none of its jobs has a brain that passed its check — its work waits for a person';
const OFF_AUDIT = 'no file of yours for card fraud, credit default or intrusion to grow its independent second brain from — until one arrives, a money or security call no second brain confirms waits for a person';
const MODELLED = (labels) => 'No headcount was given for ' + labels + ' — the comparison keeps the model office’s headcount there.';
const ALL_BUT_SERVICE = 'Sales and business development, Marketing, Finance and accounts, HR and administration, Operations and delivery, IT and systems and Leadership';

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('tokensOf: camelCase and separators split, one-letter words and a plural s dropped, -ss and short words kept', () => {
  assert.deepEqual(tokensOf('airTempK'), ['air', 'temp']);
  assert.deepEqual(tokensOf('ProductRelated_Duration'), ['product', 'related', 'duration']);
  assert.deepEqual(tokensOf('pktsPerSec'), ['pkt', 'per', 'sec']);
  assert.deepEqual(tokensOf('smsSent'), ['sms', 'sent']);
  assert.deepEqual(tokensOf('bus class'), ['bus', 'class']);
  assert.deepEqual(tokensOf('V12 RTIoTFlows'), ['v12', 'rt', 'io', 'flow']);
  assert.deepEqual(tokensOf('Paid out'), ['paid', 'out']);
  assert.deepEqual(tokensOf(''), []);
  assert.deepEqual(tokensOf(Symbol('s')), ['symbol']);
  assert.deepEqual(tokensOf({ toString() { throw new Error('boom'); } }), []);
});

// ── classifyFile ────────────────────────────────────────────────────────────────────────────────────────────────────
test('every real sample, exported as a CSV, is an outcomes file classified to its own job', () => {
  // permille: 600 × (columns that are the job's measurements / other columns) + 300 if the outcome is named for the job + 100 if the file name is
  const want = { shopper: 0.9, churn: 1, fraud: 1, credit: 1, energy: 0.9, intrusion: 0.963, maintenance: 0.9 };   // intrusion: 15 of 16 columns → 563 + 300 + 100
  for (const d of Object.keys(TARGET)) {
    const c = classifyFile(d + '.csv', CSV[d]);
    assert.equal(c.kind, 'outcomes', d);
    assert.equal(c.domain, d, d);
    assert.equal(c.target, TARGET[d], d);
    assert.equal(c.decision, null);
    assert.equal(c.outcome, null);
    assert.equal(c.confidence, want[d], d);
    assert.equal(c.rows, SAMPLE[d].data.length);
    assert.equal(c.columns.length, SAMPLE[d].features.length + 1);
    assert.deepEqual(c.columns.at(-1), { name: TARGET[d], kind: 'categorical', distinct: 2 });
  }
  assert.equal(classifyFile('fraud.csv', CSV.fraud).reason, 'A yes/no column to learn: Fraud (no / yes). It teaches the card fraud job: 16 of its other 16 columns are measurements that job uses, its Fraud column is named for it and the file’s name points to it.');
  assert.equal(classifyFile('shopper.csv', CSV.shopper).reason, 'A yes/no column to learn: Purchased (no / yes). It teaches the buyers job: 10 of its other 10 columns are measurements that job uses and its Purchased column is named for it.');
  assert.equal(classifyFile('x.csv', CSV.intrusion).reason, 'A yes/no column to learn: Attack (no / yes). It teaches the intrusion job: 15 of its other 16 columns are measurements that job uses and its Attack column is named for it.');
});

test('every shipped brain’s own measurements are enough, on their own, to name its job (inventory included)', () => {
  for (const d of JOBS) {
    const feats = PATTERNS[d].features;
    const text = table([...feats, 'Flag'], 60, (r) => [...feats.map(() => int(r, 1000)), yn(r)], d.length);
    const c = classifyFile('export.csv', text);
    assert.equal(c.kind, 'outcomes', d);
    assert.equal(c.domain, d, d + ': ' + c.reason);
    assert.ok(c.confidence >= 0.5, d + ' ' + c.confidence);
  }
});

test('a business’s own export with its own column names is still read: words, not exact names', () => {
  const text = table(['monthsAsCustomer', 'complaints', 'droppedCalls', 'minutesUsed', 'plan', 'Left'], 200, (r) => [int(r, 60), int(r, 5), int(r, 9), int(r, 900), r() < 0.5 ? 'basic' : 'plus', yn(r)]);
  const c = classifyFile('customers.csv', text);
  assert.equal(c.kind, 'outcomes');
  assert.equal(c.domain, 'churn');
  assert.equal(c.target, 'Left');
  assert.equal(c.confidence, 1);
  assert.match(c.reason, /5 of its other 5 columns are measurements that job uses, its Left column is named for it and the file’s name points to it\.$/);
  assert.equal(classifyFile('export.csv', text).confidence, 0.9);
});

test('a decision log: the decision column, what really happened, and the job — with or without the outcome', () => {
  const c = classifyFile('credit-decisions.csv', LOG);
  assert.deepEqual([c.kind, c.domain, c.decision, c.outcome, c.target, c.confidence], ['decisions', 'credit', 'oldRuleDecision', 'Outcome', null, 0.7]);
  assert.equal(c.reason, 'A log of past decisions: oldRuleDecision records what was decided (approve / decline), and Outcome records what really happened. It teaches the credit default job: 14 of its other 14 columns are measurements that job uses and the file’s name points to it.');
  const h = classifyFile('card-holds.csv', HOLDS);
  assert.deepEqual([h.kind, h.domain, h.decision, h.outcome, h.confidence], ['decisions', 'fraud', 'actionTaken', null, 0.7]);
  assert.match(h.reason, /^A log of past decisions: actionTaken records what was decided \(hold \/ release\), but no column records what really happened\./);
  const y = classifyFile('rule-log.csv', LOG_YESNO);
  assert.deepEqual([y.kind, y.domain, y.decision, y.outcome, y.confidence], ['decisions', 'credit', 'ruleDecision', 'Defaulted', 0.9]);
  // a numeric "rule" column and a yes/no measurement before the decision do not fool it
  const odd = table(['ruleVersion', 'amount', 'isWeekend', 'decision', 'Fraud'], 200, (r) => [1 + int(r, 3), int(r, 900), yn(r), r() < 0.3 ? 'hold' : 'release', yn(r)]);
  const o = classifyFile('payments.csv', odd);
  assert.deepEqual([o.kind, o.decision, o.outcome, o.domain], ['decisions', 'decision', 'Fraud', 'fraud']);
});

test('records are never a brain: bank statements, trial balances and customer lists', () => {
  const cases = [['bank.csv', BANK, 'bank'], ['statement.csv', BANK2, 'bank'], ['tb.csv', TB, 'trial-balance'], ['crm.csv', CRM, 'crm'], ['leads.csv', CRM2, 'crm']];
  for (const [n, text, kind] of cases) {
    const c = classifyFile(n, text);
    assert.equal(c.kind, kind, n);
    assert.deepEqual([c.domain, c.confidence, c.target, c.decision, c.outcome], [null, 0, null, null, null], n);
    assert.ok(c.columns.length >= 3 && c.rows >= 2, n);
  }
  assert.equal(classifyFile('bank.csv', BANK).reason, 'A bank statement: dated money in and out. The books read it — there is nothing in it to learn a job from.');
  assert.equal(classifyFile('tb.csv', TB).reason, 'A trial balance: account codes with debit and credit columns. The books read it — there is nothing in it to learn a job from.');
  assert.equal(classifyFile('crm.csv', CRM).reason, 'A customer list: names or contact details with deal stages. The CRM keeps it — a list of people is not a set of cases to learn from.');
  // ...and files that only look a little like them are not taken for them
  const near = [
    ['Date,Amount,Merchant,Fraud', 'outcomes'],          // dated money, but no description: card payments, not a statement
    ['Amount,Description,Fraud', 'outcomes'],            // money and words, but no date
    ['Date,Visits,Converted', 'outcomes'],
    ['Code,Debit,Flag', 'outcomes'],                     // a debit column alone is not a trial balance
    ['Debit,Credit,Flag', 'outcomes'],                   // nor are debit and credit without account codes
    ['Name,Region,Flag', 'outcomes'],                    // a name without a deal stage is not a customer list
  ];
  for (const [head, kind] of near) {
    const text = table(head.split(','), 30, (r, i) => head.split(',').map((h, k) => (k === head.split(',').length - 1 ? yn(r) : h === 'Name' ? 'P' + i : h === 'Region' ? ['n', 's', 'e'][i % 3] : h === 'Description' || h === 'Merchant' ? 'm' + (i % 4) : h.endsWith('Date') || h === 'Date' ? '2026-01-' + (10 + (i % 20)) : int(r, 900))));
    assert.equal(classifyFile('f.csv', text).kind, kind, head);
  }
});

test('refused in words: no learnable column, an empty or unreadable file, too large', () => {
  const staff = classifyFile('staff.csv', STAFF);
  assert.equal(staff.kind, 'unknown');
  assert.equal(staff.reason, 'There is no column with exactly two values to learn — a yes/no, churned/stayed or paid/defaulted column.');
  assert.equal(staff.rows, 3);
  assert.deepEqual(staff.columns.map((c) => c.name), ['Name', 'Role', 'Salary']);
  const three = table(['a', 'b', 'Result'], 60, (r, i) => [int(r, 9), int(r, 9), ['win', 'lose', 'draw'][i % 3]]);
  assert.equal(classifyFile('games.csv', three).kind, 'unknown');
  for (const junk of ['', '   \n ', 42, null, undefined, {}, ['a,b']]) {
    const c = classifyFile('x.csv', junk);
    assert.deepEqual([c.kind, c.domain, c.confidence, c.rows, c.columns], ['unknown', null, 0, 0, []]);
    assert.equal(c.reason, 'The file is empty, or it is not text.');
  }
  assert.equal(classifyFile('x.csv', 'a,b,Flag').reason, 'It could not be read as a table — it needs a header row, two or more columns and at least one row of data.');
  assert.equal(classifyFile('x.csv', 'Flag\nyes\nno\nyes').reason, 'It could not be read as a table — it needs a header row, two or more columns and at least one row of data.');
  const two = classifyFile('x.csv', 'amount,Fraud\n' + Array.from({ length: 40 }, (_, i) => (i * 7) % 31 + ',' + (i % 3 ? 'no' : 'yes')).join('\n'));
  assert.deepEqual([two.kind, two.target, two.domain], ['outcomes', 'Fraud', 'fraud']);
  const exact = 'amount,Fraud\n1,yes\n2,no\n3,yes\n' + 'x'.repeat(MAX_CHARS - 30);
  assert.equal(exact.length, MAX_CHARS);
  assert.notEqual(classifyFile('x.csv', exact).reason.slice(0, 22), 'The file is too large ');
  assert.equal(classifyFile('x.csv', exact + 'x').reason, 'The file is too large to read here (more than 4000000 characters) — split it into smaller files.');
});

test('which column to learn: an outcome word first, else csv-forge’s choice; a hint by name wins', () => {
  const first = table(['Failed', 'temp', 'rpm', 'isNew'], 80, (r) => [yn(r), 290 + int(r, 30), 1300 + int(r, 400), yn(r)]);
  assert.equal(classifyFile('m.csv', first).target, 'Failed');
  const plain = table(['x', 'y', 'Flag'], 80, (r) => [int(r, 50), int(r, 50), yn(r)]);
  const c = classifyFile('data.csv', plain);
  assert.deepEqual([c.kind, c.target, c.domain, c.confidence], ['outcomes', 'Flag', null, 0]);
  assert.equal(c.reason, 'A yes/no column to learn: Flag (no / yes). It does not look like any of the company’s eight jobs — name the job to use it.');
  assert.equal(classifyFile('m.csv', first, { target: 'isnew' }).target, 'isNew');
  assert.equal(classifyFile('m.csv', first, { target: 'temp' }).kind, 'unknown');          // a hint must name a yes/no column
  assert.equal(classifyFile('m.csv', first, { target: 'nope' }).kind, 'unknown');
  const named = classifyFile('data.csv', plain, { domain: 'energy' });
  assert.deepEqual([named.domain, named.confidence], ['energy', 1]);
  assert.equal(named.reason, 'A yes/no column to learn: Flag (no / yes). You said it teaches the power overload job.');
  assert.equal(classifyFile('data.csv', plain, { domain: 'Energy' }).domain, null);          // only a real job id is a hint
  // a decision column by name: it must be a column of a handful of choices
  const log = classifyFile('m.csv', first, { decision: 'isNew', outcome: 'Failed' });
  assert.deepEqual([log.kind, log.decision, log.outcome], ['decisions', 'isNew', 'Failed']);
  assert.equal(classifyFile('m.csv', first, { decision: 'rpm' }).kind, 'outcomes');
  assert.deepEqual([classifyFile('credit-decisions.csv', LOG, { outcome: 'nope' }).outcome], [null]);
});

test('the evidence thresholds, exactly: an outcome named for the job is enough; a near tie is not', () => {
  assert.equal(MIN_SCORE, 300);
  assert.equal(MARGIN, 100);
  const named = table(['alpha', 'beta', 'Fraud'], 60, (r) => [int(r, 50), int(r, 50), yn(r)]);
  const c = classifyFile('data.csv', named);
  assert.deepEqual([c.domain, c.confidence], ['fraud', 0.3]);                 // 0 + 300 + 0: exactly the minimum
  assert.equal(c.reason, 'A yes/no column to learn: Fraud (no / yes). It teaches the card fraud job: 0 of its other 2 columns are measurements that job uses and its Fraud column is named for it.');
  const weak = table(['amount', 'colour', 'size', 'Flag'], 60, (r) => [int(r, 50), int(r, 50), int(r, 50), yn(r)]);
  assert.equal(classifyFile('data.csv', weak).domain, null);                   // 600 × 1/3 = 200: too little
  const month = table(['month', 'Flag'], 60, (r) => [1 + int(r, 12), yn(r)]);  // 'month' is a churn word and an energy word
  const tie = classifyFile('data.csv', month);
  assert.equal(tie.domain, null);
  assert.equal(tie.reason, 'A yes/no column to learn: Flag (no / yes). It fits the leavers and power overload jobs about equally — name the job to use it.');
  const just = classifyFile('meter.csv', month);                              // the file name breaks the tie by exactly the margin
  assert.deepEqual([just.domain, just.confidence], ['energy', 0.7]);
});

test('jobsFor: the jobs each kind of business uses, read from the adoption guide’s own words', () => {
  const all = ['shopper', 'churn', 'fraud', 'credit', 'inventory', 'maintenance', 'energy', 'intrusion'];
  assert.deepEqual(JOBS, all);
  assert.deepEqual(jobsFor('retail'), all);
  assert.deepEqual(jobsFor('services'), all.filter((d) => d !== 'energy'));          // "light use": equipment and supplies, no load shedding
  assert.deepEqual(jobsFor('manufacturing'), all.filter((d) => d !== 'fraud'));      // trade accounts on terms, no card payments
  assert.deepEqual(jobsFor('saas'), all.filter((d) => d !== 'inventory'));           // no stock
  assert.deepEqual(jobsFor('trades'), all.filter((d) => d !== 'energy'));
  assert.deepEqual(jobsFor('other'), all);
  for (const junk of ['x', '', null, undefined, 1, {}, 'Retail']) assert.deepEqual(jobsFor(junk), []);
  assert.deepEqual(ADOPTION.map((b) => b.id), ['retail', 'services', 'manufacturing', 'saas', 'trades']);
});

// ── differentiate ───────────────────────────────────────────────────────────────────────────────────────────────────
test('THE PLAN for an online retailer with seven real files, a decision log, a bank statement, a CRM export and a staff list', () => {
  assert.equal(P1.ok, true);
  assert.equal(P1.why, '');
  assert.equal(P1.model, PLAN_MODEL);
  assert.equal(P1.seed, 1);
  assert.deepEqual(P1.business, { type: 'retail', name: 'Online retail', needs: JOBS.slice() });
  assert.deepEqual(P1.jobs.map((j) => [j.domain, j.agent, j.source, j.verified, j.reverify, j.needed, j.file]), [
    ['shopper', 'sales', 'grown', true, false, true, 'shopper.csv'], ['churn', 'service', 'grown', true, false, true, 'churn.csv'],
    ['fraud', 'finance', 'grown', true, false, true, 'fraud.csv'], ['credit', 'finance', 'grown', true, false, true, 'credit.csv'],
    ['inventory', 'ops', 'shipped', true, true, true, null], ['maintenance', 'ops', 'grown', true, false, true, 'maintenance.csv'],
    ['energy', 'ops', 'grown', true, false, true, 'energy.csv'], ['intrusion', 'systems', 'grown', true, false, true, 'intrusion.csv']]);
  for (const j of P1.jobs.filter((x) => x.source === 'grown')) {
    assert.equal(validPattern(j.pattern), true, j.domain);
    assert.ok(j.heldAuc >= GATE_AUC && j.heldAuc === j.pattern.heldAuc, j.domain);
    assert.equal(j.rows, SAMPLE[j.domain].data.length);
    assert.equal(j.target, TARGET[j.domain]);
    assert.equal(j.positive, 'yes');
    assert.equal(j.pattern.domain, j.domain);
    assert.equal(j.pattern.role, j.agent);
    assert.ok(j.features.length >= 1 && j.features.every((f) => SAMPLE[j.domain].features.includes(f.from.split(' = ')[0])), j.domain);   // a yes/no column is learned as 'name = level'
    assert.deepEqual(j.pattern.features, j.features.map((f) => f.name));
    assert.equal(j.why, 'Grown from your file ' + j.file + ': ' + j.rows + ' rows, learning ' + j.target + ' (yes is the case to catch). On the rows it never grew on it scored AUC ' + j.heldAuc.toFixed(3) + ' — it passed.');
  }
  assert.equal(job(P1, 'fraud').pattern.title, 'card fraud (grown from fraud.csv)');
  // the plan's brain is exactly what train.mjs grows from that file with that seed — re-grown here independently
  const t = trainFromCsv(CSV.fraud, { target: 'Fraud', domain: 'fraud', seed: 1 });
  assert.equal(job(P1, 'fraud').pattern.patternId, t.pattern.patternId);
  assert.deepEqual(job(P1, 'fraud').pattern.rules, t.pattern.rules);
  const inv = job(P1, 'inventory');
  assert.deepEqual(inv.pattern, PATTERNS.inventory);
  assert.deepEqual([inv.heldAuc, inv.rows, inv.target, inv.positive], [PATTERNS.inventory.heldAuc, null, null, null]);
  assert.deepEqual(inv.features, PATTERNS.inventory.features.map((n) => ({ name: n, from: n })));
  assert.equal(inv.why, 'No file of yours for this job: the Ops agent starts on the shipped brain, grown on realistic-synthetic data — no open dataset exists for it. It scored AUC 0.824 on rows it never grew on, and must re-verify on your own records before it acts.');
  assert.deepEqual(P1.files.map((f) => [f.name, f.kind, f.domain, f.used, f.why]), [
    ['shopper.csv', 'outcomes', 'shopper', true, 'Grew the buyers brain.'], ['churn.csv', 'outcomes', 'churn', true, 'Grew the leavers brain.'],
    ['fraud.csv', 'outcomes', 'fraud', true, 'Grew the card fraud brain.'], ['credit.csv', 'outcomes', 'credit', true, 'Grew the credit default brain.'],
    ['energy.csv', 'outcomes', 'energy', true, 'Grew the power overload brain.'], ['intrusion.csv', 'outcomes', 'intrusion', true, 'Grew the intrusion brain.'],
    ['maintenance.csv', 'outcomes', 'maintenance', true, 'Grew the machine failure brain.'],
    ['credit-decisions.csv', 'decisions', 'credit', true, 'Set aside: the plan grows the credit default brain from credit.csv. Your past decisions were re-grown and checked.'],
    ['bank.csv', 'bank', null, false, 'Set aside as a record — not a brain.'], ['crm.csv', 'crm', null, false, 'Set aside as a record — not a brain.'],
    ['staff.csv', 'unknown', null, false, 'Not used.']]);
  assert.deepEqual(P1.records, [
    { file: 'bank.csv', kind: 'bank', rows: 3, why: classifyFile('bank.csv', BANK).reason },
    { file: 'crm.csv', kind: 'crm', rows: 3, why: classifyFile('crm.csv', CRM).reason }]);
  assert.deepEqual(P1.gaps, [
    'bank.csv is a bank statement: it was recognised and set aside — bringing it into the books or the CRM is not part of planting yet.',
    'crm.csv is a customer list: it was recognised and set aside — bringing it into the books or the CRM is not part of planting yet.',
    'staff.csv was not used. There is no column with exactly two values to learn — a yes/no, churned/stayed or paid/defaulted column.',
    'credit-decisions.csv also teaches the credit default job; the plan uses credit.csv (on the rows each never grew on: AUC 0.698 against AUC 0.698; the earlier file wins a tie).',
    SHIPPED_GAP('stock-out', 'Ops agent'),
    MODELLED(ALL_BUT_SERVICE)]);
  assert.deepEqual(P1.suite.agents.map((a) => [a.id, a.jobs]), [['sales', ['shopper']], ['service', ['churn']], ['finance', ['fraud', 'credit']],
    ['ops', ['inventory', 'maintenance', 'energy']], ['systems', ['intrusion']], ['audit', ['fraud', 'credit', 'intrusion']]]);
  const retail = ADOPTION.find((b) => b.id === 'retail');
  for (const a of P1.suite.agents) { assert.equal(a.takesOver, retail.agents[a.id]); assert.equal(a.name, AGENTS.find((x) => x.id === a.id).name); }
  assert.deepEqual(P1.suite.off, []);
  assert.deepEqual(P1.suite.humans, retail.humans);
  // the office comparison is adopt.mjs's, on their headcount — recomputed here
  const f = fitPlan(fitInput([{ id: 'service', value: 12 }]), OFFICE, BASIS);
  assert.deepEqual(P1.office, { ok: true, why: '', years: f.plan.years, headcountToday: f.plan.today.headcount, headcountAiNative: f.plan.sovereign.headcount, addedLeads: f.added,
    boxes: f.plan.capacity.boxes, fits: f.plan.human.fits, todayTotal: Math.round(f.plan.today.total), aiNativeTotal: Math.round(f.plan.sovereign.total), saving: Math.round(f.plan.saving),
    savingPermille: Math.round(f.plan.savingPct * 1000), modelled: ['sales', 'marketing', 'finance', 'people', 'ops', 'it', 'leadership'] });
  assert.equal(P1.office.headcountToday, 52);
  assert.match(P1.planHash, /^[0-9a-f]{64}$/);
});

test('legacy re-growth: the old rule re-grown, checked on decisions it never grew on, every mismatch listed and traced back', () => {
  const [g] = job(P1, 'credit').legacy;
  assert.equal(g.file, 'credit-decisions.csv');
  assert.deepEqual([g.decisionColumn, g.decisions, g.outcomeColumn, g.positiveDecision], ['oldRuleDecision', ['approve', 'decline'], 'Outcome', 'decline']);
  const heldOut = CREDIT.data.map((_, i) => i).filter((i) => sliceOf(String(i)) === 'holdout');
  assert.equal(g.n, heldOut.length);
  assert.equal(g.same + g.mismatches.length, g.n);
  assert.equal(g.equivalence, Math.round(g.same / g.n * 1000) / 1000);
  assert.deepEqual(g.mismatches.map((m) => m.row), [239, 557]);
  for (const m of g.mismatches) {
    const r = CREDIT.data[m.row - 1];                                    // row = the 1-based record after the header
    assert.ok(heldOut.includes(m.row - 1));
    assert.equal(m.legacy, oldRule(r));
    assert.notEqual(m.regrown, m.legacy);
    assert.equal(m.outcome, happened(r));
  }
  // how often the business's own past decisions were right — recomputed from the source rows
  const right = CREDIT.data.filter((r) => (oldRule(r) === 'decline') === (r[LABEL] === 1)).length;
  assert.equal(g.pastN, CREDIT.data.length);
  assert.equal(g.pastAccuracy, Math.round(right / CREDIT.data.length * 1000) / 1000);
  assert.equal(g.pastAccuracy, 0.733);
  assert.equal(g.why, 'Your oldRuleDecision column decided approve or decline. The organ re-grown from your log agrees with it on 442 of 444 held-out decisions it never grew on (99.5%); every mismatch is listed. Your past decisions matched what really happened in 1100 of 1500 cases (73.3%).');
});

test('a professional-services firm: a decision log grows its credit brain; a file it does not usually need is still planted; a failing brain is not swapped', () => {
  assert.deepEqual(P2.business.needs, jobsFor('services'));
  assert.deepEqual(P2.jobs.map((j) => [j.domain, j.source, j.verified, j.needed, j.file]), [
    ['shopper', 'shipped', true, true, null], ['churn', 'shipped', true, true, null], ['fraud', 'grown', false, true, 'fraud-random.csv'],
    ['credit', 'grown', true, true, 'credit-decisions.csv'], ['inventory', 'shipped', true, true, null], ['maintenance', 'shipped', true, true, null],
    ['energy', 'grown', true, false, 'energy.csv'], ['intrusion', 'shipped', true, true, null]]);
  // the decision column never teaches the brain that replaces it: the brain is exactly train.mjs's on the log without it
  const credit = job(P2, 'credit');
  const t = trainFromCsv(LOG_NO_DECISION, { target: 'Outcome', domain: 'credit', seed: 1 });
  assert.equal(credit.pattern.patternId, t.pattern.patternId);
  assert.deepEqual([credit.target, credit.positive, credit.rows], ['Outcome', 'defaulted', 1500]);
  assert.ok(credit.features.every((f) => f.from !== 'oldRuleDecision'));
  assert.equal(credit.legacy.length, 1);
  assert.match(job(P2, 'energy').why, /^This kind of business does not usually need the power overload job; it is planted because your file teaches it\. Grown from your file energy\.csv/);
  const fraud = job(P2, 'fraud');
  assert.ok(fraud.heldAuc < GATE_AUC && validPattern(fraud.pattern) && fraud.pattern.heldAuc === fraud.heldAuc);
  assert.match(fraud.why, /^The brain grown from your file fraud-random\.csv did not pass: grew but failed held-out \(AUC 0\.\d+ < 0\.6\) — CUT\. The Finance agent holds this work for a person until more of your data arrives\.$/);
  const [h] = fraud.legacy;
  assert.deepEqual([h.file, h.decisionColumn, h.outcomeColumn, h.positiveDecision, h.pastAccuracy, h.pastN], ['card-holds.csv', 'actionTaken', null, null, null, 0]);
  assert.equal(h.same + h.mismatches.length, h.n);
  assert.deepEqual([h.n, h.same, h.equivalence, h.mismatches], [318, 318, 1, []]);   // a one-threshold rule, re-grown exactly on every held-out decision
  assert.ok(h.mismatches.every((m) => !('outcome' in m)));
  assert.equal(h.n, FRAUD.data.map((_, i) => i).filter((i) => sliceOf(String(i)) === 'holdout').length);
  assert.equal(h.why, 'Your actionTaken column decided hold or release. The organ re-grown from your log agrees with it on ' + h.same + ' of ' + h.n + ' held-out decisions it never grew on (' + (h.equivalence * 100).toFixed(1) + '%); every mismatch is listed.');
  assert.deepEqual(P2.files.map((f) => [f.name, f.used, f.why]), [
    ['credit-decisions.csv', true, 'Grew the credit default brain. Your past decisions were re-grown and checked.'], ['energy.csv', true, 'Grew the power overload brain.'],
    ['fraud-random.csv', true, 'Grew the card fraud brain — it did not pass its check.'], ['card-holds.csv', true, 'Your past decisions were re-grown and checked.']]);
  assert.deepEqual(P2.gaps, [
    'card-holds.csv records your past decisions but not what really happened, so how often they were right cannot be measured.',
    SHIPPED_GAP('buyers', 'Sales agent'), SHIPPED_GAP('leavers', 'Service agent'),
    'The card fraud brain grown from fraud-random.csv did not pass its check on rows it never grew on — that work waits for a person until more of your data arrives.',
    SHIPPED_GAP('stock-out', 'Ops agent'), SHIPPED_GAP('machine failure', 'Ops agent'), SHIPPED_GAP('intrusion', 'Systems agent'),
    MODELLED('Leadership')]);
  assert.deepEqual(P2.suite.agents.map((a) => [a.id, a.jobs]), [['sales', ['shopper']], ['service', ['churn']], ['finance', ['credit']],
    ['ops', ['inventory', 'maintenance', 'energy']], ['systems', ['intrusion']], ['audit', ['credit']]]);
  assert.deepEqual(P2.office.modelled, ['leadership']);
  assert.equal(P2.office.headcountToday, OFFICE.departments.reduce((s, d) => s + d.today, 0) + OFFICE.leadership.today);
});

test('no files at all: every job starts on its shipped brain, the second brain waits for their data, the office waits for a headcount', () => {
  assert.deepEqual(P3.business, { type: 'other', name: 'Other', needs: JOBS.slice() });
  assert.deepEqual(P3.jobs.map((j) => [j.domain, j.source, j.verified, j.reverify, j.file, j.heldAuc]), JOBS.map((d) => [d, 'shipped', true, true, null, PATTERNS[d].heldAuc]));
  for (const j of P3.jobs) assert.deepEqual(j.pattern, PATTERNS[j.domain]);
  assert.equal(job(P3, 'fraud').why, 'No file of yours for this job: the Finance agent starts on the shipped brain, grown on Credit Card Fraud Detection (ULB Machine Learning Group / Worldline). It scored AUC 0.959 on rows it never grew on, and must re-verify on your own records before it acts.');
  assert.deepEqual(P3.suite.agents.map((a) => [a.id, a.takesOver]), AGENTS.filter((a) => a.domains.length).map((a) => [a.id, a.job]));
  assert.deepEqual(P3.suite.off, [{ id: 'audit', name: 'Audit agent', why: OFF_AUDIT }]);
  assert.deepEqual(P3.suite.humans, ['Direction, and the decisions only people should make', 'Relationships with customers and suppliers', 'Every call no brain could confirm (the Watch list)']);
  assert.deepEqual(P3.gaps, [SHIPPED_GAP('buyers', 'Sales agent'), SHIPPED_GAP('leavers', 'Service agent'), SHIPPED_GAP('card fraud', 'Finance agent'), SHIPPED_GAP('credit default', 'Finance agent'),
    SHIPPED_GAP('stock-out', 'Ops agent'), SHIPPED_GAP('machine failure', 'Ops agent'), SHIPPED_GAP('power overload', 'Ops agent'), SHIPPED_GAP('intrusion', 'Systems agent'),
    'The Audit agent stays off: ' + OFF_AUDIT + '.', 'The office comparison was not made: no headcount was given — it needs one per department.']);
  assert.deepEqual(P3.office, { ok: false, why: 'no headcount was given — it needs one per department' });
  assert.deepEqual(P3.files, []);
  assert.deepEqual(P3.records, []);
});

test('no data and no brains: every job a manufacturer needs goes to the Watch list and every agent stays off', () => {
  assert.deepEqual(P4.jobs.map((j) => [j.domain, j.source, j.verified, j.pattern, j.features, j.heldAuc]), jobsFor('manufacturing').map((d) => [d, 'none', false, null, [], null]));
  assert.equal(P4.jobs[0].why, 'No file of yours and no shipped brain for this job: its work waits on the Watch list for a person until data arrives.');
  assert.deepEqual(P4.suite.agents, []);
  assert.deepEqual(P4.suite.off.map((o) => [o.id, o.why]), AGENTS.map((a) => [a.id, a.domains.length ? OFF_WORKER : OFF_AUDIT]));
  assert.deepEqual(P4.gaps, [...jobsFor('manufacturing').map((d) => NONE_GAP({ shopper: 'buyers', churn: 'leavers', credit: 'credit default', inventory: 'stock-out', maintenance: 'machine failure', energy: 'power overload', intrusion: 'intrusion' }[d])),
    ...AGENTS.map((a) => 'The ' + a.name + ' stays off: ' + (a.domains.length ? OFF_WORKER : OFF_AUDIT) + '.'), 'The office comparison was not made: the model office and its sourced figures were not given.']);
  assert.deepEqual(P4.suite.humans, ADOPTION.find((b) => b.id === 'manufacturing').humans);
});

test('past decisions in the outcome’s own words are measured; in other words they are not — until the file says which means yes', () => {
  const [y, other] = job(P5, 'credit').legacy;
  assert.deepEqual([y.file, y.positiveDecision, y.pastAccuracy, y.pastN], ['rule-log.csv', 'yes', 0.733, 1500]);
  assert.deepEqual([other.file, other.positiveDecision, other.pastAccuracy, other.pastN], ['credit-log-2.csv', null, null, 0]);
  assert.deepEqual(y.mismatches, [{ row: 239, legacy: 'no', regrown: 'yes', outcome: 'no' }, { row: 557, legacy: 'no', regrown: 'yes', outcome: 'no' }]);
  assert.equal(job(P5, 'credit').file, 'rule-log.csv');                      // two equal brains: the earlier file wins
  assert.deepEqual(P5.gaps.slice(0, 1), ['credit-log-2.csv: its decisions (approve / decline) do not read as yes or no for Outcome — say which decision means yes to measure how often they were right.']);
  assert.ok(P5.gaps.includes('credit-log-2.csv also teaches the credit default job; the plan uses rule-log.csv (on the rows each never grew on: AUC 0.698 against AUC 0.698; the earlier file wins a tie).'));
  assert.deepEqual(file(P5, 'credit-log-2.csv'), { ...file(P5, 'credit-log-2.csv'), used: true, why: 'Set aside: the plan grows the credit default brain from rule-log.csv. Your past decisions were re-grown and checked.' });
  assert.equal(P5.office.why, 'no headcount was given — it needs one per department');
});

test('the boundaries: exactly 120 decisions re-grow, 119 do not; a file too small to grow is a brain that did not pass', () => {
  assert.deepEqual(P6.files.map((f) => [f.name, f.rows, f.used, f.why]), [
    ['credit-119.csv', MIN_ROWS - 1, false, 'Set aside: the plan grows the credit default brain from credit-120.csv. Its decisions could not be re-grown.'],
    ['credit-120.csv', MIN_ROWS, true, 'Grew the credit default brain — it did not pass its check. Your past decisions were re-grown and checked.'],
    ['fraud-tiny.csv', 50, true, 'Grew the card fraud brain — it did not pass its check.']]);
  const g = job(P6, 'credit').legacy;
  assert.equal(g.length, 1);
  assert.equal(g[0].file, 'credit-120.csv');
  for (const m of g[0].mismatches) assert.equal(m.legacy, oldRule(CREDIT.data[m.row - 1]));
  assert.equal(P6.gaps[0], 'credit-119.csv could not be re-grown: it needs at least 120 decisions to re-grow and check honestly (this log has 119).');
  const tiny = job(P6, 'fraud');
  assert.deepEqual([tiny.source, tiny.verified, tiny.pattern, tiny.heldAuc, tiny.rows, tiny.target, tiny.positive, tiny.features], ['grown', false, null, null, null, null, null, []]);
  assert.match(tiny.why, /did not pass: it needs at least 120 rows to grow and grade a brain honestly \(this file has 50\)\./);
  assert.deepEqual(P6.suite.off.map((o) => o.id), ['finance', 'audit']);
  assert.ok(P6.gaps.includes('The Finance agent stays off: ' + OFF_WORKER + '.'));
  assert.ok(P6.gaps.includes('credit-119.csv also teaches the credit default job; the plan uses credit-120.csv (on the rows each never grew on: AUC 0.500 against no brain; the earlier file wins a tie).'));
});

test('a log of past decisions alone: re-grown and checked, mismatches traced to the source rows, no brain and no past accuracy', () => {
  const credit = job(P7, 'credit');
  assert.deepEqual([credit.source, credit.file], ['shipped', null]);                // nothing to learn an outcome from: the shipped brain starts it
  const [g] = credit.legacy;
  assert.deepEqual([g.file, g.outcomeColumn, g.positiveDecision, g.pastAccuracy, g.pastN], ['credit-old-calls.csv', null, null, null, 0]);
  assert.ok(g.mismatches.length >= 1, 'a log this small leaves some disagreements to list');
  assert.equal(g.same + g.mismatches.length, g.n);
  for (const m of g.mismatches) {
    assert.deepEqual(Object.keys(m), ['row', 'legacy', 'regrown']);
    assert.equal(m.legacy, oldRule(CREDIT.data[m.row - 1]));
    assert.notEqual(m.regrown, m.legacy);
  }
  assert.deepEqual(file(P7, 'credit-old-calls.csv'), { ...file(P7, 'credit-old-calls.csv'), kind: 'decisions', used: true, why: 'Your past decisions were re-grown and checked.' });
  assert.equal(P7.gaps[0], 'credit-old-calls.csv records your past decisions but not what really happened, so how often they were right cannot be measured.');
});

test('refusals: the kind of business, the list of files; junk files are reported, never thrown', () => {
  const no = (why) => ({ ok: false, why, model: PLAN_MODEL, seed: 0, business: null, files: [], jobs: [], suite: { agents: [], off: [], humans: [] }, records: [], gaps: [], office: null, planHash: '' });
  const kinds = 'the kind of business must be one of retail, services, manufacturing, saas, trades or other';
  for (const b of [undefined, null, 'retail', {}, { type: 'Retail' }, { type: 'shop' }]) assert.deepEqual(differentiate({ business: b }, SHIPPED), no(kinds));
  assert.deepEqual(differentiate(null, SHIPPED), no(kinds));
  assert.deepEqual(differentiate({ business: { type: 'other' }, files: 'x' }, SHIPPED), no('the files must be a list of at most 16 CSV files'));
  assert.deepEqual(differentiate({ business: { type: 'other' }, files: null }, SHIPPED), no('the files must be a list of at most 16 CSV files'));
  const junk = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: 'f' + i + '.csv', text: '' }));
  assert.deepEqual(differentiate({ business: { type: 'other' }, files: junk }, SHIPPED), no('the files must be a list of at most 16 CSV files'));
  const sixteen = differentiate({ business: { type: 'other' }, files: junk.slice(1) }, SHIPPED);
  assert.equal(sixteen.ok, true);
  assert.equal(sixteen.files.length, MAX_FILES);
  const odd = differentiate({ business: { type: 'saas' }, files: [null, 7, { name: '', text: 'a' }, { name: 42, text: BANK }, { text: TB }] }, SHIPPED);
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.files.map((f) => [f.name, f.kind, f.used]), [['an unnamed file', 'unknown', false], ['an unnamed file', 'unknown', false], ['an unnamed file', 'unknown', false],
    ['an unnamed file', 'bank', false], ['an unnamed file', 'trial-balance', false]]);
  assert.equal(odd.gaps[0], 'an unnamed file was not used. The file is empty, or it is not text.');
  assert.equal(odd.files[0].reason, 'The file is empty, or it is not text.');
  const long = differentiate({ business: { type: 'other' }, files: [{ name: 'n'.repeat(300) + '.csv', text: STAFF }] }, SHIPPED);
  assert.equal(long.files[0].name, 'n'.repeat(120));
});

test('the office comparison: only from the model office and its figures, and only on a headcount', () => {
  const o = (pairs, shipped) => differentiate({ business: { type: 'other', pairs } }, shipped).office;
  const given = 'the model office and its sourced figures were not given';
  assert.deepEqual(o([{ id: 'service', value: 1 }], { ...SHIPPED, office: undefined }), { ok: false, why: given });
  assert.deepEqual(o([{ id: 'service', value: 1 }], { ...SHIPPED, office: 'x' }), { ok: false, why: given });
  assert.deepEqual(o([{ id: 'service', value: 1 }], { ...SHIPPED, basis: null }), { ok: false, why: given });
  assert.deepEqual(o([{ id: 'service', value: 1 }], { ...SHIPPED, basis: 'x' }), { ok: false, why: given });
  assert.deepEqual(o(undefined, SHIPPED), { ok: false, why: 'no headcount was given — it needs one per department' });
  assert.deepEqual(o('x', SHIPPED), { ok: false, why: 'no headcount was given — it needs one per department' });
  assert.deepEqual(o([{ id: 'nope', value: 1 }], SHIPPED), { ok: false, why: 'there is no department called nope' });
  assert.deepEqual(o([{ id: 'service', value: -1 }], SHIPPED), { ok: false, why: 'the headcount for Customer service must be a whole number from 0 to 10000' });
  const full = formFields(OFFICE).map((f) => ({ id: f.id, value: f.value }));
  assert.deepEqual(o(full, SHIPPED).modelled, []);
  assert.equal(o([null, ...full], SHIPPED).ok, true);
  const plan = differentiate({ business: { type: 'other', pairs: full } }, SHIPPED);
  assert.ok(!plan.gaps.some((g) => g.startsWith('No headcount')) && !plan.gaps.some((g) => g.startsWith('The office')));
  // a line the model office leaves at zero is not "kept at the model's headcount" — it is simply empty
  const zero = { ...OFFICE, departments: [...OFFICE.departments, { ...OFFICE.departments[0], id: 'extra', name: 'Extra', today: 0 }] };
  assert.deepEqual(o(full, { ...SHIPPED, office: zero }).modelled, []);
  assert.deepEqual(o([{ id: 'extra', value: 2 }], { ...SHIPPED, office: zero }).modelled, formFields(OFFICE).filter((f) => f.value > 0).map((f) => f.id));
});

test('shipped brains are taken only when they are what they say: the right job, well-formed, over the gate', () => {
  const swap = differentiate({ business: { type: 'other' } }, { ...SHIPPED, patterns: { ...PATTERNS, fraud: PATTERNS.churn } });
  assert.equal(job(swap, 'fraud').source, 'none');
  const low = differentiate({ business: { type: 'other' } }, { ...SHIPPED, patterns: { ...PATTERNS, credit: { ...PATTERNS.credit, heldAuc: 0.55 } } });
  assert.equal(job(low, 'credit').source, 'none');
  const broken = differentiate({ business: { type: 'other' } }, { ...SHIPPED, patterns: { ...PATTERNS, energy: { ...PATTERNS.energy, rules: [] } } });
  assert.equal(job(broken, 'energy').source, 'none');
  const noIndex = differentiate({ business: { type: 'other' } }, { patterns: PATTERNS });
  assert.equal(job(noIndex, 'fraud').why, 'No file of yours for this job: the Finance agent starts on the shipped brain. It scored AUC 0.959 on rows it never grew on, and must re-verify on your own records before it acts.');
  assert.equal(job(noIndex, 'inventory').source, 'shipped');
  for (const s of [undefined, null, 'x', { patterns: null }, { patterns: 'x' }]) assert.deepEqual(differentiate({ business: { type: 'other' } }, s).jobs.map((j) => j.source), JOBS.map(() => 'none'));
});

test('determinism: the same input gives the same plan and planHash; another seed grows another brain', () => {
  const input = { business: { type: 'manufacturing', pairs: [{ id: 'ops', value: 20 }] }, files: [{ name: 'machines.csv', text: CSV.maintenance }] };
  const a = differentiate(input, SHIPPED, { seed: 5 }), b = differentiate(clone(input), SHIPPED, { seed: 5 });
  assert.equal(a.planHash, b.planHash);
  assert.deepEqual(a, b);
  const c = differentiate(input, SHIPPED, { seed: 6 });
  assert.notEqual(c.planHash, a.planHash);
  assert.notEqual(job(c, 'maintenance').pattern.patternId, job(a, 'maintenance').pattern.patternId);
  assert.equal(a.seed, 5);
  for (const [s, want] of [[undefined, 1], [0, 1], ['x', 1], [-1, 4294967295], [2.7, 2], [7, 7]]) assert.equal(differentiate({ business: { type: 'other' } }, SHIPPED, { seed: s }).seed, want);
  assert.equal(differentiate({ business: { type: 'other' } }, SHIPPED, null).seed, 1);
  // the hash survives a trip through JSON, and is exactly sha256 of the canonical plan with non-whole numbers as strings
  assert.equal(hashPlan(clone(P1)), P1.planHash);
  assert.equal(hashPlan({ a: 1.5, b: 'x', c: [2, 0.25, { d: -3 }], planHash: 'ignored' }), sha256(canonical({ a: '1.5', b: 'x', c: [2, '0.25', { d: -3 }] })));
  assert.equal(hashPlan({ s: 'str', o: { k: [1] } }), sha256('{"o":{"k":[1]},"s":"str"}'));
  for (const junk of [null, undefined, { x: 1n }, { get x() { throw new Error('boom'); } }]) assert.equal(hashPlan(junk), '');
  const moved = clone(P1); moved.gaps.push('x');
  assert.notEqual(hashPlan(moved), P1.planHash);
});

// ── the library and the records ─────────────────────────────────────────────────────────────────────────────────────
test('plannedLibrary: every brain that passed its gate, grown and shipped — and nothing from a plan whose hash does not re-compute', () => {
  const lib = plannedLibrary(P1);
  assert.deepEqual(Object.keys(lib), JOBS);
  assert.equal(lib.fraud, job(P1, 'fraud').pattern);
  assert.deepEqual(lib.inventory, PATTERNS.inventory);
  assert.deepEqual(Object.keys(plannedLibrary(P2)), ['shopper', 'churn', 'credit', 'inventory', 'maintenance', 'energy', 'intrusion']);   // the failed fraud brain is not in it
  assert.deepEqual(plannedLibrary(P4), {});
  assert.deepEqual(Object.keys(plannedLibrary(clone(P1))), JOBS);
  const reseal = (edit) => { const p = clone(P1); edit(p); p.planHash = hashPlan(p); return p; };
  const keys = (p) => Object.keys(plannedLibrary(p));
  assert.ok(!keys(reseal((p) => { job(p, 'fraud').verified = false; })).includes('fraud'));
  assert.ok(!keys(reseal((p) => { job(p, 'fraud').pattern.rules = []; })).includes('fraud'));
  assert.ok(!keys(reseal((p) => { job(p, 'fraud').pattern.domain = 'churn'; })).includes('fraud'));
  assert.ok(!keys(reseal((p) => { job(p, 'fraud').pattern.heldAuc = 0.5; })).includes('fraud'));
  assert.deepEqual(keys(reseal((p) => { const j = job(p, 'fraud'); j.domain = 'custom'; j.pattern.domain = 'custom'; })), JOBS.filter((d) => d !== 'fraud'));
  // tampering without re-sealing, or a plan that is not ok, gives nothing
  const tampered = clone(P1); job(tampered, 'fraud').pattern.threshold = 99;
  assert.deepEqual(plannedLibrary(tampered), {});
  assert.deepEqual(plannedLibrary(reseal((p) => { p.ok = false; })), {});
  assert.deepEqual(plannedLibrary({ ...clone(P1), planHash: '', x: 1n }), {});
  assert.deepEqual(plannedLibrary(differentiate(null)), {});
});

test('planRecords: the grown brains for their agents, the legacy checks and the plan for an admin — every field a spine scalar', () => {
  const recs = planRecords(P1);
  const tag = P1.planHash.slice(0, 16);
  assert.deepEqual(recs.map((r) => [r.by, r.c, r.id]), [['sales', 'brain', 'shopper.sales'], ['service', 'brain', 'churn.service'], ['finance', 'brain', 'fraud.finance'],
    ['finance', 'brain', 'credit.finance'], ['admin', 'plan', 'legacy-credit-0-' + tag], ['ops', 'brain', 'maintenance.ops'], ['ops', 'brain', 'energy.ops'],
    ['systems', 'brain', 'intrusion.systems'], ['admin', 'plan', 'plan-' + tag]]);
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.f)) assert.ok(/^[a-z][a-zA-Z0-9_]{0,31}$/.test(k) && (typeof v === 'boolean' || Number.isSafeInteger(v) || (typeof v === 'string' && v.length <= 2000)), r.id + '.' + k);
    assert.ok(Object.keys(r.f).length <= 32);
  }
  for (const r of recs.filter((x) => x.c === 'brain')) {
    const j = job(P1, r.f.domain);
    assert.equal(r.by, OWNER_OF[j.domain]);
    const back = fromRecord(r.f);
    assert.deepEqual(back.rules, j.pattern.rules);
    assert.deepEqual([r.f.by, r.f.source, r.f.localAuc, r.f.n, r.f.plan], [j.agent, 'grown', Math.round(j.heldAuc * 1000), j.pattern.held, tag]);
  }
  const [g] = job(P1, 'credit').legacy;
  assert.deepEqual(recs[4].f, { kind: 'legacy', domain: 'credit', file: 'credit-decisions.csv', decision: 'oldRuleDecision', n: g.n, same: g.same, mismatches: 2,
    equivalencePermille: 995, pastPermille: 733, pastN: 1500, plan: tag });
  assert.deepEqual(recs.at(-1).f, { kind: 'plan', business: 'retail', planHash: P1.planHash,
    jobs: 'shopper:grown:1;churn:grown:1;fraud:grown:1;credit:grown:1;inventory:shipped:1;maintenance:grown:1;energy:grown:1;intrusion:grown:1',
    agents: 'sales,service,finance,ops,systems,audit', gaps: 6, files: 11, by: 'planting' });
  // a log without the outcome is published with no past accuracy (-1); a failed brain is not published; shipped brains are left to the runtime
  const two = planRecords(P2);
  assert.deepEqual(two.filter((r) => r.c === 'brain').map((r) => r.id), ['credit.finance', 'energy.ops']);
  assert.deepEqual(two.filter((r) => r.f.kind === 'legacy').map((r) => [r.f.domain, r.f.pastPermille, r.f.pastN]), [['fraud', -1, 0], ['credit', 733, 1500]]);
  assert.equal(two.at(-1).f.jobs, 'shopper:shipped:1;churn:shipped:1;fraud:grown:0;credit:grown:1;inventory:shipped:1;maintenance:shipped:1;energy:grown:1;intrusion:shipped:1');
  assert.deepEqual(planRecords(P4).map((r) => r.id), ['plan-' + P4.planHash.slice(0, 16)]);
  const reseal = (edit) => { const p = clone(P1); edit(p); p.planHash = hashPlan(p); return p; };
  assert.deepEqual(planRecords(reseal((p) => { job(p, 'fraud').agent = 'admin'; })).find((r) => r.id.startsWith('fraud.')).by, 'finance');   // the job's agent, never the plan's word
  assert.equal(planRecords(reseal((p) => { job(p, 'fraud').pattern.held = 1.5; })).find((r) => r.id.startsWith('fraud.')).f.n, 0);
  const t2 = clone(P1); t2.gaps = [];
  assert.deepEqual(planRecords(t2), []);
  assert.deepEqual(planRecords(reseal((p) => { p.ok = false; })), []);
});

test('the records go onto the real spine: each through the gate, each authorised by the role tree — and only there', async () => {
  const keys = {};
  for (const id of ['owner', 'overseer', 'hub', ...AGENTS.map((a) => a.id)]) keys[id] = await fromSeed(sha256Bytes('plant-test/' + id));
  const G = keys.owner.pub;
  const nodes = Object.fromEntries(Object.entries(keys).map(([id, k]) => [id, createNode({ keys: k, genesis: G, name: id })]));
  await nodes.owner.grant('admin-overseer', keys.overseer.pub, 'admin', ['*']);
  await pull(nodes.overseer, nodes.owner);
  await nodes.overseer.grant('hub-door', keys.hub.pub, 'hub', ['inbox', 'msg', 'model']);
  for (const a of AGENTS) await nodes.overseer.grant('agent-' + a.id, keys[a.id].pub, 'agent', a.cols);
  for (const n of Object.values(nodes)) await pull(n, nodes.overseer);
  const recs = planRecords(P1);
  for (const r of recs) {
    const writer = r.by === 'admin' ? nodes.overseer : nodes[r.by];
    const put = await writer.put(r.c, r.id, r.f);
    assert.equal(put.ok, true, r.id + ': ' + put.reason);
  }
  assert.deepEqual(await nodes.finance.put('plan', 'plan-x', { kind: 'plan' }), { ok: false, reason: 'not-authorised' });   // no agent grant names 'plan'
  assert.equal((await nodes.hub.put('brain', 'fraud.hub', recs[2].f)).ok, false);                                          // nor does the hub's name 'brain'
  for (const n of Object.values(nodes)) await pull(nodes.owner, n);
  const v = nodes.owner.view();
  assert.equal(v.report.unauthorized, 0);
  const brains = nodes.owner.list('brain');
  assert.deepEqual(brains.map((b) => b.id), recs.filter((r) => r.c === 'brain').map((r) => r.id).sort());
  for (const b of brains) assert.deepEqual(fromRecord(b).rules, job(P1, b.domain).pattern.rules);
  assert.deepEqual(nodes.owner.list('plan').map((p) => p.id).sort(), recs.filter((r) => r.c === 'plan').map((r) => r.id).sort());
  assert.equal(nodes.owner.list('plan').find((p) => p.kind === 'plan').planHash, P1.planHash);
});

// ── never throws ────────────────────────────────────────────────────────────────────────────────────────────────────
const toxic = { get name() { throw new Error('boom'); }, get text() { throw new Error('boom'); }, get business() { throw new Error('boom'); }, get files() { throw new Error('boom'); },
  get type() { throw new Error('boom'); }, get pairs() { throw new Error('boom'); }, get patterns() { throw new Error('boom'); }, get ok() { throw new Error('boom'); },
  get planHash() { throw new Error('boom'); }, get jobs() { throw new Error('boom'); }, get seed() { throw new Error('boom'); }, get domain() { throw new Error('boom'); },
  get office() { throw new Error('boom'); }, get index() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s')];
test('junk never throws: every export, junk in every position', () => {
  const fns = Object.entries(P).filter(([, v]) => typeof v === 'function');
  assert.deepEqual(fns.map(([k]) => k).sort(), ['classifyFile', 'differentiate', 'hashPlan', 'jobsFor', 'planRecords', 'plannedLibrary', 'tokensOf']);
  for (const [name, fn] of fns) for (const a of JUNK) for (const b of JUNK) assert.doesNotThrow(() => fn(a, b, a), name);
  for (const a of JUNK) {
    assert.equal(classifyFile('x.csv', 'a,b,Fraud\n1,2,yes\n3,4,no\n5,6,yes\n7,8,no\n9,1,no\n2,3,yes', a).kind, a === toxic ? 'unknown' : 'outcomes');   // hints that throw: refused, not thrown
    assert.equal(differentiate(a, SHIPPED).ok, false);
    assert.deepEqual(plannedLibrary(a), {});
    assert.deepEqual(planRecords(a), []);
  }
  assert.equal(differentiate({ business: toxic }, SHIPPED).why, 'the input could not be read');
  assert.equal(differentiate({ business: { type: 'other', pairs: toxic } }, SHIPPED).office.ok, false);
  const hostile = differentiate({ business: { type: 'other' }, files: [toxic, { name: 'f.csv', text: CSV.fraud, get target() { throw new Error('boom'); } }] }, SHIPPED);
  assert.deepEqual(hostile.files.map((f) => [f.name, f.kind, f.reason]), [['an unnamed file', 'unknown', 'The file could not be read.'], ['f.csv', 'unknown', 'The file could not be read.']]);
  assert.equal(differentiate({ business: { type: 'other' } }, toxic).why, 'the input could not be read');
  assert.equal(differentiate({ business: { type: 'other' } }, SHIPPED, { get seed() { throw new Error('boom'); } }).why, 'the input could not be read');
  assert.equal(classifyFile(toxic, CSV.churn).reason, 'The file could not be read.');
  assert.deepEqual(KINDS, ['outcomes', 'decisions', 'bank', 'crm', 'trial-balance', 'unknown']);
  assert.ok([P1, P2, P3, P4, P5, P6].every((p) => p.files.every((f) => KINDS.includes(f.kind))));
});
