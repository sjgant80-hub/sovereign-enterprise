import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan } from '../src/office.mjs';
import { cloudCompare, undercut } from '../src/market.mjs';

const basis = JSON.parse(readFileSync(new URL('../data/basis.json', import.meta.url)));
const office = JSON.parse(readFileSync(new URL('../data/office.json', import.meta.url)));
const p = plan(office, basis);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' vs ' + b);

test('cloudCompare: owned boxes vs the London GPU rented for office hours or always on vs Bedrock London per token — recomputed by hand', () => {
  const c = cloudCompare(p, basis);
  const hours = 8760, busy = 2600, fx = basis.fxGbpPerUsd.value;
  assert.equal(p.capacity.busyHours, busy);
  const powerYear = p.capacity.boxes * basis.aiBox.watts * hours / 1000 * basis.electricityPencePerKwh.value / 100;
  let power = 0;
  for (let y = 0; y < 5; y++) power += powerYear * (1 + basis.cpi.value) ** y;
  close(c.owned, p.capacity.boxes * p.hardware.boxCost + power);
  close(c.officeHours, p.capacity.boxesNeeded * 8.944 * busy * fx * 5);
  close(c.alwaysOn, p.capacity.boxesNeeded * 8.944 * hours * fx * 5);
  const inShare = p.capacity.inPerSec / (p.capacity.inPerSec + p.capacity.outPerSec);
  close(c.perToken, p.capacity.tokens * (inShare * 0.23 + (1 - inShare) * 0.93) / 1e6 * fx * 5);
  close(c.officeHoursTimes, c.officeHours / c.owned);
  close(c.alwaysOnTimes, c.alwaysOn / c.owned);
  close(c.savedVsOfficeHours, c.officeHours - c.owned);
  assert.equal(c.years, 5);
  assert.ok(c.officeHoursTimes > 5, 'renting the London GPU only while the office is open still costs over five times owning');
  assert.ok(c.perToken < c.owned, 'and paying per token IS cheaper on raw compute at this volume — the page says so plainly');
  const one = cloudCompare(p, basis, 1);
  close(one.officeHours * 5, c.officeHours);
  close(one.owned, p.capacity.boxes * p.hardware.boxCost + powerYear);
  // busy hours never exceed the hours in a year
  close(cloudCompare({ ...p, capacity: { ...p.capacity, busyHours: 99999 } }, basis).officeHours, c.alwaysOn);
});

test('cloudCompare: refuses bad inputs, never throws', () => {
  for (const y of [0, -1, 1.5, NaN, '5']) assert.equal(cloudCompare(p, basis, y), null, String(y));
  const zeroBox = { ...p, capacity: { ...p.capacity, boxes: 0 } };
  assert.equal(cloudCompare(zeroBox, basis), null);
  const noCpi = { ...basis, cpi: { value: 'x' } };
  assert.equal(cloudCompare(p, noCpi), null);
  assert.equal(cloudCompare(p, { ...basis, cpi: { value: 0 } }).owned > 0, true);    // zero inflation is a valid world
  assert.equal(cloudCompare(p, { ...basis, cpi: { value: -0.01 } }).years, 5);       // so is deflation
  for (const k of ['boxes', 'boxesNeeded', 'tokens', 'inPerSec', 'outPerSec', 'busyHours']) assert.equal(cloudCompare({ ...p, capacity: { ...p.capacity, [k]: -1 } }, basis), null, k);
  assert.equal(cloudCompare({ ...p, hardware: { ...p.hardware, boxCost: 0 } }, basis), null);
  for (const k of ['hoursPerYear', 'fxGbpPerUsd', 'electricityPencePerKwh']) assert.equal(cloudCompare(p, { ...basis, [k]: { value: 0 } }), null, k);
  assert.equal(cloudCompare(p, { ...basis, aiBox: { ...basis.aiBox, watts: 0 } }), null);
  assert.equal(cloudCompare(p, { ...basis, awsGpuLondon: { usdPerHour: -1 } }), null);
  assert.equal(cloudCompare(p, { ...basis, bedrockGptOss120b: { inPerM: 0, outPerM: 1 } }), null);
  assert.equal(cloudCompare(p, { ...basis, bedrockGptOss120b: { inPerM: 1, outPerM: 0 } }), null);
  for (const j of [null, undefined, {}, 'x', 1, [], { get capacity() { throw new Error('x'); } }]) { assert.equal(cloudCompare(j, basis), null); assert.equal(cloudCompare(p, j), null); }
});

