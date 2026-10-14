// office.mjs — the AI-native office: what it costs, what it needs, what it frees. Pure, total, deterministic.
//
// One kernel computes every number the white paper shows, from two inputs: data/basis.json (every external
// figure, sourced) and data/office.json (the modelled office). Three ways to run the same 50-person office for
// five years:
//   today      — 50 people + rented per-seat software
//   assisted   — the same 50 people + an AI seat on every desk (the AI helps; the people still do the work)
//   sovereign  — 5 AI-native people + AI boxes they own + per-use limbs (the AI does the work; people oversee)
// Their pay, seats and power rise with CPI each year; token and voice prices are held flat.

const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const v = (b, k, d = 0) => num(b && b[k] && b[k].value, d);

/** Employer cost of one salary: gross + employer NI above the threshold + pension on qualifying earnings. */
export function employerCost(gross, b) {
  const g = Math.max(0, num(gross));
  const ni = v(b, 'employerNiRate') * Math.max(0, g - v(b, 'employerNiThreshold'));
  const qe = Math.max(0, Math.min(g, v(b, 'pensionQeUpper')) - v(b, 'pensionQeLower'));
  const pension = v(b, 'pensionEmployerRate') * qe;
  return { gross: g, ni, pension, total: g + ni + pension };
}

/** Sum over `years` of (1 + cpi)^t, t = 0..years-1 — the multiplier for a cost that rises with CPI. */
export function cpiFactor(cpi, years) {
  let s = 0;
  const n = Math.max(0, Math.floor(num(years)));
  for (let t = 0; t < n; t++) s += (1 + num(cpi)) ** t;
  return s;
}

/** Seat cost per year for a set of seat kinds × users. */
export function seatsPerYear(kinds, users, b) {
  let s = 0;
  for (const k of Array.isArray(kinds) ? kinds : []) s += num(b && b['seat.' + k] && b['seat.' + k].value) * 12 * Math.max(0, num(users));
  return s;
}

const clamp01 = (x, d) => Math.min(1, Math.max(0, num(x, d)));
/** A department's share of work done end to end by AI: its own `aiShare` if set, else the office's; a kept line is 0. */
export const shareOf = (d, o) => (d && d.kept === true ? 0 : clamp01(d && d.aiShare, clamp01(o && o.aiShare, 0.9)));
/** A per-head yearly cost the visitor typed (fully loaded), or the fallback. */
const payOr = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback);

/** The whole comparison. → { today, assisted, sovereign, saving, savingPct, capacity, human, hardware, departments }
 *  Each department may set `aiShare` (its own automation assumption), `kept: true` (the AI assists them, never
 *  replaces them — fee-earners, engineers on site) and `payYear` (its fully loaded cost per head). The office may set
 *  `softwarePerYear` (today's software bill, instead of counting seats) and `setupCost` (instead of days × rate). */
