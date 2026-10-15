// bridge.test.mjs — the bridges to the systems a business already has. Every fixture below is SYNTHETIC: written for
// these tests, in the shapes UK bank, CRM and accounting exports take — no real account, person, client or business.
// Every expected number is worked out by hand in the comments beside it, never taken from the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as B from '../src/bridge.mjs';
import { moneyOf, dateOf, parseBankCsv, bankToJournal, parseCrmCsv, parseTrialBalance, journalToCsv, parseJournalCsv, crmToCsv, bridgeReceipt, DEFAULT_RULES } from '../src/bridge.mjs';
import { CHART, validEntry, parseLines, trialBalance, balanceSheet, profitAndLoss } from '../src/books.mjs';
import { canonical } from '../src/canon.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { createCompany } from '../src/runtime.mjs';
import { vaultOf, checkpoint, proofBundle, verifyProofBundle } from '../src/audit.mjs';

const hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const label = (x) => { try { return String(x); } catch { return 'a value whose toString throws'; } };

// ── SYNTHETIC statement A: paid in / paid out / balance, three lines of account details above the header, pound signs,
//    thousands commas, a quoted description holding a comma, oldest first. Opens at £5,000.00 (the trial balance's bank). ──
const STATEMENT_A = [
  'Account name,Synthetic Trading Ltd (synthetic - no real account)',            // 1
  'Account number,00000000',                                                     // 2
  '"Statement period","01/10/2026 to 31/10/2026"',                               // 3
  'Date,Description,Paid in,Paid out,Balance',                                   // 4  the header
  '01/10/2026,TRANSFER FROM SAVINGS,"£2,000.00",,"£7,000.00"',                   // 5  5000 + 2000
  '02/10/2026,"RENT, UNIT 4 OCTOBER",,£750.00,"£6,250.00"',                      // 6  7000 − 750
  '05/10/2026,CUSTOMER C1042 INV 3311,£480.00,,"£6,730.00"',                     // 7  6250 + 480
  '06/10/2026,ELECTRICITY DD,,£96.12,"£6,633.88"',                               // 8  6730 − 96.12
  '09/10/2026,SOFTWARE SUBSCRIPTION,,£29.99,"£6,603.89"',                        // 9  6633.88 − 29.99
  '31/09/2026,THIRTY-FIRST OF SEPTEMBER,,£1.00,"£6,603.89"',                     // 10 rejected: September has 30 days
  '12/10/2026,IN AND OUT AT ONCE,£5.00,£5.00,"£6,603.89"',                       // 11 rejected: both columns
  '15/10/2026,SALARIES OCTOBER,,"£1,200.00","£5,403.89"',                        // 12 6603.89 − 1200
  '20/10/2026,CUSTOMER C2077 INV 3312,"£1,045.50",,"£6,449.39"',                 // 13 5403.89 + 1045.50
  '31/10/2026,BANK CHARGES,,£8.50,"£6,440.89"',                                  // 14 6449.39 − 8.50
  ',,,,',                                                                        // 15 an empty row: skipped, not rejected
].join('\n') + '\n';
const ROWS_A = [
  { date: '2026-10-01', desc: 'TRANSFER FROM SAVINGS', pence: 200000, balance: 700000, line: 5 },
  { date: '2026-10-02', desc: 'RENT, UNIT 4 OCTOBER', pence: -75000, balance: 625000, line: 6 },
  { date: '2026-10-05', desc: 'CUSTOMER C1042 INV 3311', pence: 48000, balance: 673000, line: 7 },
  { date: '2026-10-06', desc: 'ELECTRICITY DD', pence: -9612, balance: 663388, line: 8 },
  { date: '2026-10-09', desc: 'SOFTWARE SUBSCRIPTION', pence: -2999, balance: 660389, line: 9 },
  { date: '2026-10-15', desc: 'SALARIES OCTOBER', pence: -120000, balance: 540389, line: 12 },
  { date: '2026-10-20', desc: 'CUSTOMER C2077 INV 3312', pence: 104550, balance: 644939, line: 13 },
  { date: '2026-10-31', desc: 'BANK CHARGES', pence: -850, balance: 644089, line: 14 },
];
// in: 2000.00 + 480.00 + 1045.50 = 3525.50 · out: 750 + 96.12 + 29.99 + 1200 + 8.50 = 2084.61 · net 1440.89
const TOTALS_A = { count: 8, moneyIn: 352550, moneyOut: 208461, net: 144089 };

// ── SYNTHETIC statement B: one signed Amount column, a Type column, newest first, an amount in brackets. ──
const STATEMENT_B = [
  'Date,Type,Description,Amount,Balance',
  '30/10/2026,DD,ELECTRIC SUPPLY CO SYNTHETIC,-64.20,"2,371.30"',     // 2435.50 − 64.20
  '28/10/2026,FPI,CUSTOMER C3001 PAYMENT,"1,250.00","2,435.50"',      // 1185.50 + 1250
  '21/10/2026,DEB,STATIONERY SUPPLIER A,(14.50),"1,185.50"',          // 1200 − 14.50
  '14/10/2026,SO,RENT UNIT 9,-600.00,"1,200.00"',                     // 1800 − 600
  '01/10/2026,BGC,INTEREST,1.75,"1,800.00"',                          // opened at 1798.25
].join('\r\n');
// in: 1.75 + 1250.00 = 1251.75 · out: 64.20 + 14.50 + 600.00 = 678.70 · net 573.05; opening 1798.25, closing 2371.30
const TOTALS_B = { count: 5, moneyIn: 125175, moneyOut: 67870, net: 57305 };

// ── SYNTHETIC statement C: a bank's Debit / Credit columns, "1 Oct 2026" dates, a byte-order mark, CRLF. ──
const STATEMENT_C = '﻿Transaction Date,Transaction Description,Debit Amount,Credit Amount,Balance\r\n' +
  '01 Oct 2026,BALANCE BROUGHT FORWARD,,,500.00\r\n' +                 // 2 rejected: no money moved
  '02 Oct 2026,CARD PAYMENT OFFICE SUPPLIES,23.40,,476.60\r\n' +       // 3
  '03 Oct 2026,PAYROLL OCT,300.00,,176.60\r\n' +                       // 4
  '04 Oct 2026,HMRC PAYE,50.00,,126.60\r\n' +                          // 5
  '05 Oct 2026,CUSTOMER C5005,,"1,000.00","1,126.60"\r\n';             // 6
// in 1000.00 · out 23.40 + 300 + 50 = 373.40 · net 626.60; opening 500.00

// ── SYNTHETIC statement D: amount only, no balance, year-month-day dates, a Unicode minus sign. ──
const STATEMENT_D = 'Date,Description,Amount\n2026-10-03,CUSTOMER C9 REFUND,−20.00\n2026-10-04,WAGES,−1500\n2026-10-05,SALES RECEIPT,250.5\n';

// ── SYNTHETIC trial balance at 30 September 2026, as an accounting package exports it (N/C, Name, Debit, Credit). ──
const TRIAL = [
  'N/C,Name,Debit,Credit',
  '1200,Bank current account,"5,000.00",',
  '30,Office equipment,"2,400.00",',                 // a spreadsheet dropped the leading zeros of 0030
  '1100,Trade debtors,"1,600.00",',
  '2100,Trade creditors,,"1,250.00"',
  '2200,VAT on sales,,350.00',
  '3000,Share capital,,"6,000.00"',
  '3200,Retained earnings,,"1,400.00"',
  ',Totals:,"9,000.00","9,000.00"',                   // 5000 + 2400 + 1600 = 9000 = 1250 + 350 + 6000 + 1400
].join('\n');
const OPENING = [['0030', 240000, 0], ['1100', 160000, 0], ['1200', 500000, 0], ['2100', 0, 125000], ['2200', 0, 35000], ['3000', 0, 600000], ['3200', 0, 140000]];

