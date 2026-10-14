import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { employerCost, cpiFactor, seatsPerYear, plan, gbp0, gbpM, shareOf, redundancyWeeks, noticeWeeks, transition, payback } from '../src/office.mjs';

const basis = JSON.parse(readFileSync(new URL('../data/basis.json', import.meta.url)));
const office = JSON.parse(readFileSync(new URL('../data/office.json', import.meta.url)));
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('employer cost: gross + 15% NI above £5,000 + 3% pension on £6,240..£50,270', () => {
  const m = employerCost(19.67 * 1950, basis);
  close(m.gross, 38356.5);
  close(m.ni, 0.15 * (38356.5 - 5000));
  close(m.pension, 0.03 * (38356.5 - 6240));
  close(m.total, 44323.475);
  const s = employerCost(56438, basis);
  close(s.pension, 0.03 * (50270 - 6240));                 // capped at the upper limit
  close(s.total, 65474.6);
  const low = employerCost(4000, basis);
  assert.equal(low.ni, 0);                                  // under the NI threshold
  assert.equal(low.pension, 0);                             // under the qualifying band
  assert.equal(low.total, 4000);
  const mid = employerCost(6000, basis);
  close(mid.ni, 150);
  assert.equal(mid.pension, 0);
  assert.equal(employerCost(-5, basis).total, 0);
  close(employerCost(5000, basis).ni, 0);
  close(employerCost(6240, basis).pension, 0);
  close(employerCost(50270, basis).pension, employerCost(90000, basis).pension);
});

test('cpiFactor: the five-year CPI multiplier', () => {
  close(cpiFactor(0.031, 5), 1 + 1.031 + 1.031 ** 2 + 1.031 ** 3 + 1.031 ** 4, 1e-9);
  assert.equal(cpiFactor(0, 5), 5);
  assert.equal(cpiFactor(0.1, 0), 0);
  assert.equal(cpiFactor(0.1, 1), 1);
  close(cpiFactor(0.1, 2), 2.1, 1e-9);
  assert.equal(cpiFactor(0.1, -3), 0);
});

test('seatsPerYear: price × 12 × users, per kind', () => {
  assert.equal(seatsPerYear(['crm'], 10, basis), 80 * 12 * 10);
  close(seatsPerYear(['crm', 'hr'], 2, basis), (80 + 103.8) * 12 * 2, 1e-9);
  assert.equal(seatsPerYear([], 9, basis), 0);
  assert.equal(seatsPerYear(['nope'], 9, basis), 0);
  assert.equal(seatsPerYear(['crm'], -4, basis), 0);
  assert.equal(seatsPerYear(null, 4, basis), 0);
});

test('the modelled office: today vs assisted vs sovereign', () => {
  const p = plan(office, basis);
  assert.equal(p.today.headcount, 50);
  assert.equal(p.sovereign.headcount, 5);
  close(p.headcountCut, 0.9, 1e-9);
  close(p.median.total, 44323.47, 0.001);
  close(p.today.payYear1, 45 * employerCost(19.67 * 1950, basis).total + 5 * employerCost(56438, basis).total, 1e-6);
  close(p.today.seatsYear1, (28 * 80 + 5 * 161.5 + 6 * 103.8) * 12, 0.001);
  close(p.assisted.seatsYear1 - p.today.seatsYear1, 50 * 23.1 * 12, 0.001);
  assert.ok(p.assisted.total > p.today.total);              // an AI seat on every desk only adds cost
  close(p.today.total, (p.today.payYear1 + p.today.seatsYear1) * p.cpiFactor, 0.01);
  close(p.leadCost.total, employerCost(56438 * 1.2, basis).total, 1e-6);
  close(p.sovereign.payYear1, 5 * p.leadCost.total, 1e-6);
  close(p.saving, p.today.total - p.sovereign.total, 1e-6);
  assert.ok(p.savingPct > 0.8 && p.savingPct < 0.85, String(p.savingPct));
});

