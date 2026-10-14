// VENDORED from sjgant80-hub/konomi-slm (MIT) — Konomi architecture: Thomas Frumkin. ONE patch, marked below: a
// STREAM override so a device can draw its OWN sample (its own seed, its own size) from the same generator.
// domains-ext.mjs — the KONOMI SLM's own extra verticals, for broadening the library tier-over-tier (polymath).
// Same contract as the vendored seed-library domains: loadDomainExt(name) -> { ok, name, title, note, real,
// features[], n, cols{feat:Float64Array}, y:Uint8Array, trainRows[], heldRows[] }. The vendored seed-library
// domains.mjs is left pristine; these are konomi-slm's own, so the ladder has new ground to grow into.
//
// HONESTY: these three are REALISTIC-SYNTHETIC — generated deterministically from a known ground-truth rule plus
// seeded Gaussian noise, so held-out generalisation is real (train and held are disjoint draws from the same
// generator and the grown pattern never sees the held rows) but they are NOT real-world measurements. The rule
// is printed in each note. The one REAL dataset in the stack stays the UCI shopper anchor in seed-library.
// Powered by the Konomi architecture, created by Thomas Frumkin.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const splitByIndex = (n) => { const trainRows = [], heldRows = []; for (let i = 0; i < n; i++) (i % 10 < 3 ? heldRows : trainRows).push(i); return { trainRows, heldRows }; };

export const STREAM = { seed: null, n: null };   // ◊ PATCH (sovereign-enterprise): per-device sample override
function synth(name, title, note, N, seed, featureNames, gen) {
  if (STREAM.n) N = STREAM.n;                        // ◊ PATCH
  if (STREAM.seed !== null) seed = STREAM.seed;      // ◊ PATCH
  const cols = {};
  for (const f of featureNames) cols[f] = new Float64Array(N);
  const y = new Uint8Array(N);
  const r = rng(seed);
  for (let i = 0; i < N; i++) {
    const row = gen(r);
    for (const f of featureNames) cols[f][i] = row[f];
    y[i] = row.latent + 1.0 * gauss(r) > 0 ? 1 : 0;
  }
  const { trainRows, heldRows } = splitByIndex(N);
  return { ok: true, name, title, note, real: false, features: featureNames, n: N, cols, y, trainRows, heldRows };
}

// ── fraud: card-transaction fraud (realistic-synthetic) ──────────────────────────────────────────────────────
const FRAUD_NOTE = 'Card fraud — fraud=1. Ground-truth risk rises with large amounts, late-night hour, distance from '
  + 'home, a burst of recent transactions, higher merchant risk and card-not-present. Realistic-synthetic.';
export function loadFraud() {
  return synth('fraud', 'Card fraud', FRAUD_NOTE, 2400, 404,
    ['amount', 'hourOfDay', 'distanceKm', 'recentTx', 'merchantRisk', 'cardNotPresent'], (r) => {
      const amount = clamp(Math.max(0, 60 + 90 * gauss(r)), 0, 5000);
      const hourOfDay = clamp(13 + 6 * gauss(r), 0, 23);
      const distanceKm = clamp(Math.max(0, 8 + 40 * Math.abs(gauss(r))), 0, 3000);
      const recentTx = clamp(Math.max(0, 2 + 2 * Math.abs(gauss(r))), 0, 40);
      const merchantRisk = clamp(0.3 + 0.25 * gauss(r), 0, 1);
      const cardNotPresent = r() < 0.4 ? 1 : 0;
      const latent = 0.004 * (amount - 120) + 0.10 * Math.max(0, 2 - hourOfDay) + 0.09 * Math.max(0, hourOfDay - 22)
        + 0.003 * distanceKm + 0.12 * (recentTx - 4) + 1.8 * (merchantRisk - 0.5) + 0.8 * cardNotPresent - 1.0;
      return { amount, hourOfDay, distanceKm, recentTx, merchantRisk, cardNotPresent, latent };
    });
}

// ── maintenance: predictive machine failure (realistic-synthetic) ────────────────────────────────────────────
const MAINT_NOTE = 'Predictive maintenance — failure-soon=1. Ground-truth risk rises with high vibration, high '
  + 'temperature, long time since service, sustained high load, machine age and rising error rate. Realistic-synthetic.';