// ── SYNTHETIC CRM deals export (the names are placeholders; addresses are on the reserved example domains). ──
const DEALS = [
  'Deal Name,Contact Name,Email,Deal Stage,Amount,Deal Owner',
  'Client Alpha (synthetic),Contact A,contact.a@example.com,Appointment scheduled,"£1,200.00",Owner One',   // 2
  'Client Bravo (synthetic),Contact B,contact.b@example.com,Qualified to buy,950,Owner Two',                 // 3
  'Client Charlie (synthetic),,contact.c@example.org,Contract sent,"12,500.50",',                           // 4
  'Client Delta (synthetic),Contact D,,Closed won,300.00,Owner One',                                        // 5
  'Client Echo (synthetic),Contact E,,Closed lost,0,Owner Two',                                             // 6
  'Client Foxtrot (synthetic),Contact F,,On hold,100,Owner One',                                            // 7 rejected
  ',,,Closed won,50,',                                                                                      // 8 rejected
  'Client Golf (synthetic),Contact G,,,-20.00,',                                                            // 9 rejected
  'Client Hotel (synthetic),Contact H,,,ten pounds,',                                                       // 10 rejected
  'Client India (synthetic),Contact I,,,,',                                                                 // 11
].join('\n');
const DEAL_RECORDS = [
  { name: 'Client Alpha (synthetic)', contact: 'Contact A', stage: 'lead', value: 120000, owner: 'Owner One' },
  { name: 'Client Bravo (synthetic)', contact: 'Contact B', stage: 'qualified', value: 95000, owner: 'Owner Two' },
  { name: 'Client Charlie (synthetic)', contact: 'contact.c@example.org', stage: 'proposal', value: 1250050, owner: 'Imported' },
  { name: 'Client Delta (synthetic)', contact: 'Contact D', stage: 'won', value: 30000, owner: 'Owner One' },
  { name: 'Client Echo (synthetic)', contact: 'Contact E', stage: 'lost', value: 0, owner: 'Owner Two' },
  { name: 'Client India (synthetic)', contact: 'Contact I', stage: 'lead', value: 0, owner: 'Imported' },
];

// ── money and dates ─────────────────────────────────────────────────────────────────────────────────────────────────
test('moneyOf: exact whole pence from every way a statement writes money — never a float', () => {
  const good = [
    ['12.34', 1234], ['12', 1200], ['12.3', 1230], ['0.05', 5], ['-12.34', -1234], ['+12.34', 1234], ['−12.34', -1234],
    ['£1,234.56', 123456], ['-£1,234.56', -123456], ['£-1,234.56', -123456], ['(1,234.56)', -123456], ['(£12.00)', -1200],
    ['GBP 10.00', 1000], [' £ 7.50 ', 750], ['1,000', 100000], ['99999999999.99', 9999999999999], ['99,999,999,999.99', 9999999999999],
    ['0.10', 10], ['1234567.89', 123456789], [12.5, 1250],
  ];
  for (const [s, p] of good) assert.equal(moneyOf(s), p, String(s));
  for (const bad of ['', '   ', 'abc', '12.345', '1,23', '12,34.00', '.5', '--1', '-£-1', '+-1', '(-1)', '(+1)', '(1', '1)', '(12.34', '12.34)', '£', '-', '()', '1.2.3', '12e3',
    'Infinity', '100000000000.00', '1,000,000,000,000', '1£', null, undefined, {}, [], { toString() { throw new Error('x'); } }]) assert.equal(moneyOf(bad), null, label(bad));
  assert.ok(Object.is(moneyOf('-0.00'), 0) && Object.is(moneyOf('(0)'), 0), 'a minus zero is plain 0');
});

test('dateOf: day-first UK dates, year-month-day, "1 Oct 2026"; a day that does not exist is refused', () => {
  const good = [['01/10/2026', '2026-10-01'], ['1/2/2026', '2026-02-01'], ['10/01/2026', '2026-01-10'], ['01-10-2026', '2026-10-01'], ['01.10.2026', '2026-10-01'],
    ['31/12/2026', '2026-12-31'], ['01/10/26', '2026-10-01'], ['2026-10-01', '2026-10-01'], ['2026-10-01T09:15:00Z', '2026-10-01'], ['2026-10-01 09:15', '2026-10-01'],
    ['01/10/2026 09:15', '2026-10-01'], ['1 Oct 2026', '2026-10-01'], ['01-Oct-2026', '2026-10-01'], ['1 October 26', '2026-10-01'], ['5 dec 2025', '2025-12-05'],
    ['29/02/2024', '2024-02-29'], ['2000-02-29', '2000-02-29'], ['  15/06/2026  ', '2026-06-15'], ['31 Jan 1999', '1999-01-31']];
  for (const [s, d] of good) assert.equal(dateOf(s), d, s);
  for (const bad of ['29/02/2026', '31/04/2026', '31/09/2026', '00/10/2026', '32/01/2026', '01/13/2026', '01/00/2026', '2026-13-01', '2026-02-30', '2100-02-29',
    '1 Foo 2026', '1899-12-31', '2100-01-01', '2026/10/01', '20261001', '1/10', '', 'yesterday', null, undefined, { toString() { throw new Error('x'); } }]) assert.equal(dateOf(bad), '', label(bad));
});

// ── bank statements in ──────────────────────────────────────────────────────────────────────────────────────────────
test('statement A (paid in / paid out / balance): every row read exactly, the bad ones refused with the reason', () => {
  const r = parseBankCsv(STATEMENT_A);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'paid-in-out');
  assert.deepEqual(r.rows, ROWS_A);
  assert.deepEqual(r.rejected, [
    { line: 10, why: 'the date “31/09/2026” is not a date (day/month/year or year-month-day)', text: '31/09/2026,THIRTY-FIRST OF SEPTEMBER,,£1.00,£6,603.89' },
    { line: 11, why: 'money both in and out on one row', text: '12/10/2026,IN AND OUT AT ONCE,£5.00,£5.00,£6,603.89' },
  ]);
  assert.deepEqual(r.totals, TOTALS_A);
});

test('statement B (one signed amount, newest first) and C (debit / credit, named months, BOM, CRLF), D (no balance)', () => {
  const b = parseBankCsv(STATEMENT_B);
  assert.equal(b.format, 'amount');
  assert.deepEqual(b.rows.map((x) => [x.date, x.pence, x.balance, x.line]), [['2026-10-30', -6420, 237130, 2], ['2026-10-28', 125000, 243550, 3],
    ['2026-10-21', -1450, 118550, 4], ['2026-10-14', -60000, 120000, 5], ['2026-10-01', 175, 180000, 6]]);
  assert.deepEqual(b.totals, TOTALS_B);
  const c = parseBankCsv(STATEMENT_C);
  assert.equal(c.format, 'debit-credit');
  assert.deepEqual(c.rows.map((x) => [x.date, x.desc, x.pence, x.balance]), [['2026-10-02', 'CARD PAYMENT OFFICE SUPPLIES', -2340, 47660],
    ['2026-10-03', 'PAYROLL OCT', -30000, 17660], ['2026-10-04', 'HMRC PAYE', -5000, 12660], ['2026-10-05', 'CUSTOMER C5005', 100000, 112660]]);
  assert.deepEqual(c.rejected.map((x) => [x.line, x.why]), [[2, 'no money moved on this row']]);
  assert.deepEqual(c.totals, { count: 4, moneyIn: 100000, moneyOut: 37340, net: 62660 });
  const d = parseBankCsv(STATEMENT_D);
  assert.deepEqual(d.rows, [{ date: '2026-10-03', desc: 'CUSTOMER C9 REFUND', pence: -2000, line: 2 }, { date: '2026-10-04', desc: 'WAGES', pence: -150000, line: 3 },
    { date: '2026-10-05', desc: 'SALES RECEIPT', pence: 25050, line: 4 }]);
  assert.ok(d.rows.every((x) => !('balance' in x)), 'no balance column, no balance');
});