test('hardware is ex-VAT and sized from measured throughput (N + spare)', () => {
  const p = plan(office, basis);
  close(p.hardware.boxCost, 4673.35 / 1.2, 1e-6);
  close(p.hardware.hubCost, 1399 / 1.2, 1e-6);
  assert.equal(p.capacity.boxesNeeded, 1);
  assert.equal(p.capacity.boxes, 2);
  close(p.hardware.total, 2 * 4673.35 / 1.2 + 1399 / 1.2, 1e-6);
  close(p.capacity.aiHours, 45 * 1950 * 0.9, 1e-6);
  close(p.capacity.tokens, 45 * 1950 * 0.9 * 60000, 1e-3);
  close(p.capacity.outPerSec, p.capacity.tokens * 0.25 / (2600 * 3600), 1e-9);
  close(p.capacity.decodeUtilisation, p.capacity.outPerSec / (368 * 2), 1e-12);
  close(p.capacity.prefillUtilisation, p.capacity.inPerSec / (7950 * 2), 1e-12);
  // 2.5× the token demand still fits the provisioned boxes' decode budget
  const heavy = plan({ ...office, tokensPerHumanHour: 150000 }, basis);
  assert.ok(heavy.capacity.outPerSec < 368 * 2);
  // enough demand forces a second box before the spare
  const huge = plan({ ...office, tokensPerHumanHour: 200000 }, basis);
  assert.equal(huge.capacity.boxesNeeded, 2);
  assert.equal(huge.capacity.boxes, 3);
});

test('power, limbs and setup', () => {
  const p = plan(office, basis);
  assert.equal(p.sovereign.watts, 2 * 240 + 155);
  close(p.sovereign.kwh, (2 * 240 + 155) * 8760 / 1000, 1e-9);
  close(p.sovereign.powerYear1, p.sovereign.kwh * 0.2451, 1e-9);
  const blend = 0.75 * 2 + 0.25 * 10;
  close(p.sovereign.frontierYear, p.capacity.tokens * 0.05 / 1e6 * blend * 0.75396, 1e-6);
  close(p.sovereign.phoneMinutes, 10 * 1950 * 0.9 * 0.4 * 60, 1e-6);
  close(p.sovereign.voiceYear, p.sovereign.phoneMinutes * 0.08 * 0.75396, 1e-6);
  assert.equal(p.sovereign.setup, 60 * 800);
  close(p.sovereign.total, p.sovereign.payYear1 * p.cpiFactor + p.sovereign.powerYear1 * p.cpiFactor +
    (p.sovereign.frontierYear + p.sovereign.voiceYear) * 5 + p.sovereign.hardware + p.sovereign.setup, 1e-6);
});

test('the human remainder fits the retained people', () => {
  const p = plan(office, basis);
  close(p.human.remainderFte, 4.5, 1e-9);
  assert.equal(p.human.capacityFte, 4.5);
  assert.equal(p.human.fits, true);
  assert.equal(plan({ ...office, aiShare: 0.8 }, basis).human.fits, false);
  const d = p.departments.find((x) => x.id === 'service');
  close(d.aiFte, 9, 1e-9);
  close(d.humanFte, 1, 1e-9);
  assert.equal(d.overseenBy, 'Revenue lead (AI-native)');
  assert.equal(p.departments.find((x) => x.id === 'ops').overseenBy, 'Operations lead (AI-native)');
});

test('an empty office: percentages are 0, never NaN', () => {
  const p = plan({ departments: [] }, basis);
  assert.equal(p.today.total, 0);
  assert.equal(p.savingPct, 0);
  assert.equal(p.headcountCut, 0);
});

test('non-finite inputs fall back to defaults, never poison the totals', () => {
  const ref = plan(office, basis).today.total;
  assert.equal(plan({ ...office, hoursPerFte: NaN }, basis).today.total, ref);
  assert.equal(plan({ ...office, hoursPerFte: Infinity }, basis).today.total, ref);
  assert.ok(Number.isFinite(plan({ ...office, years: NaN }, basis).sovereign.total));
});

test('fits is decided on rounded FTE, so the exact boundary fits', () => {
  // 45 × (1 − 0.9) is 4.4999… in floating point; capacity is 4.5 — they are the same FTE and must fit
  const p = plan(office, basis);
  assert.equal(p.human.fits, true);
  assert.equal(plan({ ...office, retained: office.retained.slice(1) }, basis).human.fits, false);   // 4.0 < 4.5
});

