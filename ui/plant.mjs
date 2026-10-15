// ui/plant.mjs — "Plant": the planter's console. Walk into a business (or remote in), understand what it does, plant the seed
// differentiated to its domain, prove it worked — and keep the proof for the next prospect.
//
// Seven steps, each explaining itself in plain words: (1) the kind of business and its headcount; (2) its files, read on this
// device and never uploaded, each classified with the reason and correctable; (3) Grow — the plan (src/plant.mjs differentiate):
// what grew from their own records, what stays shipped, what is left to people, the readable rules and the held-out numbers,
// and a decision log re-grown and checked against the old decisions; (4) Tune — which agents switch on and the second-brain
// confidence floor; (5) Bridge — the bank statement, the trial balance and the customer list read across (src/bridge.mjs), the
// reconciliation shown, the Sage journal and the CRM file to download; (6) Plant — the plan published into a company by the
// owner's or an admin's device and the planted brains loaded onto its agent devices (src/sow.mjs: a brain is adopted only if
// a key the role tree grants signed it AND it re-checks on that device's own records); (7) the signed planting receipt
// (src/receipt.mjs), printed for the client, with a redacted showcase copy for the next prospect.
// Pure renderers (renderPlant, demoFiles, bridgeOf) and one controller (createPlant) that talks to the page through the env it
// is given — so the renderers are tested in Node (test/console.test.mjs) and the controller with a fake page over real devices.
// Every file name, column and cell a client hands over is hostile input: escaped at the sink (src/explain.mjs esc).
import { classifyFile, differentiate, jobsFor } from '../src/plant.mjs';
import { parseBankCsv, bankToJournal, parseCrmCsv, parseTrialBalance, journalToCsv, crmToCsv, bridgeReceipt, SUSPENSE } from '../src/bridge.mjs';
import { buildPlantingReceipt, verifyPlantingReceipt, reproducePlantingReceipt, showcase, receiptHtml, afterFromSpine } from '../src/receipt.mjs';
import { publishPlan, loadPlanted, rowsFor, jobFor, plantedReports, judgePlanted, FLOORS } from '../src/sow.mjs';
import { ADOPTION, esc, ruleWords } from '../src/explain.mjs';
import { formFields } from '../src/adopt.mjs';
import { AGENTS, JOBS as JOB_WORDS, agentName } from '../src/company.mjs';
import { createNode, pull } from '../src/node.mjs';
import { grantFor, wiringView, signedAs } from '../src/shell.mjs';
import { toRecord } from '../src/brain.mjs';
import { gbp, CHART } from '../src/books.mjs';
import { parseCsv, inferColumns } from '../vendor/csv-forge/csv.mjs';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;   // a file larger than this is refused before it is read
const short = (h) => (h ? String(h).slice(0, 8) : '—');
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? 'not measured' : (x * 100).toFixed(1) + '%');
const auc3 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '—');
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pounds = (n) => '£' + num(Math.round(n));
const jobWord = (d) => (Object.hasOwn(JOB_WORDS, d) ? JOB_WORDS[d] : String(d));
const KIND_WORDS = Object.freeze({ outcomes: 'Cases with a yes/no outcome — a brain can grow from it', decisions: 'A log of past decisions — re-grown and checked against them',
  bank: 'A bank statement — a record for the books', crm: 'A customer list — a record for the CRM', 'trial-balance': 'A trial balance — the opening books', unknown: 'Not usable as it is' });
const SOURCE_WORDS = Object.freeze({ grown: 'Grown from your own records', shipped: 'The shipped brain — it must re-check on your own records before it acts', none: 'No brain yet — this work waits for a person' });

export const PLANT_CSS = [
  '.pl-steps{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}',
  '.pl-step{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}',
  '.pl-step.next{border-color:var(--accent2);box-shadow:0 0 0 1px var(--accent2) inset}',
  '.pl-step>h3{font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink);margin:0 0 6px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
  '.pl-step>h3 .n{font-family:var(--mono);color:var(--faint);font-size:12px}',
  '.pl-step>p.pl-say{margin:0 0 10px;color:var(--dim);font-size:14px;max-width:86ch}',
  '.pl-chip{font-size:11px;border:1px solid var(--line);border-radius:12px;padding:1px 8px;white-space:nowrap;font-weight:400}',
  '.pl-chip.done{color:var(--accent);border-color:var(--accent)}.pl-chip.todo{color:var(--warn);border-color:var(--warn)}.pl-chip.wait{color:var(--dim)}',
  '.pl-flow{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;margin:10px 0}',
  '.pl-flow>div{flex:1 1 150px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px;min-width:0}',
  '.pl-flow b{display:block;font-size:13.5px;color:var(--ink)}.pl-flow span{color:var(--dim)}',
  '.pl-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin:8px 0}',
  '.pl-grid label{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px;color:var(--dim)}.pl-grid input{width:90px}',
  '.pl-file{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;background:var(--panel2);min-width:0}',
  '.pl-file .nm{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}',
  '.pl-file .why{font-size:13px;color:var(--dim);margin:4px 0;overflow-wrap:anywhere}',
  '.pl-job{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;background:var(--panel2);min-width:0}',
  '.pl-job h4{margin:0 0 4px;font-size:14.5px}.pl-job p{margin:4px 0;font-size:13.5px;max-width:86ch;overflow-wrap:anywhere}',
  '.pl-job ul{margin:4px 0;padding-left:18px;font-size:13px}.pl-job li{overflow-wrap:anywhere}',
  '.pl-src{font-size:11px;border-radius:10px;padding:1px 7px;border:1px solid var(--line);display:inline-block;max-width:100%;font-weight:400}',
  '.pl-src.grown{color:var(--accent);border-color:var(--accent)}.pl-src.shipped{color:var(--accent2);border-color:var(--accent2)}.pl-src.none{color:var(--warn);border-color:var(--warn)}',
  '.pl-scroll{max-height:260px;overflow:auto}',
  '.pl-step .row>.dim{font-size:13px}.pl-fn{white-space:nowrap}',
  '.pl-sel{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}.pl-sel label{font-size:12.5px;color:var(--dim);display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  '.pl-sel select{max-width:220px}.pl-sel label.pl-radio{flex-wrap:nowrap;align-items:flex-start;font-size:13.5px;color:var(--ink)}.pl-radio input{margin-top:3px}',
  '.pl-pre{font-family:var(--mono);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:260px;overflow:auto}',
  '#plant-print{display:none}',
  '@media print{body.print-receipt>*:not(#plant-print){display:none!important}body.print-receipt #plant-print{display:block!important;background:#fff;color:#000;font-size:12px}',
  '  body.print-receipt #plant-print .panel{border:1px solid #999;background:#fff;break-inside:avoid;margin:0 0 10px}body.print-receipt #plant-print table{width:100%;border-collapse:collapse}',
  '  body.print-receipt #plant-print td,body.print-receipt #plant-print th{border:1px solid #999;padding:3px 5px;color:#000}}',
].join('\n');

// ── the demo business: the repository's real published samples, as the CSV exports a business would hand over ───────────
/** The column each real sample's outcome goes in — the names a business's own export would use (src/plant.mjs reads them). */
export const DEMO_TARGET = Object.freeze({ shopper: 'Purchased', churn: 'Churned', fraud: 'Fraud', credit: 'Defaulted', energy: 'PeakNextHour', intrusion: 'Attack', maintenance: 'MachineFailure' });
export const DEMO_SAMPLE = Object.freeze({ shopper: 'brains/shopper.sample.json', churn: 'brains/real/churn.sample.json', fraud: 'brains/real/fraud.sample.json',
  credit: 'brains/real/credit.sample.json', energy: 'brains/real/energy.sample.json', intrusion: 'brains/real/intrusion.sample.json', maintenance: 'brains/real/maintenance.sample.json' });