export function loadMaintenance() {
  return synth('maintenance', 'Predictive maintenance', MAINT_NOTE, 2400, 505,
    ['vibration', 'tempC', 'hoursSinceService', 'loadPct', 'ageMonths', 'errorRate'], (r) => {
      const vibration = clamp(Math.max(0, 2 + 1.2 * Math.abs(gauss(r))), 0, 20);
      const tempC = clamp(55 + 12 * gauss(r), 10, 120);
      const hoursSinceService = clamp(Math.max(0, 400 + 250 * gauss(r)), 0, 3000);
      const loadPct = clamp(65 + 18 * gauss(r), 0, 100);
      const ageMonths = clamp(Math.max(0, 36 + 24 * gauss(r)), 0, 240);
      const errorRate = clamp(Math.max(0, 0.5 + 0.6 * Math.abs(gauss(r))), 0, 20);
      const latent = 0.35 * (vibration - 3) + 0.05 * (tempC - 62) + 0.0016 * (hoursSinceService - 450)
        + 0.03 * (loadPct - 60) + 0.012 * (ageMonths - 36) + 0.5 * (errorRate - 1.0) - 1.6;
      return { vibration, tempC, hoursSinceService, loadPct, ageMonths, errorRate, latent };
    });
}

// ── credit: consumer loan default (realistic-synthetic) ──────────────────────────────────────────────────────
const CREDIT_NOTE = 'Consumer credit — default=1. Ground-truth risk rises with high debt-to-income, high credit '
  + 'utilisation, more delinquencies, lower income, higher loan-to-value and shorter employment. Realistic-synthetic.';
export function loadCredit() {
  return synth('credit', 'Loan default', CREDIT_NOTE, 2400, 606,
    ['dti', 'utilisation', 'delinquencies', 'incomeK', 'loanToValue', 'employMonths'], (r) => {
      const dti = clamp(0.35 + 0.15 * gauss(r), 0, 1.5);
      const utilisation = clamp(0.5 + 0.22 * gauss(r), 0, 1.5);
      const delinquencies = clamp(Math.max(0, Math.round(0.6 + 1.0 * Math.abs(gauss(r)))), 0, 12);
      const incomeK = clamp(Math.max(8, 42 + 18 * gauss(r)), 8, 300);
      const loanToValue = clamp(0.7 + 0.18 * gauss(r), 0, 1.4);
      const employMonths = clamp(Math.max(0, 48 + 36 * gauss(r)), 0, 480);
      const latent = 2.2 * (dti - 0.36) + 1.6 * (utilisation - 0.5) + 0.45 * (delinquencies - 0.8)
        - 0.02 * (incomeK - 42) + 1.5 * (loanToValue - 0.75) - 0.006 * (employMonths - 48) - 0.3;
      return { dti, utilisation, delinquencies, incomeK, loanToValue, employMonths, latent };
    });
}

// ── churn: subscription churn (realistic-synthetic) ─────────────────────────────────────────────────────────
const CHURN_NOTE = 'Subscription churn — churn=1. Ground-truth risk rises with short tenure, many support tickets, '
  + 'a big usage drop, little contract left and few weekly logins. Realistic-synthetic.';
export function loadChurn() {
  return synth('churn', 'Subscription churn', CHURN_NOTE, 2400, 707,
    ['tenureMonths', 'monthlySpend', 'supportTickets', 'usageDropPct', 'contractMonthsLeft', 'loginsPerWeek'], (r) => {
      const tenureMonths = clamp(Math.max(0, 20 + 16 * gauss(r)), 0, 120);
      const monthlySpend = clamp(Math.max(0, 55 + 25 * gauss(r)), 0, 400);
      const supportTickets = clamp(Math.max(0, Math.round(1.5 + 1.8 * Math.abs(gauss(r)))), 0, 30);
      const usageDropPct = clamp(15 + 20 * gauss(r), -40, 100);
      const contractMonthsLeft = clamp(Math.max(0, 6 + 5 * gauss(r)), 0, 24);
      const loginsPerWeek = clamp(Math.max(0, 6 + 4 * gauss(r)), 0, 50);
      const latent = -0.05 * (tenureMonths - 18) + 0.28 * (supportTickets - 1.5) + 0.035 * (usageDropPct - 10)
        - 0.12 * (contractMonthsLeft - 6) - 0.14 * (loginsPerWeek - 6) - 0.4;
      return { tenureMonths, monthlySpend, supportTickets, usageDropPct, contractMonthsLeft, loginsPerWeek, latent };
    });
}

