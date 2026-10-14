// market.mjs — the two questions a board has to answer. Pure, total, deterministic.
//
//   1. The cloud: what does running the company's AI on machines it owns cost, against renting a GPU from AWS London
//      that can hold the same open-model class, and against paying AWS per token? (Every price is in data/basis.json
//      with its source: the AWS price files for EU (London).)
//   2. The rival: an AI-native company — a competitor, or a few of your own people who leave to start one — runs your
//      business on the AI-native cost base. How far can it cut its prices and still make the profit you make?
//
// Inputs are the white paper's plan (src/office.mjs plan()) and data/basis.json; nothing here is typed by hand.

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => num(x) && x > 0;

/**
 * Owned AI compute vs the cloud, over `years`.
 * owned       — the AI boxes, bought once, plus their electricity at full power around the clock (an upper bound), CPI-raised
 * officeHours — the smallest AWS London GPU instance that holds this model class, one per box the load needs, rented only
 *               for the office's busy hours (p.capacity.busyHours), at list price
 * alwaysOn    — the same instance kept running around the clock (what a service other systems call needs)
 * perToken    — the measured token demand paid per token on Amazon Bedrock in London for the same open-model class
 * → { years, owned, officeHours, alwaysOn, perToken, officeHoursTimes, alwaysOnTimes, savedVsOfficeHours } in GBP, or null
 */
export function cloudCompare(p, basis, years = 5) {
  try {
    const { capacity: c, hardware: h } = p;
    const hours = basis.hoursPerYear.value, fx = basis.fxGbpPerUsd.value, cpi = basis.cpi.value;
    const pence = basis.electricityPencePerKwh.value, watts = basis.aiBox.watts;
    const gpu = basis.awsGpuLondon.usdPerHour, tin = basis.bedrockGptOss120b.inPerM, tout = basis.bedrockGptOss120b.outPerM;
    const checks = [c.boxes, c.boxesNeeded, c.busyHours, h.boxCost, hours, fx, pence, watts, gpu, tin, tout, c.tokens, c.inPerSec, c.outPerSec, years];
    if (!checks.every(pos) || !num(cpi) || !Number.isInteger(years)) return null;
    let power = 0;
    const powerYear = (c.boxes * watts * hours / 1000) * pence / 100;
    for (let y = 0; y < years; y++) power += powerYear * (1 + cpi) ** y;
    const owned = c.boxes * h.boxCost + power;
    const rent = (h2) => c.boxesNeeded * gpu * h2 * fx * years;
    const officeHours = rent(Math.min(c.busyHours, hours));
    const alwaysOn = rent(hours);
    const inShare = c.inPerSec / (c.inPerSec + c.outPerSec);
    const perToken = c.tokens * (inShare * tin + (1 - inShare) * tout) / 1e6 * fx * years;
    return { years, owned, officeHours, alwaysOn, perToken, officeHoursTimes: officeHours / owned, alwaysOnTimes: alwaysOn / owned,
      savedVsOfficeHours: officeHours - owned };
  } catch { return null; }
}

/**
 * The rival. Your office costs today.total over the plan's years; the AI-native rival's costs sovereign.total. Your
 * revenue and margin imply your yearly costs C = revenue × (1 − margin). The yearly gap G lets the rival cut its prices
 * by G / revenue and still earn the profit you earn (priceCut), or by G / C and still earn your margin (sameMarginCut);
 * at your prices it earns your margin plus G / revenue. When the modelled office costs more a year than C, the model is
 * not your business (enter your headcount): `mismatch` is true and the figures are not to be shown as yours.
 * Starting it costs the rival the hardware plus the roll-out (it has nobody to make redundant).
 * → { gapYear, costBase, modelledYear, mismatch, priceCut, sameMarginCut, rivalMarginAtYourPrice, yourMargin,
 *     headcountYou, headcountRival, startupCost } or null
 */
export function undercut(p, inputs) {
  try {
    const { revenue, margin, years = 5 } = inputs || {};
    if (!pos(revenue) || !num(margin) || margin <= -1 || margin >= 1 || !Number.isInteger(years) || years < 1) return null;
    const gapYear = (p.today.total - p.sovereign.total) / years;
    const modelledYear = p.today.total / years;
    if (!num(gapYear) || !num(modelledYear)) return null;
    const costBase = revenue * (1 - margin);
    return {
      gapYear, costBase, modelledYear,
      mismatch: modelledYear > costBase,
      priceCut: Math.min(1, Math.max(0, gapYear / revenue)),
      sameMarginCut: Math.min(1, Math.max(0, gapYear / costBase)),
      rivalMarginAtYourPrice: Math.min(1, margin + gapYear / revenue),
      yourMargin: margin,
      headcountYou: p.today.headcount,
      headcountRival: p.sovereign.headcount,
      startupCost: p.hardware.total + p.sovereign.setup,
    };
  } catch { return null; }
}