/** The demo business: an online retailer, headcount per department (adopt.mjs form fields). */
export const DEMO_BUSINESS = Object.freeze({ type: 'retail', pairs: Object.freeze({ service: '6', sales: '4', marketing: '2', finance: '2', people: '1', ops: '5', it: '1', leadership: '2' }), tbDate: '2026-08-31' });
const sampleCsv = (j, target) => [[...j.features, target].join(','), ...j.data.map((r) => r.slice(0, j.features.length).concat(r[j.features.length] ? 'yes' : 'no').join(','))].join('\n');
const money2 = (p) => (p / 100).toFixed(2);
/** The example bank statement: September's lines with running balances worked out here, in whole pence, from the opening balance. */
function bankText() {
  const lines = [['01/09/2026', 'CARD TAKINGS', 184560], ['01/09/2026', 'RENT SEPTEMBER UNIT 4', -225000], ['03/09/2026', 'SOFTWARE SUBSCRIPTION', -8900], ['05/09/2026', 'CARD TAKINGS', 231025],
    ['08/09/2026', 'ELECTRICITY DIRECT DEBIT', -31240], ['10/09/2026', 'SUPPLIER 0042', -312000], ['12/09/2026', 'CARD TAKINGS', 197510], ['15/09/2026', 'HMRC PAYE', -114032],
    ['19/09/2026', 'CARD TAKINGS', 264080], ['25/09/2026', 'SALARIES SEPTEMBER', -645000], ['28/09/2026', 'BANK CHARGES', -1850], ['30/09/2026', 'INTEREST', 214]];
  let bal = 1248000;
  return ['Date,Description,Paid out,Paid in,Balance', ...lines.map(([d, desc, p]) => { bal += p; return [d, desc, p < 0 ? money2(-p) : '', p > 0 ? money2(p) : '', money2(bal)].join(','); })].join('\n');
}
const TB_TEXT = ['Account Code,Account Name,Debit,Credit', '0030,Office equipment,6800.00,', '1001,Stock,18250.00,', '1100,Trade debtors,4120.00,', '1200,Bank current account,12480.00,',
  '2100,Trade creditors,,5310.00', '2200,VAT on sales,,2940.00', '3000,Share capital,,10000.00', '3200,Retained earnings,,23400.00', 'TOTAL,,41650.00,41650.00'].join('\n');
const CRM_TEXT = ['Company,Contact,Deal Stage,Owner,Value', 'Example customer 01,Buyer,qualified,Sales lead,4500', 'Example customer 02,Office manager,proposal sent,Sales lead,12800',
  'Example customer 03,Buyer,closed won,Sales lead,7250', 'Example customer 04,Operations lead,new,Sales lead,', 'Example customer 05,Buyer,closed lost,Sales lead,3100',
  'Example customer 06,Finance lead,negotiation,Sales lead,9900', 'Example customer 07,Buyer,on hold,Sales lead,2000'].join('\n');

/**
 * The demo business's files, from the published samples ({ [job]: sample json }): seven real files, a decision log (an example
 * old rule applied to the real credit sample, beside what really happened) and three example records made up for the demo —
 * a bank statement, a trial balance and a customer list (no real account, no real customer). → [{ name, text, hints, note }]
 */
export function demoFiles(samples) {
  try {
    const out = [];
    for (const d of Object.keys(DEMO_TARGET)) {
      const j = samples[d];
      out.push({ name: d === 'shopper' ? 'web-sessions.csv' : d + '.csv', text: sampleCsv(j, DEMO_TARGET[d]), hints: {}, note: 'Real published data: ' + String(j.source).slice(0, 200) });
    }
    const c = samples.credit, F = c.features, at = (n) => F.indexOf(n), L = F.length;
    const rule = (r) => (r[at('payStatusSep')] >= 2 || r[at('utilisationSep')] > 0.9 ? 'decline' : 'approve');
    out.push({ name: 'credit-decisions.csv', text: [[...F, 'oldRuleDecision', 'Outcome'].join(','), ...c.data.map((r) => [...r.slice(0, L), rule(r), r[L] ? 'defaulted' : 'repaid'].join(','))].join('\n'),
      hints: { positiveDecision: 'decline' }, note: 'An example old rule — decline when September’s payment is two or more months late or the card is over 90% used — applied to the real credit sample, beside what really happened.' });
    out.push({ name: 'example-bank-statement.csv', text: bankText(), hints: {}, note: 'Made up for this demo: September’s lines of an example account — not a real account.' });
    out.push({ name: 'example-trial-balance.csv', text: TB_TEXT, hints: {}, note: 'Made up for this demo: the opening books at 31 August.' });
    out.push({ name: 'example-customers.csv', text: CRM_TEXT, hints: {}, note: 'Made up for this demo: example customers, no real names.' });
    return out;
  } catch { return []; }
}

/** The values a column takes in a file (for the "which decision means yes" choice) — [] if it is not a column of few values. */
export function levelsOf(text, column) {
  try {
    const { header, rows } = parseCsv(text);
    const c = inferColumns(header, rows).find((x) => x.name === column);
    return c && c.kind === 'categorical' ? c.levels.slice(0, 20) : [];
  } catch { return []; }
}

// ── the bridges: one record file read across ──────────────────────────────────────────────────────────────────────────
/**
 * One record file through its bridge. kind: 'bank' | 'trial-balance' | 'crm'; opts = { date } (the day a trial balance's balances
 * are at). → { kind, ok, why, read (the parse), out (the journal, for a statement), sage: { ok, why, text, rows }, xero: why,
 * crm: { ok, text, rows } | null, receipt (bridge.mjs bridgeReceipt) }. Never throws.
 */
export function bridgeOf(kind, text, opts) {
  const none = (why) => ({ kind, ok: false, why, read: null, out: null, sage: null, xero: '', crm: null, receipt: null });
  try {
    const xero = journalToCsv([], 'xero').why;
    if (kind === 'bank') {
      const read = parseBankCsv(text);
      if (!read.ok) return { ...none(read.why), read };
      const out = bankToJournal(read.rows);
      const sage = out.ok ? journalToCsv(out.entries, 'sage') : null;
      return { kind, ok: out.ok, why: out.why, read, out, sage, xero, crm: null, receipt: bridgeReceipt({ kind, inputText: text, result: out }) };
    }
    if (kind === 'trial-balance') {
      const read = parseTrialBalance(text, { date: opts && opts.date });
      const sage = read.ok ? journalToCsv([{ id: 'OPENING', ...read.entry }], 'sage') : null;
      return { kind, ok: read.ok, why: read.why, read, out: null, sage, xero, crm: null, receipt: read.ok ? bridgeReceipt({ kind, inputText: text, result: read }) : null };
    }
    if (kind === 'crm') {
      const read = parseCrmCsv(text);
      return { kind, ok: read.ok, why: read.why, read, out: null, sage: null, xero: '', crm: read.ok ? crmToCsv(read.records) : null, receipt: read.ok ? bridgeReceipt({ kind, inputText: text, result: read }) : null };
    }
    return none('this file is not a bank statement, a trial balance or a customer list');
  } catch { return none('this file could not be read across'); }
}

// ── the renderers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const chip = (s, w) => '<span class="pl-chip ' + s + '">' + esc(w) + '</span>';
function stepHtml(n, id, title, status, say, body, next) {
  const words = { done: 'done', todo: 'to do', wait: 'waiting on the step before' };
  return '<li class="pl-step' + (next ? ' next' : '') + '" id="' + id + '"><h3><span class="n">' + n + '</span>' + esc(title) + ' ' + chip(status, words[status]) + '</h3><p class="pl-say">' + say + '</p>' + body + '</li>';
}
const table = (head, rows) => '<div class="tablewrap"><table><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>' + rows.join('') + '</table></div>';
const tr = (cells) => '<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';

function introHtml() {
  return '<h2 class="sec-h">Plant — the planter’s console</h2>' +
    '<p class="sec-sub">One seed, grown into each business’s own company. Walk into an office (or remote in), learn what the business does, and plant the company differentiated to it: ' +
    'its own records grow its own brains, its old decisions are re-grown and checked, its bank, books and customers are read across, and the agents switch on. ' +
    'Their tech person wires the devices; you remote in and tend; a signed receipt proves it worked — and its redacted copy shows the next prospect. Everything here runs in this browser: no file is uploaded.</p>' +
    '<div class="pl-flow" role="list" aria-label="How a planting works">' +
    [['1 · The business', 'what it is, and how many people'], ['2 · Its files', 'read here, each named with the reason'], ['3 · Grow', 'its own brains, its old decisions re-checked'],
      ['4 · Tune', 'which agents switch on, how sure they must be'], ['5 · Bridge', 'bank, books and customers read across'], ['6 · Plant', 'signed into the company; each agent device re-checks before it acts'],
      ['7 · Receipt', 'signed proof, and a copy for the next prospect']].map(([b, s]) => '<div role="listitem"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>').join('') + '</div>' +
    '<div class="row"><button class="primary" data-act="plant-all">Plant the demo business, start to finish</button><span class="dim">One click: an example online retailer, its real published records, every step below run in order. Then do it with your own files.</span></div>';
}