// ── energy: grid-overload forecast (realistic-synthetic) ────────────────────────────────────────────────────
const ENERGY_NOTE = 'Grid overload — overload=1. Ground-truth risk rises with high load, temperature extremes, peak '
  + 'hours and low wind supply. Realistic-synthetic.';
export function loadEnergy() {
  return synth('energy', 'Grid overload', ENERGY_NOTE, 2400, 808,
    ['loadMW', 'tempC', 'hourOfDay', 'humidity', 'windMW', 'priceMWh'], (r) => {
      const loadMW = clamp(Math.max(0, 600 + 150 * gauss(r)), 0, 2000);
      const tempC = clamp(18 + 11 * gauss(r), -15, 48);
      const hourOfDay = clamp(14 + 5 * gauss(r), 0, 23);
      const humidity = clamp(55 + 18 * gauss(r), 0, 100);
      const windMW = clamp(Math.max(0, 120 + 70 * gauss(r)), 0, 600);
      const priceMWh = clamp(Math.max(0, 55 + 30 * gauss(r)), 0, 600);
      const latent = 0.006 * (loadMW - 620) + 0.07 * Math.abs(tempC - 20) + 0.12 * Math.max(0, hourOfDay - 16)
        - 0.004 * (windMW - 120) + 0.003 * (priceMWh - 55) - 1.3;
      return { loadMW, tempC, hourOfDay, humidity, windMW, priceMWh, latent };
    });
}

// ── intrusion: network intrusion (realistic-synthetic) ──────────────────────────────────────────────────────
const INTRUSION_NOTE = 'Network intrusion — intrusion=1. Ground-truth risk rises with failed logins, many distinct '
  + 'ports touched, lopsided byte ratios, long connections and off-hours activity. Realistic-synthetic.';
export function loadIntrusion() {
  return synth('intrusion', 'Network intrusion', INTRUSION_NOTE, 2400, 909,
    ['bytesInKB', 'bytesOutKB', 'connSeconds', 'failedLogins', 'distinctPorts', 'offHours'], (r) => {
      const bytesInKB = clamp(Math.max(0, 120 + 90 * gauss(r)), 0, 5000);
      const bytesOutKB = clamp(Math.max(0, 90 + 80 * gauss(r)), 0, 5000);
      const connSeconds = clamp(Math.max(0, 30 + 40 * Math.abs(gauss(r))), 0, 1000);
      const failedLogins = clamp(Math.max(0, Math.round(0.8 + 1.6 * Math.abs(gauss(r)))), 0, 50);
      const distinctPorts = clamp(Math.max(1, Math.round(3 + 4 * Math.abs(gauss(r)))), 1, 200);
      const offHours = r() < 0.35 ? 1 : 0;
      const latent = 0.5 * (failedLogins - 1) + 0.12 * (distinctPorts - 4) + 0.004 * (connSeconds - 30)
        + 0.001 * (bytesOutKB - bytesInKB) + 0.7 * offHours - 1.2;
      return { bytesInKB, bytesOutKB, connSeconds, failedLogins, distinctPorts, offHours, latent };
    });
}

// ── inventory: stockout risk (realistic-synthetic) ──────────────────────────────────────────────────────────
const INVENTORY_NOTE = 'Inventory stockout — stockout=1. Ground-truth risk rises with low days-of-stock, long lead '
  + 'time, high demand variance, a big reorder gap and low supplier reliability. Realistic-synthetic.';
export function loadInventory() {
  return synth('inventory', 'Inventory stockout', INVENTORY_NOTE, 2400, 1010,
    ['daysOfStock', 'leadTimeDays', 'demandVar', 'reorderGap', 'seasonalityIdx', 'supplierReliab'], (r) => {
      const daysOfStock = clamp(Math.max(0, 18 + 10 * gauss(r)), 0, 120);
      const leadTimeDays = clamp(Math.max(0, 10 + 6 * gauss(r)), 0, 90);
      const demandVar = clamp(Math.max(0, 0.4 + 0.25 * Math.abs(gauss(r))), 0, 3);
      const reorderGap = clamp(5 + 6 * gauss(r), -30, 60);
      const seasonalityIdx = clamp(1 + 0.4 * gauss(r), 0, 3);
      const supplierReliab = clamp(0.82 + 0.12 * gauss(r), 0, 1);
      const latent = -0.10 * (daysOfStock - 16) + 0.06 * (leadTimeDays - 9) + 1.2 * (demandVar - 0.4)
        + 0.05 * (reorderGap - 4) - 2.0 * (supplierReliab - 0.8) - 0.3;
      return { daysOfStock, leadTimeDays, demandVar, reorderGap, seasonalityIdx, supplierReliab, latent };
    });
}

