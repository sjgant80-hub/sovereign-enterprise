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

/** The whole comparison. → { today, assisted, sovereign, saving, savingPct, capacity, human, hardware, departments } */
export function plan(office, b) {
  const o = office && typeof office === 'object' ? office : {};
  const depts = Array.isArray(o.departments) ? o.departments : [];
  const years = Math.max(1, Math.floor(num(o.years, 5)));
  const hours = num(o.hoursPerFte, 1950);
  const share = Math.min(1, Math.max(0, num(o.aiShare, 0.9)));
  const cpi = v(b, 'cpi');
  const F = cpiFactor(cpi, years);
  const fx = v(b, 'fxGbpPerUsd', 1);
  const vat = v(b, 'vat');
  const exVat = (p) => num(p) / (1 + vat);

  // ── today: every department's people at the median, leadership at the senior rate, plus their seats
  const median = employerCost(v(b, 'wageMedianHourly') * hours, b);
  const senior = employerCost(v(b, 'seniorSalary'), b);
  const lead = (o.leadership && num(o.leadership.today)) || 0;
  const opsHeads = depts.reduce((s, d) => s + Math.max(0, num(d.today)), 0);
  let seats = 0;
  for (const d of depts) seats += seatsPerYear(d.seats, d.today, b);
  if (o.leadership) seats += seatsPerYear(o.leadership.seats, lead, b);
  const todayPay = opsHeads * median.total + lead * senior.total;
  const today = { headcount: opsHeads + lead, payYear1: todayPay, seatsYear1: seats, total: (todayPay + seats) * F };

  // ── assisted: the same people and seats, plus an AI seat on every desk
  const copilot = seatsPerYear(['copilot'], opsHeads + lead, b);
  const assisted = { headcount: today.headcount, payYear1: todayPay, seatsYear1: seats + copilot, total: (todayPay + seats + copilot) * F };

  // ── capacity: the AI does `share` of the operational hours; size the AI boxes from measured throughput
  const aiHours = opsHeads * hours * share;
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
    aiHours, tokens, outPerSec, inPerSec, boxesNeeded, boxes,
    decodeUtilisation: outPerSec / (decode * boxes), prefillUtilisation: inPerSec / (prefill * boxes),
  };

  // ── sovereign: the retained AI-native people + what they own + what they rent per use
  const retained = Array.isArray(o.retained) ? o.retained : [];
  const leadCost = employerCost(v(b, 'seniorSalary') * (1 + num(o.aiNativePremium)), b);
  const sovPay = retained.length * leadCost.total;
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
  const phoneMin = service ? Math.max(0, num(service.today)) * hours * share * Math.min(1, Math.max(0, num(o.phoneShareOfService))) * 60 : 0;
  const voiceYear = phoneMin * v(b, 'voicePerMinute') * fx;
  const setup = Math.max(0, num(o.setupDays)) * Math.max(0, num(o.dayRate));
  const sovereign = {
    headcount: retained.length, payYear1: sovPay, hardware: hardware.total, powerYear1, kwh, watts,
    frontierYear, voiceYear, phoneMinutes: phoneMin, setup,
    total: sovPay * F + powerYear1 * F + (frontierYear + voiceYear) * years + hardware.total + setup,
  };

  // ── the human remainder: does the share the AI does not do fit the retained people's oversight time?
  const remainderFte = opsHeads * (1 - share);
  const capacityFte = retained.reduce((s, r) => s + Math.max(0, num(r && r.oversight)), 0);
  const human = { remainderFte, capacityFte, fits: Math.round(remainderFte * 1e6) <= Math.round(capacityFte * 1e6) };

  const saving = today.total - sovereign.total;
  const departments = depts.map((d) => ({
    id: d.id, name: d.name, today: num(d.today), aiFte: num(d.today) * share, humanFte: num(d.today) * (1 - share),
    overseenBy: (retained.find((r) => Array.isArray(r.covers) && r.covers.includes(d.id)) || {}).role || null,
  }));
  return {
    years, cpiFactor: F, median, senior, leadCost, today, assisted, sovereign, capacity, human, hardware, departments,
    saving, savingPct: today.total > 0 ? saving / today.total : 0,
    headcountCut: today.headcount > 0 ? 1 - sovereign.headcount / today.headcount : 0,
  };
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