test('statement rows: each fault refused alone, with its own reason', () => {
  const io = (cells) => parseBankCsv('Date,Description,Money in,Money out,Running balance\n01/10/2026,OK,1.00,,1.00\n' + cells + '\n');
  const why = (cells) => io(cells).rejected.map((x) => x.why);
  assert.deepEqual(why('02/10/2026,X,abc,,'), ['the money in, “abc”, is not an amount of money']);
  assert.deepEqual(why('02/10/2026,X,,1.2.3,'), ['the money out, “1.2.3”, is not an amount of money']);
  assert.deepEqual(why('02/10/2026,X,-5.00,,'), ['a negative amount in the money-in column']);
  assert.deepEqual(why('02/10/2026,X,,,'), ['no money moved on this row']);
  assert.deepEqual(why('02/10/2026,X,0.00,0.00,'), ['no money moved on this row']);
  assert.deepEqual(why('02/10/2026,X,,2.00,zz'), ['the balance “zz” is not an amount of money']);
  assert.deepEqual(why('2026-02-30,X,1.00,,'), ['the date “2026-02-30” is not a date (day/month/year or year-month-day)']);
  assert.deepEqual(why('02/10/2026'), ['no money moved on this row'], 'a short row reads its missing cells as blank');
  // money out written as a negative number (some banks) still reads as money out; a blank balance is no balance
  assert.deepEqual(io('02/10/2026,X,,-2.00,').rows[1], { date: '2026-10-02', desc: 'X', pence: -200, line: 3 });
  assert.deepEqual(io('02/10/2026,,3.00,,4.00').rows[1], { date: '2026-10-02', desc: '(no description)', pence: 300, balance: 400, line: 3 });
  const amt = parseBankCsv('Date,Amount\n01/10/2026,1.00\n02/10/2026,12.345\n');
  assert.deepEqual(amt.rejected, [{ line: 3, why: 'the amount “12.345” is not an amount of money', text: '02/10/2026,12.345' }]);
  // a description is cleaned: control and invisible characters out, whitespace collapsed, at most 200 characters
  const long = parseBankCsv('Date,Amount,Description\n01/10/2026,1,"A\u0007B​C   D\tE"\n02/10/2026,1,' + 'x'.repeat(300) + '\n');
  assert.equal(long.rows[0].desc, 'A B C D E');
  assert.equal(long.rows[1].desc.length, 200);
});

test('a file that is not a statement is refused in plain words; the header may sit below account details', () => {
  assert.equal(parseBankCsv('').why, 'the file is empty');
  assert.equal(parseBankCsv(' \n \n').why, 'the file is empty');
  assert.equal(parseBankCsv(42).why, 'the file is empty');
  const notBank = parseBankCsv('Name,Email\nA,b@example.com\n');
  assert.equal(notBank.ok, false);
  assert.match(notBank.why, /^no row in it reads as the header of a bank statement/);
  assert.deepEqual([notBank.rows, notBank.rejected, notBank.totals], [[], [], { count: 0, moneyIn: 0, moneyOut: 0, net: 0 }]);
  assert.equal(parseBankCsv('Date,Description\n01/10/2026,X\n').ok, false, 'a date but no money column');
  assert.equal(parseBankCsv('Description,Amount\nX,1.00\n').ok, false, 'money but no date column');
  assert.equal(parseBankCsv('Date,Paid in\n01/10/2026,1.00\n').ok, false, 'paid in alone is half a pair');
  assert.equal(parseBankCsv('Date,Debit\n01/10/2026,1.00\n').ok, false, 'debit alone is half a pair');
  // the header is looked for in the first HEAD_SCAN rows only
  const after = (n) => parseBankCsv('Statement line\n'.repeat(n) + 'Date,Amount\n01/10/2026,1.00\n');
  assert.equal(after(B.HEAD_SCAN - 1).ok, true);
  assert.equal(after(B.HEAD_SCAN - 1).rows[0].line, B.HEAD_SCAN + 1);
  assert.equal(after(B.HEAD_SCAN).ok, false);
  // the columns may come in any order — money first included
  const first = parseBankCsv('Paid out,Paid in,Date,Description\n2.00,,01/10/2026,A\n,3.00,02/10/2026,B\n');
  assert.deepEqual([first.format, first.rows.map((x) => [x.desc, x.pence])], ['paid-in-out', [['A', -200], ['B', 300]]]);
  assert.deepEqual([parseBankCsv('Credit,Debit,Date\n,2.00,01/10/2026\n').format, parseBankCsv('Credit,Debit,Date\n,2.00,01/10/2026\n').rows[0].pence], ['debit-credit', -200]);
  assert.deepEqual([parseBankCsv('Amount,Date\n-2.00,01/10/2026\n').format, parseBankCsv('Amount,Date\n-2.00,01/10/2026\n').rows[0].pence], ['amount', -200]);
  // a header and nothing readable under it
  const none = parseBankCsv('Date,Amount\nnot a date,1.00\n');
  assert.deepEqual([none.ok, none.why, none.format, none.rejected.length], [false, 'not one row could be read as a payment in or out', 'amount', 1]);
});

test('size limits: the largest file and the most rows a bridge reads', () => {
  const rows = (n) => 'x\n'.repeat(n);
  assert.match(parseBankCsv(rows(B.MAX_ROWS)).why, /^no row in it reads/, 'exactly MAX_ROWS rows are read');
  assert.equal(parseBankCsv(rows(B.MAX_ROWS + 1)).why, 'the file has more than 50000 rows — split it and bring it in a part at a time');
  assert.equal(parseBankCsv(' '.repeat(B.MAX_TEXT)).why, 'the file is empty', 'exactly MAX_TEXT characters are read (and found empty)');
  assert.equal(parseBankCsv(' '.repeat(B.MAX_TEXT + 1)).why, 'the file is too large to read here (over 8 MB)');
});

// ── statement → journal ─────────────────────────────────────────────────────────────────────────────────────────────
test('statement A → journal: the bank against the rule’s nominal, the rest to suspense; every entry books-valid', () => {
  const j = bankToJournal(parseBankCsv(STATEMENT_A).rows);
  assert.equal(j.ok, true);
  assert.deepEqual(j.entries, [
    { date: '2026-10-01', memo: 'TRANSFER FROM SAVINGS', lines: [['1200', 200000, 0], ['9998', 0, 200000]] },
    { date: '2026-10-02', memo: 'RENT, UNIT 4 OCTOBER', lines: [['1200', 0, 75000], ['7100', 75000, 0]] },
    { date: '2026-10-05', memo: 'CUSTOMER C1042 INV 3311', lines: [['1200', 48000, 0], ['9998', 0, 48000]] },
    { date: '2026-10-06', memo: 'ELECTRICITY DD', lines: [['1200', 0, 9612], ['7200', 9612, 0]] },
    { date: '2026-10-09', memo: 'SOFTWARE SUBSCRIPTION', lines: [['1200', 0, 2999], ['7500', 2999, 0]] },
    { date: '2026-10-15', memo: 'SALARIES OCTOBER', lines: [['1200', 0, 120000], ['7000', 120000, 0]] },
    { date: '2026-10-20', memo: 'CUSTOMER C2077 INV 3312', lines: [['1200', 104550, 0], ['9998', 0, 104550]] },
    { date: '2026-10-31', memo: 'BANK CHARGES', lines: [['1200', 0, 850], ['7900', 850, 0]] },
  ]);
  for (const e of j.entries) assert.equal(validEntry(e).ok, true);
  assert.deepEqual(j.suspense, [
    { index: 0, line: 5, entry: 0, date: '2026-10-01', desc: 'TRANSFER FROM SAVINGS', pence: 200000 },
    { index: 2, line: 7, entry: 2, date: '2026-10-05', desc: 'CUSTOMER C1042 INV 3311', pence: 48000 },
    { index: 6, line: 13, entry: 6, date: '2026-10-20', desc: 'CUSTOMER C2077 INV 3312', pence: 104550 },
  ]);
  assert.deepEqual(j.rejected, []);
  assert.deepEqual(j.rules, { used: 12, ignored: 0 });
  assert.deepEqual(j.totals, { ...TOTALS_A, suspense: 3 });
  // reconciled to the penny: money in, out and net; every running balance; opening + net = closing
  assert.deepEqual(j.reconciliation, { ...TOTALS_A, balances: { ok: true, order: 'oldest-first', checked: 7, opening: 500000, closing: 644089, movement: 144089, mismatches: [] } });
  assert.equal(j.why, 'posted 8 of 8 rows');
});