test('total on junk: no throw, sane zeros', () => {
  for (const o of [null, {}, { departments: 'x' }, { years: -1 }]) {
    const p = plan(o, basis);
    assert.equal(typeof p.saving, 'number');
    assert.ok(Number.isFinite(p.today.total));
  }
  assert.equal(plan(office, {}).today.payYear1, 0);
  assert.equal(plan({ ...office, aiShare: 7 }, basis).capacity.aiHours, 45 * 1950);
  assert.equal(plan({ ...office, aiShare: -1 }, basis).capacity.aiHours, 0);
});

test('per-department automation, kept lines, and the visitor\'s own pay, software and set-up', () => {
  const base = plan(office, basis);
  // one department at its own share: only its AI hours move
  const svc = office.departments.map((d) => (d.id === 'service' ? { ...d, aiShare: 0.5 } : d));
  const s = plan({ ...office, departments: svc }, basis);
  close(s.capacity.aiHours, base.capacity.aiHours - 10 * 1950 * 0.4, 1e-6);
  assert.equal(s.departments.find((d) => d.id === 'service').share, 0.5);
  close(s.sovereign.phoneMinutes, 10 * 1950 * 0.5 * 0.4 * 60, 1e-6);          // calls follow the department's own share
  close(s.human.remainderFte, 4.5 + 10 * 0.4, 1e-9);
  // a kept line: the AI assists, never replaces — the people stay on the AI-native payroll, out of the remainder
  const kept = [...office.departments, { id: 'field', name: 'Engineers on site', today: 17, kept: true }];
  const k = plan({ ...office, departments: kept }, basis);
  assert.equal(k.today.headcount, 67);
  assert.equal(k.sovereign.headcount, 5 + 17);
  assert.equal(k.sovereign.kept, 17);
  close(k.sovereign.payYear1, 5 * k.leadCost.total + 17 * k.median.total, 1e-6);
  close(k.capacity.aiHours, base.capacity.aiHours, 1e-6);
  close(k.human.remainderFte, base.human.remainderFte, 1e-9);
  assert.equal(k.departments.find((d) => d.id === 'field').share, 0);
  close(k.saving, base.saving, 1e-3);                                             // kept people cost the same on both sides
  // a kept line with an aiShare set is still kept
  assert.equal(plan({ ...office, departments: [{ id: 'x', today: 3, kept: true, aiShare: 0.9 }] }, basis).capacity.aiHours, 0);
  // the visitor's own fully loaded cost per head, software bill and set-up
  const pay = office.departments.map((d) => (d.id === 'finance' ? { ...d, payYear: 60000 } : d));
  const py = plan({ ...office, departments: pay }, basis);
  close(py.today.payYear1, base.today.payYear1 + 5 * (60000 - base.median.total), 1e-6);
  assert.equal(py.departments.find((d) => d.id === 'finance').payYear, 60000);
  assert.equal(plan({ ...office, departments: office.departments.map((d) => ({ ...d, payYear: -1 })) }, basis).today.payYear1, base.today.payYear1);
  assert.equal(plan({ ...office, softwarePerYear: 12345 }, basis).today.seatsYear1, 12345);
  assert.equal(plan({ ...office, softwarePerYear: 0 }, basis).today.seatsYear1, 0);
  assert.equal(plan({ ...office, setupCost: 30000 }, basis).sovereign.setup, 30000);
  assert.equal(plan({ ...office, setupCost: NaN }, basis).sovereign.setup, 60 * 800);
  close(plan({ ...office, leadership: { ...office.leadership, payYear: 90000 } }, basis).today.payYear1, base.today.payYear1 + 5 * (90000 - base.senior.total), 1e-6);
  close(base.human.weeklyHours, 4.5 * 1950 / 52, 1e-9);
  assert.equal(shareOf({ aiShare: 2 }, office), 1);
  assert.equal(shareOf({}, { aiShare: 0.7 }), 0.7);
  assert.equal(shareOf({}, {}), 0.9);
  assert.equal(shareOf(null, null), 0.9);
});

