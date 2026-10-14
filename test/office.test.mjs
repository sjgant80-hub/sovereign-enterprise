import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { employerCost, cpiFactor, seatsPerYear, plan, gbp0, gbpM } from '../src/office.mjs';

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

test('money formatting', () => {
  assert.equal(gbp0(10304782.4), '£10,304,782');
  assert.equal(gbp0(-12.6), '−£13');
  assert.equal(gbpM(12586407), '£12.6m');
  assert.equal(gbp0('x'), '£0');
});