test('statement B (newest first) and C reconcile; D has no balances to check', () => {
  const b = bankToJournal(parseBankCsv(STATEMENT_B).rows);
  assert.deepEqual(b.reconciliation, { ...TOTALS_B, balances: { ok: true, order: 'newest-first', checked: 4, opening: 179825, closing: 237130, movement: 57305, mismatches: [] } });
  assert.deepEqual(b.entries.map((e) => e.lines[1][0]), ['7200', '9998', '9998', '7100', '4900']);   // electric · ? · ? · rent · interest (in)
  const c = bankToJournal(parseBankCsv(STATEMENT_C).rows);
  assert.deepEqual(c.entries.map((e) => e.lines[1][0]), ['9998', '7000', '2210', '9998']);
  assert.deepEqual(c.reconciliation.balances, { ok: true, order: 'oldest-first', checked: 3, opening: 50000, closing: 112660, movement: 62660, mismatches: [] });
  const d = bankToJournal(parseBankCsv(STATEMENT_D).rows);
  assert.equal(d.reconciliation.balances, null);
  assert.deepEqual(d.entries.map((e) => e.lines), [[['1200', 0, 2000], ['9998', 2000, 0]], [['1200', 0, 150000], ['7000', 150000, 0]], [['1200', 25050, 0], ['9998', 0, 25050]]]);
});

test('running balances: a wrong balance is found and named; partial balances are not checked; one row; a tie', () => {
  const r = (date, pence, balance, line) => ({ date, desc: 'X', pence, balance, line });
  // the third balance is a typo (should be 1300): the two checks that touch it fail; the books still post
  const typo = bankToJournal([r('2026-10-01', 1000, 1000, 2), r('2026-10-02', 200, 1200, 3), r('2026-10-03', 100, 1301, 4), r('2026-10-04', 50, 1350, 5)]);
  assert.equal(typo.ok, true);
  assert.deepEqual(typo.reconciliation.balances, { ok: false, order: 'oldest-first', checked: 3, opening: 0, closing: 1350, movement: 1350,
    mismatches: [{ index: 2, line: 4, expected: 1300, found: 1301 }, { index: 3, line: 5, expected: 1351, found: 1350 }] });
  // newest first, with the 2 October row (−30.00) missing between lines 3 and 5: the gap is found, at line 3
  const gap = bankToJournal([r('2026-10-04', 10, 930, 2), r('2026-10-03', -50, 920, 3), r('2026-10-01', 100, 1000, 5)]);
  assert.deepEqual(gap.reconciliation.balances, { ok: false, order: 'newest-first', checked: 2, opening: 900, closing: 930, movement: 30,
    mismatches: [{ index: 1, line: 3, expected: 950, found: 920 }] });
  // a single row: nothing to compare, read in file order
  assert.deepEqual(bankToJournal([r('2026-10-01', 500, 1500)]).reconciliation.balances, { ok: true, order: 'oldest-first', checked: 0, opening: 1000, closing: 1500, movement: 500, mismatches: [] });
  // balances that agree with neither order equally: the dates decide (descending → newest first)
  assert.equal(bankToJournal([r('2026-10-02', 10, 5), r('2026-10-01', 10, 99)]).reconciliation.balances.order, 'newest-first');
  assert.equal(bankToJournal([r('2026-10-01', 10, 5), r('2026-10-02', 10, 99)]).reconciliation.balances.order, 'oldest-first');
  // balances that agree read in file order win over dates that run backwards
  const fwd = bankToJournal([r('2026-10-09', 10, 110), r('2026-10-01', 20, 130)]).reconciliation.balances;
  assert.deepEqual([fwd.order, fwd.ok, fwd.opening], ['oldest-first', true, 100]);
  // only some rows carry a balance
  const part = bankToJournal([r('2026-10-01', 10, 10), { date: '2026-10-02', desc: 'Y', pence: 5 }]).reconciliation.balances;
  assert.deepEqual(part, { ok: false, why: '1 of the 2 rows carry a running balance, so the balances were not checked' });
});

test('rules: whole words, either direction or one, first match wins; malformed rules ignored and counted', () => {
  const rows = [
    { date: '2026-10-01', desc: 'CURRENT ACCOUNT TRANSFER', pence: -100 },      // "rent" inside "current" is not the word rent
    { date: '2026-10-02', desc: 'Rent Unit 4', pence: -200 },
    { date: '2026-10-03', desc: 'REFUND FROM SUPPLIER', pence: 300 },
    { date: '2026-10-04', desc: 'REFUND TO CUSTOMER', pence: -400 },
    { date: '2026-10-05', desc: 'unit 4 rent', pence: -500 },
  ];
  const rules = [{ contains: 'RENT', code: '7100' }, { contains: 'refund', code: '5000', dir: 'in' }, { contains: 'refund', code: '4000', dir: 'out' }, { contains: 'unit 4', code: '0030' }];
  const j = bankToJournal(rows, rules);
  assert.deepEqual(j.entries.map((e) => e.lines[1][0]), ['9998', '7100', '5000', '4000', '7100']);
  assert.deepEqual(j.suspense.map((s) => s.index), [0]);
  assert.deepEqual(j.rules, { used: 4, ignored: 0 });
  const junk = [null, 7, { contains: 7, code: '7100' }, { contains: '!!!', code: '7100' }, { contains: 'x', code: '9999' }, { contains: 'x', code: '1200' },
    { contains: 'x', code: '7100', dir: 'sideways' }, { contains: 'x', code: '7100', dir: 'toString' }, { get contains() { throw new Error('x'); } },
    { contains: 'rent', code: '7100', dir: 'out' }];
  const k = bankToJournal(rows, junk);
  assert.deepEqual(k.rules, { used: 1, ignored: 9 });
  assert.deepEqual(k.entries.map((e) => e.lines[1][0]), ['9998', '7100', '9998', '9998', '7100']);
  assert.deepEqual(bankToJournal(rows, []).entries.map((e) => e.lines[1][0]), ['9998', '9998', '9998', '9998', '9998'], 'no rules: everything waits for a person');
  assert.deepEqual(bankToJournal(rows).rules, { used: DEFAULT_RULES.length, ignored: 0 }, 'no rules given: the starting rules');
  assert.deepEqual(bankToJournal(rows, Array(B.MAX_RULES + 5).fill({ contains: 'rent', code: '7100' })).rules, { used: 200, ignored: 0 }, 'at most MAX_RULES are read');
});

