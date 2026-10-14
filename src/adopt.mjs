// adopt.mjs — fit it to your business. Pure, total, deterministic.
//
// A visitor enters THEIR business: headcount per department, what each costs, how much of each department's work
// they believe agents can do end to end, the people the AI assists but never replaces (fee-earners, staff on site),
// their software bill and their roll-out cost. officeFor builds an office in exactly the shape src/office.mjs plan()
// reads, starting from the modelled office the white paper uses (data/office.json) — so the five-year comparison,
// the transition, the payback and the NPV they get back are computed by the same kernel, never typed.
//
// The AI-native team is the model's own (its retained roles) unless the human remainder — the share of the work the
// AI does not do — would not fit their oversight time. Then it adds AI-native leads one at a time, each to the role
// whose departments carry the most remainder per person, until it fits. That is the same aggregate rule plan()
// checks (`human.fits`), so a bigger company is never shown run by too few people. Kept lines are not in the
// remainder: they keep doing their own work, assisted.
import { plan, shareOf, transition, payback } from './office.mjs';

export const MAX_HEADS = 10000;      // per department — a form field, not a census
export const MAX_ADDED = 10000;      // a ceiling on added leads, so a malformed model can never loop for ever
export const MAX_MONEY = 1e9;        // £ — a form field, not a balance sheet
const DIGITS = /^\s*\d{1,5}\s*$/;
const MONEY = /^\s*£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*([km])?\s*$/i;

/** The people the AI assists but never replaces — offered on every form, kept on the AI-native payroll. */
export const KEPT_LINES = Object.freeze([
  Object.freeze({ id: 'clients', name: 'Fee-earners and client delivery (kept)', work: 'The advice, the craft and the judgement clients pay for. The agents take their admin; they stay.' }),
  Object.freeze({ id: 'field', name: 'Engineers and staff on site (kept)', work: 'The work done in person — jobs, installs, repairs, care. The agents take their paperwork; they stay.' }),
]);
const KEPT = new Map(KEPT_LINES.map((k) => [k.id, k]));

// officeFor works on a JSON copy of the model, and JSON has no NaN or Infinity (they become null) — so in the copy every
// number is finite, and "is it a number" is the whole test (plan() reads the same copy the same way).
const num = (x, d) => (typeof x === 'number' ? x : d);
const no = (why) => ({ ok: false, why, office: null, added: 0 });

/** A headcount from a form field: a whole number from 0 to MAX_HEADS (a number, or a string of digits), else null. */
export function headcount(x) {
  try {
    const n = typeof x === 'number' ? x : typeof x === 'string' && DIGITS.test(x) ? Number(x) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= MAX_HEADS ? n : null;
  } catch { return null; }
}

/** £ from a form field: a number, or '45000', '£45,000', '45,000.50', '45k', '7m', '7.5m' → pounds from 0 to MAX_MONEY, else null. */
export function money(x) {
  try {
    let n = NaN;
    if (typeof x === 'number') n = x;
    else if (typeof x === 'string') {
      const m = MONEY.exec(x);
      if (m) n = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : '')) * ({ k: 1e3, m: 1e6 }[String(m[3]).toLowerCase()] || 1);
    }
    return Number.isFinite(n) && n >= 0 && n <= MAX_MONEY ? n : null;
  } catch { return null; }
}

/** A share of work from a form field: a fraction 0..1, or a percent string '0'..'100' (with or without %), else null. */
export function share(x) {
  try {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*\d{1,3}(\.\d+)?\s*%?\s*$/.test(x) ? Number(x.replace('%', '')) / 100 : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  } catch { return null; }
}

/** The form's fields, from the modelled office: one per department, the kept lines, then leadership.
 *  → [{ id, label, value, work, kept? }] */
export function formFields(base) {
  try {
    const depts = base.departments.map((d) => ({ id: String(d.id), label: String(d.name || d.id), value: headcount(d.today) ?? 0, work: String(d.work || '') }));
    const ids = new Set(depts.map((d) => d.id));
    const kept = KEPT_LINES.filter((k) => !ids.has(k.id)).map((k) => ({ id: k.id, label: k.name, value: 0, work: k.work, kept: true }));
    return [...depts, ...kept, { id: 'leadership', label: 'Leadership', value: headcount(base.leadership && base.leadership.today) ?? 0, work: 'Direction, decisions, relationships' }];
  } catch { return []; }
}

