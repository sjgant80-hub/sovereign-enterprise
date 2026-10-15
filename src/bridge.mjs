// bridge.mjs — a planting is never greenfield. The business already keeps a bank account, a customer list and an
// accountant's trial balance, and its accountant already works in their own software. These are the bridges: files in,
// read and checked, mapped to records the existing kernels accept (books.mjs entries, the page's CRM records) — and the
// books out again in the accountant's own import layout. Nothing is posted here: a bridge hands back entries and records,
// and they go onto the spine through the runtime's posting path (runtime.mjs postEntry) and a device's own grant, like
// every other write. Pure, total, deterministic: junk in, a refusal in plain words out, never a throw.
//
// One CSV reader in the repository (csv-forge's, vendored) and one CSV writer (exportco.mjs's, which defuses any cell a
// spreadsheet would run as a formula). Money is whole pence from the first character read to the last one written —
// an amount is read digit by digit, never through a floating-point number.
import { parseCsv } from '../vendor/csv-forge/csv.mjs';
import { CHART, validEntry, gbp } from './books.mjs';
import { toCsv, poundsText, companyCsvs } from './exportco.mjs';
import { canonical } from './canon.mjs';
import { sha256 } from './sha256.mjs';

export const BANK = '1200';                    // the bank current account every statement line posts against
export const SUSPENSE = '9998';                // where a line no rule recognises waits for a person (books.mjs CHART)
export const MAX_TEXT = 8 * 1024 * 1024;       // the largest file a bridge reads, in characters
export const MAX_ROWS = 50000;                 // the most rows one file may hold
export const MAX_RULES = 200;
export const HEAD_SCAN = 30;                   // the header may follow this many lines of account details above it
export const SAGE_MAX = 9999999900;            // 99,999,999.00 in pence: the largest amount Sage's journal import takes
export const STAGES = Object.freeze(['lead', 'qualified', 'proposal', 'won', 'lost']);   // the page's CRM columns

const no = (why, extra) => ({ ok: false, why, ...extra });
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const clean = (s, max) => String(s ?? '').replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const shown = (s) => '\u201c' + clean(s, 40) + '\u201d';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cell = (cells, i) => String(cells[i] ?? '').trim();
const blank = (cells) => cells.every((c) => String(c).trim() === '');
const pad2 = (n) => String(n).padStart(2, '0');
/** A row that could not be read: where it is, why, and its first characters, so a person can find it in the file. */
const refused = (i, cells, why) => ({ line: i + 1, why, text: clean(cells.join(','), 80) });
const tooMany = (n) => n > MAX_ROWS;

/** The first header cell (normalised) matching one of `names`, in the order the names are preferred; −1 if none. */
function column(head, names) {
  for (const n of names) {
    const i = head.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

// ── money and dates, read exactly ───────────────────────────────────────────────────────────────────────────────────
// An optional sign (before or after a pound sign — not both), digits with or without thousands commas, up to two
// decimals. Brackets round an amount mean minus, as accounts print it.
const MONEY = /^([-+\u2212]?)(?:\u00a3|gbp)?([-+\u2212]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i;
const MINUS = /[-\u2212]/;
/** Text → whole pence (a safe integer), or null. Never a float: whole pounds and pence are read as separate digits. */
export function moneyOf(text) {
  try {
    let s = String(text).replace(/\s+/g, '');
    const bracketed = s.startsWith('(') && s.endsWith(')');
    if (bracketed) s = s.slice(1, -1);
    const m = MONEY.exec(s);
    if (!m) return null;
    const sign = m[1] + m[2];
    if (sign.length > 1) return null;                       // a sign both before and after the pound sign
    if (bracketed && sign) return null;                     // brackets and a sign: which one is meant is not clear
    const whole = m[3].replace(/,/g, '');
    if (whole.length > 11) return null;                     // beyond the books' range (books.mjs, a line is at most 10^13 pence)
    const p = Number(whole) * 100 + Number((m[4] ?? '').padEnd(2, '0'));
    return bracketed || MINUS.test(sign) ? 0 - p : p;       // 0 - p: a minus zero reads as plain 0
  } catch { return null; }
}

const ISO_DATE = /^((?:19|20)\d\d)-(\d\d)-(\d\d)(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z?)?$/;
const UK_DATE = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]((?:19|20)\d\d|\d\d)(?: \d{1,2}:\d\d(?::\d\d)?)?$/;
const NAMED_DATE = /^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -]((?:19|20)\d\d|\d\d)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const year = (s) => (s.length === 2 ? 2000 + Number(s) : Number(s));
/** A real calendar day, or ''. A day or month out of range rolls the month over, so checking the month catches both. */
function ymd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return '';
  return y + '-' + pad2(m) + '-' + pad2(d);
}
/** Text → 'YYYY-MM-DD', or ''. UK order: day/month/year (also with - or .), year-month-day, or "1 Oct 2026". A two-digit
 *  year is read as 20YY; years 1900–2099. */