test('bankToJournal refuses what is not a statement row, row by row; the rest still post', () => {
  const ok = { date: '2026-10-01', desc: 'FINE', pence: 100, line: 2 };
  const j = bankToJournal([ok, { date: '2026-02-30', pence: 100, line: 3 }, { date: '2026-10-01', pence: '100' }, { date: '2026-10-01', pence: 1.5 },
    { date: '2026-10-01', pence: 0 }, { date: '2026-10-01', pence: 1e14 }, null, { get pence() { throw new Error('x'); } }, { date: '01/10/2026', pence: -7, desc: '  ' }]);
  assert.deepEqual(j.rejected, [
    { index: 1, line: 3, why: 'the date is not a date' },
    { index: 2, line: null, why: 'the amount is not a whole number of pence within range' },
    { index: 3, line: null, why: 'the amount is not a whole number of pence within range' },
    { index: 4, line: null, why: 'no money moved on this row' },
    { index: 5, line: null, why: 'the amount is not a whole number of pence within range' },
    { index: 6, line: null, why: 'the row could not be read' },
    { index: 7, line: null, why: 'the row could not be read' },
  ]);
  assert.deepEqual(j.entries, [{ date: '2026-10-01', memo: 'FINE', lines: [['1200', 100, 0], ['9998', 0, 100]] }, { date: '2026-10-01', memo: '(no description)', lines: [['1200', 0, 7], ['9998', 7, 0]] }]);
  assert.deepEqual(j.totals, { count: 2, moneyIn: 100, moneyOut: 7, net: 93, suspense: 2 });
  assert.equal(j.why, 'posted 2 of 9 rows');
  const none = bankToJournal([{ date: 'x', pence: 1 }]);
  assert.deepEqual([none.ok, none.why, none.rejected.length, none.entries], [false, 'not one row became an entry', 1, []]);
  for (const bad of [undefined, null, 'rows', {}, []]) {
    const r = bankToJournal(bad);
    assert.deepEqual([r.ok, r.why, r.entries, r.reconciliation.balances], [false, 'there are no statement rows to post', [], null], String(bad));
  }
  assert.equal(bankToJournal(Array(B.MAX_ROWS + 1).fill({ date: '2026-10-01', desc: 'X', pence: 1 })).why, 'more than 50000 rows — post them a part at a time');
});

test('the suspense account: on the chart, on the balance sheet — profit untouched while a line waits', () => {
  assert.deepEqual(CHART[B.SUSPENSE], ['Suspense (to be classified)', 'liability']);
  assert.equal(B.SUSPENSE, '9998');
  assert.equal(B.BANK, '1200');
  const e = [{ id: 's', date: '2026-10-01', lines: [['1200', 0, 5000], ['9998', 5000, 0]] }];
  assert.deepEqual(profitAndLoss(e), { income: 0, expense: 0, profit: 0 });
  assert.equal(balanceSheet(e).balanced, true);
});

// ── customer lists in and out ───────────────────────────────────────────────────────────────────────────────────────
test('a CRM deals export → records in exactly the page’s CRM fields; the rest refused with the reason', () => {
  const r = parseCrmCsv(DEALS);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'crm');
  assert.deepEqual(r.records, DEAL_RECORDS);
  for (const rec of r.records) assert.deepEqual(Object.keys(rec), ['name', 'contact', 'stage', 'value', 'owner']);
  assert.deepEqual(r.rejected.map((x) => [x.line, x.why]), [
    [7, 'the stage “On hold” is not one of lead, qualified, proposal, won, lost (or a usual name for one)'],
    [8, 'no name and no contact'],
    [9, 'a negative deal value'],
    [10, 'the value “ten pounds” is not an amount of money'],
  ]);
  assert.equal(r.rejected[0].text, 'Client Foxtrot (synthetic),Contact F,,On hold,100,Owner One');
  assert.deepEqual(r.totals, { count: 6, value: 1495050 });   // 1200 + 950 + 12500.50 + 300 = 14950.50
});

test('a contacts export: name from the company, contact from first and last name, the stage from lead status', () => {
  const r = parseCrmCsv('First Name,Last Name,Email,Company,Lead Status\nAna,Example,ana@example.com,Example Org One,New\n,,solo@example.com,,Unqualified\nBo,,,,Sales Qualified Lead\n');
  assert.deepEqual(r.records, [
    { name: 'Example Org One', contact: 'Ana Example', stage: 'lead', value: 0, owner: 'Imported' },
    { name: 'solo@example.com', contact: 'solo@example.com', stage: 'lost', value: 0, owner: 'Imported' },
    { name: 'Bo', contact: 'Bo', stage: 'qualified', value: 0, owner: 'Imported' },
  ]);
  // every stage name, read
  const st = (s) => parseCrmCsv('Name,Stage\nX,' + s + '\n').records[0]?.stage;
  for (const [said, stage] of [['Lead', 'lead'], ['prospect', 'lead'], ['QUALIFIED', 'qualified'], ['Proposal Sent', 'proposal'], ['quote', 'proposal'], ['Negotiation', 'proposal'],
    ['Won', 'won'], ['closed-won', 'won'], ['Customer', 'won'], ['Lost', 'lost'], ['Closed Lost', 'lost'], ['dead', 'lost']]) assert.equal(st(said), stage, said);
  assert.equal(st('Closed'), undefined, 'closed alone could be won or lost: refused, not guessed');
  // the page's limits: 120 characters a field
  const long = parseCrmCsv('Company,Contact,Owner\n' + 'n'.repeat(150) + ',' + 'c'.repeat(150) + ',' + 'o'.repeat(150) + '\n').records[0];
  assert.deepEqual([long.name.length, long.contact.length, long.owner.length], [120, 120, 120]);
  assert.equal(parseCrmCsv('Stage,Value\nwon,1\n').ok, false, 'no name, company or contact column: not a customer list');
  assert.equal(parseCrmCsv('Company\n,\n').why, 'not one row could be read as a customer');
  assert.equal(parseCrmCsv(null).why, 'the file is empty');
});

test('CRM out and back: crmToCsv writes the company’s own crm.csv; it reads back to the same records', () => {
  const out = crmToCsv(DEAL_RECORDS);
  assert.equal(out.ok, true);
  assert.equal(out.text.split('\r\n')[0], 'id,name,contact,stage,value_gbp,owner');
  assert.equal(out.text.split('\r\n')[3], ',Client Charlie (synthetic),contact.c@example.org,proposal,12500.50,Imported');
  assert.deepEqual([out.rows, out.totals], [6, { count: 6, value: 1495050 }]);
  assert.deepEqual(parseCrmCsv(out.text).records, DEAL_RECORDS);
  // a field a spreadsheet would run as a formula leaves defused (exportco's writer) — and comes back as text, defused
  const evil = crmToCsv([{ name: '=HYPERLINK("http://example.invalid")', contact: 'x', stage: 'lead', value: 0, owner: 'o' }]);
  assert.ok(evil.text.includes('"\'=HYPERLINK(""http://example.invalid"")"'));
  assert.equal(parseCrmCsv(evil.text).records[0].name, '\'=HYPERLINK("http://example.invalid")');
  assert.deepEqual(crmToCsv([null, 7, { name: 'A', value: 5 }, { name: 'B', value: 'x' }]).totals, { count: 2, value: 5 });
  assert.deepEqual([crmToCsv('x').ok, crmToCsv('x').why], [false, 'there are no records to write']);
  assert.equal(crmToCsv(Array(B.MAX_ROWS + 1).fill({})).why, 'there are no records to write');
  assert.equal(crmToCsv([{ get name() { throw new Error('x'); } }]).why, 'the records could not be written');
});