test('statutory redundancy and notice, by the gov.uk rules', () => {
  assert.equal(redundancyWeeks(5, 'from22to40', basis), 5);
  assert.equal(redundancyWeeks(5, 'from41', basis), 7.5);
  assert.equal(redundancyWeeks(5, 'under22', basis), 2.5);
  assert.equal(redundancyWeeks(30, 'from22to40', basis), 20);                    // service capped at 20 years
  assert.equal(redundancyWeeks(20, 'from22to40', basis), 20);
  assert.equal(redundancyWeeks(2, 'from22to40', basis), 2);                      // two years qualifies
  assert.equal(redundancyWeeks(1.9, 'from22to40', basis), 0);                    // under two does not
  assert.equal(redundancyWeeks(5.9, 'from22to40', basis), 5);                    // full years only
  assert.equal(redundancyWeeks(5, 'nope', basis), 5);                            // an unknown band falls back to 22–40
  assert.equal(redundancyWeeks(5, 'from22to40', {}), 0);
  assert.equal(noticeWeeks(0), 1);
  assert.equal(noticeWeeks(1.9), 1);
  assert.equal(noticeWeeks(2), 2);
  assert.equal(noticeWeeks(12), 12);
  assert.equal(noticeWeeks(30), 12);
  assert.equal(noticeWeeks(-4), 1);
});

test('the transition: redundancy, dual running, training, contingency — and consultation by the count', () => {
  const p = plan(office, basis);
  const t = transition(p, office, basis);
  assert.equal(t.leavers, 45);
  assert.equal(t.redundancyWeeks, 5);
  close(t.redundancy, 45 * 5 * Math.min(p.median.gross / 52, 751), 1e-6);
  assert.equal(t.noticeWeeks, 5);
  assert.equal(t.consultationDays, 30);
  assert.equal(t.hr1, true);
  assert.equal(t.dualRunMonths, 3);
  close(t.dualRunWeeks, 13, 1e-9);
  close(t.dualRun, 45 * (p.median.total / 52) * 13, 1e-6);
  close(t.training, 5 * 10 * p.leadCost.total / (1950 / 7.5), 1e-6);
  close(t.contingency, 0.2 * (t.redundancy + t.dualRun + t.training + p.sovereign.setup), 1e-6);
  close(t.total, t.redundancy + t.dualRun + t.training + t.contingency, 1e-6);
  // a short dual run: notice and consultation still have to be paid in full
  const short = transition(p, { ...office, transition: { ...office.transition, dualRunMonths: 0 } }, basis);
  close(short.dualRunWeeks, 5 + 30 / 7, 1e-9);
  // the redundancy cap bites on high pay
  const rich = { ...p, median: { ...p.median, gross: 100000 } };
  close(transition(rich, office, basis).redundancy, 45 * 5 * 751, 1e-6);
  // fewer than 20 leavers: no collective consultation; 100 or more: 45 days
  const small = plan({ ...office, departments: [{ id: 'a', today: 19 }], retained: [] }, basis);
  assert.equal(transition({ ...small, sovereign: { ...small.sovereign, headcount: 5 } }, office, basis).consultationDays, 0);
  const twenty = plan({ ...office, departments: [{ id: 'a', today: 20 }], leadership: { today: 5 } }, basis);
  assert.equal(transition(twenty, office, basis).consultationDays, 30);
  const big = plan({ ...office, departments: [{ id: 'a', today: 100 }], leadership: { today: 5 } }, basis);
  assert.equal(transition(big, office, basis).consultationDays, 45);
  const nn = plan({ ...office, departments: [{ id: 'a', today: 104 }], leadership: { today: 0 } }, basis);
  assert.equal(transition(nn, office, basis).consultationDays, 30);              // 104 − 5 = 99 leavers: still the 20–99 band
  // kept lines don't leave and don't set the leaver's cost
  const kp = plan({ ...office, departments: [...office.departments, { id: 'f', today: 17, kept: true, payYear: 90000 }] }, basis);
  const kt = transition(kp, office, basis);
  assert.equal(kt.leavers, 45);
  close(kt.dualRun, t.dualRun, 1e-6);
  // nobody leaves: no redundancy, no consultation, and the median sets the weekly cost
  const none = transition({ ...p, departments: [], sovereign: { ...p.sovereign, headcount: 50 } }, office, basis);
  assert.equal(none.leavers, 0);
  assert.equal(none.redundancy, 0);
  assert.equal(none.consultationDays, 0);
  assert.equal(none.hr1, false);
  assert.equal(none.dualRun, 0);
  assert.ok(Number.isFinite(none.total));
  assert.equal(transition(null, office, basis).total, 0);
  // leaders who go but no department line goes: the median sets what a leaver costs a week
  const lp = plan({ ...office, departments: [], leadership: { today: 10 } }, basis);
  const lt = transition(lp, office, basis);
  assert.equal(lt.leavers, 5);
  close(lt.dualRun, 5 * (lp.median.total / 52) * 13, 1e-6);
  // an office with no transition settings, or none at all: the stated defaults
  const bare = transition(p, null, basis);
  assert.equal(bare.dualRunMonths, 3);
  assert.equal(bare.redundancyWeeks, 0);                                         // no service years given → none counted
  close(bare.contingency, 0.2 * (bare.redundancy + bare.dualRun + bare.training + p.sovereign.setup), 1e-6);
  assert.equal(transition(p, { transition: 'x' }, basis).dualRunMonths, 3);
  // a basis without the consultation figures still applies the gov.uk numbers; with its own, it uses them
  assert.equal(transition(p, office, { ...basis, collectiveConsultation: undefined }).consultationDays, 30);
  assert.equal(transition(p, office, { ...basis, collectiveConsultation: { threshold: 50, days20to99: 30, days100plus: 45 } }).consultationDays, 0);
  assert.equal(transition(p, office, { ...basis, collectiveConsultation: { threshold: 20, days20to99: 33, days100plus: 45 } }).consultationDays, 33);
});