const TOP = new Map([['aiShare', 'aiShare'], ['software', 'softwarePerYear'], ['setup', 'setupCost'], ['leadership.pay', 'leadershipPay']]);
/** What the form sends — [{ id, value }] — as officeFor's input. 'leadership' is leadership; 'aiShare', 'software',
 *  'setup' and 'leadership.pay' are the office's; '<dept>' is a headcount, '<dept>.pay' its cost per head, '<dept>.share'
 *  its own automation share. One department's fields merge into one entry, in the order they first appear. */
export function fitInput(pairs) {
  try {
    const out = { departments: [] };
    const byId = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      if (!p || typeof p !== 'object') continue;
      const id = p.id;
      if (id === 'leadership') { out.leadership = p.value; continue; }
      if (TOP.has(id)) { out[TOP.get(id)] = p.value; continue; }
      const [dept, field] = typeof id === 'string' && id.includes('.') ? id.split('.', 2) : [id, 'today'];
      const key = { pay: 'payYear', share: 'aiShare' }[field] || 'today';
      if (!byId.has(dept)) { const e = { id: dept }; byId.set(dept, e); out.departments.push(e); }
      byId.get(dept)[key] = p.value;
    }
    return out;
  } catch { return { departments: [] }; }
}

/**
 * Your office, in the model's shape. input = { departments: [{ id, today?, payYear?, aiShare? }], leadership?,
 * leadershipPay?, aiShare?, softwarePerYear?, setupCost? }; base = data/office.json. A department you do not give
 * keeps the model's numbers; a kept line you give joins the office. → { ok, office, added, why } — never throws.
 */
export function officeFor(input, base) {
  try {
    if (!base || typeof base !== 'object' || !Array.isArray(base.departments) || !Array.isArray(base.retained)) return no('the modelled office is missing');
    const office = JSON.parse(JSON.stringify(base));
    const inp = input && typeof input === 'object' ? input : {};
    const byId = new Map(office.departments.map((d) => [d && d.id, d]));
    const seen = new Set();
    for (const e of Array.isArray(inp.departments) ? inp.departments : []) {
      const id = e && typeof e === 'object' ? e.id : undefined;
      let d = typeof id === 'string' ? byId.get(id) : undefined;
      const k = d ? undefined : KEPT.get(id);
      if (!d && !k) return no('there is no department called ' + String(id).slice(0, 40));
      if (seen.has(id)) return no('the ' + id + ' department was given twice');
      const name = d ? d.name || id : k.name;
      const n = 'today' in e ? headcount(e.today) : d ? null : 0;
      if (n === null && (!d || 'today' in e)) return no('the headcount for ' + name + ' must be a whole number from 0 to ' + MAX_HEADS);
      seen.add(id);
      if (!d) {
        if (n === 0) continue;                                // an empty kept line changes nothing — leave the model as it is
        d = { id, name: k.name, today: n, kept: true, seats: [], work: k.work };
        office.departments.push(d);
      } else if ('today' in e) d.today = n;
      if ('payYear' in e) {
        const m = money(e.payYear);
        if (m === null) return no('the cost per person for ' + name + ' must be an amount in pounds from 0 to £1,000,000,000');
        d.payYear = m;
      }
      if ('aiShare' in e) {
        const s = share(e.aiShare);
        if (s === null) return no('the share of ' + name + '’s work done by agents must be from 0% to 100%');
        d.aiShare = s;
      }
    }
    if ('leadership' in inp) {
      const n = headcount(inp.leadership);
      if (n === null) return no('the leadership headcount must be a whole number from 0 to ' + MAX_HEADS);
      office.leadership = { ...(office.leadership || {}), today: n };
    }
    if ('leadershipPay' in inp) {
      const m = money(inp.leadershipPay);
      if (m === null) return no('the cost per leader must be an amount in pounds from 0 to £1,000,000,000');
      office.leadership = { ...(office.leadership || {}), payYear: m };
    }
    if ('aiShare' in inp) {
      const s = share(inp.aiShare);
      if (s === null) return no('the share of the work done by agents must be from 0% to 100%');
      office.aiShare = s;
    }
    for (const [key, what] of [['softwarePerYear', 'the software bill per year'], ['setupCost', 'the roll-out cost']]) {
      if (!(key in inp)) continue;
      const m = money(inp[key]);
      if (m === null) return no(what + ' must be an amount in pounds from 0 to £1,000,000,000');
      office[key] = m;
    }
    return { ok: true, office, added: sizeTeam(office), why: '' };
  } catch { return no('the input could not be read'); }
}