function businessHtml(s) {
  const office = s.office;
  const opts = ADOPTION.map((b) => '<option value="' + esc(b.id) + '"' + (s.type === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
    '<option value="other"' + (s.type === 'other' ? ' selected' : '') + '>Something else — every job considered</option>';
  const b = ADOPTION.find((x) => x.id === s.type);
  const fields = office ? formFields(office) : [];
  return '<div class="row"><label class="dim" for="plant-type">Kind of business</label><select id="plant-type" data-plant="type"><option value="">Choose…</option>' + opts + '</select></div>' +
    (b ? '<p class="note">' + esc(b.intro) + ' The jobs it uses: ' + esc(jobsFor(b.id).map(jobWord).join(', ')) + '.</p>' : s.type === 'other' ? '<p class="note">Every one of the eight jobs is considered; the files decide which grow.</p>' : '') +
    (fields.length ? '<p class="note" style="margin-top:10px">People per department today — leave a box empty to use the model office’s number (shown faint). The five-year comparison runs on these.</p><div class="pl-grid">' +
      fields.map((f) => '<label>' + esc(f.label) + '<input inputmode="numeric" data-plant-pair="' + esc(f.id) + '" value="' + esc(s.pairs[f.id] || '') + '" placeholder="' + esc(f.value) + '" aria-label="' + esc(f.label) + ' — people"></label>').join('') + '</div>'
      : '<p class="dim">Loading the model office…</p>');
}

function fileHtml(f) {
  const c = f.cls || { kind: 'unknown', reason: '', columns: [], rows: 0 };
  const cols = (c.columns || []).map((x) => x.name);
  const sel = (hint, label, values, cur, auto) => '<label>' + esc(label) + '<select data-plant-hint="' + esc(hint) + '" data-file="' + f.id + '"><option value="">' + esc(auto) + '</option>' +
    values.map((v) => '<option value="' + esc(v[0]) + '"' + (cur === v[0] ? ' selected' : '') + '>' + esc(v[1]) + '</option>').join('') + '</select></label>';
  const jobs = Object.keys(JOB_WORDS).map((d) => [d, JOB_WORDS[d]]);
  const two = (c.columns || []).filter((x) => x.distinct === 2).map((x) => [x.name, x.name]);
  const learnable = c.kind === 'outcomes' || c.kind === 'decisions' || (c.kind === 'unknown' && cols.length > 1);
  const pick = learnable ? '<div class="pl-sel">' + sel('domain', 'The job it teaches', jobs, f.hints.domain || '', 'Work it out') +
    (c.kind === 'decisions' ? sel('decision', 'The decision column', cols.map((x) => [x, x]), f.hints.decision || '', 'Work it out') + sel('outcome', 'What really happened', two, f.hints.outcome || '', 'Work it out') +
      sel('positiveDecision', 'The decision that means “yes”', (f.levels || []).map((v) => [v, v]), f.hints.positiveDecision || '', 'Not said')
      : sel('target', 'The column to learn', two, f.hints.target || '', 'Work it out')) + '</div>' : '';
  return '<div class="pl-file"><div class="row" style="margin:0"><span class="nm grow">' + esc(f.name) + '</span><span class="dim">' + num(c.rows | 0) + ' rows</span><button class="sm" data-act="plant-remove" data-file="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></div>' +
    '<div><b>' + esc(KIND_WORDS[c.kind] || KIND_WORDS.unknown) + '</b>' + (c.domain ? ' — the ' + esc(jobWord(c.domain).toLowerCase()) + ' job (' + Math.round((c.confidence || 0) * 100) + '% sure)' : '') + '</div>' +
    '<div class="why">' + esc(c.reason) + '</div>' + (f.note ? '<div class="why"><i>' + esc(f.note) + '</i></div>' : '') + pick + '</div>';
}

function filesHtml(s) {
  return '<div class="row"><label class="sm" for="plant-files" style="font-size:13px">Add their files (CSV)</label><input type="file" id="plant-files" multiple accept=".csv,text/csv" data-plant="files" aria-label="Add the business’s CSV files">' +
    '<button data-act="plant-demo">Use the demo business’s files</button>' + (s.files.length ? '<button class="sm" data-act="plant-clear">Remove them all</button>' : '') + '</div>' +
    (s.files.length ? s.files.map(fileHtml).join('') : '<p class="dim">No files yet. Export what the business already keeps — past cases with how they turned out, a log of its own decisions, a bank statement, a trial balance, a customer list — as CSV.</p>');
}

function legacyHtml(g) {
  const rows = g.mismatches.map((m) => tr([num(m.row), esc(m.legacy), esc(m.regrown), m.outcome === undefined ? '—' : esc(m.outcome)]));
  return '<div class="pl-job" style="background:var(--panel)"><b>Their old decisions — ' + esc(g.file) + '</b>' +
    '<p>' + esc(g.why) + '</p><ul><li>Agreement with the old rule on ' + num(g.n) + ' held-out decisions it never grew on: <b>' + num(g.same) + ' (' + pct(g.equivalence) + ')</b></li>' +
    '<li>How often the old decisions were right: <b>' + (g.pastAccuracy === null ? 'not measured' : pct(g.pastAccuracy) + ' of ' + num(g.pastN)) + '</b></li></ul>' +
    (rows.length ? '<details><summary>Every mismatch (' + num(rows.length) + ')</summary><div class="pl-scroll">' + table(['Row', 'Old decision', 'Re-grown', 'What happened'], rows) + '</div></details>' : '<p class="ok">No mismatches.</p>') + '</div>';
}

function jobHtml(j) {
  const p = j.pattern;
  const rules = p ? '<details><summary>Its ' + p.rules.length + ' readable rules</summary><ul>' + p.rules.map((r) => '<li class="mono">' + esc(ruleWords(r)) + '</li>').join('') +
    '</ul><p class="note">It acts when the score is above ' + esc(String(p.threshold)) + '. A brain is these rules and nothing else — anyone can read why it decided.</p></details>' : '';
  const reads = j.features.length && j.source === 'grown' ? '<details><summary>What it reads (' + j.features.length + ' of your columns)</summary><ul>' + j.features.map((f) => '<li><span class="mono">' + esc(f.name) + '</span>' + (f.from !== f.name ? ' ← ' + esc(f.from) : '') + '</li>').join('') + '</ul></details>' : '';
  const held = p ? '<li>Held-out score: AUC <b>' + auc3(j.heldAuc) + '</b>' + (Number.isSafeInteger(p.held) ? ' on ' + num(p.held) + ' cases it never grew on' : '') + ' — 0.5 is a coin toss, 1.0 is perfect; it must reach the gate to act.</li>' : '';
  return '<div class="pl-job"><h4>' + esc(jobWord(j.domain)) + ' <span class="pl-src ' + esc(j.source) + '">' + esc(SOURCE_WORDS[j.source] || j.source) + '</span></h4>' +
    '<p class="dim">' + esc(agentName(j.agent)) + (j.needed ? '' : ' · not a usual job for this kind of business') + '</p><p>' + esc(j.why) + '</p>' +
    (j.source === 'grown' ? '<ul><li>From <span class="mono">' + esc(j.file) + '</span>: ' + num(j.rows || 0) + ' rows, learning <b>' + esc(j.target) + '</b> (“' + esc(j.positive) + '” is the case to catch)</li>' + held + '</ul>' : held ? '<ul>' + held + '</ul>' : '') +
    reads + rules + j.legacy.map(legacyHtml).join('') + '</div>';
}

function planHtml(s) {
  const P = s.plan;
  if (!P) return '';
  if (!P.ok) return '<p class="bad">The plan could not be made: ' + esc(P.why) + '.</p>';
  const o = P.office;
  return (s.stale ? '<p class="warn">The business or its files changed since this plan was grown — grow it again before you plant.</p>' : '') +
    '<p><b>' + esc(P.business.name) + '</b> · ' + P.suite.agents.length + ' agents switch on · ' + P.jobs.filter((j) => j.source === 'grown' && j.verified).length + ' brains grown from their own records · ' +
    P.gaps.length + ' gaps, each in words below · plan <span class="mono">' + esc(P.planHash.slice(0, 16)) + '</span></p>' +
    '<h4>What became of each file</h4>' + table(['File', 'What it is', 'Used'], P.files.map((f) => tr(['<span class="mono pl-fn">' + esc(f.name) + '</span>', esc(KIND_WORDS[f.kind] || f.kind) + (f.domain ? ' — ' + esc(jobWord(f.domain)) : ''), esc(f.why || (f.used ? 'yes' : 'no'))]))) +
    '<h4>Each job</h4>' + P.jobs.map(jobHtml).join('') +
    '<h4>The agents</h4>' + table(['Agent', 'Switches on?', 'What it takes over'], [...P.suite.agents.map((a) => tr([esc(a.name), '<span class="ok">on</span> — ' + esc(a.jobs.map(jobWord).join(', ')), esc(a.takesOver)])),
      ...P.suite.off.map((a) => tr([esc(a.name), '<span class="warn">off</span>', esc(a.why)]))]) +
    '<h4>What the people keep</h4><ul class="b-list">' + P.suite.humans.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
    (o && o.ok ? '<h4>Five years on their headcount</h4><p>Their office today: <b>' + num(o.headcountToday) + ' people, ' + pounds(o.todayTotal) + '</b> over ' + o.years + ' years. AI-native: <b>' + num(o.headcountAiNative) + ' people, ' + pounds(o.aiNativeTotal) +
      '</b> — ' + pounds(o.saving) + ' less before the one-off move (' + (o.savingPermille / 10).toFixed(1) + '%). The receipt adds the move and the payback.</p>' : '<p class="dim">The office comparison was not made: ' + esc(o ? o.why : 'no headcount') + '.</p>') +
    '<h4>The gaps, in plain words</h4>' + (P.gaps.length ? '<ul class="b-list">' + P.gaps.map((g) => '<li>' + esc(g) + '</li>').join('') + '</ul>' : '<p class="ok">None.</p>');
}

function tuneHtml(s) {
  const P = s.plan;
  if (!P || !P.ok) return '<p class="dim">Grow the plan first.</p>';
  const on = new Set(s.agents);
  const rows = AGENTS.map((a) => {
    const off = P.suite.off.find((x) => x.id === a.id);
    return '<label class="dim" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-plant-agent="' + a.id + '"' + (on.has(a.id) ? ' checked' : '') + (off ? ' disabled' : '') + '> <span><b style="color:var(--ink)">' + esc(a.name) + '</b> — ' +
      esc(off ? 'stays off: ' + off.why : (P.suite.agents.find((x) => x.id === a.id) || {}).takesOver || a.job) + '</span></label>';
  }).join('');
  return rows + '<p class="note">An agent you switch off here is paused in the company until a person switches it on (Wire it → Devices → Clear) — the roll-out’s weeks, one department at a time.</p>' +
    '<div class="row" style="margin-top:8px"><label class="dim" for="plant-floor">Ask a second brain when an agent is less sure than</label><select id="plant-floor" data-plant="floor">' +
    FLOORS.map((v) => '<option value="' + v + '"' + (s.floor === v ? ' selected' : '') + '>' + (v / 1000).toFixed(2) + '</option>').join('') + '</select></div>' +
    '<p class="note">Money and security calls always need a second, independent brain. This floor is for every other call: below it, the agent asks another device’s brain to agree, or the work waits for a person. Higher means more checking and more on the Watch list. It is the company’s own policy record — every agent reads it.</p>' +
    '<p class="note">Free text — what a customer wrote — needs a language model. Put one on the AI box in <a href="#wire" data-view="wire">Wire it</a> (a local model, nothing sent out), or connect one on the live company’s Board.</p>';
}

function bankHtml(b) {
  const r = b.read, o = b.out;
  if (!o) return '<p class="bad">' + esc(b.why) + '</p>';
  const bal = o.reconciliation.balances;
  const balWords = bal === null ? 'The statement carries no running balance, so it was not checked line by line.' : bal.ok === false && bal.why ? esc(bal.why) + '.'
    : bal.ok ? 'Every running balance checks: ' + esc(gbp(bal.opening)) + ' → ' + esc(gbp(bal.closing)) + ' (' + esc(bal.order) + '), a movement of ' + esc(gbp(bal.movement)) + ' — to the penny.'
      : bal.mismatches.length + ' running balances do not follow from the line before: ' + bal.mismatches.slice(0, 5).map((m) => 'line ' + esc(m.line) + ' says ' + esc(gbp(m.found)) + ', expected ' + esc(gbp(m.expected))).join('; ') + '.';
  return '<p>' + num(r.rows.length) + ' lines read (' + esc(r.format) + '); ' + num(r.rejected.length) + ' refused. Money in ' + esc(gbp(o.totals.moneyIn)) + ', out ' + esc(gbp(o.totals.moneyOut)) + ', net ' + esc(gbp(o.totals.net)) + '.</p>' +
    '<p class="' + (bal && bal.ok ? 'ok' : 'warn') + '">' + balWords + '</p>' +
    (o.suspense.length ? '<p>' + num(o.suspense.length) + ' lines no rule recognises wait in the suspense account (' + SUSPENSE + ') for a person to classify:</p><div class="pl-scroll">' +
      table(['Date', 'Description', 'Amount'], o.suspense.map((x) => tr([esc(x.date), esc(x.desc), esc(gbp(x.pence))]))) + '</div>' : '<p class="ok">Every line matched a rule.</p>') +
    (r.rejected.length ? table(['Line', 'Why refused', 'It begins'], r.rejected.map((x) => tr([num(x.line), esc(x.why), '<span class="mono">' + esc(x.text) + '</span>']))) : '') +
    '<div class="row"><button class="sm" data-act="plant-dl" data-what="sage-bank">Download the Sage journal (' + num(b.sage ? b.sage.totals.entries : 0) + ' entries)</button><span class="dim">Xero: ' + esc(b.xero) + '.</span></div>';
}
function tbHtml(b) {
  const r = b.read;
  if (!r || !r.ok) {
    return '<p class="bad">' + esc(b.why) + '.</p>' + (r && r.rejected.length ? table(['Line', 'Why refused', 'It begins'], r.rejected.map((x) => tr([num(x.line), esc(x.why), '<span class="mono">' + esc(x.text) + '</span>']))) : '');
  }
  return '<p class="ok">It balances: debits ' + esc(gbp(r.totals.debit)) + ' = credits ' + esc(gbp(r.totals.credit)) + ', ' + num(r.totals.accounts) + ' accounts → one opening entry dated ' + esc(r.entry.date) + '.</p>' +
    table(['Code', 'Account', 'Debit', 'Credit'], r.entry.lines.map(([c, d, k]) => tr(['<span class="mono">' + esc(c) + '</span>', esc(Object.hasOwn(CHART, c) ? CHART[c][0] : c), d ? esc(gbp(d)) : '', k ? esc(gbp(k)) : '']))) +
    '<div class="row"><button class="sm" data-act="plant-dl" data-what="sage-tb">Download the opening entry as a Sage journal</button></div>';
}
function crmHtml(b) {
  const r = b.read;
  if (!r.ok) return '<p class="bad">' + esc(b.why) + '.</p>';
  const by = {};
  for (const x of r.records) by[x.stage] = (by[x.stage] || 0) + 1;
  return '<p>' + num(r.records.length) + ' customers read, worth ' + esc(gbp(r.totals.value)) + ' in the pipeline: ' + esc(Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ')) + '. ' + num(r.rejected.length) + ' refused.</p>' +
    (r.rejected.length ? table(['Line', 'Why refused', 'It begins'], r.rejected.map((x) => tr([num(x.line), esc(x.why), '<span class="mono">' + esc(x.text) + '</span>']))) : '') +
    '<div class="row"><button class="sm" data-act="plant-dl" data-what="crm">Download the customer list for the CRM</button></div>';
}

function bridgeHtml(s) {
  const recs = s.files.filter((f) => f.cls && ['bank', 'crm', 'trial-balance'].includes(f.cls.kind));
  if (!recs.length) return '<p class="dim">No bank statement, trial balance or customer list among the files — nothing to read across. Add them in step 2 if the business has them.</p>';
  const tb = recs.some((f) => f.cls.kind === 'trial-balance');
  return (tb ? '<div class="row"><label class="dim" for="plant-tbdate">The day the trial balance’s balances are at</label><input id="plant-tbdate" type="date" data-plant="tbdate" value="' + esc(s.tbDate) + '"></div>' : '') +
    '<div class="row"><button class="primary" data-act="plant-bridge">Read them across</button><span class="dim">Read and checked line by line here; money in whole pence from the first digit to the last.</span></div>' +
    recs.map((f) => {
      const b = s.bridges[f.id];
      const body = !b ? '<p class="dim">Not read yet.</p>' : f.cls.kind === 'bank' ? bankHtml(b) : f.cls.kind === 'trial-balance' ? tbHtml(b) : crmHtml(b);
      return '<div class="pl-job"><h4><span class="mono">' + esc(f.name) + '</span> — ' + esc(KIND_WORDS[f.cls.kind]) + '</h4>' + body +
        (b && b.receipt && b.receipt.ok ? '<p class="note">Fingerprint: the file <span class="mono">' + esc(b.receipt.inputHash.slice(0, 16)) + '…</span> → what came out <span class="mono">' + esc(b.receipt.outputHash.slice(0, 16)) + '…</span> — it goes on the receipt.</p>' : '') + '</div>';
    }).join('') +
    '<p class="note">Nothing is posted into the company’s books from here: the Finance agent’s device sequences every posting into the vault, and the journal goes to the accountant’s own Sage as it is. An accountant on Xero takes the files the other way: Xero refuses manual journals to bank, receivable and payable accounts (<a href="https://developer.xero.com/documentation/api/accounting/manualjournals" target="_blank" rel="noopener">Xero’s developer documentation</a>), so the bank statement goes into Xero as the statement file itself, through Xero’s own bank import, and the trial balance through Xero’s conversion balances.</p>';
}

function devicesHtml(s) {
  const d = s.planted;
  if (!d) return '';
  const pub = d.publish;
  let html = '<p class="' + (pub.ok ? 'ok' : 'bad') + '">' + (pub.ok ? 'Planted: ' + num(pub.wrote) + ' records signed into the company by ' + esc(d.byWords) + '.' : 'Not planted: ' + esc(pub.why) + '.') + '</p>' +
    (pub.refused.length ? '<ul class="b-list">' + pub.refused.map((x) => '<li>' + esc(x.id) + ': ' + esc(x.reason) + '</li>').join('') + '</ul>' : '');
  if (d.target === 'practice') {
    html += '<h4>On each agent device</h4>' + table(['Agent device', 'Job', 'What it did with the planted brain'], d.devices.flatMap((x) => {
      const a = AGENTS.find((y) => y.id === x.agent);
      return a.domains.map((dom) => {
        const r = x.judged.results.filter((y) => y.domain === dom);
        const kept = x.judged.kept[dom];
        const what = r.length ? r.map((y) => (y.adopted ? '<span class="ok">Adopted</span>' : '<span class="warn">Refused</span>') + ' — ' + esc(y.reason.replace(/^(Adopted|Refused): /, '')) +
          (y.n ? ' <span class="dim">(' + num(y.n) + ' of its own records)</span>' : '')).join('<br>') + (kept === 'shipped' ? '<br><span class="dim">It keeps the shipped brain, which does better on its own records.</span>' : kept === 'none' ? '<br><span class="dim">No brain holds up here: this work waits for a person.</span>' : '')
          : '<span class="dim">Nothing planted for this job — ' + esc(s.plan && s.plan.jobs.find((j) => j.domain === dom) ? SOURCE_WORDS[s.plan.jobs.find((j) => j.domain === dom).source].toLowerCase() : 'not part of this plan') + '.</span>';
        return tr(['<b>' + esc(a.name) + '</b><br><span class="mono">' + esc(short(x.pub)) + '</span>', esc(jobWord(dom)), what]);
      });
    })) +
      '<p class="note">Each agent device is its own key in this practice company, granted by its owner (you), syncing exactly as devices do. A device reads a planted brain only if the role tree grants its signer to plant that job — the owner, an admin, or the agent that runs it — and adopts it only if it re-checks on the device’s own records and does at least as well as the brain it holds. Try to slip one past it:</p>' +
      '<div class="row"><button class="sm danger" data-act="plant-attack" data-kind="forged">Another agent signs a brain in the job owner’s name</button><button class="sm danger" data-act="plant-attack" data-kind="tampered">Your own key signs a tampered brain</button></div>' +
      (d.attack ? '<p class="flash" role="status">' + esc(d.attack) + '</p>' : '');
  } else {
    const rep = d.reports || [];
    html += '<h4>What the agent devices reported</h4>' + (rep.length ? table(['Agent', 'Job', 'Verdict', 'Re-checked on'], rep.map((r) => tr([esc(agentName(r.agent)), esc(jobWord(r.domain)), (r.adopted ? '<span class="ok">Adopted</span> — ' : '<span class="warn">Refused</span> — ') + esc(r.reason.replace(/^(Adopted|Refused): /, '')),
      r.n ? num(r.n) + ' of its own records (AUC ' + (r.localAuc / 1000).toFixed(3) + ')' : '—'])))
      : '<p class="dim">No agent device has reported yet. On the AI box, each agent device loads its planted brains when it starts (Wire it → An AI agent → Start the agent) and reports back here. Give each the business’s file for its job in its Wire it panel, so it re-checks on its own copy.</p>') +
      '<div class="row"><button class="sm" data-act="plant-refresh">Check for reports</button><a href="#wire" data-view="wire">Wire it — the tech person’s checklist</a></div>';
  }
  return html;
}

function plantStepHtml(s) {
  const P = s.plan;
  if (!P || !P.ok) return '<p class="dim">Grow the plan first.</p>';
  const c = s.company;
  const company = !c.has ? 'This device is in no company yet. Found one in <a href="#run" data-view="run">Run your own</a> — or, to plant a client’s company remotely, open their invite link on this device, connect to their machine (Run your own → Connect another machine), and have their owner grant this device as an admin (Wire it → Devices).'
    : c.admin ? 'This device is ' + (c.owner ? 'the owner' : 'an admin') + ' of company <span class="mono">' + esc(short(c.genesis)) + '</span> — it can plant there.'
      : 'This device is in company <span class="mono">' + esc(short(c.genesis)) + '</span> but is not its owner or an admin — ask the owner to grant this device as an admin (Wire it → Devices), then plant.';
  return '<div class="pl-sel"><label class="pl-radio"><input type="radio" name="plant-target" data-plant="target" value="practice"' + (s.target === 'practice' ? ' checked' : '') + '> A practice company in this tab — you as its owner, one device per agent, gone when you close the tab</label></div>' +
    '<div class="pl-sel"><label class="pl-radio"><input type="radio" name="plant-target" data-plant="target" value="company"' + (s.target === 'company' ? ' checked' : '') + (c.admin ? '' : ' disabled') + '> This device’s company</label></div>' +
    '<p class="note">' + company + '</p>' +
    '<div class="row"><button class="primary" data-act="plant-plant"' + (s.stale || (s.target === 'company' && !c.admin) ? ' disabled' : '') + '>Plant it</button><span class="dim">Signs the plan, the brains grown from their records, how to read each file, the confidence floor and the pauses into the company — every record through this device’s own gate.</span></div>' +
    devicesHtml(s);
}

function receiptStepHtml(s) {
  const r = s.receipt;
  if (!s.planted || !s.planted.publish.ok) return '<p class="dim">Plant first — the receipt is signed by the device that planted.</p>' + checkHtml(s);
  const body = !r ? '' : !r.ok ? '<p class="bad">Not made: ' + esc(r.why) + '.</p>'
    : '<p class="' + (s.check && s.check.ok ? 'ok' : 'bad') + '">' + esc(s.check ? s.check.words : '') + '</p>' +
      '<p>Receipt <span class="mono">' + esc(r.hash) + '</span>, signed by <span class="mono">' + esc(short(r.pub)) + '</span>.</p>' +
      '<div class="row"><button class="primary" data-act="plant-print">Print it for the client</button><button data-act="plant-dl" data-what="receipt">Download the signed receipt</button>' +
      '<button data-act="plant-dl" data-what="showcase">Download the showcase copy for the next prospect</button></div>' +
      '<details><summary>What the showcase copy shows (and leaves out)</summary><p class="note">The kind of business, its size band, each job’s before and after, the office saving as a share, the month, and the hashes — no file names, no headcount, no money amounts, no bridge totals. Whoever holds the full receipt can prove it against the hash.</p><div class="pl-pre">' + esc(JSON.stringify(showcase(r), null, 1)) + '</div></details>' +
      '<details><summary>Read the receipt here</summary>' + receiptHtml(r) + '</details>';
  return '<div class="row"><button class="primary" data-act="plant-receipt">Build and sign the receipt</button><span class="dim">Before and after on each job, measured on the rows its brain never grew on; the five-year cost on their headcount; the records read across.</span></div>' + body +
    '<p class="note">Then hand the tech person <a href="#wire" data-view="wire">Wire it</a>: the owner’s laptop, each person’s device, the office hub and one device per agent — each step checked against the company itself.</p>' + checkHtml(s);
}
function checkHtml(s) {
  return '<details class="pl-check"' + (s.checkOut ? ' open' : '') + '><summary>Check any planting receipt</summary><textarea id="plant-check-in" rows="3" spellcheck="false" class="mono" aria-label="A planting receipt (JSON)"></textarea>' +
    '<div class="row" style="margin-top:6px"><button class="sm" data-act="plant-check">Check it</button></div>' + (s.checkOut ? '<p class="note" role="status">' + esc(s.checkOut) + '</p>' : '') + '</details>';
}

/** The whole Plant view from a snapshot (createPlant().state()). Never throws. */
export function renderPlant(s) {
  try { return plantHtml(s || {}); } catch { return '<p class="bad">This view could not be drawn. Reload the page.</p>'; }
}
function plantHtml(x) {
  const s = { type: '', pairs: {}, files: [], plan: null, stale: false, agents: [], floor: 50, tbDate: '', bridges: {}, target: 'practice', company: { has: false }, planted: null, receipt: null, check: null, ...x };
  const recs = s.files.filter((f) => f.cls && ['bank', 'crm', 'trial-balance'].includes(f.cls.kind));
  const grown = !!(s.plan && s.plan.ok && !s.stale);
  const status = [s.type ? 'done' : 'todo', s.files.length ? 'done' : 'todo', grown ? 'done' : s.type && s.files.length ? 'todo' : 'wait', grown ? 'done' : 'wait',
    !grown ? 'wait' : !recs.length || recs.every((f) => s.bridges[f.id]) ? 'done' : 'todo', s.planted && s.planted.publish.ok ? 'done' : grown ? 'todo' : 'wait',
    s.receipt && s.receipt.ok && s.check && s.check.ok ? 'done' : s.planted && s.planted.publish.ok ? 'todo' : 'wait'];
  const next = status.findIndex((t) => t !== 'done');
  const step = (i, id, title, say, body) => stepHtml(i + 1, id, title, status[i], say, body, i === next);
  return introHtml() + (s.say ? '<p class="flash" role="status">' + esc(s.say) + '</p>' : '') + (s.busy ? '<p class="flash" role="status">' + esc(s.busy) + '</p>' : '') +
    '<ol class="pl-steps">' +
    step(0, 'pl-1', 'What kind of business, and how many people', 'Name the kind of business: it decides which of the company’s eight jobs it usually needs and what each agent takes over. The headcount runs the white paper’s own five-year model on their numbers.', businessHtml(s)) +
    step(1, 'pl-2', 'Their files', 'Hand over what the business already keeps, as CSV. Each file is read on this device — nothing is uploaded — and named with the reason: cases to learn from, a log of its own decisions, or records for the books and the CRM. If it reads a file wrong, say what it is.', filesHtml(s)) +
    step(2, 'pl-3', 'Grow', 'The seed reads the business and grows its organs: a brain from each of its own files, graded on rows it never grew on; the shipped brain where there is no file (it must still re-check on their records); a person where neither holds. A decision log is re-grown and checked against the old decisions.',
      '<div class="row"><button class="primary" data-act="plant-grow"' + (s.type && s.files.length ? '' : ' disabled') + '>Grow the plan</button><span class="dim">Takes a few seconds; it all runs here.</span></div>' + planHtml(s)) +
    step(3, 'pl-4', 'Tune', 'Decide which agents switch on now and how sure an agent must be before it acts without a second brain.', tuneHtml(s)) +
    step(4, 'pl-5', 'Bridge their systems', 'Nothing gets ripped out. The bank statement, the trial balance and the customer list are read across and checked; the books go back out in the accountant’s own import layout.', grown ? bridgeHtml(s) : '<p class="dim">Grow the plan first.</p>') +
    step(5, 'pl-6', 'Plant', 'Sign the plan into a company, then load the planted brains onto its agent devices. A device takes a brain only from a key the company grants to plant it, and only if it holds up on that device’s own records.', plantStepHtml(s)) +
    step(6, 'pl-7', 'The receipt', 'Signed proof the business got better: each job before and after on its own records, the five-year cost on its own headcount, the records brought across. The redacted copy is the next prospect’s evidence.', receiptStepHtml(s)) +
    '</ol><p class="foot">The brains are Konomi SLM pattern libraries — route, gate, then a verified answer or none (the Konomi architecture is Thomas Frumkin’s). Re-growing a business’s old decisions is discombobulator’s relearn kernel. Checking old decisions against what really happened, not only against the old rule, draws on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2.</p>';
}

// ── the controller ────────────────────────────────────────────────────────────────────────────────────────────────────
const isoDay = (ms) => { try { return new Date(ms).toISOString().slice(0, 10); } catch { return '1970-01-01'; } };
const HINTS = ['domain', 'target', 'decision', 'outcome', 'positiveDecision'];

/**
 * The Plant controller. env = { node() → this tab's device or null, keys() → its keys, fetchJson(url), keygen() → Promise<keys>,
 * now() → ms, download(name, text, type), print(html), render(), setWirePlan(agents), pause() → Promise (a moment for the page
 * to paint) }. → { state(), act(name, el, read), addFiles([{ name, text, size }]), ready() }
 */
export function createPlant(env) {
  const E = env || {};
  const now = () => { try { return Number(E.now()) || Date.now(); } catch { return Date.now(); } };
  const paint = () => { try { E.render(); } catch { /* not drawn */ } };
  const pause = async () => { try { await E.pause(); } catch { /* no page to paint */ } };
  const ui = { type: '', pairs: {}, files: [], next: 1, version: 0, plan: null, planVersion: -1, input: null, agents: [], floor: 50, tbDate: '', bridges: {}, target: 'practice',
    practice: null, planted: null, receipt: null, receiptInput: null, check: null, checkOut: '', say: '', busy: '', data: null, loading: null };
  const changed = () => { ui.version++; ui.receipt = null; ui.check = null; };

  /** The shipped brains, the model office and its sourced figures — fetched once. */
  function load() {
    if (!ui.loading) {
      ui.loading = (async () => {
        const index = await E.fetchJson('brains/index.json');
        const patterns = {};
        for (const [d, m] of Object.entries(index)) patterns[d] = await E.fetchJson('brains/' + m.file);
        const [office, basis] = [await E.fetchJson('data/office.json'), await E.fetchJson('data/basis.json')];
        ui.data = { index, patterns, office, basis };
        paint();
        return ui.data;
      })();
      ui.loading.catch(() => { ui.loading = null; });
    }
    return ui.loading;
  }

  function company() {
    let n = null;
    try { n = E.node() || null; } catch { n = null; }
    if (!n) return { has: false, admin: false, owner: false, genesis: '' };
    let admin = false;
    try { admin = n.canWrite(null) === true; } catch { admin = false; }
    return { has: true, admin, owner: n.pub === n.genesis, genesis: n.genesis };
  }

  function state() {
    const c = company();
    if (ui.planted && ui.planted.target === 'company' && ui.planted.node) ui.planted.reports = plantedReports(ui.planted.node, ui.planted.tag);
    return { type: ui.type, pairs: ui.pairs, files: ui.files, office: ui.data ? ui.data.office : null, plan: ui.plan, stale: !!ui.plan && ui.planVersion !== ui.version, agents: ui.agents, floor: ui.floor,
      tbDate: ui.tbDate, bridges: ui.bridges, target: ui.target === 'company' && !c.admin ? 'practice' : ui.target, company: c, planted: ui.planted, receipt: ui.receipt, check: ui.check,
      checkOut: ui.checkOut, say: ui.say, busy: ui.busy };
  }

  function classify(f) { f.cls = classifyFile(f.name, f.text, f.hints); f.levels = f.cls.kind === 'decisions' ? levelsOf(f.text, f.cls.decision) : []; }
  function addFiles(list) {
    let added = 0;
    for (const x of Array.isArray(list) ? list : []) {
      const name = String((x && x.name) || 'an unnamed file').slice(0, 120);
      if (!x || typeof x.text !== 'string') { ui.say = name + ' could not be read as text.'; continue; }
      if ((x.size | 0) > MAX_FILE_BYTES || x.text.length > MAX_FILE_BYTES) { ui.say = name + ' is over 8 MB — split it and add the parts.'; continue; }
      if (ui.files.length >= 16) { ui.say = 'At most 16 files in one planting.'; break; }
      const f = { id: ui.next++, name, text: x.text, hints: { ...(x.hints || {}) }, note: x.note ? String(x.note) : '', cls: null };
      classify(f);
      ui.files.push(f);
      added++;
    }
    if (added) changed();
    paint();
    return added;
  }

  async function demo() {
    const samples = {};
    for (const [d, u] of Object.entries(DEMO_SAMPLE)) samples[d] = await E.fetchJson(u);
    ui.files = [];
    ui.type = DEMO_BUSINESS.type;
    ui.pairs = { ...DEMO_BUSINESS.pairs };
    ui.tbDate = DEMO_BUSINESS.tbDate;
    addFiles(demoFiles(samples));
    ui.say = 'The demo business: an example online retailer with 23 people. Seven files are real published records; the decision log applies an example old rule to real data; the bank statement, trial balance and customer list are made up for the demo.';
  }

  async function grow() {
    const D = await load();
    ui.busy = 'Growing the plan — reading every file and growing a brain from each…';
    paint();
    await pause();
    const pairs = Object.entries(ui.pairs).filter(([, v]) => String(v).trim() !== '').map(([id, value]) => ({ id, value: String(value).trim() }));
    const input = { business: { type: ui.type, pairs }, files: ui.files.map((f) => ({ name: f.name, text: f.text, ...Object.fromEntries(HINTS.filter((h) => f.hints[h]).map((h) => [h, f.hints[h]])) })) };
    const plan = differentiate(input, { ...D }, { seed: 1 });
    ui.busy = '';
    ui.plan = plan;
    ui.input = input;
    ui.planVersion = ui.version;
    ui.agents = plan.ok ? plan.suite.agents.map((a) => a.id) : [];
    ui.planted = null; ui.receipt = null; ui.check = null; ui.bridges = {};
    ui.say = plan.ok ? 'Grown: ' + plan.jobs.filter((j) => j.source === 'grown' && j.verified).length + ' brains from their own records; ' + plan.suite.agents.length + ' agents switch on.' : 'The plan could not be made: ' + plan.why + '.';
  }

  function bridges() {
    ui.bridges = {};
    for (const f of ui.files) if (f.cls && ['bank', 'crm', 'trial-balance'].includes(f.cls.kind)) ui.bridges[f.id] = bridgeOf(f.cls.kind, f.text, { date: ui.tbDate });
    ui.receipt = null; ui.check = null;
    const n = Object.keys(ui.bridges).length;
    ui.say = n ? 'Read across: ' + n + ' file' + (n === 1 ? '' : 's') + '.' : 'There is nothing to read across.';
  }

  /** The practice company: the planter as owner, one device per switched-on agent that runs a job — each its own key. */
  async function practiceCompany(agents) {
    const ok = await E.keygen();
    const owner = createNode({ keys: ok, genesis: ok.pub, name: 'Planter (owner)' });
    const devices = {};
    for (const id of agents.filter((x) => AGENTS.find((a) => a.id === x).domains.length)) {
      const k = await E.keygen();
      const node = createNode({ keys: k, genesis: ok.pub, name: agentName(id) });
      const g = grantFor(wiringView(owner), { role: 'agent', agent: id, pub: k.pub });
      await owner.grant(g.id, g.to, g.role, g.cols);
      devices[id] = { node, keys: k };
    }
    return { owner, keys: ok, devices, sync: async () => { for (const d of Object.values(devices)) { await pull(d.node, owner); await pull(owner, d.node); } for (const d of Object.values(devices)) await pull(d.node, owner); } };
  }
  const fileOf = (domain) => {
    const j = ui.plan.jobs.find((x) => x.domain === domain);
    const f = j && j.source === 'grown' ? ui.input.files.find((x) => x.name === j.file) : null;
    return f ? f.text : '';
  };
  /** One practice agent device judges and records its planted brains, reading its own copy of each job's file. */
  async function loadOn(pc, id) {
    const d = pc.devices[id];
    const tag = ui.plan.planHash.slice(0, 16);
    const rows = (dom) => { const job = jobFor(d.node, dom, tag); return job ? rowsFor(job, fileOf(dom)).rows : []; };
    return { agent: id, pub: d.keys.pub, judged: await loadPlanted({ node: d.node, agentId: id, rows, shipped: ui.data.patterns }) };
  }

  async function plant() {
    const P = ui.plan;
    if (!P || !P.ok || ui.planVersion !== ui.version) { ui.say = 'Grow the plan again first — something changed since it was grown.'; return; }
    const tune = { floor: ui.floor, agents: ui.agents };
    ui.receipt = null; ui.check = null;
    if (ui.target === 'company' && company().admin) {
      const node = E.node();
      const publish = await publishPlan(node, P, tune);
      ui.planted = { target: 'company', node, keys: E.keys(), tag: P.planHash.slice(0, 16), publish, byWords: 'this device', devices: [], reports: [] };
      try { E.setWirePlan(ui.agents); } catch { /* the Wire it plan is this page's own */ }
      ui.say = publish.ok ? 'Planted into company ' + short(node.genesis) + '. On the AI box, each agent device loads its brains when it starts, and reports back here.' : 'Not planted: ' + publish.why + '.';
      return;
    }
    ui.busy = 'Making the practice company: a key for you and one for each agent device…';
    paint();
    await pause();
    const pc = await practiceCompany(ui.agents);
    await pc.sync();
    const publish = await publishPlan(pc.owner, P, tune);
    await pc.sync();
    const devices = [];
    for (const id of Object.keys(pc.devices)) devices.push(await loadOn(pc, id));
    await pc.sync();
    ui.practice = pc;
    ui.planted = { target: 'practice', node: pc.owner, keys: pc.keys, tag: P.planHash.slice(0, 16), publish, byWords: 'you, the practice company’s owner', devices, attack: '' };
    ui.busy = '';
    const adopted = devices.reduce((s, x) => s + x.judged.results.filter((r) => r.adopted).length, 0);
    ui.say = publish.ok ? 'Planted into the practice company: ' + Object.keys(pc.devices).length + ' agent devices checked their planted brains — ' + adopted + ' adopted. Each verdict is below.' : 'Not planted: ' + publish.why + '.';
  }

  async function attack(kind) {
    const pc = ui.practice, d = ui.planted;
    if (!pc || !d || d.target !== 'practice') { ui.say = 'Plant into the practice company first.'; return; }
    const job = ui.plan.jobs.find((j) => j.source === 'grown' && j.verified && pc.devices[j.agent]);
    if (!job) { ui.say = 'No planted brain on a device here to attack.'; return; }
    const victim = pc.devices[job.agent];
    await pc.sync();                                  // every device up to date first, so the attacker's write is the latest
    const rec = { ...toRecord(job.pattern), by: job.agent, source: 'grown', localAuc: Math.round(job.pattern.heldAuc * 1000), n: job.pattern.held | 0, plan: d.tag };
    const id = job.domain + '.' + job.agent;
    let who;
    if (kind === 'forged') {
      const other = Object.keys(pc.devices).find((x) => x !== job.agent);
      if (!other) { ui.say = 'Only one agent device here — switch on another agent to try this.'; return; }
      await pc.devices[other].node.put('brain', id, rec);
      who = 'The ' + agentName(other) + '’s device wrote a ' + jobWord(job.domain).toLowerCase() + ' brain over the ' + agentName(job.agent) + '’s own record, in its name';
    } else {
      const bad = { ...job.pattern, patternId: 'tampered' + d.tag.slice(0, 8), rules: job.pattern.rules.map((r) => ({ ...r, w: -r.w })) };
      await pc.owner.put('brain', id, { ...rec, ...toRecord(bad), by: job.agent });
      who = 'Your own key — the owner’s — signed a tampered ' + jobWord(job.domain).toLowerCase() + ' brain (every rule turned around)';
    }
    await pc.sync();
    const j = judgePlanted({ node: victim.node, agentId: job.agent, rows: (dom) => { const r = jobFor(victim.node, dom, d.tag); return r ? rowsFor(r, fileOf(dom)).rows : []; }, shipped: ui.data.patterns });
    const v = j.results.find((r) => r.id === id);
    d.attack = who + '. The ' + agentName(job.agent) + '’s device: ' + (v ? v.reason : 'did not see it') + ' Plant it again to put the planter’s brain back.';
    ui.say = '';
  }

  async function receipt() {
    const d = ui.planted;
    if (!d || !d.publish.ok) { ui.say = 'Plant first.'; return; }
    const bridgesR = Object.values(ui.bridges).map((b) => b.receipt).filter((r) => r && r.ok);
    let after = null;
    if (d.target === 'company') {
      const decisions = [...signedAs(d.node, 'decisions', (r) => r.agent), ...d.node.list('watch').filter((w) => w.agent === 'door')];
      if (decisions.length) after = { decisions, outcomes: {} };
    }
    const input = { plan: ui.plan, before: ui.input, after, bridges: bridgesR, office: { base: ui.data.office, basis: ui.data.basis }, at: isoDay(now()) };
    ui.busy = 'Measuring each job on its own held-out rows and signing…';
    paint();
    await pause();
    const r = await buildPlantingReceipt(input, d.keys);
    ui.busy = '';
    ui.receipt = r;
    ui.receiptInput = input;
    if (!r.ok) { ui.check = null; ui.say = 'The receipt was not made: ' + r.why + '.'; return; }
    const v = await verifyPlantingReceipt(r);
    const again = reproducePlantingReceipt(r, input);
    const ok = v.ok && again.ok && again.identical;
    ui.check = { ok, words: ok ? 'Checked: its hash and signature hold, every share re-derives from its counts, and the same inputs make the same receipt, byte for byte.' : 'Not checked: ' + (v.ok ? again.why : v.why) + '.' };
    ui.say = '';
  }

  function download(what) {
    const b = Object.values(ui.bridges);
    const stamp = isoDay(now());
    if (what === 'sage-bank') { const x = b.find((y) => y.kind === 'bank' && y.sage && y.sage.ok); if (x) E.download('sage-journal-statement-' + stamp + '.csv', x.sage.text, 'text/csv'); return; }
    if (what === 'sage-tb') { const x = b.find((y) => y.kind === 'trial-balance' && y.sage && y.sage.ok); if (x) E.download('sage-journal-opening-' + stamp + '.csv', x.sage.text, 'text/csv'); return; }
    if (what === 'crm') { const x = b.find((y) => y.kind === 'crm' && y.crm && y.crm.ok); if (x) E.download('customers-' + stamp + '.csv', x.crm.text, 'text/csv'); return; }
    if (what === 'receipt' && ui.receipt && ui.receipt.ok) { E.download('planting-receipt-' + ui.receipt.hash.slice(0, 16) + '.json', JSON.stringify(ui.receipt, null, 1), 'application/json'); return; }
    if (what === 'showcase' && ui.receipt && ui.receipt.ok) E.download('planting-showcase-' + ui.receipt.hash.slice(0, 16) + '.json', JSON.stringify(showcase(ui.receipt), null, 1), 'application/json');
  }

  async function all() {
    await demo();
    await grow();
    if (!ui.plan || !ui.plan.ok) return;
    bridges();
    ui.target = 'practice';
    await plant();
    await receipt();
    ui.say = 'The whole planting ran: the plan grown from the demo business’s records, its records read across, the plan signed into a practice company and checked on every agent device, and the receipt signed and checked. Read each step below — then do it with your own files.';
  }

  const val = (read, id) => { try { return read(id); } catch { return ''; } };
  /** One action from the page. el = the element (its dataset), read(id) = an input's value. */
  async function act(name, el, read = () => '') {
    const d = (el && el.dataset) || {};
    ui.say = '';
    try {
      if (name === 'plant-type') { ui.type = ADOPTION.some((b) => b.id === d.value) || d.value === 'other' ? d.value : ''; changed(); load(); }
      else if (name === 'plant-pair') { if (formFields(ui.data ? ui.data.office : null).some((f) => f.id === d.pair)) { ui.pairs[d.pair] = String(d.value ?? '').slice(0, 12); changed(); } return; }
      else if (name === 'plant-demo') await demo();
      else if (name === 'plant-clear') { ui.files = []; changed(); }
      else if (name === 'plant-remove') { ui.files = ui.files.filter((f) => String(f.id) !== String(d.file)); changed(); }
      else if (name === 'plant-hint') {
        const f = ui.files.find((x) => String(x.id) === String(d.file));
        if (f && HINTS.includes(d.hint)) { f.hints[d.hint] = String(d.value ?? '') || undefined; if (!f.hints[d.hint]) delete f.hints[d.hint]; classify(f); changed(); }
      } else if (name === 'plant-grow') await grow();
      else if (name === 'plant-agent') {
        const ok = ui.plan && ui.plan.ok && ui.plan.suite.agents.some((a) => a.id === d.agent);
        if (ok) { ui.agents = d.checked ? [...new Set([...ui.agents, d.agent])] : ui.agents.filter((x) => x !== d.agent); ui.planted = null; ui.receipt = null; ui.check = null; }
      } else if (name === 'plant-floor') { const v = Number(d.value); if (FLOORS.includes(v)) ui.floor = v; }
      else if (name === 'plant-tbdate') { ui.tbDate = String(d.value ?? '').slice(0, 10); ui.bridges = {}; }
      else if (name === 'plant-target') { ui.target = d.value === 'company' ? 'company' : 'practice'; }
      else if (name === 'plant-bridge') bridges();
      else if (name === 'plant-plant') await plant();
      else if (name === 'plant-attack') await attack(d.kind);
      else if (name === 'plant-refresh') ui.say = 'Reports read from this device’s copy of the company.';
      else if (name === 'plant-receipt') await receipt();
      else if (name === 'plant-print') { if (ui.receipt && ui.receipt.ok) E.print(receiptHtml(ui.receipt)); }
      else if (name === 'plant-dl') download(d.what);
      else if (name === 'plant-check') {
        let r = null;
        try { r = JSON.parse(String(val(read, 'plant-check-in'))); } catch { r = null; }
        const v = await verifyPlantingReceipt(r);
        ui.checkOut = v.ok ? 'Genuine: its hash and signature hold and every number re-derives from its counts. Who signed it is the key ' + short(r.pub) + ' — check it belongs to the planter.' : 'Not genuine: ' + v.why + '.';
      } else if (name === 'plant-all') await all();
    } catch (e) {
      ui.busy = '';
      ui.say = 'That did not work: ' + String((e && e.message) || e).slice(0, 160);
    } finally { paint(); }
  }

  return { state, act, addFiles, ready: () => load() };
}