test('payback and NPV: the investment, the monthly saving, discounted at the Green Book rate with CPI', () => {
  const p = plan(office, basis);
  const t = transition(p, office, basis);
  const y = payback(p, t, basis);
  close(y.investment, p.sovereign.hardware + p.sovereign.setup + t.total, 1e-6);
  const run0 = p.today.payYear1 + p.today.seatsYear1 - (p.sovereign.payYear1 + p.sovereign.powerYear1 + p.sovereign.frontierYear + p.sovereign.voiceYear);
  close(y.monthlySaving, run0 / 12, 1e-6);
  close(y.paybackMonths, y.investment / y.monthlySaving, 1e-9);
  close(y.rate, 1.035 * 1.031 - 1, 1e-12);
  assert.equal(y.flows.length, 6);
  close(y.flows[0], -y.investment, 1e-6);
  close(y.flows[1], run0, 1e-6);
  const run2 = (p.today.payYear1 + p.today.seatsYear1) * 1.031 ** 2 - ((p.sovereign.payYear1 + p.sovereign.powerYear1) * 1.031 ** 2 + p.sovereign.frontierYear + p.sovereign.voiceYear);
  close(y.flows[3], run2, 1e-6);
  close(y.npv, y.flows.reduce((s, f, i) => s + f / (1 + y.rate) ** i, 0), 1e-6);
  close(y.net, p.saving - t.total, 1e-6);
  assert.ok(y.paybackMonths > 0 && y.paybackMonths < 12, String(y.paybackMonths));
  // when the AI-native side costs more each month, it never pays back
  const loss = payback({ ...p, sovereign: { ...p.sovereign, payYear1: p.today.payYear1 * 2 } }, t, basis);
  assert.equal(loss.paybackMonths, null);
  assert.ok(loss.npv < 0);
  assert.equal(payback(p, t, { ...basis, discountRateReal: undefined }).rate, 1.035 * 1.031 - 1);
  close(payback(p, t, { ...basis, discountRateReal: { value: 0.05 } }).rate, 1.05 * 1.031 - 1, 1e-12);
  // exactly break-even each month: it never pays back (no division by zero)
  const even = { ...p, today: { ...p.today, payYear1: 100, seatsYear1: 20 }, sovereign: { ...p.sovereign, payYear1: 120, powerYear1: 0, frontierYear: 0, voiceYear: 0 } };
  assert.equal(payback(even, t, basis).monthlySaving, 0);
  assert.equal(payback(even, t, basis).paybackMonths, null);
  assert.equal(payback(null, t, basis).paybackMonths, null);
});

test('money formatting', () => {
  assert.equal(gbp0(10304782.4), '£10,304,782');
  assert.equal(gbp0(-12.6), '−£13');
  assert.equal(gbpM(12586407), '£12.6m');
  assert.equal(gbp0('x'), '£0');
});