export function plan(office, b) {
  const o = office && typeof office === 'object' ? office : {};
  const depts = Array.isArray(o.departments) ? o.departments : [];
  const years = Math.max(1, Math.floor(num(o.years, 5)));
  const hours = num(o.hoursPerFte, 1950);
  const cpi = v(b, 'cpi');
  const F = cpiFactor(cpi, years);
  const fx = v(b, 'fxGbpPerUsd', 1);
  const vat = v(b, 'vat');
  const exVat = (p) => num(p) / (1 + vat);
  const heads = (d) => Math.max(0, num(d && d.today));

  // ── today: every department's people at the median (or the cost the visitor gave), leadership at the senior rate, plus seats
  const median = employerCost(v(b, 'wageMedianHourly') * hours, b);
  const senior = employerCost(v(b, 'seniorSalary'), b);
  const lead = (o.leadership && num(o.leadership.today)) || 0;
  const opsHeads = depts.reduce((s, d) => s + heads(d), 0);
  const keptHeads = depts.reduce((s, d) => s + (d && d.kept === true ? heads(d) : 0), 0);
  const deptPay = (d) => heads(d) * payOr(d && d.payYear, median.total);
  let seats = 0;
  for (const d of depts) seats += seatsPerYear(d.seats, d.today, b);
  if (o.leadership) seats += seatsPerYear(o.leadership.seats, lead, b);
  seats = payOr(o.softwarePerYear, seats);
  const leadPay = lead * payOr(o.leadership && o.leadership.payYear, senior.total);
  const todayPay = depts.reduce((s, d) => s + deptPay(d), 0) + leadPay;
  const today = { headcount: opsHeads + lead, payYear1: todayPay, seatsYear1: seats, total: (todayPay + seats) * F };

  // ── assisted: the same people and seats, plus an AI seat on every desk
  const copilot = seatsPerYear(['copilot'], opsHeads + lead, b);
  const assisted = { headcount: today.headcount, payYear1: todayPay, seatsYear1: seats + copilot, total: (todayPay + seats + copilot) * F };

  // ── capacity: the AI does each department's share of its operational hours; size the AI boxes from measured throughput
  const aiHours = depts.reduce((s, d) => s + heads(d) * hours * shareOf(d, o), 0);
  const tokens = aiHours * num(o.tokensPerHumanHour);
  const outShare = Math.min(1, Math.max(0, num(o.outputShare, 0.25)));
  const busySec = Math.max(1, num(o.businessHoursPerYear, 2600) * 3600);
  const box = (b && b.aiBox) || {};
  const outPerSec = (tokens * outShare) / busySec;
  const inPerSec = (tokens * (1 - outShare)) / busySec;
  const decode = Math.max(1, num(box.decodeTokPerSec, 1));
  const prefill = Math.max(1, num(box.prefillTokPerSec, 1));
  const boxesNeeded = Math.max(1, Math.ceil(outPerSec / decode), Math.ceil(inPerSec / prefill));
  const boxes = boxesNeeded + Math.max(0, Math.floor(num(o.boxesSpare)));
  const capacity = {
    aiHours, tokens, outPerSec, inPerSec, boxesNeeded, boxes, busyHours: busySec / 3600,
    decodeUtilisation: outPerSec / (decode * boxes), prefillUtilisation: inPerSec / (prefill * boxes),
  };

  // ── sovereign: the retained AI-native people + what they own + what they rent per use
  const retained = Array.isArray(o.retained) ? o.retained : [];
  const leadCost = employerCost(v(b, 'seniorSalary') * (1 + num(o.aiNativePremium)), b);
  const keptPay = depts.reduce((s, d) => s + (d && d.kept === true ? deptPay(d) : 0), 0);
  const sovPay = retained.length * leadCost.total + keptPay;
  const hub = (b && b.hub) || {};
  const hardware = { boxes, boxCost: exVat(box.priceIncVat), hubCost: exVat(hub.priceIncVat) };
  hardware.total = boxes * hardware.boxCost + hardware.hubCost;
  const watts = boxes * num(box.watts) + num(hub.watts);
  const kwh = (watts * 24 * 365) / 1000;
  const powerYear1 = kwh * v(b, 'electricityPencePerKwh') / 100;
  const fr = (b && b.frontier) || {};
  const blendPerM = (1 - outShare) * num(fr.inPerM) + outShare * num(fr.outPerM);
  const frontierYear = (tokens * Math.min(1, Math.max(0, num(o.frontierShare))) / 1e6) * blendPerM * fx;
  const service = depts.find((d) => d.id === 'service');
  const phoneMin = service ? heads(service) * hours * shareOf(service, o) * Math.min(1, Math.max(0, num(o.phoneShareOfService))) * 60 : 0;
  const voiceYear = phoneMin * v(b, 'voicePerMinute') * fx;
  const setup = payOr(o.setupCost, Math.max(0, num(o.setupDays)) * Math.max(0, num(o.dayRate)));
  const sovereign = {
    headcount: retained.length + keptHeads, kept: keptHeads, payYear1: sovPay, hardware: hardware.total, powerYear1, kwh, watts,
    frontierYear, voiceYear, phoneMinutes: phoneMin, setup,
    total: sovPay * F + powerYear1 * F + (frontierYear + voiceYear) * years + hardware.total + setup,
  };

  // ── the human remainder: does the share the AI does not do (the Watch list and the exceptions) fit the retained
  //    people's oversight time? Kept lines are not in it: they keep doing their own work, assisted.
  const remainderFte = depts.reduce((s, d) => s + (d && d.kept === true ? 0 : heads(d) * (1 - shareOf(d, o))), 0);
  const capacityFte = retained.reduce((s, r) => s + Math.max(0, num(r && r.oversight)), 0);
  const human = { remainderFte, capacityFte, weeklyHours: (remainderFte * hours) / 52, fits: Math.round(remainderFte * 1e6) <= Math.round(capacityFte * 1e6) };

  const saving = today.total - sovereign.total;
  const departments = depts.map((d) => ({
    id: d.id, name: d.name, today: num(d.today), kept: d.kept === true, share: shareOf(d, o),
    aiFte: heads(d) * shareOf(d, o), humanFte: heads(d) * (1 - shareOf(d, o)), payYear: payOr(d.payYear, median.total),
    overseenBy: (retained.find((r) => Array.isArray(r.covers) && r.covers.includes(d.id)) || {}).role || null,
  }));
  return {
    years, cpiFactor: F, median, senior, leadCost, today, assisted, sovereign, capacity, human, hardware, departments,
    saving, savingPct: today.total > 0 ? saving / today.total : 0,
    headcountCut: today.headcount > 0 ? 1 - sovereign.headcount / today.headcount : 0,
  };
}