// ── a trial balance in ──────────────────────────────────────────────────────────────────────────────────────────────
test('trial balance → one opening entry that balances; codes Excel shortened padded back; the totals row checked', () => {
  const r = parseTrialBalance(TRIAL, { date: '30/09/2026' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.entry, { date: '2026-09-30', memo: 'Opening balances (trial balance)', lines: OPENING });
  assert.equal(validEntry(r.entry).ok, true);
  assert.deepEqual(r.totals, { debit: 900000, credit: 900000, difference: 0, accounts: 7 });
  assert.deepEqual(r.rows[1], { line: 3, code: '0030', name: 'Office equipment', debit: 240000, credit: 0 });
  assert.deepEqual(r.rejected, []);
  assert.equal(parseTrialBalance(TRIAL, { date: '2026-09-30', memo: 'Brought forward' }).entry.memo, 'Brought forward');
});

test('trial balance: a signed balance column; one code twice nets to one line; an account at nothing has no line', () => {
  const r = parseTrialBalance('Nominal Code,Account Name,Balance\n1200,Bank,1000.00\n1200,Bank (second line),-250.00\n7100,Rent,0\n3000,Capital,-750.00\n', { date: '2026-09-30' });
  assert.deepEqual(r.entry.lines, [['1200', 75000, 0], ['3000', 0, 75000]]);
  assert.deepEqual(r.totals, { debit: 100000, credit: 100000, difference: 0, accounts: 2 });   // 1000 = 250 + 750
  // each row keeps the file's own account name; a row without one is named from the chart
  assert.deepEqual(r.rows.map((x) => x.name), ['Bank', 'Bank (second line)', 'Rent', 'Capital']);
  assert.deepEqual(parseTrialBalance('Code,Name,Balance\n1200,,5\n3000,,-5\n', { date: '2026-09-30' }).rows.map((x) => x.name), ['Bank current account', 'Share capital']);
  // the columns may come in any order
  assert.deepEqual(parseTrialBalance('Debit,Credit,Code\n5.00,,1200\n,5.00,3000\n', { date: '2026-09-30' }).entry.lines, [['1200', 500, 0], ['3000', 0, 500]]);
  assert.deepEqual(parseTrialBalance('Balance,Code\n5.00,1200\n-5.00,3000\n', { date: '2026-09-30' }).entry.lines, [['1200', 500, 0], ['3000', 0, 500]]);
  // a balance-format totals row is a net, not two sides: it is skipped, not compared
  assert.equal(parseTrialBalance('Code,Balance\n1200,10\n3000,-10\nTotal,0.00\n', { date: '2026-09-30' }).ok, true);
});

test('trial balance refusals: by how much it does not balance, a code the chart lacks, a bad row, a lying totals row', () => {
  const off = parseTrialBalance('Code,Debit,Credit\n1200,100.00,\n3000,,90.00\n', { date: '2026-09-30' });
  assert.deepEqual([off.ok, off.why, off.totals], [false, 'the trial balance does not balance: debits £100.00, credits £90.00 — out by £10.00', { debit: 10000, credit: 9000, difference: 1000, accounts: 2 }]);
  const under = parseTrialBalance('Code,Debit,Credit\n1200,90.00,\n3000,,100.00\n', { date: '2026-09-30' });
  assert.deepEqual([under.why, under.totals.difference], ['the trial balance does not balance: debits £90.00, credits £100.00 — out by £10.00', -1000]);
  const unknown = parseTrialBalance('Code,Debit,Credit\n1200,100.00,\n4001,,100.00\n', { date: '2026-09-30' });
  assert.deepEqual([unknown.ok, unknown.why, unknown.entry], [false, '1 row could not be read — fix it and bring the file in again; an opening balance is all or nothing', null]);
  assert.deepEqual(unknown.rejected, [{ line: 3, why: 'nominal code 4001 is not in this company’s chart of accounts — map it to one of its codes first', text: '4001,,100.00' }]);
  const two = parseTrialBalance('Code,Debit,Credit\nBank,100.00,\n1200,abc,\n3000,,-5\n', { date: '2026-09-30' });
  assert.equal(two.why, '3 rows could not be read — fix them and bring the file in again; an opening balance is all or nothing');
  assert.deepEqual(two.rejected.map((x) => x.why), ['“Bank” is not a nominal code', 'the debit “abc” is not an amount of money', 'a negative amount in a debit or credit column']);
  assert.equal(parseTrialBalance('Code,Debit,Credit\n1200,,x\n', { date: '2026-09-30' }).rejected[0].why, 'the credit “x” is not an amount of money');
  assert.equal(parseTrialBalance('Code,Balance\n1200,1..0\n', { date: '2026-09-30' }).rejected[0].why, 'the balance “1..0” is not an amount of money');
  const lie = (dr, cr) => parseTrialBalance('Code,Name,Debit,Credit\n1200,Bank,100.00,\n3000,Capital,,100.00\n,Grand total,' + dr + ',' + cr + '\n', { date: '2026-09-30' });
  assert.equal(lie('100.00', '100.00').ok, true);
  assert.equal(lie('110.00', '100.00').why, 'the file’s own totals row says debits £110.00 and credits £100.00, but its rows add to £100.00 and £100.00');
  assert.equal(lie('100.00', '90.00').why, 'the file’s own totals row says debits £100.00 and credits £90.00, but its rows add to £100.00 and £100.00');
  assert.equal(lie('x', '100.00').rejected[0].why, 'the totals row: the debit “x” is not an amount of money');
  const zero = parseTrialBalance('Code,Debit,Credit\n1200,0,\n3000,,0.00\n', { date: '2026-09-30' });
  assert.equal(zero.why, 'every account in it is at nothing — there is no opening balance to post');
  const huge = parseTrialBalance('Code,Debit,Credit\n1200,99999999999.99,\n1200,99999999999.99,\n3000,,99999999999.99\n3000,,99999999999.99\n', { date: '2026-09-30' });
  assert.equal(huge.why, 'the opening entry could not be made: the amount is not a whole number of pence within range');
  for (const d of [undefined, '', '31/02/2026', 'soon']) assert.equal(parseTrialBalance(TRIAL, { date: d }).why, 'say the date the balances are at (opts.date — day/month/year or year-month-day)');
  assert.equal(parseTrialBalance(TRIAL).why, 'say the date the balances are at (opts.date — day/month/year or year-month-day)');
  assert.match(parseTrialBalance('Date,Amount\n01/10/2026,1\n', { date: '2026-09-30' }).why, /^no row in it reads as the header of a trial balance/);
});

// ── the books out: Sage's journal import ────────────────────────────────────────────────────────────────────────────
test('journal → Sage import: its twelve columns, A–C on every line, day/month/year, both amounts, pounds exact', () => {
  const entries = [
    { id: 'j1', date: '2026-10-02', memo: 'Rent, unit 4', lines: [['7100', 75000, 0], ['1200', 0, 75000]] },
    { id: 'j2', date: '2026-10-31', memo: '-adjustment', lines: '1200:5:0|9998:0:5' },
  ];
  const r = journalToCsv(entries, 'sage');
  assert.equal(r.ok, true);
  assert.equal(r.text, [
    'Reference,Date,Description,Nominal Code,Details,Include on VAT/Tax Return?,Debit,Credit,Analysis Type 1,Analysis Type 2,Analysis Type 3,Exchange Rate',
    'j1,02/10/2026,"Rent, unit 4",7100,"Rent, unit 4",,750.00,0.00,,,,',
    'j1,02/10/2026,"Rent, unit 4",1200,"Rent, unit 4",,0.00,750.00,,,,',
    'j2,31/10/2026,\'-adjustment,1200,\'-adjustment,,0.05,0.00,,,,',
    'j2,31/10/2026,\'-adjustment,9998,\'-adjustment,,0.00,0.05,,,,',
  ].join('\r\n') + '\r\n');
  assert.deepEqual([r.rows, r.rejected, r.totals], [4, [], { entries: 2, lines: 4, debit: 75005, credit: 75005 }]);
});

test('Sage import: what Sage would refuse is listed and left out, never half-written', () => {
  const ok = { id: 'a', date: '2026-10-01', memo: 'm', lines: [['1200', 1, 0], ['4000', 0, 1]] };
  const r = journalToCsv([ok, { ...ok, lines: [['1200', 1, 0], ['4000', 0, 2]] }, { ...ok }, { ...ok, id: 'b', lines: [['1200', B.SAGE_MAX + 1, 0], ['4000', 0, B.SAGE_MAX + 1]] },
    { ...ok, id: 'c', lines: [['1200', B.SAGE_MAX, 0], ['4000', 0, B.SAGE_MAX]] }, { ...ok, id: 'bad ref!' }, { ...ok, id: undefined }, null,
    { date: '2026-10-01', get lines() { throw new Error('x'); } }, { id: 't', date: '2026-10-01', lines: ok.lines, get memo() { throw new Error('x'); } }], 'sage');
  assert.deepEqual(r.rejected, [
    { index: 1, why: 'the entry would not balance (unbalanced)' },
    { index: 2, why: 'the reference a is already used by another entry — Sage would merge them' },
    { index: 3, why: 'a line is over 99,999,999.00, the most the Sage import takes' },
    { index: 7, why: 'the entry would not balance (not-an-entry)' },
    { index: 8, why: 'the entry would not balance (fault)' },
    { index: 9, why: 'the entry could not be read' },
  ]);
  assert.deepEqual(r.text.split('\r\n').slice(1, -1).map((l) => l.split(',').slice(0, 1).concat(l.split(',').slice(6, 8))),
    [['a', '0.01', '0.00'], ['a', '0.00', '0.01'], ['c', '99999999.00', '0.00'], ['c', '0.00', '99999999.00'], ['J000006', '0.01', '0.00'], ['J000006', '0.00', '0.01'], ['J000007', '0.01', '0.00'], ['J000007', '0.00', '0.01']]);
  assert.deepEqual(r.totals, { entries: 4, lines: 8, debit: 9999999903, credit: 9999999903 });
  const x = journalToCsv([ok], 'xero');
  assert.deepEqual([x.ok, x.text], [false, '']);
  assert.match(x.why, /^a Xero file is not written: Xero’s own manual-journal import layout could not be checked/);
  assert.equal(journalToCsv([ok], 'quickbooks').why, 'the layouts are: sage');
  assert.equal(journalToCsv([ok]).why, 'the layouts are: sage');
  assert.equal(journalToCsv('x', 'sage').why, 'there are no journal entries to write');
  assert.equal(journalToCsv(Array(B.MAX_ROWS + 1).fill(ok), 'sage').why, 'there are no journal entries to write');
  const none = journalToCsv([{ ...ok, lines: [] }], 'sage');
  assert.deepEqual([none.ok, none.why, none.rows], [false, 'not one entry could be written', 0]);
});

test('Sage import read back: a journal per reference; a blank reference continues the one above', () => {
  const text = 'Reference,Date,Description,Nominal Code,Details,Include on VAT/Tax Return?,Debit,Credit\r\n' +
    'ADJ1,30/09/2026,Accrual,7200,,,120.00,0.00\r\n,,,2100,,,0,120.00\r\n' +                        // A–C filled once
    'ADJ2,30/09/2026,Reclass,30,,,"1,000.00",\r\nADJ2,30/09/2026,Reclass,9998,,,,"1,000.00"\r\n' +   // a short code padded
    'ADJ3,30/09/2026,Broken,1200,,,abc,\r\nADJ3,30/09/2026,Broken,4000,,,,1\r\n' +
    'ADJ4,30/09/2026,Unknown code,1200,,,1,\r\nADJ4,30/09/2026,Unknown code,4001,,,,1\r\n';
  const r = parseJournalCsv(text);
  assert.deepEqual(r.entries, [
    { id: 'ADJ1', date: '2026-09-30', memo: 'Accrual', lines: [['7200', 12000, 0], ['2100', 0, 12000]] },
    { id: 'ADJ2', date: '2026-09-30', memo: 'Reclass', lines: [['0030', 100000, 0], ['9998', 0, 100000]] },
  ]);
  assert.deepEqual(r.rejected, [{ line: 6, why: 'line 6: an amount is not an amount of money' }, { line: 8, why: 'the nominal code is not in the chart of accounts' }]);
  assert.deepEqual(r.totals, { entries: 2, lines: 4, debit: 112000, credit: 112000 });
  assert.equal(parseJournalCsv('Reference,Date,Nominal Code,Debit,Credit\r\nX,01/10/2026,1200,1,\r\nX,01/10/2026,4000,,x\r\n').rejected[0].why, 'line 3: an amount is not an amount of money');
  assert.equal(parseJournalCsv('Reference,Date,Nominal Code,Debit,Credit\r\nX,not a date,1200,1,\r\nX,,4000,,1\r\n').rejected[0].why, 'the date is not a date');
  assert.equal(parseJournalCsv('Reference,Date,Nominal Code,Debit,Credit\r\nX,01/10/2026,1200,1,\r\n').why, 'not one journal could be read');
  assert.match(parseJournalCsv(STATEMENT_A).why, /^no row in it reads as the header of a Sage journal import/);
});

// ── the receipt ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('bridgeReceipt: the file’s hash, the counts, the totals and the result’s hash — the same file, the same receipt', () => {
  const r = parseBankCsv(STATEMENT_A);
  const rc = bridgeReceipt({ kind: 'bank', inputText: STATEMENT_A, result: r });
  assert.deepEqual(rc, { ok: true, kind: 'bank', inputHash: hex(STATEMENT_A), rows: 8, rejected: 2, totals: TOTALS_A, outputHash: hex(canonical(r)) });
  assert.deepEqual(bridgeReceipt({ kind: 'bank', inputText: STATEMENT_A, result: parseBankCsv(STATEMENT_A) }), rc, 'deterministic');
  assert.notEqual(bridgeReceipt({ kind: 'bank', inputText: STATEMENT_A + ' ', result: r }).inputHash, rc.inputHash);
  // rows: rows, records or entries — or the count a writer reports
  assert.equal(bridgeReceipt({ kind: 'crm', inputText: DEALS, result: parseCrmCsv(DEALS) }).rows, 6);
  assert.equal(bridgeReceipt({ kind: 'journal', inputText: '', result: { entries: [1, 2, 3] } }).rows, 3);
  assert.equal(bridgeReceipt({ kind: 'sage-out', inputText: '', result: { rows: 4, records: [1] } }).rows, 4);
  assert.deepEqual(bridgeReceipt({ kind: 'x', inputText: '', result: {} }), { ok: true, kind: 'x', inputHash: hex(''), rows: 0, rejected: 0, totals: {}, outputHash: hex('{}') });
  assert.equal(bridgeReceipt({ kind: 'Bank', inputText: '', result: {} }).ok, false);
  assert.equal(bridgeReceipt({ kind: 'b'.repeat(33), inputText: '', result: {} }).ok, false);
  assert.equal(bridgeReceipt({ kind: 'bank', inputText: 5, result: {} }).why, 'the file’s text is needed to fingerprint it');
  assert.equal(bridgeReceipt({ kind: 'bank', inputText: '', result: [] }).why, 'there is no result to make a receipt of');
  assert.equal(bridgeReceipt({ kind: 'bank', inputText: '', result: { totals: { x: 0.5 } } }).ok, false, 'a float cannot be fingerprinted canonically');
  assert.equal(bridgeReceipt({ kind: 7 }).why, 'name the kind of file (a short word such as bank, crm or trial-balance)');
});