// ── marketing: lead / campaign conversion (realistic-synthetic) ─────────────────────────────────────────────
const MARKETING_NOTE = 'Marketing — converts=1. Ground-truth lift rises with more email opens and clicks, recent site '
  + 'visits, time on site, past purchases, and recency; high ad fatigue dampens it. Realistic-synthetic.';
export function loadMarketing() {
  return synth('marketing', 'Lead conversion', MARKETING_NOTE, 2400, 1111,
    ['emailOpens', 'clickRate', 'siteVisits', 'timeOnSiteMin', 'pastPurchases', 'daysSinceLast', 'adExposures'], (r) => {
      const emailOpens = clamp(Math.max(0, 4 + 3 * gauss(r)), 0, 40);
      const clickRate = clamp(0.12 + 0.08 * gauss(r), 0, 1);
      const siteVisits = clamp(Math.max(0, 3 + 3 * Math.abs(gauss(r))), 0, 60);
      const timeOnSiteMin = clamp(Math.max(0, 6 + 5 * gauss(r)), 0, 120);
      const pastPurchases = clamp(Math.max(0, Math.round(1 + 1.5 * Math.abs(gauss(r)))), 0, 40);
      const daysSinceLast = clamp(Math.max(0, 40 + 30 * gauss(r)), 0, 400);
      const adExposures = clamp(Math.max(0, 8 + 6 * Math.abs(gauss(r))), 0, 80);
      const latent = 0.10 * (emailOpens - 4) + 3.0 * (clickRate - 0.12) + 0.08 * (siteVisits - 3)
        + 0.05 * (timeOnSiteMin - 6) + 0.18 * (pastPurchases - 1) - 0.006 * (daysSinceLast - 40)
        - 0.03 * Math.max(0, adExposures - 25) - 0.4;
      return { emailOpens, clickRate, siteVisits, timeOnSiteMin, pastPurchases, daysSinceLast, adExposures, latent };
    });
}

export const EXT_IDS = ['fraud', 'maintenance', 'credit', 'churn', 'energy', 'intrusion', 'inventory', 'marketing'];
// the ladder climbs one batch of new verticals per rung (tier 1 -> 2 -> 3)
export const LADDER_BATCHES = [['fraud', 'maintenance', 'credit'], ['churn', 'energy', 'intrusion', 'inventory']];
export const EXT_META = {
  fraud: { title: 'Card fraud', real: false, survival: 'finance', note: FRAUD_NOTE },
  maintenance: { title: 'Predictive maintenance', real: false, survival: 'industry', note: MAINT_NOTE },
  credit: { title: 'Loan default', real: false, survival: 'finance', note: CREDIT_NOTE },
  churn: { title: 'Subscription churn', real: false, survival: 'commerce', note: CHURN_NOTE },
  energy: { title: 'Grid overload', real: false, survival: 'energy', note: ENERGY_NOTE },
  intrusion: { title: 'Network intrusion', real: false, survival: 'security', note: INTRUSION_NOTE },
  inventory: { title: 'Inventory stockout', real: false, survival: 'supply chain', note: INVENTORY_NOTE },
  marketing: { title: 'Lead conversion', real: false, survival: 'marketing', note: MARKETING_NOTE },
};
export function loadDomainExt(name) {
  if (name === 'fraud') return loadFraud();
  if (name === 'maintenance') return loadMaintenance();
  if (name === 'credit') return loadCredit();
  if (name === 'churn') return loadChurn();
  if (name === 'energy') return loadEnergy();
  if (name === 'intrusion') return loadIntrusion();
  if (name === 'inventory') return loadInventory();
  if (name === 'marketing') return loadMarketing();
  return { ok: false, error: 'unknown ext domain: ' + name };
}