test('undercut: the rival cuts prices by the yearly gap over your revenue and still earns your profit — or keeps your margin', () => {
  const u = undercut(p, { revenue: 6000000, margin: 0.08 });
  const gap = (p.today.total - p.sovereign.total) / 5;
  close(u.gapYear, gap);
  close(u.costBase, 6000000 * 0.92);
  close(u.modelledYear, p.today.total / 5);
  assert.equal(u.mismatch, false);
  close(u.priceCut, gap / 6000000);
  close(u.sameMarginCut, gap / (6000000 * 0.92));
  close(u.rivalMarginAtYourPrice, 0.08 + gap / 6000000);
  assert.equal(u.yourMargin, 0.08);
  assert.equal(u.headcountYou, 50);
  assert.equal(u.headcountRival, 5);
  close(u.startupCost, p.hardware.total + p.sovereign.setup);
  // the arithmetic of the claims: at the cut price the rival's profit equals yours; at the other cut its margin does
  const yourProfit = 6000000 * 0.08, yourCost = 6000000 - yourProfit;
  close(6000000 * (1 - u.priceCut) - (yourCost - gap), yourProfit);
  const price = 6000000 * (1 - u.sameMarginCut);
  close((price - (yourCost - gap)) / price, 0.08);
  // a revenue too small for the modelled office: flagged, and nothing over 100%
  const small = undercut(p, { revenue: 1500000, margin: 0.07 });
  assert.equal(small.mismatch, true);
  assert.equal(small.priceCut, 1);
  assert.equal(small.sameMarginCut, 1);
  assert.equal(small.rivalMarginAtYourPrice, 1);
  // the exact edge: the modelled office costing exactly your cost base is not a mismatch
  const edge = undercut(p, { revenue: p.today.total / 5, margin: 0 });
  assert.equal(edge.mismatch, false);
  assert.equal(undercut(p, { revenue: 1e12, margin: 0 }).priceCut > 0, true);
  assert.equal(undercut(p, { revenue: 1e6, margin: 0.99 }).yourMargin, 0.99);
  assert.equal(undercut(p, { revenue: 1e6, margin: -0.99 }).yourMargin, -0.99);
  const shrinking = undercut({ ...p, today: { ...p.today, total: p.sovereign.total - 5 } }, { revenue: 100, margin: 0 });
  assert.equal(shrinking.priceCut, 0);                                                  // no gap, no cut — never negative
  assert.equal(shrinking.sameMarginCut, 0);
  close(undercut(p, { revenue: 6000000, margin: 0.08, years: 1 }).gapYear, p.today.total - p.sovereign.total);
});

test('undercut: refuses bad inputs, never throws', () => {
  for (const bad of [{ revenue: 0, margin: 0.1 }, { revenue: -5, margin: 0.1 }, { revenue: 'x', margin: 0.1 }, { revenue: 1, margin: 1 }, { revenue: 1, margin: 1.01 },
    { revenue: 1, margin: -1 }, { revenue: 1, margin: -1.01 }, { revenue: 1, margin: NaN }, { revenue: 1, margin: 0.1, years: 0 }, { revenue: 1, margin: 0.1, years: 2.5 }, {}]) {
    assert.equal(undercut(p, bad), null, JSON.stringify(bad));
  }
  assert.equal(undercut(p), null);
  assert.equal(undercut({ today: { total: 'x' }, sovereign: { total: 1 } }, { revenue: 1, margin: 0 }), null);
  assert.equal(undercut({ today: { total: Infinity }, sovereign: { total: Infinity } }, { revenue: 1, margin: 0 }), null);
  assert.equal(undercut({ today: { total: 1, headcount: 1 }, sovereign: { total: Infinity, headcount: 1 }, hardware: { total: 1 } }, { revenue: 1, margin: 0 }), null, 'an infinite gap is refused even when your own costs are finite');
  for (const j of [null, undefined, 'x', 1, [], { get today() { throw new Error('x'); } }]) { assert.equal(undercut(j, { revenue: 1, margin: 0 }), null); assert.equal(undercut(p, j), null); }
});