// ── hostile input ───────────────────────────────────────────────────────────────────────────────────────────────────
test('fuzz: no export throws on junk in any position, and every refusal says why', () => {
  const toxic = { get rows() { throw new Error('boom'); }, get kind() { throw new Error('boom'); }, get date() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, -1, NaN, '', 'x', '\u0000"', [], {}, [null], [[]], toxic, [toxic], 1n, () => 1, Symbol('s')];
  const HUGE = ['x'.repeat(200000), '1,'.repeat(100000), new Array(200000).fill(0)];
  const fns = Object.entries(B).filter(([, v]) => typeof v === 'function');
  assert.deepEqual(fns.map(([k]) => k).sort(), ['bankToJournal', 'bridgeReceipt', 'crmToCsv', 'dateOf', 'journalToCsv', 'moneyOf', 'parseBankCsv', 'parseCrmCsv', 'parseJournalCsv', 'parseTrialBalance']);
  const call = (name, fn, a, b) => {
    let out;
    assert.doesNotThrow(() => { out = fn(a, b); }, name);
    if (out && typeof out === 'object' && out.ok === false) assert.ok(typeof out.why === 'string' && out.why.length > 5, name);
  };
  for (const [name, fn] of fns) {
    for (const a of JUNK) for (const b of JUNK) call(name, fn, a, b);
    for (const a of HUGE) call(name, fn, a, 'sage');
  }
});