export function dateOf(text) {
  try {
    const s = String(text).trim();
    let m = ISO_DATE.exec(s);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    m = UK_DATE.exec(s);
    if (m) return ymd(year(m[3]), Number(m[2]), Number(m[1]));
    m = NAMED_DATE.exec(s);
    if (m) return ymd(year(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
    return '';
  } catch { return ''; }
}
const ukDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

/** Read a file's records and find its header: the first of the opening HEAD_SCAN rows that `layout` recognises. */
function readTable(text, layout, what) {
  if (typeof text !== 'string') return { why: 'the file is empty' };
  if (text.length > MAX_TEXT) return { why: 'the file is too large to read here (over ' + MAX_TEXT / 1024 / 1024 + ' MB)' };
  if (text.trim() === '') return { why: 'the file is empty' };
  const { header, rows } = parseCsv(text);
  const recs = [header, ...rows];
  if (tooMany(recs.length)) return { why: 'the file has more than ' + MAX_ROWS + ' rows — split it and bring it in a part at a time' };
  for (let i = 0; i < Math.min(HEAD_SCAN, recs.length); i++) {
    const L = layout(recs[i].map(norm));
    if (L) return { L, recs, start: i + 1 };
  }
  return { why: 'no row in it reads as the header of ' + what };
}

// ── bank statements in ──────────────────────────────────────────────────────────────────────────────────────────────
const BANK_HEAD = Object.freeze({
  date: ['date', 'transaction date', 'posting date', 'posted date', 'value date'],
  desc: ['description', 'transaction description', 'details', 'transaction details', 'narrative', 'memo', 'payee', 'name', 'reference'],
  amount: ['amount', 'amount gbp', 'transaction amount', 'value'],
  in: ['paid in', 'money in', 'paid in gbp', 'money in gbp', 'in'],
  out: ['paid out', 'money out', 'paid out gbp', 'money out gbp', 'out'],
  credit: ['credit', 'credits', 'credit amount', 'credit gbp'],
  debit: ['debit', 'debits', 'debit amount', 'debit gbp'],
  balance: ['balance', 'running balance', 'balance gbp'],
});
/** A bank statement's header → where each field is. Paid in / paid out first, then a bank's credit / debit columns
 *  (credit is money in, as the bank sees the account), then one signed amount. */
function bankLayout(head) {
  const at = (k) => column(head, BANK_HEAD[k]);
  const date = at('date');
  if (date < 0) return null;
  const base = { date, desc: at('desc'), balance: at('balance') };
  if (Math.min(at('in'), at('out')) >= 0) return { ...base, format: 'paid-in-out', in: at('in'), out: at('out') };
  if (Math.min(at('credit'), at('debit')) >= 0) return { ...base, format: 'debit-credit', in: at('credit'), out: at('debit') };
  const amount = at('amount');
  return amount >= 0 ? { ...base, format: 'amount', amount } : null;
}

function bankAmount(cells, L) {
  if (L.format === 'amount') {
    const p = moneyOf(cell(cells, L.amount));
    return p === null ? { why: 'the amount ' + shown(cell(cells, L.amount)) + ' is not an amount of money' } : { pence: p };
  }
  const a = cell(cells, L.in), b = cell(cells, L.out);
  const pin = a === '' ? 0 : moneyOf(a), pout = b === '' ? 0 : moneyOf(b);
  if (pin === null) return { why: 'the money in, ' + shown(a) + ', is not an amount of money' };
  if (pout === null) return { why: 'the money out, ' + shown(b) + ', is not an amount of money' };
  if (pin < 0) return { why: 'a negative amount in the money-in column' };
  if (pin !== 0 && pout !== 0) return { why: 'money both in and out on one row' };
  return { pence: pin - Math.abs(pout) };                 // some banks write money out as a negative number: either reads as out
}

function bankRow(cells, L) {
  const date = dateOf(cell(cells, L.date));
  if (!date) return { why: 'the date ' + shown(cell(cells, L.date)) + ' is not a date (day/month/year or year-month-day)' };
  const a = bankAmount(cells, L);
  if (a.why) return a;
  if (a.pence === 0) return { why: 'no money moved on this row' };
  const row = { date, desc: clean(cell(cells, L.desc), 200) || '(no description)', pence: a.pence };
  const b = cell(cells, L.balance);
  if (b === '') return { row };
  const balance = moneyOf(b);
  if (balance === null) return { why: 'the balance ' + shown(b) + ' is not an amount of money' };
  return { row: { ...row, balance } };
}

/** Money in, money out and the difference, in pence. */
function totalsOf(rows) {
  let moneyIn = 0, moneyOut = 0;
  for (const r of rows) { moneyIn += Math.max(r.pence, 0); moneyOut += Math.max(0 - r.pence, 0); }
  return { count: rows.length, moneyIn, moneyOut, net: moneyIn - moneyOut };
}

/**
 * A bank statement as exported (CSV) → { ok, format, rows: [{ date (YYYY-MM-DD), desc, pence (signed: + in, − out),
 * balance?, line }], rejected: [{ line, why, text }], totals: { count, moneyIn, moneyOut, net } }. format: 'amount' (one
 * signed Amount column), 'paid-in-out' (Paid in / Paid out, or Money in / Money out), 'debit-credit' (the bank's Debit =
 * out, Credit = in). Dates are read day-first (the UK order). Lines of account details above the header are skipped.
 * `line` counts the file's rows from 1 — blank lines are not counted (the CSV reader drops them), so a rejected row also
 * carries `text`, its first characters, to find it by.
 */
export function parseBankCsv(text) {
  try {
    const t = readTable(text, bankLayout, 'a bank statement (a date column, and an amount — or paid in and paid out, or debit and credit)');
    if (t.why) return no(t.why, { format: '', rows: [], rejected: [], totals: totalsOf([]) });
    const rows = [], rejected = [];
    for (let i = t.start; i < t.recs.length; i++) {
      if (blank(t.recs[i])) continue;
      const r = bankRow(t.recs[i], t.L);
      if (r.row) rows.push({ ...r.row, line: i + 1 });
      else rejected.push(refused(i, t.recs[i], r.why));
    }
    const out = { format: t.L.format, rows, rejected, totals: totalsOf(rows) };
    return rows.length ? { ok: true, why: 'read', ...out } : no('not one row could be read as a payment in or out', out);
  } catch {
    return no('this file could not be read as a bank statement', { format: '', rows: [], rejected: [], totals: totalsOf([]) });
  }
}

// ── statement lines → journal entries ───────────────────────────────────────────────────────────────────────────────
/** Starting rules: whole words in the description → a nominal. `dir` limits a rule to money 'in' or 'out'. A business
 *  gives its own; whatever no rule recognises goes to the suspense account for a person to classify. */
export const DEFAULT_RULES = Object.freeze([
  { contains: 'rent', code: '7100', dir: 'out' },
  { contains: 'salaries', code: '7000', dir: 'out' },
  { contains: 'salary', code: '7000', dir: 'out' },
  { contains: 'wages', code: '7000', dir: 'out' },
  { contains: 'payroll', code: '7000', dir: 'out' },
  { contains: 'paye', code: '2210', dir: 'out' },
  { contains: 'electricity', code: '7200', dir: 'out' },
  { contains: 'electric', code: '7200', dir: 'out' },
  { contains: 'software', code: '7500', dir: 'out' },
  { contains: 'subscription', code: '7500', dir: 'out' },
  { contains: 'bank charges', code: '7900', dir: 'out' },
  { contains: 'interest', code: '4900', dir: 'in' },
].map(Object.freeze));

const words = (s) => ' ' + String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';
const DIRS = Object.freeze({ in: 1, out: -1 });
function ruleSet(rules) {
  const list = [];
  let ignored = 0;
  for (const r of (Array.isArray(rules) ? rules : DEFAULT_RULES).slice(0, MAX_RULES)) {
    try {
      const phrase = words(r.contains);
      const sign = r.dir === undefined ? 0 : DIRS[r.dir];
      const ok = typeof r.contains === 'string' && phrase.trim() !== '' && Object.hasOwn(CHART, r.code) && r.code !== BANK && Number.isInteger(sign);
      if (ok) list.push({ phrase, code: r.code, sign, contains: r.contains });
      else ignored++;
    } catch { ignored++; }
  }
  return { list, ignored };
}
const ruleFor = (list, desc, pence) => list.find((r) => words(desc).includes(r.phrase) && (r.sign === 0 || r.sign === Math.sign(pence))) ?? null;

const REASON = Object.freeze({ date: 'the date is not a date', amount: 'the amount is not a whole number of pence within range', 'one-side': 'no money moved on this row', account: 'the nominal code is not in the chart of accounts' });
const reasonFor = (v) => REASON[v.reason] ?? 'the entry would not balance (' + v.reason + ')';

/** Is every row's running balance the one before it plus the row's own amount — in the file's order (oldest first), or
 *  read from the bottom up (newest first)? The order is the one the balances agree with; on a tie, the dates decide. */
function balances(rows) {
  const bal = rows.map((r) => r.balance);
  const have = bal.filter(Number.isSafeInteger).length;
  if (have === 0) return null;
  if (have !== rows.length) return { ok: false, why: have + ' of the ' + rows.length + ' rows carry a running balance, so the balances were not checked' };
  const fwd = [], bwd = [];
  for (let i = 1; i < rows.length; i++) {
    const down = bal[i - 1] + rows[i].pence, up = bal[i] + rows[i - 1].pence;
    if (bal[i] !== down) fwd.push({ index: i, line: rows[i].line ?? null, expected: down, found: bal[i] });
    if (bal[i - 1] !== up) bwd.push({ index: i - 1, line: rows[i - 1].line ?? null, expected: up, found: bal[i - 1] });
  }
  const newestFirst = bwd.length < fwd.length || (bwd.length === fwd.length && rows[0].date > rows[rows.length - 1].date);
  const first = newestFirst ? rows.length - 1 : 0, last = newestFirst ? 0 : rows.length - 1;
  const opening = bal[first] - rows[first].pence, closing = bal[last];
  const mismatches = newestFirst ? bwd : fwd;
  return { ok: mismatches.length === 0, order: newestFirst ? 'newest-first' : 'oldest-first', checked: rows.length - 1, opening, closing,
    movement: closing - opening, mismatches };
}

/**
 * Statement rows (parseBankCsv's) → journal entries books.validEntry accepts: the bank (1200) against the nominal the
 * first matching rule names — or the suspense account (9998) — for a person. rules: [{ contains, code, dir? }] (whole
 * words, any case; DEFAULT_RULES if none are given; a malformed rule is ignored and counted).
 * → { ok, entries: [{ date, memo, lines }], suspense: [{ index, line, entry, date, desc, pence }], rejected: [{ index, line, why }],
 *     rules: { used, ignored }, totals: { count, moneyIn, moneyOut, net, suspense },
 *     reconciliation: { count, moneyIn, moneyOut, net, balances } }
 * balances: null when the statement carries none; otherwise every running balance checked — { ok, order, checked,
 * opening, closing, movement, mismatches: [{ index, line, expected, found }] }, or { ok: false, why } if only some rows carry one.
 */
export function bankToJournal(rows, rules) {
  const empty = { entries: [], suspense: [], rejected: [], rules: { used: 0, ignored: 0 }, totals: { ...totalsOf([]), suspense: 0 }, reconciliation: { ...totalsOf([]), balances: null } };
  try {
    if (!Array.isArray(rows) || rows.length === 0) return no('there are no statement rows to post', empty);
    if (tooMany(rows.length)) return no('more than ' + MAX_ROWS + ' rows — post them a part at a time', empty);
    const R = ruleSet(rules);
    const entries = [], suspense = [], rejected = [], kept = [];
    rows.forEach((r, index) => {
      try {
        const pence = typeof r.pence === 'number' ? r.pence : NaN;
        const desc = clean(r.desc, 200) || '(no description)';
        const rule = ruleFor(R.list, desc, pence);
        const code = rule ? rule.code : SUSPENSE;
        const pin = Math.max(pence, 0), pout = Math.max(0 - pence, 0);
        const entry = { date: dateOf(r.date), memo: desc, lines: [[BANK, pin, pout], [code, pout, pin]] };
        const v = validEntry(entry);
        if (!v.ok) { rejected.push({ index, line: r.line ?? null, why: reasonFor(v) }); return; }
        if (!rule) suspense.push({ index, line: r.line ?? null, entry: entries.length, date: entry.date, desc, pence });
        entries.push(entry);
        kept.push({ date: entry.date, pence, balance: r.balance, line: r.line });
      } catch { rejected.push({ index, line: null, why: 'the row could not be read' }); }
    });
    const t = totalsOf(kept);
    const out = { entries, suspense, rejected, rules: { used: R.list.length, ignored: R.ignored }, totals: { ...t, suspense: suspense.length }, reconciliation: { ...t, balances: balances(kept) } };
    return entries.length ? { ok: true, why: 'posted ' + entries.length + ' of ' + rows.length + ' rows', ...out } : no('not one row became an entry', out);
  } catch {
    return no('the statement rows could not be read', empty);
  }
}

// ── customer lists in ───────────────────────────────────────────────────────────────────────────────────────────────
const CRM_HEAD = Object.freeze({
  name: ['company', 'company name', 'organisation', 'organization', 'account name', 'deal name', 'client', 'customer', 'name'],
  contact: ['contact', 'contact name', 'full name', 'person'],
  email: ['email', 'email address', 'e mail'],
  first: ['first name', 'firstname', 'given name'],
  last: ['last name', 'lastname', 'surname', 'family name'],
  stage: ['stage', 'deal stage', 'pipeline stage', 'lead status', 'status'],
  value: ['value', 'value gbp', 'deal value', 'amount', 'deal amount', 'expected revenue'],
  owner: ['owner', 'deal owner', 'account owner', 'sales rep', 'assigned to'],
});
/** The stage names other CRMs export, read as the page's five. */
export const STAGE_OF = Object.freeze(Object.fromEntries([
  ['lead', ['lead', 'new', 'new lead', 'prospect', 'open', 'subscriber', 'mql', 'marketing qualified lead', 'appointment scheduled', 'contacted']],
  ['qualified', ['qualified', 'qualified lead', 'qualified to buy', 'sql', 'sales qualified lead']],
  ['proposal', ['proposal', 'proposal sent', 'proposal made', 'quote', 'quoted', 'quote sent', 'negotiation', 'presentation scheduled', 'decision maker bought in', 'contract sent']],
  ['won', ['won', 'closed won', 'customer']],
  ['lost', ['lost', 'closed lost', 'dead', 'disqualified', 'unqualified']],
].flatMap(([stage, names]) => names.map((n) => [n, stage]))));

function crmLayout(head) {
  const at = (k) => column(head, CRM_HEAD[k]);
  const L = { name: at('name'), contact: at('contact'), email: at('email'), first: at('first'), last: at('last'), stage: at('stage'), value: at('value'), owner: at('owner') };
  return Math.max(L.name, L.contact, L.email, L.first, L.last) >= 0 ? L : null;
}

function crmRow(cells, L) {
  const person = clean(cell(cells, L.first) + ' ' + cell(cells, L.last), 120);
  const contact = clean(cell(cells, L.contact), 120) || person || clean(cell(cells, L.email), 120);
  const name = clean(cell(cells, L.name), 120) || contact;
  if (!name) return { why: 'no name and no contact' };
  const said = cell(cells, L.stage);
  const stage = said === '' ? 'lead' : STAGE_OF[norm(said)];
  if (!stage) return { why: 'the stage ' + shown(said) + ' is not one of ' + STAGES.join(', ') + ' (or a usual name for one)' };
  const v = cell(cells, L.value);
  const value = v === '' ? 0 : moneyOf(v);
  if (value === null) return { why: 'the value ' + shown(v) + ' is not an amount of money' };
  if (value < 0) return { why: 'a negative deal value' };
  return { record: { name, contact, stage, value, owner: clean(cell(cells, L.owner), 120) || 'Imported' } };
}

/**
 * A customer list or pipeline exported from a CRM (CSV) → { ok, format: 'crm', records: [{ name, contact, stage, value,
 * owner }], rejected: [{ line, why, text }], totals: { count, value } } — each record exactly the fields the page's CRM keeps
 * (index.html crm-add, company.mjs effects): stage one of lead / qualified / proposal / won / lost (blank reads as lead),
 * value in whole pence. A record has no id: the device that writes it gives it one.
 */
export function parseCrmCsv(text) {
  const fail = (why, records = [], rejected = []) => no(why, { format: 'crm', records, rejected, totals: { count: records.length, value: records.reduce((s, r) => s + r.value, 0) } });
  try {
    const t = readTable(text, crmLayout, 'a customer list (a name, company or contact column)');
    if (t.why) return fail(t.why);
    const records = [], rejected = [];
    for (let i = t.start; i < t.recs.length; i++) {
      if (blank(t.recs[i])) continue;
      const r = crmRow(t.recs[i], t.L);
      if (r.record) records.push(r.record);
      else rejected.push(refused(i, t.recs[i], r.why));
    }
    if (!records.length) return fail('not one row could be read as a customer', records, rejected);
    return { ok: true, why: 'read', format: 'crm', records, rejected, totals: { count: records.length, value: records.reduce((s, r) => s + r.value, 0) } };
  } catch {
    return fail('this file could not be read as a customer list');
  }
}

// ── a trial balance in: the opening entry ───────────────────────────────────────────────────────────────────────────
const TB_HEAD = Object.freeze({
  code: ['n c', 'nc', 'nominal code', 'nominal', 'code', 'account code', 'a c', 'ac', 'account', 'nominal ref', 'ref'],
  name: ['name', 'account name', 'nominal name', 'description'],
  debit: ['debit', 'debits', 'dr', 'debit gbp'],
  credit: ['credit', 'credits', 'cr', 'credit gbp'],
  balance: ['balance', 'closing balance', 'net', 'balance gbp'],
});
function tbLayout(head) {
  const at = (k) => column(head, TB_HEAD[k]);
  const code = at('code');
  if (code < 0) return null;
  const base = { code, name: at('name') };
  if (Math.min(at('debit'), at('credit')) >= 0) return { ...base, format: 'debit-credit', debit: at('debit'), credit: at('credit') };
  const balance = at('balance');
  return balance >= 0 ? { ...base, format: 'balance', balance } : null;
}
/** One trial-balance row's debit and credit, in pence. A signed balance column: plus is a debit, minus a credit. */
function tbAmounts(cells, L) {
  if (L.format === 'balance') {
    const s = cell(cells, L.balance);
    const b = s === '' ? 0 : moneyOf(s);
    if (b === null) return { why: 'the balance ' + shown(s) + ' is not an amount of money' };
    return { debit: Math.max(b, 0), credit: Math.max(0 - b, 0) };
  }
  const d = cell(cells, L.debit), c = cell(cells, L.credit);
  const debit = d === '' ? 0 : moneyOf(d), credit = c === '' ? 0 : moneyOf(c);
  if (debit === null) return { why: 'the debit ' + shown(d) + ' is not an amount of money' };
  if (credit === null) return { why: 'the credit ' + shown(c) + ' is not an amount of money' };
  if (Math.min(debit, credit) < 0) return { why: 'a negative amount in a debit or credit column' };
  return { debit, credit };
}
const TOTAL = /\btotals?\b/;

/**
 * An accountant's trial balance (CSV: a nominal code, and debit and credit columns — or one signed balance) → ONE opening
 * entry that balances: { ok, entry: { date, memo, lines }, rows: [{ line, code, name, debit, credit }], rejected,
 * totals: { debit, credit, difference, accounts } }. Each account's debits and credits net to one line; codes are read
 * against this company's chart (a code Excel shortened, 30 for 0030, is padded back). A refusal says why — a row it could
 * not read, a code the chart does not have, or by how much the debits and credits differ (`totals.difference`, in pence).
 * A totals row in the file is checked against the rows above it. opts: { date (required: the day the balances are at),
 * memo }.
 */
export function parseTrialBalance(text, opts) {
  const zero = { debit: 0, credit: 0, difference: 0, accounts: 0 };
  try {
    const o = plain(opts) ? opts : {};
    const date = dateOf(o.date);
    if (!date) return no('say the date the balances are at (opts.date — day/month/year or year-month-day)', { entry: null, rows: [], rejected: [], totals: zero });
    const t = readTable(text, tbLayout, 'a trial balance (a nominal code column, and debit and credit columns or a balance)');
    if (t.why) return no(t.why, { entry: null, rows: [], rejected: [], totals: zero });
    const rows = [], rejected = [], net = new Map();
    let filed = null, debit = 0, credit = 0;
    for (let i = t.start; i < t.recs.length; i++) {
      const cells = t.recs[i];
      if (blank(cells)) continue;
      const raw = cell(cells, t.L.code);
      const numbered = /^\d{1,4}$/.test(raw);
      const total = !numbered && cells.some((c) => TOTAL.test(norm(c)));   // the file's own totals row
      const a = tbAmounts(cells, t.L);
      if (a.why) { rejected.push(refused(i, cells, (total ? 'the totals row: ' : '') + a.why)); continue; }
      if (total) { filed = a; continue; }
      if (!numbered) { rejected.push(refused(i, cells, shown(raw) + ' is not a nominal code')); continue; }
      const code = raw.padStart(4, '0');
      if (!Object.hasOwn(CHART, code)) { rejected.push(refused(i, cells, 'nominal code ' + code + ' is not in this company’s chart of accounts — map it to one of its codes first')); continue; }
      rows.push({ line: i + 1, code, name: clean(cell(cells, t.L.name), 120) || CHART[code][0], debit: a.debit, credit: a.credit });
      net.set(code, (net.get(code) ?? 0) + a.debit - a.credit);
      debit += a.debit; credit += a.credit;
    }
    const lines = [...net.keys()].sort().map((c) => [c, Math.max(net.get(c), 0), Math.max(0 - net.get(c), 0)]).filter(([, d, c]) => d + c !== 0);
    const totals = { debit, credit, difference: debit - credit, accounts: lines.length };
    const base = { entry: null, rows, rejected, totals };
    if (rejected.length) return no(rejected.length + ' row' + (rejected.length === 1 ? '' : 's') + ' could not be read — fix ' + (rejected.length === 1 ? 'it' : 'them') + ' and bring the file in again; an opening balance is all or nothing', base);
    if (filed && t.L.format === 'debit-credit' && (filed.debit !== debit || filed.credit !== credit)) {
      return no('the file’s own totals row says debits ' + gbp(filed.debit) + ' and credits ' + gbp(filed.credit) + ', but its rows add to ' + gbp(debit) + ' and ' + gbp(credit), base);
    }
    if (debit !== credit) return no('the trial balance does not balance: debits ' + gbp(debit) + ', credits ' + gbp(credit) + ' — out by ' + gbp(Math.abs(debit - credit)), base);
    if (lines.length === 0) return no('every account in it is at nothing — there is no opening balance to post', base);
    const entry = { date, memo: clean(o.memo, 200) || 'Opening balances (trial balance)', lines };
    const v = validEntry(entry);
    if (!v.ok) return no('the opening entry could not be made: ' + reasonFor(v), base);
    return { ok: true, why: 'balances', ...base, entry };
  } catch {
    return no('this file could not be read as a trial balance', { entry: null, rows: [], rejected: [], totals: zero });
  }
}

// ── the books out: the accountant's own journal import ──────────────────────────────────────────────────────────────
// Sage Accounting (UK) — "Import journal entries", Sage Knowledgebase solution 222001000100916 (last modified 13 Feb 2025,
// https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000100916), read 15 Oct 2026:
// columns A–L are Reference (text, ≤75, required), Date (day/month/year, required), Description (≤200), Nominal Code (the
// number only; it must already exist in the chart), Details (≤200), Include on VAT/Tax Return? (Yes/Y/No/N, optional),
// Debit and Credit (numbers only, each required, at most 99999999.00), Analysis Type 1–3 and Exchange Rate (optional).
// "We create a new journal when the data in column A is different from the previous row", and each journal's debits and
// credits must balance. The page says to fill A–C once per journal; it does not say what a blank A on a later line means,
// and by that rule a blank A differs from the row above — so this writer repeats A–C on every line, which reads the same
// either way. Both amount columns are written on every line ('0.00' on the other side), as both are required.
//
// Xero is left out on purpose. Xero's own help page for importing manual journals could not be read to confirm its CSV
// columns, date format or sign convention (third-party guides agree on *Narration, *Date, Description, *AccountCode,
// *TaxRate, *Amount with debits positive — not Xero's own words), so no Xero file is written rather than a guessed one.
export const SAGE_HEADER = Object.freeze(['Reference', 'Date', 'Description', 'Nominal Code', 'Details', 'Include on VAT/Tax Return?', 'Debit', 'Credit',
  'Analysis Type 1', 'Analysis Type 2', 'Analysis Type 3', 'Exchange Rate']);
const REF = /^[A-Za-z0-9][A-Za-z0-9 _.:\/-]{0,74}$/;

/**
 * Journal entries ({ id?, date, memo, lines } — lines as [[code, debit, credit]] or the spine's encoded string) → the
 * accountant's import file. format: 'sage' (Sage Accounting UK). → { ok, format, text, rows (lines written), rejected:
 * [{ index, why }], totals: { entries, lines, debit, credit } }. An entry that does not balance, or has a line Sage would
 * refuse, is listed and left out — never half-written. Each entry's reference is its id (else J + its position).
 */
export function journalToCsv(entries, format) {
  const zero = { entries: 0, lines: 0, debit: 0, credit: 0 };
  try {
    // Xero refuses manual journals to bank, receivable and payable accounts (developer.xero.com, Accounting API · Manual Journals),
    // so a statement's journal could never import there: Xero takes the statement itself, and opening balances as conversion balances.
    if (format === 'xero') return no('Xero takes the bank statement itself through its own bank import, and opening balances as conversion balances — it refuses manual journals to bank, receivable and payable accounts, so no journal file is written for it', { format, text: '', rows: 0, rejected: [], totals: zero });
    if (format !== 'sage') return no('the layouts are: sage', { format: '', text: '', rows: 0, rejected: [], totals: zero });
    if (!Array.isArray(entries) || tooMany(entries.length)) return no('there are no journal entries to write', { format, text: '', rows: 0, rejected: [], totals: zero });
    const out = [], rejected = [], seen = new Set();
    let n = 0, debit = 0, credit = 0;
    entries.forEach((e, index) => {
      try {
        const v = validEntry(e);
        if (!v.ok) { rejected.push({ index, why: reasonFor(v) }); return; }
        const ref = typeof e.id === 'string' && REF.test(e.id) ? e.id : 'J' + String(index + 1).padStart(6, '0');
        if (seen.has(ref)) { rejected.push({ index, why: 'the reference ' + ref + ' is already used by another entry — Sage would merge them' }); return; }
        if (v.lines.some(([, d, c]) => Math.max(d, c) > SAGE_MAX)) { rejected.push({ index, why: 'a line is over 99,999,999.00, the most the Sage import takes' }); return; }
        seen.add(ref);
        const memo = clean(e.memo, 200);
        for (const [code, d, c] of v.lines) out.push([ref, ukDate(e.date), memo, code, memo, '', poundsText(d), poundsText(c), '', '', '', '']);
        n++; debit += v.total; credit += v.total;
      } catch { rejected.push({ index, why: 'the entry could not be read' }); }
    });
    const totals = { entries: n, lines: out.length, debit, credit };
    const text = toCsv(SAGE_HEADER, out);
    return n ? { ok: true, why: 'written', format, text, rows: out.length, rejected, totals } : no('not one entry could be written', { format, text, rows: 0, rejected, totals });
  } catch {
    return no('the journal could not be written', { format: '', text: '', rows: 0, rejected: [], totals: zero });
  }
}

const SAGE_IN = Object.freeze({ ref: ['reference'], date: ['date'], memo: ['description'], code: ['nominal code'], debit: ['debit'], credit: ['credit'] });
function sageLayout(head) {
  const L = Object.fromEntries(Object.entries(SAGE_IN).map(([k, names]) => [k, column(head, names)]));
  return Math.min(L.ref, L.date, L.code, L.debit, L.credit) >= 0 ? L : null;
}

/**
 * A Sage journal import file (the layout journalToCsv writes, or one an accountant sends back with adjustments) → entries.
 * A new journal starts when the reference changes; a line with a blank reference continues the journal above it.
 * → { ok, format: 'sage', entries: [{ id, date, memo, lines }], rejected: [{ line, why }], totals: { entries, lines, debit, credit } }
 */
export function parseJournalCsv(text) {
  const zero = { entries: 0, lines: 0, debit: 0, credit: 0 };
  try {
    const t = readTable(text, sageLayout, 'a Sage journal import (Reference, Date, Nominal Code, Debit and Credit)');
    if (t.why) return no(t.why, { format: 'sage', entries: [], rejected: [], totals: zero });
    const groups = [];
    for (let i = t.start; i < t.recs.length; i++) {
      const cells = t.recs[i];
      if (blank(cells)) continue;
      const ref = cell(cells, t.L.ref);
      const top = groups[groups.length - 1];
      if (!top || (ref !== '' && ref !== top.id)) groups.push({ id: ref, line: i + 1, date: cell(cells, t.L.date), memo: cell(cells, t.L.memo), rows: [], why: '' });
      const g = groups[groups.length - 1];
      const d = cell(cells, t.L.debit), c = cell(cells, t.L.credit);
      const dr = d === '' ? 0 : moneyOf(d), cr = c === '' ? 0 : moneyOf(c);
      if (dr === null || cr === null) g.why = g.why || 'line ' + (i + 1) + ': an amount is not an amount of money';
      g.rows.push([cell(cells, t.L.code).padStart(4, '0'), dr, cr]);
    }
    const entries = [], rejected = [];
    let lines = 0, debit = 0;
    for (const g of groups) {
      const entry = { id: g.id, date: dateOf(g.date), memo: clean(g.memo, 200), lines: g.rows };
      const v = g.why ? { ok: false } : validEntry(entry);
      if (!v.ok) { rejected.push({ line: g.line, why: g.why || reasonFor(v) }); continue; }
      entries.push(entry);
      lines += v.lines.length; debit += v.total;
    }
    const totals = { entries: entries.length, lines, debit, credit: debit };
    return entries.length ? { ok: true, why: 'read', format: 'sage', entries, rejected, totals } : no('not one journal could be read', { format: 'sage', entries, rejected, totals });
  } catch {
    return no('this file could not be read as a Sage journal import', { format: 'sage', entries: [], rejected: [], totals: zero });
  }
}

/** CRM records → the same crm.csv the company's own export writes (exportco.companyCsvs): id, name, contact, stage,
 *  value in pounds, owner, then any other field — for any CRM's own import. → { ok, text, rows, totals: { count, value } } */
export function crmToCsv(records) {
  try {
    if (!Array.isArray(records) || tooMany(records.length)) return no('there are no records to write', { text: '', rows: 0, totals: { count: 0, value: 0 } });
    const list = records.filter(plain);
    const out = companyCsvs({ list: (c) => (c === 'crm' ? list : []) });
    const file = out.ok ? out.files.find((f) => f.name === 'crm.csv') : null;
    if (!file) return no('the records could not be written', { text: '', rows: 0, totals: { count: 0, value: 0 } });
    const value = list.reduce((s, r) => s + (Number.isSafeInteger(r.value) ? r.value : 0), 0);
    return { ok: true, why: 'written', text: file.text, rows: file.rows, totals: { count: list.length, value } };
  } catch {
    return no('the records could not be written', { text: '', rows: 0, totals: { count: 0, value: 0 } });
  }
}

// ── the receipt of one bridge ───────────────────────────────────────────────────────────────────────────────────────
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
/**
 * What came in and what came out, so a later planting (or an auditor) can check the same file gives the same result:
 * { ok, kind, inputHash (SHA-256 of the file's text), rows, rejected, totals, outputHash (SHA-256 of the result's
 * canonical form) }. rows counts the result's rows / records / entries (or a writer's lines written).
 */
export function bridgeReceipt(input) {
  try {
    const { kind, inputText, result } = input || {};
    if (typeof kind !== 'string' || !KIND.test(kind)) return no('name the kind of file (a short word such as bank, crm or trial-balance)');
    if (typeof inputText !== 'string') return no('the file’s text is needed to fingerprint it');
    if (!plain(result)) return no('there is no result to make a receipt of');
    const list = [result.rows, result.records, result.entries].find(Array.isArray) ?? [];
    const rows = Number.isSafeInteger(result.rows) ? result.rows : list.length;
    const rejected = Array.isArray(result.rejected) ? result.rejected.length : 0;
    const totals = plain(result.totals) ? JSON.parse(canonical(result.totals)) : {};
    return { ok: true, kind, inputHash: sha256(inputText), rows, rejected, totals, outputHash: sha256(canonical(result)) };
  } catch {
    return no('this result cannot be fingerprinted (it holds something other than text, whole numbers, lists and records)');
  }
}