/** Statutory redundancy weeks for one person: by age band per full year of service, service capped (basis.redundancy). */
export function redundancyWeeks(serviceYears, ageBand, b) {
  const r = (b && b.redundancy) || {};
  const years = Math.floor(Math.min(num(serviceYears), num(r.maxServiceYears, 20)));
  if (!(years >= num(r.minServiceYears, 2))) return 0;
  const per = (r.weeksPerYear && num(r.weeksPerYear[ageBand], num(r.weeksPerYear.from22to40, 1))) || 0;
  return years * per;
}

/** Statutory notice weeks for one person: 1 week under 2 years' service, then 1 per full year up to 12. */
export function noticeWeeks(serviceYears) {
  const y = Math.floor(Math.max(0, num(serviceYears)));
  return y < 2 ? 1 : Math.min(12, y);
}

/**
 * The one-off cost of moving to the AI-native company. p = plan(office, b). office.transition = { serviceYears,
 * ageBand, dualRunMonths, trainingDays, contingency }. Everyone in a role that goes is paid statutory redundancy
 * (weekly pay capped) and works their notice inside the dual-running months, while the old team and the agents run
 * side by side; the people who stay are trained; a contingency covers what the plan missed.
 * → { leavers, redundancyWeeks, redundancy, noticeWeeks, consultationDays, hr1, dualRunMonths, dualRun, training, contingency, total }
 */