// Grow the retained team until the human remainder fits its oversight time — plan()'s own aggregate test.
function sizeTeam(o) {
  // a department's human remainder, in FTE — exactly plan()'s rule (its own share, a kept line carries none)
  const rem = (d) => (d && d.kept === true ? 0 : Math.max(0, num(d && d.today, 0)) * (1 - shareOf(d, o)));
  const need = o.departments.reduce((s, d) => s + rem(d), 0);
  let cap = o.retained.reduce((s, r) => s + Math.max(0, num(r && r.oversight, 0)), 0);
  const roles = o.retained.filter((r) => r && Array.isArray(r.covers) && r.covers.length && num(r.oversight, 0) > 0);
  const people = new Map(roles.map((r) => [r, 1]));
  const covered = (r) => r.covers.reduce((s, id) => s + rem(o.departments.find((d) => d && d.id === id)), 0);
  const load = (r) => covered(r) / people.get(r);
  let added = 0;
  while (roles.length && Math.round(need * 1e6) > Math.round(cap * 1e6) && added < MAX_ADDED) {
    const pick = roles.reduce((best, r) => (load(r) > load(best) ? r : best));
    o.retained.push({ ...pick });
    people.set(pick, people.get(pick) + 1);
    cap += pick.oversight;
    added++;
  }
  return added;
}

/** officeFor + plan + the transition + payback in one call.
 *  → { ok, why, office, added, plan, transition, payback } — plan is office.mjs plan(office, basis). */
export function fitPlan(input, base, basis) {
  try {
    const r = officeFor(input, base);
    if (!r.ok) return { ...r, plan: null, transition: null, payback: null };
    const p = plan(r.office, basis);
    const t = transition(p, r.office, basis);
    return { ok: true, why: '', office: r.office, added: r.added, plan: p, transition: t, payback: payback(p, t, basis) };
  } catch { return { ...no('the input could not be read'), plan: null, transition: null, payback: null }; }
}

// the same input with one automation share for every line that is not kept
const atShare = (input, s) => {
  const inp = input && typeof input === 'object' ? input : {};
  const depts = (Array.isArray(inp.departments) ? inp.departments : []).map((e) => {
    if (!e || typeof e !== 'object') return e;
    const { aiShare, ...rest } = e;
    return rest;
  });
  return { ...inp, departments: depts, aiShare: s };
};

/** The saving at other automation shares — the assumption under every number, made visible. Each row re-sizes the
 *  team. → [{ share, ok, today, sovereign, team, saving, transition, net, paybackMonths, npv }] */
export function sensitivity(input, base, basis, shares) {
  try {
    const list = Array.isArray(shares) ? shares : [0.5, 0.7, 0.9];
    return list.map((s) => {
      const f = fitPlan(atShare(input, s), base, basis);
      if (!f.ok) return { share: s, ok: false, why: f.why };
      return { share: s, ok: true, today: f.plan.today.total, sovereign: f.plan.sovereign.total, team: f.plan.sovereign.headcount,
        saving: f.plan.saving, transition: f.transition.total, net: f.payback.net, paybackMonths: f.payback.paybackMonths, npv: f.payback.npv };
    });
  } catch { return []; }
}

/** The automation share at which the five-year saving, after the transition, is exactly zero — below it, it does not pay.
 *  → { ok, share (0..1, to 0.001) | null (never pays at 100%), alwaysPays (pays even at 0%) } */
export function breakEven(input, base, basis) {
  try {
    const net = (s) => { const f = fitPlan(atShare(input, s), base, basis); return f.ok ? f.payback.net : NaN; };
    const hi = net(1);                                   // the same input at another share is just as valid: one check
    if (!Number.isFinite(hi)) return { ok: false, share: null, alwaysPays: false };
    if (hi < 0) return { ok: true, share: null, alwaysPays: false };
    if (net(0) >= 0) return { ok: true, share: 0, alwaysPays: true };
    let a = 0, b = 1;
    for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (net(m) >= 0) b = m; else a = m; }
    return { ok: true, share: Math.ceil(b * 1000) / 1000, alwaysPays: false };
  } catch { return { ok: false, share: null, alwaysPays: false }; }
}
