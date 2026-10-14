import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART, encodeLines, parseLines, validEntry, trialBalance, profitAndLoss, balanceSheet, gbp } from '../src/books.mjs';

const e = (id, date, lines) => ({ id, date, lines: encodeLines(lines) });
const MONTH = [
  e('j1', '2026-10-01', [['1200', 1000000, 0], ['3000', 0, 1000000]]),                       // £10,000 capital in
  e('j2', '2026-10-05', [['1100', 120000, 0], ['4000', 0, 100000], ['2200', 0, 20000]]),      // invoice £1,000 + VAT
  e('j3', '2026-10-12', [['1200', 120000, 0], ['1100', 0, 120000]]),                         // customer pays
  e('j4', '2026-10-15', [['7100', 150000, 0], ['1200', 0, 150000]]),                         // rent £1,500
  e('j5', '2026-10-20', [['7510', 4500, 0], ['1200', 0, 4500]]),                             // AI limb calls £45
  e('j6', '2026-11-02', [['7200', 9000, 0], ['1200', 0, 9000]]),                             // next month's power
];

test('lines encode and parse round-trip; parse is strict', () => {
  const L = [['1200', 0, 12000], ['4000', 10000, 0]];
  assert.deepEqual(parseLines(encodeLines(L)), L);
  for (const bad of ['', '1200:1:0|x', '120:1:0', '1200:-1:0', '1200:1.5:0', 'a'.repeat(1801), 5, null, '1200:12345678901234:0']) {
    assert.equal(parseLines(bad), null, String(bad).slice(0, 20));
  }
  assert.deepEqual(parseLines('1200:1234567890123:0'), [['1200', 1234567890123, 0]]);
});

test('validEntry: balanced in, everything else out with its reason', () => {
  assert.equal(validEntry(MONTH[1]).ok, true);
  assert.equal(validEntry(MONTH[1]).total, 120000);
  assert.equal(validEntry(null).reason, 'not-an-entry');
  assert.equal(validEntry({ date: '2026-13-01', lines: MONTH[0].lines }).reason, 'date');
  assert.equal(validEntry({ date: '2026-10-32', lines: MONTH[0].lines }).reason, 'date');
  assert.equal(validEntry({ date: '2026-10-01', lines: 'junk' }).reason, 'lines');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 5, 0]] }).reason, 'lines');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 5, 0], ['9999', 0, 5]] }).reason, 'account');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 5, 5], ['4000', 0, 0]] }).reason, 'one-side');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 0, 0], ['4000', 0, 0]] }).reason, 'one-side');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 5, 0], ['4000', 0, 4]] }).reason, 'unbalanced');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', -5, 0], ['4000', 0, -5]] }).reason, 'amount');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 1.5, 0], ['4000', 0, 1.5]] }).reason, 'amount');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 1e13 + 1, 0], ['4000', 0, 1e13 + 1]] }).reason, 'amount');
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 1e13, 0], ['4000', 0, 1e13]] }).ok, true);
  assert.equal(validEntry({ date: '2026-10-01', lines: [['1200', 5, 0], ['4000', 0]] }).reason, 'line-shape');
  const big = Array.from({ length: 64 }, (_, i) => (i % 2 ? ['4000', 0, 1] : ['1200', 1, 0]));
  assert.equal(validEntry({ date: '2026-10-01', lines: big }).ok, true);
  assert.equal(validEntry({ date: '2026-10-01', lines: [...big, ['1200', 1, 0], ['4000', 0, 1]] }).reason, 'lines');
  assert.equal(validEntry({ get date() { throw new Error('x'); } }).reason, 'fault');
});

test('trial balance: debits = credits; invalid entries rejected not posted; period filter', () => {
  const tb = trialBalance([...MONTH, { id: 'bad', date: '2026-10-09', lines: '1200:5:0|4000:0:4' }]);
  assert.equal(tb.balanced, true);
  assert.equal(tb.dr, tb.cr);
  assert.deepEqual(tb.rejected, [{ id: 'bad', reason: 'unbalanced' }]);
  const bank = tb.rows.find((r) => r.code === '1200');
  assert.equal(bank.balance, 1000000 + 120000 - 150000 - 4500 - 9000);
  assert.equal(bank.name, 'Bank current account');
  const oct = trialBalance(MONTH, '2026-10-01', '2026-10-31');
  assert.equal(oct.rows.find((r) => r.code === '7200'), undefined);
  assert.deepEqual(oct.rows.map((r) => r.code), [...oct.rows.map((r) => r.code)].sort());
  assert.equal(trialBalance('x').balanced, true);
});

test('P&L and balance sheet: the books prove themselves', () => {
  const pl = profitAndLoss(MONTH, '2026-10-01', '2026-10-31');
  assert.deepEqual(pl, { income: 100000, expense: 154500, profit: -54500 });
  const bs = balanceSheet(MONTH, '2026-10-31');
  assert.equal(bs.balanced, true);
  assert.equal(bs.assets, 1000000 + 120000 - 150000 - 4500);
  assert.equal(bs.liabilities, 20000);
  assert.equal(bs.equity, 1000000);
  assert.equal(bs.profit, -54500);
  assert.equal(balanceSheet(MONTH).balanced, true);
});

test('period boundaries are inclusive at both ends', () => {
  const tb = trialBalance(MONTH, '2026-10-01', '2026-10-20');
  const codes = tb.rows.map((r) => r.code);
  assert.ok(codes.includes('3000'));            // j1 is dated exactly on `from`
  assert.ok(codes.includes('7510'));            // j5 is dated exactly on `to`
  assert.ok(!codes.includes('7200'));           // j6 is after `to`
});

test('parseLines: exactly 1800 characters is allowed, 1801 is not', () => {
  const s1800 = [...new Array(199).fill('1200:1:0'), '1200:10:0'].join('|');
  assert.equal(s1800.length, 1800);
  assert.equal(parseLines(s1800).length, 200);
  const s1801 = [...new Array(198).fill('1200:1:0'), '1200:10:0', '1200:10:0'].join('|');
  assert.equal(s1801.length, 1801);
  assert.equal(parseLines(s1801), null);
});

test('validEntry: each amount fault, alone, on an otherwise balanced entry', () => {
  const r = (lines) => validEntry({ date: '2026-10-01', lines }).reason;
  assert.equal(r([['1200', 1.5, 0], ['1230', 0, 1.5]]), 'amount');
  assert.equal(r([['1200', 0, 1.5], ['1230', 1.5, 0]]), 'amount');
  assert.equal(r([['1200', -5, 0], ['1230', 0, -5]]), 'amount');
  assert.equal(r([['1200', 0, -5], ['1230', -5, 0]]), 'amount');
  assert.equal(r([['1200', 1e13 + 1, 0], ['1230', 0, 1e13 + 1]]), 'amount');
  assert.equal(r([['1200', 0, 1e13 + 1], ['1230', 1e13 + 1, 0]]), 'amount');
});

test('chart: every account typed; gbp formats pence', () => {
  for (const [code, [name, type]] of Object.entries(CHART)) {
    assert.match(code, /^\d{4}$/);
    assert.ok(name.length > 0);
    assert.ok(['asset', 'liability', 'equity', 'income', 'expense'].includes(type));
  }
  assert.equal(gbp(123456789), '£1,234,567.89');
  assert.equal(gbp(5), '£0.05');
  assert.equal(gbp(-54500), '−£545.00');
  assert.equal(gbp(0), '£0.00');
});