export function transition(p, office, b) {
  try {
    const o = Object(office);                          // Object(null | undefined | 5) has no fields: every default applies
    const t = Object(o.transition);
    const r = Object(b?.redundancy);
    const c = Object(b?.collectiveConsultation);
    const leavers = Math.max(0, num(p.today.headcount) - num(p.sovereign.headcount));
    // what a leaver costs a week: the average fully loaded cost of the lines that go (the median if none was given)
    const going = (Array.isArray(p.departments) ? p.departments : []).filter((d) => !d.kept);
    const goingHeads = going.reduce((s, d) => s + num(d.today), 0);
    const weeklyCost = (goingHeads > 0 ? going.reduce((s, d) => s + num(d.today) * num(d.payYear), 0) / goingHeads : num(p.median?.total)) / 52;
    const weeklyGross = num(p.median?.gross) / 52;
    const weeks = redundancyWeeks(t.serviceYears, t.ageBand, b);
    const redundancy = leavers * weeks * Math.min(weeklyGross, num(r.weeklyCap, Infinity));
    const notice = noticeWeeks(t.serviceYears);
    const consultationDays = leavers >= num(c.threshold, 20) ? (leavers >= 100 ? num(c.days100plus, 45) : num(c.days20to99, 30)) : 0;
    const dualRunMonths = Math.max(0, num(t.dualRunMonths, 3));
    // the leavers' cost while both run side by side — and any notice or consultation that runs past the dual run
    const dualWeeks = Math.max(dualRunMonths * 52 / 12, notice + consultationDays / 7);
    const dualRun = leavers * weeklyCost * dualWeeks;
    const dayCost = num(p.leadCost && p.leadCost.total) / Math.max(1, num(o.hoursPerFte, 1950) / 7.5);
    const training = num(p.sovereign.headcount) * Math.max(0, num(t.trainingDays, 10)) * dayCost;
    const contingency = Math.max(0, num(t.contingency, 0.2)) * (redundancy + dualRun + training + num(p.sovereign.setup));
    return { leavers, redundancyWeeks: weeks, redundancy, noticeWeeks: notice, consultationDays, hr1: consultationDays > 0,
      dualRunMonths, dualRunWeeks: dualWeeks, dualRun, training, contingency, total: redundancy + dualRun + training + contingency };
  } catch {
    return { leavers: 0, redundancyWeeks: 0, redundancy: 0, noticeWeeks: 0, consultationDays: 0, hr1: false, dualRunMonths: 0, dualRunWeeks: 0, dualRun: 0, training: 0, contingency: 0, total: 0 };
  }
}

/**
 * When it pays back, and what it is worth today. The investment is the hardware, the set-up and the transition;
 * each year saves (today's pay + software) − (the AI-native pay + power + per-use services), with pay, software and
 * power rising by CPI. NPV discounts at the Green Book rate (real) combined with CPI. → { investment, monthlySaving,
 * paybackMonths (null if it never pays back), rate, flows: [year 0..n], npv, net (five-year saving − transition) }
 */
export function payback(p, tr, b) {
  try {
    const cpi = v(b, 'cpi');
    const real = num(b?.discountRateReal?.value, 0.035);
    const rate = (1 + real) * (1 + cpi) - 1;
    const investment = num(p.sovereign.hardware) + num(p.sovereign.setup) + num(tr.total);
    const run = (y) => (num(p.today.payYear1) + num(p.today.seatsYear1)) * (1 + cpi) ** y
      - ((num(p.sovereign.payYear1) + num(p.sovereign.powerYear1)) * (1 + cpi) ** y + num(p.sovereign.frontierYear) + num(p.sovereign.voiceYear));
    const monthlySaving = run(0) / 12;
    const flows = [-investment];
    for (let y = 0; y < num(p.years, 5); y++) flows.push(run(y));
    const npv = flows.reduce((s, f, i) => s + f / (1 + rate) ** i, 0);
    return { investment, monthlySaving, paybackMonths: monthlySaving > 0 ? investment / monthlySaving : null, rate, flows, npv, net: num(p.saving) - num(tr.total) };
  } catch {
    return { investment: 0, monthlySaving: 0, paybackMonths: null, rate: 0, flows: [], npv: 0, net: 0 };
  }
}

/** £ with no pence for large sums. */
export function gbp0(x) {
  const n = Math.round(num(x));
  return (n < 0 ? '−£' : '£') + Math.abs(n).toLocaleString('en-GB');
}
/** £m with one decimal. */
export function gbpM(x) {
  return '£' + (num(x) / 1e6).toFixed(1) + 'm';
}