// ── end to end, on the real spine ───────────────────────────────────────────────────────────────────────────────────
test('on the real spine: bridged entries go in through the runtime’s posting path, land in the vault, the books balance and audit', async () => {
  const key = (id) => fromSeed(sha256Bytes('sovereign-enterprise/bridge-test/' + id));
  const K = { owner: await key('owner'), finance: await key('finance'), sales: await key('sales'), audit: await key('audit') };
  const G = K.owner.pub;
  const N = Object.fromEntries(Object.entries(K).map(([id, k]) => [id, createNode({ keys: k, genesis: G, name: id })]));
  await N.owner.grant('g-finance', K.finance.pub, 'agent', ['journal', 'vault', 'vault_head']);
  await N.owner.grant('g-sales', K.sales.pub, 'agent', ['crm']);
  await N.owner.grant('g-audit', K.audit.pub, 'agent', ['vault_cosig']);
  for (const id of ['finance', 'sales', 'audit']) await pull(N[id], N.owner);
  const co = createCompany({ index: {}, patterns: {} });            // the runtime's own posting path; no agents booted

  // 1. the accountant's trial balance becomes the opening entry; 2. the statement's lines follow it
  const tb = parseTrialBalance(TRIAL, { date: '30/09/2026' });
  assert.deepEqual(await co.postEntry(N.finance, tb.entry), { ok: true });
  const j = bankToJournal(parseBankCsv(STATEMENT_A).rows);
  for (const e of j.entries) assert.deepEqual(await co.postEntry(N.finance, e), { ok: true });
  // a device without the books' grant cannot post them — by the runtime's check, and by the device's own
  assert.deepEqual(await co.postEntry(N.sales, j.entries[0]), { ok: false, reason: 'not-authorised' });
  assert.equal((await N.sales.put('journal', 'forged', { date: '2026-10-01', memo: 'x', lines: '1200:1:0|4000:0:1' })).ok, false);
  // 3. the customer list goes in through the Sales device's own CRM grant
  const crm = parseCrmCsv(DEALS);
  for (const [i, rec] of crm.records.entries()) assert.equal((await N.sales.put('crm', 'c-bridge-' + i, rec)).ok, true);

  // every device converges on the same company
  for (const [a, b] of [['owner', 'finance'], ['owner', 'sales'], ['audit', 'owner'], ['finance', 'owner'], ['sales', 'owner']]) await pull(N[a], N[b]);
  assert.equal(new Set(Object.values(N).map((n) => n.digest())).size, 1);
  const journal = N.owner.list('journal');
  assert.equal(journal.length, 9);
  const entries = journal.map((x) => ({ id: x.id, date: x.date, memo: x.memo, lines: x.lines }));

  // the books balance, and the bank in the books is the statement's own closing balance: £6,440.89
  const tbNow = trialBalance(entries);
  assert.equal(tbNow.balanced, true);
  assert.deepEqual(tbNow.rejected, []);
  assert.deepEqual(Object.fromEntries(tbNow.rows.map((r) => [r.code, r.balance])), {
    '0030': 240000, 1100: 160000, 1200: 644089, 2100: -125000, 2200: -35000, 3000: -600000, 3200: -140000,
    7000: 120000, 7100: 75000, 7200: 9612, 7500: 2999, 7900: 850, 9998: -352550,      // suspense: 2000 + 480 + 1045.50 waiting for a person
  });
  assert.equal(balanceSheet(entries).balanced, true);
  assert.deepEqual(profitAndLoss(entries), { income: 0, expense: 208461, profit: -208461 });

  // the vault: every posting sealed, the log audits on every device, and an outsider can check one bridged entry
  const vs0 = co.vaultState(N.owner);
  assert.deepEqual([vs0.a.ok, vs0.a.size, vs0.recs.length], [true, 9, 9]);
  assert.equal(co.vaultState(N.finance).a.root, vs0.a.root);
  assert.equal((await co.witnessHead(N.audit)).ok, true, 'the audit device rebuilt the same log and co-signs its head');
  await pull(N.owner, N.audit);
  const vs = vaultOf(N.owner);
  const cp = await checkpoint(vs, K.owner, { at: '2026-10-31T18:00:00Z' });
  assert.equal(cp.ok, true);
  const rentAt = [...vs.entryAt].find(([, id]) => journal.find((x) => x.id === id).memo === 'RENT, UNIT 4 OCTOBER')[0];
  const proof = proofBundle(vs, rentAt, cp.bundle);
  const seen = await verifyProofBundle(proof.bundle);
  assert.equal(seen.ok, true, seen.why);
  assert.deepEqual(seen.lines, [{ code: '1200', name: 'Bank current account', debit: 0, credit: 75000 }, { code: '7100', name: 'Rent', debit: 75000, credit: 0 }]);
  assert.equal(seen.checkpoint.witnesses.length, 1, 'co-signed by the audit device');

  // the CRM, exactly as the page keeps it
  assert.deepEqual(N.owner.list('crm').map(({ id, ...rec }) => rec), DEAL_RECORDS);

  // out again: the books to Sage and back, the CRM to CSV and back — the same entries and records
  const sage = journalToCsv(journal, 'sage');
  assert.deepEqual([sage.ok, sage.rejected, sage.totals.entries, sage.totals.lines], [true, [], 9, 23]);   // 7 opening lines + 8 × 2
  const back = parseJournalCsv(sage.text);
  assert.deepEqual(back.entries, journal.map((x) => ({ id: x.id, date: x.date, memo: x.memo, lines: parseLines(x.lines) })));
  assert.deepEqual(parseCrmCsv(crmToCsv(N.owner.list('crm')).text).records, DEAL_RECORDS);

  // the receipts of this planting's bridges
  const receipts = [bridgeReceipt({ kind: 'trial-balance', inputText: TRIAL, result: tb }), bridgeReceipt({ kind: 'bank', inputText: STATEMENT_A, result: j }),
    bridgeReceipt({ kind: 'crm', inputText: DEALS, result: crm })];
  assert.deepEqual(receipts.map((r) => [r.kind, r.rows, r.rejected]), [['trial-balance', 7, 0], ['bank', 8, 0], ['crm', 6, 4]]);
});
