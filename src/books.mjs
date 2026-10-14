// books.mjs — double-entry bookkeeping, integer pence, UK nominal codes (the Sage-standard numbering a UK
// accountant already reads). A journal entry balances or it does not exist. Pure, total, deterministic.

/** The chart of accounts: code → [name, type]. type ∈ asset | liability | equity | income | expense. */
export const CHART = Object.freeze({
  '0030': ['Office equipment', 'asset'],
  '0031': ['Office equipment depreciation', 'asset'],
  '1100': ['Trade debtors', 'asset'],
  '1200': ['Bank current account', 'asset'],
  '1230': ['Petty cash', 'asset'],
  '2100': ['Trade creditors', 'liability'],
  '2200': ['VAT on sales', 'liability'],
  '2201': ['VAT on purchases', 'liability'],
  '2210': ['PAYE and NI', 'liability'],
  '3000': ['Share capital', 'equity'],
  '3200': ['Retained earnings', 'equity'],
  '4000': ['Sales', 'income'],
  '4900': ['Other income', 'income'],
  '5000': ['Cost of sales', 'expense'],
  '7000': ['Wages and salaries', 'expense'],
  '7006': ['Employer NI', 'expense'],
  '7100': ['Rent', 'expense'],
  '7200': ['Electricity', 'expense'],
  '7500': ['Software and subscriptions', 'expense'],
  '7510': ['AI compute (per-use limbs)', 'expense'],
  '7900': ['Bank charges', 'expense'],
  '8000': ['Depreciation', 'expense'],
});

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PENCE_MAX = 1e13;                          // £100bn per line — far beyond any SME, far inside safe integers

/** Lines are stored as one compact string field: "1200:0:12000|4000:10000:0|2200:2000:0" (code:debit:credit). */
export function encodeLines(lines) {
  return lines.map(([a, d, c]) => a + ':' + d + ':' + c).join('|');
}
export function parseLines(s) {
  if (typeof s !== 'string') return null;
  if (s.length > 1800) return null;
  const out = [];
  for (const part of s.split('|')) {
    const m = /^(\d{4}):(\d{1,13}):(\d{1,13})$/.exec(part);
    if (!m) return null;
    out.push([m[1], Number(m[2]), Number(m[3])]);
  }
  return out;
}

/** Is this a postable entry? → { ok, reason }. ≥2 lines, one side per line, known accounts, debits = credits. */
export function validEntry(e) {
  try {
    if (!e || typeof e !== 'object') return { ok: false, reason: 'not-an-entry' };
    if (typeof e.date !== 'string' || !DATE.test(e.date)) return { ok: false, reason: 'date' };
    const lines = Array.isArray(e.lines) ? e.lines : parseLines(e.lines);
    if (!lines || lines.length < 2 || lines.length > 64) return { ok: false, reason: 'lines' };
    let dr = 0, cr = 0;
    for (const l of lines) {
      if (!Array.isArray(l) || l.length !== 3) return { ok: false, reason: 'line-shape' };
      const [a, d, c] = l;
      if (!Object.prototype.hasOwnProperty.call(CHART, a)) return { ok: false, reason: 'account' };
      if (!Number.isSafeInteger(d)) return { ok: false, reason: 'amount' };
      if (!Number.isSafeInteger(c)) return { ok: false, reason: 'amount' };
      if (d < 0) return { ok: false, reason: 'amount' };
      if (c < 0) return { ok: false, reason: 'amount' };
      if (d > PENCE_MAX) return { ok: false, reason: 'amount' };
      if (c > PENCE_MAX) return { ok: false, reason: 'amount' };
      if ((d === 0) === (c === 0)) return { ok: false, reason: 'one-side' };
      dr += d; cr += c;
    }
    if (dr !== cr) return { ok: false, reason: 'unbalanced' };
    return { ok: true, reason: 'balanced', total: dr, lines };
  } catch {
    return { ok: false, reason: 'fault' };
  }
}

function inPeriod(date, from, to) {
  return (!from || date >= from) && (!to || date <= to);
}

/** Trial balance over the valid entries in [from, to]. Invalid entries are reported, never posted. */
export function trialBalance(entries, from, to) {
  const acc = {};
  const rejected = [];
  let dr = 0, cr = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const v = validEntry(e);
    if (!v.ok) { rejected.push({ id: e && e.id, reason: v.reason }); continue; }
    if (!inPeriod(e.date, from, to)) continue;
    for (const [a, d, c] of v.lines) {
      const row = acc[a] || (acc[a] = { code: a, name: CHART[a][0], type: CHART[a][1], dr: 0, cr: 0 });
      row.dr += d; row.cr += c; dr += d; cr += c;
    }
  }
  const rows = Object.values(acc).sort((x, y) => (x.code < y.code ? -1 : 1)).map((r) => ({ ...r, balance: r.dr - r.cr }));
  return { rows, dr, cr, balanced: dr === cr, rejected };
}

/** Profit and loss: income (credit-natural) less expenses (debit-natural), in pence. */
export function profitAndLoss(entries, from, to) {
  const tb = trialBalance(entries, from, to);
  let income = 0, expense = 0;
  for (const r of tb.rows) {
    if (r.type === 'income') income += r.cr - r.dr;
    else if (r.type === 'expense') expense += r.dr - r.cr;
  }
  return { income, expense, profit: income - expense };
}

/** Balance sheet at a date: assets = liabilities + equity + retained profit. `balanced` proves the books. */
export function balanceSheet(entries, to) {
  const tb = trialBalance(entries, null, to);
  let assets = 0, liabilities = 0, equity = 0;
  for (const r of tb.rows) {
    if (r.type === 'asset') assets += r.dr - r.cr;
    else if (r.type === 'liability') liabilities += r.cr - r.dr;
    else if (r.type === 'equity') equity += r.cr - r.dr;
  }
  const { profit } = profitAndLoss(entries, null, to);
  return { assets, liabilities, equity, profit, balanced: assets === liabilities + equity + profit };
}

/** £ formatting for pence (integer). */
export function gbp(p) {
  const neg = p < 0;
  const a = Math.abs(p);
  const s = '£' + Math.floor(a / 100).toLocaleString('en-GB') + '.' + String(a % 100).padStart(2, '0');
  return neg ? '−' + s : s;
}
