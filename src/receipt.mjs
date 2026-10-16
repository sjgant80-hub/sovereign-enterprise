// receipt.mjs — THE PER-PLANTING RECEIPT: the signed proof that a business got better when the company was planted in it,
// and — redacted — the next sales asset. Pure, total and deterministic (Ed25519 signing is deterministic too, RFC 8032):
// hostile input gives a refusal value, never a throw; the same inputs give the same body, byte for byte.
//
// INPUTS (buildPlantingReceipt / reproducePlantingReceipt):
//   plan    — the sealed plan src/plant.mjs differentiate() returned (model 'sovereign-enterprise/plant/1'). Refused unless its
//             hash recomputes (hashPlan): a changed plan is not a plan.
//   before  — the planting input exactly as differentiate() received it: { business: { type, pairs }, files: [{ name, text }] }.
//             The files must be the plan's files, in the plan's order, under the same names.
//   office  — { base, basis }: data/office.json and data/basis.json, the model office and its sourced figures — the same pair the
//             plan's office comparison ran on.
//   bridges — the bridge organ's receipts, [{ kind, inputHash, rows, rejected, totals, outputHash }], accepted defensively:
//             any field missing or malformed is kept as null (shown "not measured"), never invented.
//   after   — null before the company has run; then { decisions, outcomes } — the spine's 'decisions' records (plus any 'watch'
//             record the door wrote, agent 'door': work no agent could take) and what really happened, { [event]: 0 | 1 } or a Map.
//   at      — the receipt's date, 'YYYY-MM-DD' (given, never read from a clock, so a re-run reproduces it).
//
// THE BODY (model 'sovereign-enterprise/receipt/1'; canonical JSON — src/canon.mjs — so whole numbers only: shares are permille):
//   business — the kind and a size band only, no names. The band comes from the headcount the office comparison counted.
//   files    — every file handed over: its name, the SHA-256 of its text (UTF-8), what the plan made of it.
//   jobs     — per job, MEASURED HERE on the business's own file, on the rows the brain never grew on (the grower's own split,
//              src/grow.mjs toDataset): BEFORE = how often the business's own past decisions matched what really happened on
//              those same rows (when the brain grew from a decision log that records the outcome), and always the do-nothing
//              line — every case treated as "no", as src/company.mjs jobMetrics counts it; AFTER = the brain's own calls on those
//              rows, its AUC, and how many it answered itself (VERIFIED, src/brain.mjs answer) rather than passing to a person.
//              Each line counts right, and — as jobMetrics counts recall and precision — how many of the real yes cases it caught
//              and how many of its yes calls were real: where nearly every case is "no", doing nothing is right most of the time
//              and catches nothing, so "right" alone would flatter it. A line is a count, never a verdict: the receipt says
//              which line is which and on which rows, and leaves "better" to the numbers.
//              The brain must reproduce its own held-out score on the file exactly, or the receipt is refused — that is
//              what ties the plan to the files. A decision log's own check (agreement with the re-grown rule; how often the old
//              decisions were right over EVERY logged decision) is carried as the plan measured it and never set against the
//              brain's score: those are different rows. A shipped brain's AUC is on its published data, not theirs, and says so.
//   office   — the five-year comparison on their headcount (src/adopt.mjs fitPlan: today vs AI-native, the one-off move, the
//              investment, the monthly saving), re-run here and refused unless it gives the plan's own totals.
//   bridges  — the bridge receipts, as reported.
//   live     — afterFromSpine: decisions, held for a person, finished with a known outcome, right — counted by the company's own
//              boardKpis / scorecard, the functions its board summary uses (one way of counting, not two).
// Every share sits beside the counts it comes from, and verifyPlantingReceipt re-derives each one.
//
// THE RECEIPT: { v, body (the canonical JSON text), hash (sha256 of body), sig (Ed25519 over the body's UTF-8), pub }.
// verifyPlantingReceipt checks the bytes BEFORE it parses them (hash, then signature), then the canonical form, then that every
// derived number re-derives from the body. Who the key belongs to is the reader's question: check pub against the company's
// role tree. The brains answer the Konomi way — route, gate, a verified answer or none (the Konomi architecture, Thomas
// Frumkin). Checking old decisions against what really happened, not only against the old rule, draws on Gary W. Floyd,
// Lumiea Systems Research Division — ThunderStruck Service, LLC, "From GEP Stabilization to Dual-Map Ethical Reasoning,"
// Derivation v0.2.
import { canonical, utf8 } from './canon.mjs';
import { sha256 } from './sha256.mjs';
import { sign, verify } from './keys.mjs';
import { hashPlan, PLAN_MODEL } from './plant.mjs';
import { prepare, parseCsv } from '../vendor/csv-forge/csv.mjs';
import { toDataset } from './grow.mjs';
import { datedOrder } from './train.mjs';
import { verifyOn, answer, scoreInput } from './brain.mjs';
import { fitPlan, fitInput, formFields } from './adopt.mjs';
import { boardKpis, JOBS, agentName } from './company.mjs';
import { ACTIONS, scorecard } from './agent.mjs';
import { esc } from './explain.mjs';

export const RECEIPT_MODEL = 'sovereign-enterprise/receipt/1';
export const SHOWCASE_MODEL = 'sovereign-enterprise/showcase/1';
export const MAX_BRIDGES = 32;
export const MAX_TOTALS = 16;
/** Size bands (the UK's micro / small / medium / large): [smallest headcount, name]. */
export const BANDS = Object.freeze([[1, '1–9'], [10, '10–49'], [50, '50–249'], [250, '250 or more']]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
class Refused extends Error {}
const no = (why) => { throw new Refused(why); };
const whyOf = (e) => (e instanceof Refused ? e.message : 'the inputs could not be read');
/** a share in permille, from its counts — null when there is nothing to divide by */
const pm = (a, b) => (b > 0 ? Math.round(a / b * 1000) : null);
/** a measured share or AUC (to 6 places) in permille */
const perm = (x) => Math.round(x * 1000);
const tenths = (investment, monthly) => (monthly > 0 ? Math.round(investment / monthly * 10) : null);
const within = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const nameOf = (f) => (f && typeof f.name === 'string' && f.name ? f.name.slice(0, 120) : 'an unnamed file');
const at = (r, i) => String(r[i] ?? '').trim();

/** The size band a headcount falls in, or null (not a whole number of at least one person). */
export function bandOf(n) {
  try {
    if (!Number.isSafeInteger(n)) return null;
    let out = null;
    for (const [min, name] of BANDS) if (n >= min) out = name;
    return out;
  } catch { return null; }
}

// ── the jobs: measured on the business's own file ──────────────────────────────────────────────────────────────────────
/** The brain's file → its rows exactly as the brain grew from them, the held-out rows, and before / after on those rows. */
function measure(job, text, logs) {
  const p = prepare(text, { targetName: job.target });
  const cols = job.features.map((f) => p.featureNames.indexOf(f.from));
  const names = job.features.map((f) => f.name);
  // the rows in the order the brain grew on them — oldest first when the file dates every case (train.mjs datedOrder)
  const ord = datedOrder(text, p);
  const rows = ord.order.map((i) => p.cases[i]).map((c) => Object.fromEntries([...names.map((n, k) => [n, c.x[cols[k]]]), ['y', c.y]]));
  const ds = toDataset(job.domain, rows, names, ord.split);
  const brain = job.pattern;
  const v = ds && ds.n === rows.length ? verifyOn(brain, ds.heldRows.map((i) => rows[i])) : null;
  if (!v || v.n !== brain.held || v.auc !== brain.heldAuc || v.acc !== brain.heldAcc) {
    no('the ' + job.domain + ' brain does not reproduce its own held-out score on ' + job.file + ' — it is not the file the plan grew it from');
  }
  const held = ds.heldRows;
  const n = held.length;
  const ys = held.map((i) => rows[i].y);
  const lib = { [job.domain]: brain };
  const calls = held.map((i) => answer(lib, rows[i]));
  const answered = calls.filter((a) => a.verdict === 'VERIFIED').length;
  const answeredRight = calls.filter((a, k) => a.verdict === 'VERIFIED' && a.label === ys[k]).length;
  // the business's own past decisions on the SAME rows — only when the brain grew from a log that records them as yes / no
  const g = logs.find((x) => x.file === job.file && x.positiveDecision !== null);
  let past = null;
  if (g && p.header.includes(g.decisionColumn)) {
    const d = p.header.indexOf(g.decisionColumn);
    const raw = parseCsv(text).rows.filter((r) => at(r, p.targetIndex) !== '');      // csv-forge's own case rule: the outcome is known
    past = tally(held.map((i) => (at(raw[ord.order[i]], d) === g.positiveDecision ? 1 : 0)), ys);
  }
  return { rows: n, train: ds.trainRows.length, split: ord.split, gradedFrom: ord.split === 'time' ? ord.days[ord.days.length - n] : '', gradedTo: ord.split === 'time' ? ord.days[ord.days.length - 1] : '', positives: ys.filter((y) => y === 1).length, doNothing: tally(ys.map(() => 0), ys), past,
    brain: { ...tally(held.map((i) => (scoreInput(brain, rows[i]) > brain.threshold ? 1 : 0)), ys), auc: perm(brain.heldAuc),
      answered, answeredPermille: pm(answered, n), answeredRight, answeredRightPermille: pm(answeredRight, answered) } };
}

/** Calls (1 = yes) against what really happened, counted as src/company.mjs jobMetrics counts them: right; flagged (called
 *  yes); caught (called yes and it was) — so caughtPermille is the share of the real yes cases caught, flaggedRealPermille the
 *  share of the yes calls that were real. */
function tally(labels, ys) {
  const right = labels.filter((l, k) => l === ys[k]).length;
  const flagged = labels.filter((l) => l === 1).length;
  const caught = labels.filter((l, k) => l === 1 && ys[k] === 1).length;
  return { right, permille: pm(right, ys.length), flagged, caught, caughtPermille: pm(caught, ys.filter((y) => y === 1).length), flaggedRealPermille: pm(caught, flagged) };
}

function logOf(g) {
  return { file: String(g.file), held: g.n, agree: g.same, agreePermille: pm(g.same, g.n), pastN: g.pastN, pastPermille: g.pastAccuracy === null ? null : perm(g.pastAccuracy) };
}

function jobOf(job, plan, given) {
  const out = { job: job.domain, agent: job.agent, source: job.source, verified: job.verified === true, reverify: job.reverify === true, file: job.file,
    checked: null, shippedAuc: null, logs: job.legacy.map(logOf) };
  if (job.source === 'shipped') out.shippedAuc = perm(job.heldAuc);
  if (job.source === 'grown' && job.pattern) {
    out.checked = measure(job, given[plan.files.findIndex((f) => f.name === job.file)].text, job.legacy);
  }
  return out;
}

// ── the office: the five-year comparison, re-run on the headcount given at planting ────────────────────────────────────
function officeOf(plan, pairs, office) {
  const o = plan.office;
  if (o.ok !== true) return { measured: false, why: String(o.why) };
  const f = fitPlan(fitInput(pairs), office.base, office.basis);
  if (!f.ok) no('the office comparison does not re-run: ' + f.why);
  if (Math.round(f.plan.today.total) !== o.todayTotal || Math.round(f.plan.sovereign.total) !== o.aiNativeTotal) {
    no('the office comparison does not re-run: the headcount given at planting does not give the plan’s own totals');
  }
  const today = o.todayTotal, aiNative = o.aiNativeTotal, saving = today - aiNative, move = Math.round(f.transition.total);
  const investment = Math.round(f.payback.investment), monthlySaving = Math.round(f.payback.monthlySaving);
  const label = new Map(formFields(office.base).map((x) => [x.id, x.label]));
  return { measured: true, years: o.years, headcount: o.headcountToday, aiNativeHeadcount: o.headcountAiNative, today, aiNative, saving,
    savingPermille: pm(saving, today), move, net: saving - move, investment, monthlySaving, paybackTenths: tenths(investment, monthlySaving),
    modelled: o.modelled.map((id) => label.get(id) ?? id), figures: sha256(JSON.stringify({ base: office.base, basis: office.basis })) };
}

// ── the bridges, as reported ───────────────────────────────────────────────────────────────────────────────────────────
const hexOf = (h) => (typeof h === 'string' && HEX64.test(h) ? h : null);
const countOf = (n) => (within(n, Number.MAX_SAFE_INTEGER) ? n : null);
function bridgeOf(b) {
  const o = b && typeof b === 'object' ? b : {};
  const t = o.totals && typeof o.totals === 'object' ? o.totals : {};
  return { kind: typeof o.kind === 'string' && o.kind ? o.kind.slice(0, 60) : null, inputHash: hexOf(o.inputHash), outputHash: hexOf(o.outputHash),
    rows: countOf(o.rows), rejected: countOf(o.rejected),
    totals: Object.keys(t).sort().slice(0, MAX_TOTALS).filter((k) => Number.isSafeInteger(t[k])).map((k) => [k.slice(0, 60), t[k]]) };
}

// ── live: read from the spine, counted the company's own way ───────────────────────────────────────────────────────────
function labelOf(r) {
  const a = Object.hasOwn(ACTIONS, r.domain) ? ACTIONS[r.domain] : null;
  return a && r.action === a[1] ? 1 : a && r.action === a[0] ? 0 : null;
}
const isDecision = (r) => !!r && typeof r === 'object' && typeof r.agent === 'string' && (r.state === 'done' || r.state === 'watch' || r.agent === 'door');
const NONE = Object.freeze({ decisions: 0, held: 0, done: 0, right: 0, automatedPermille: null, rightPermille: null, perAgent: [] });

/**
 * The company's live results from its spine. decisions = the 'decisions' records (and any 'watch' record the door wrote — agent
 * 'door' — for work no agent could take); outcomes = what really happened, { [event]: 0 | 1 } or a Map. Each decision's label is
 * read back from its action (src/agent.mjs ACTIONS). Counted by boardKpis and scorecard — the functions the company's own board
 * summary uses. → { decisions, held, done, right, automatedPermille, rightPermille, perAgent: [{ agent, decisions, held, done,
 * right, rightPermille }] }: held = waited for a person; done = finished with a known outcome; right = of those, matched it.
 */
export function afterFromSpine(decisions, outcomes) {
  try {
    const truthOf = (ev) => {
      const t = outcomes instanceof Map ? outcomes.get(ev) : outcomes && typeof outcomes === 'object' && Object.hasOwn(outcomes, ev) ? outcomes[ev] : null;
      return t === 0 || t === 1 ? t : null;
    };
    const L = (Array.isArray(decisions) ? decisions : []).filter(isDecision)
      .map((r) => ({ agent: r.agent, state: r.state === 'done' ? 'done' : 'watch', label: labelOf(r), truth: truthOf(r.event) }));
    const k = boardKpis(L);
    const perAgent = [...new Set(L.map((x) => x.agent))].sort().map((agent) => {
      const mine = L.filter((x) => x.agent === agent);
      const s = scorecard(mine);
      return { agent, decisions: mine.length, held: s.watched, done: s.done, right: s.correct, rightPermille: pm(s.correct, s.done) };
    });
    return { decisions: k.total, held: k.watched, done: k.done, right: k.correct, automatedPermille: pm(k.total - k.watched, k.total), rightPermille: pm(k.correct, k.done), perAgent };
  } catch { return { ...NONE, perAgent: [] }; }
}

// ── the body ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function bodyOf(input) {
  const { plan, before, after, bridges, office, at: date } = input || {};
  if (typeof date !== 'string' || !DATE.test(date)) no('the receipt’s date must be given as YYYY-MM-DD');
  if (!plan || plan.ok !== true || plan.model !== PLAN_MODEL || hashPlan(plan) !== plan.planHash) no('the plan is not sealed: its hash does not recompute, so it has been changed since it was made');
  const b = before && typeof before === 'object' ? before : {};
  if (!b.business || b.business.type !== plan.business.type) no('the planting input names a different kind of business from the plan');
  const given = Array.isArray(b.files) ? b.files : [];
  if (given.length !== plan.files.length) no('the files given are not the plan’s files: the plan read ' + plan.files.length + ', ' + given.length + ' were given');
  plan.files.forEach((f, i) => { if (nameOf(given[i]) !== f.name) no('the files given are not the plan’s files: file ' + (i + 1) + ' is ' + nameOf(given[i]) + ', the plan read ' + f.name); });
  const files = plan.files.map((f, i) => {
    const text = Object(given[i]).text;
    const ok = typeof text === 'string';
    return { name: f.name, hash: ok ? sha256(text) : null, chars: ok ? text.length : 0, rows: f.rows, kind: f.kind, job: f.domain, used: f.used };
  });
  const o = officeOf(plan, b.business.pairs, office && typeof office === 'object' ? office : {});
  const jobs = plan.jobs.map((j) => jobOf(j, plan, given));
  const headcount = o.measured ? o.headcount : null;
  return { v: RECEIPT_MODEL, at: date, plan: { hash: plan.planHash, seed: plan.seed },
    business: { type: plan.business.type, kind: plan.business.name, headcount, band: bandOf(headcount), modelled: o.measured ? o.modelled.length > 0 : false },
    agents: { on: plan.suite.agents.map((a) => a.id), off: plan.suite.off.map((a) => a.id) },
    files, jobs, office: o, bridges: (Array.isArray(bridges) ? bridges : []).slice(0, MAX_BRIDGES).map(bridgeOf),
    live: after ? afterFromSpine(after.decisions, after.outcomes) : null };
}

const refusal = (why) => ({ ok: false, why, v: RECEIPT_MODEL, body: '', hash: '', sig: '', pub: '' });

/**
 * Build and sign the receipt. input = { plan, before, after, bridges, office, at } (see the header); keys = a device identity
 * from src/keys.mjs. → { ok, why, v, body, hash, sig, pub } — on refusal ok is false, why says what is wrong and nothing is
 * signed. Never rejects.
 */
export async function buildPlantingReceipt(input, keys) {
  try {
    const body = canonical(bodyOf(input));
    const bytes = utf8(body);
    const sig = await sign(keys, bytes);
    if (!(await verify(keys.pub, sig, bytes))) return refusal('the keys do not match: the signature does not verify under this public key');
    return { ok: true, why: '', v: RECEIPT_MODEL, body, hash: sha256(body), sig, pub: keys.pub };
  } catch (e) { return refusal(e instanceof Refused ? e.message : 'the receipt could not be made from these inputs'); }
}

// ── checking a receipt ─────────────────────────────────────────────────────────────────────────────────────────────────
const shareOk = (s, n, pos) => within(s.right, n) && s.permille === pm(s.right, n) && within(s.flagged, n) && within(s.caught, Math.min(s.flagged, pos)) &&
  s.caughtPermille === pm(s.caught, pos) && s.flaggedRealPermille === pm(s.caught, s.flagged);
function jobWhy(j) {
  for (const g of j.logs) if (!within(g.agree, g.held) || g.agreePermille !== pm(g.agree, g.held)) return 'a past-decision check does not follow from its counts';
  const c = j.checked;
  if (c === null) return '';
  const n = c.rows, a = c.brain, pos = c.positives;
  if (pos !== n - c.doNothing.right) return 'its count of cases to catch does not follow from the do-nothing line';
  if (!shareOk(c.doNothing, n, pos) || (c.past !== null && !shareOk(c.past, n, pos)) || !shareOk(a, n, pos)) return 'its before and after shares do not follow from its counts';
  if (!within(a.answered, n) || a.answeredPermille !== pm(a.answered, n) || !within(a.answeredRight, a.answered) || a.answeredRightPermille !== pm(a.answeredRight, a.answered)) {
    return 'its answered share does not follow from its counts';
  }
  return '';
}
/** '' when every derived number re-derives from the body; else what does not. */
function inconsistent(b) {
  if (b.v !== RECEIPT_MODEL) return 'the body is not a planting receipt';
  const z = b.business, o = b.office, L = b.live;
  if (z.band !== bandOf(z.headcount)) return 'the size band does not follow from the headcount';
  if (z.headcount !== (o.measured ? o.headcount : null) || z.modelled !== (o.measured ? o.modelled.length > 0 : false)) return 'the business does not match its office comparison';
  if (o.measured && (o.saving !== o.today - o.aiNative || o.savingPermille !== pm(o.saving, o.today) || o.net !== o.saving - o.move || o.paybackTenths !== tenths(o.investment, o.monthlySaving))) {
    return 'the office figures do not add up';
  }
  for (const j of b.jobs) {
    const w = jobWhy(j);
    if (w) return 'the ' + String(j.job) + ' job: ' + w;
  }
  if (L !== null) {
    if (!within(L.held, L.decisions) || !within(L.done, L.decisions - L.held) || !within(L.right, L.done) || L.automatedPermille !== pm(L.decisions - L.held, L.decisions) || L.rightPermille !== pm(L.right, L.done)) {
      return 'the live shares do not follow from the live counts';
    }
    const sum = (k) => L.perAgent.reduce((s, a) => s + a[k], 0);
    if (['decisions', 'held', 'done', 'right'].some((k) => sum(k) !== L[k]) || L.perAgent.some((a) => !within(a.right, a.done) || a.rightPermille !== pm(a.right, a.done))) {
      return 'the per-agent counts do not add up to the totals';
    }
  }
  return '';
}

/** Check a receipt: the hash and the signature over the raw body FIRST, then its canonical form, then that every derived number
 *  re-derives from the body. → { ok, why }. Never rejects. */
export async function verifyPlantingReceipt(r) {
  try {
    const { v, body, hash, sig, pub } = r;
    if (v !== RECEIPT_MODEL || typeof body !== 'string') return { ok: false, why: 'it is not a planting receipt' };
    if (sha256(body) !== hash) return { ok: false, why: 'the body does not match its hash: it has been changed' };
    if (!(await verify(pub, sig, utf8(body)))) return { ok: false, why: 'the signature does not verify: it was not signed by this key, or it has been changed' };
    const b = JSON.parse(body);
    if (canonical(b) !== body) return { ok: false, why: 'the body is not in canonical form' };
    const why = inconsistent(b);
    return why ? { ok: false, why } : { ok: true, why: '' };
  } catch { return { ok: false, why: 'the receipt could not be read' }; }
}

/** Re-derive the body from the same inputs: is it byte-identical? → { ok, identical, why, hash }. Never throws. */
export function reproducePlantingReceipt(r, input) {
  try {
    const body = canonical(bodyOf(input));
    const identical = body === r.body;
    return { ok: true, identical, why: identical ? '' : 'the same inputs give a different body: this receipt was not made from them', hash: sha256(body) };
  } catch (e) { return { ok: false, identical: false, why: whyOf(e), hash: '' }; }
}

// ── the redacted copy for the next prospect ───────────────────────────────────────────────────────────────────────────
/** The body of a receipt whose body matches its hash, parsed — or null. (The signature is verifyPlantingReceipt’s job.) */
function bodyIn(r) {
  return typeof r.body === 'string' && sha256(r.body) === r.hash ? JSON.parse(r.body) : null;
}

/**
 * A copy safe to show the next prospect: the kind of business, its size band, the before → after numbers, the hashes. No file
 * names, no headcount, no money amounts, no bridge totals, no date finer than the month — nothing that identifies the business
 * beyond the hashes of what it handed over. receipt = the full receipt's hash, which its holder can prove against. null on junk.
 */
export function showcase(r) {
  try {
    const b = bodyIn(r);
    if (b === null || b.v !== RECEIPT_MODEL) return null;
    const o = b.office, L = b.live;
    return { v: SHOWCASE_MODEL, receipt: r.hash, plan: b.plan.hash, month: b.at.slice(0, 7),
      business: { type: b.business.type, kind: b.business.kind, band: b.business.band, modelled: b.business.modelled },
      files: b.files.map((f) => ({ hash: f.hash, kind: f.kind, job: f.job })),
      jobs: b.jobs.map((j) => ({ job: j.job, source: j.source, verified: j.verified, reverify: j.reverify, shippedAuc: j.shippedAuc,
        checked: j.checked === null ? null : { rows: j.checked.rows, doNothing: j.checked.doNothing, past: j.checked.past, brain: j.checked.brain },
        logs: j.logs.map((g) => ({ held: g.held, agree: g.agree, agreePermille: g.agreePermille, pastPermille: g.pastPermille })) })),
      office: o.measured ? { measured: true, years: o.years, savingPermille: o.savingPermille, paybackTenths: o.paybackTenths } : { measured: false },
      bridges: b.bridges.map((x) => ({ kind: x.kind, inputHash: x.inputHash, outputHash: x.outputHash, rows: x.rows, rejected: x.rejected })),
      live: L === null ? null : { decisions: L.decisions, held: L.held, done: L.done, right: L.right, automatedPermille: L.automatedPermille, rightPermille: L.rightPermille } };
  } catch { return null; }
}

// ── the printable receipt ──────────────────────────────────────────────────────────────────────────────────────────────
const pct = (p) => (p === null ? 'not measured' : (p / 10).toFixed(1) + '%');
const auc3 = (p) => (p / 1000).toFixed(3);
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const gbp = (n) => (n < 0 ? '−£' : '£') + num(Math.abs(n));
const short = (h) => (h === null ? 'not given' : h.slice(0, 16) + '…');
const KIND_WORDS = Object.freeze({ outcomes: 'a yes/no outcome to learn', decisions: 'a log of past decisions', bank: 'a bank statement — set aside',
  crm: 'a customer list — set aside', 'trial-balance': 'a trial balance — set aside', unknown: 'not used' });
const row = (cells) => '<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
const head = (cells) => '<tr>' + cells.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>';
const table = (h, rows) => '<div class="tablewrap"><table>' + head(h) + rows.join('') + '</table></div>';
const panel = (title, inner) => '<div class="panel xp-sec"><h3>' + esc(title) + '</h3>' + inner + '</div>';

function jobRow(j) {
  const c = j.checked, file = '<span class="mono">' + esc(j.file) + '</span>';
  const what = '<b>' + esc(JOBS[j.job] || j.job) + '</b><br><span class="dim">' + esc(agentName(j.agent)) + '</span>';
  if (c !== null) {
    const line = (s) => pct(s.permille) + ' right; caught ' + num(s.caught) + ' of the ' + num(c.positives) + ' cases to catch' +
      (s.flagged > 0 ? ' (' + pct(s.flaggedRealPermille) + ' of the yes calls were real)' : '');
    const nothing = 'If nobody had acted: ' + line(c.doNothing);
    const before = c.past === null ? nothing : 'Your past decisions: ' + line(c.past) + '<br><span class="dim">' + nothing + '</span>';
    return row([what, 'Grown from your file ' + file + (j.verified ? '' : ' — <span class="warn">it did not pass its check, so this work waits for a person</span>'),
      num(c.rows) + (c.split === 'time' ? ' newest cases from that file — ' + esc(c.gradedFrom) + ' to ' + esc(c.gradedTo) + ', after everything it learned from' : ' cases from that file it never learned from'), before,
      'The brain: ' + line(c.brain) + '<br><span class="dim">AUC ' + auc3(c.brain.auc) + '</span>',
      pct(c.brain.answeredPermille) + ' (' + num(c.brain.answered) + ' of ' + num(c.rows) + ')' + (c.brain.answered > 0 ? '<br><span class="dim">right on ' + pct(c.brain.answeredRightPermille) + ' of those</span>' : '')]);
  }
  if (j.source === 'shipped') {
    return row([what, 'The shipped brain — it must pass again on your own records before it acts', 'Its published data, not yours', 'not measured — no file of yours',
      'AUC ' + auc3(j.shippedAuc) + ' on its published data', '—']);
  }
  return row([what, j.source === 'grown' ? 'No brain grew from your file ' + file + ' — this work waits for a person' : 'No brain yet — this work waits for a person until data arrives', '—', '—', '—', '—']);
}

function logLine(j, g) {
  return '<li>Your old decisions in <span class="mono">' + esc(g.file) + '</span> (' + esc(JOBS[j.job] || j.job) + '): the rule re-grown from them agrees with them on ' +
    num(g.agree) + ' of ' + num(g.held) + ' cases it never learned from (' + pct(g.agreePermille) + ').' +
    (g.pastPermille === null ? ' How often they were right is not measured: the file does not record what really happened, or does not say which decision means yes.'
      : ' Over all ' + num(g.pastN) + ' logged decisions, they matched what really happened ' + pct(g.pastPermille) + ' of the time' +
        (g.file === j.file ? '.' : ' — not the cases the brain was checked on, so the two are not compared.')) + '</li>';
}

function officePanel(o) {
  if (!o.measured) return panel('Five years on your headcount', '<p>The office comparison was not made: ' + esc(o.why) + '.</p>');
  const y = num(o.years) + ' years';
  return panel('Five years on your headcount', table(['', 'Amount'], [
    row(['Your office today (' + num(o.headcount) + ' people), over ' + y, gbp(o.today)]),
    row(['The AI-native office (' + num(o.aiNativeHeadcount) + ' people), over ' + y, gbp(o.aiNative)]),
    row(['The saving over ' + y, gbp(o.saving) + ' (' + pct(o.savingPermille) + ' of today’s cost)']),
    row(['The one-off move: redundancy, running both side by side, training and contingency', gbp(o.move)]),
    row(['The machines and the set-up', gbp(o.investment - o.move)]),
    row(['The saving after the move', gbp(o.net)]),
    row(['Pays back in', o.paybackTenths === null ? 'no payback from running savings' : (o.paybackTenths / 10).toFixed(1) + ' months — the machines, set-up and move over the first year’s monthly saving of ' + gbp(o.monthlySaving)]),
  ]) + '<p class="note">Worked out by the white paper’s own office model (src/adopt.mjs and src/office.mjs) on the headcount given at planting, with sourced UK pay, tax and pension figures (their SHA-256: <span class="mono">' +
    esc(short(o.figures)) + '</span>). Totals are rounded to the pound; the saving is the difference of the rounded totals.' +
    (o.modelled.length > 0 ? ' No headcount was given for ' + esc(o.modelled.join(', ')) + ' — those lines are counted at the model office’s numbers.' : '') + '</p>');
}

function bridgePanel(list) {
  if (!list.length) return panel('Records brought across', '<p>No records have been brought across yet.</p>');
  return panel('Records brought across', table(['What', 'Rows read', 'Rows refused', 'Totals', 'Input → output'], list.map((x) => row([
    esc(x.kind === null ? 'not given' : x.kind), x.rows === null ? 'not given' : num(x.rows), x.rejected === null ? 'not given' : num(x.rejected),
    x.totals.length ? x.totals.map(([k, v]) => esc(k) + ': ' + num(v)).join('<br>') : 'none given',
    '<span class="mono">' + esc(short(x.inputHash)) + ' → ' + esc(short(x.outputHash)) + '</span>']))) +
    '<p class="note">As each bridge reported them. The hashes tie each one to the exact file it read and the records it wrote.</p>');
}

function livePanel(L) {
  if (L === null) return panel('Since it went live', '<p>The company has not run yet: this receipt was made at planting. The next receipt adds what happened once it went live.</p>');
  const kpi = (v, l) => '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + esc(l) + '</div></div>';
  return panel('Since it went live', '<div class="kpis">' + kpi(num(L.decisions), 'decisions made') + kpi(pct(L.automatedPermille), 'finished by the agents, without a person') +
    kpi(pct(L.rightPermille), 'right, of the ' + num(L.done) + ' finished calls whose outcome is known') + kpi(num(L.held), 'held for a person') + '</div>' +
    table(['Agent', 'Decisions', 'Held for a person', 'Finished, outcome known', 'Right'], L.perAgent.map((a) => row([esc(a.agent === 'door' ? 'The door (no agent free)' : agentName(a.agent)),
      num(a.decisions), num(a.held), num(a.done), pct(a.rightPermille)]))) +
    '<p class="note">The decisions are read from the company’s signed record; the outcomes are what really happened afterwards. “Right” counts only finished calls whose outcome has come back. Held for a person: a call no brain could confirm, a money or security call no second brain agreed with, or a message quarantined unread.</p>');
}

/** The printable one-page receipt for the client: plain words, every number labelled with where it comes from. Uses the page's
 *  own CSS classes; everything from the body is escaped at the sink. '' on junk. */
export function receiptHtml(r) {
  try {
    if (!r || typeof r.body !== 'string') return '';
    const b = bodyIn(r);
    if (b === null) return '<div class="xp">' + panel('Planting receipt', '<p class="bad">This receipt does not match its own hash: it has been changed since it was signed. Do not rely on it.</p>') + '</div>';
    const z = b.business;
    const size = z.band === null ? 'not measured' : esc(z.band) + ' people' + (z.modelled ? ' (counting the model office’s numbers for the lines not given)' : '');
    const logs = b.jobs.flatMap((j) => j.logs.map((g) => logLine(j, g)));
    return '<div class="xp">' +
      panel('Planting receipt', '<p class="xp-lead">What changed for this business when the company was planted in it: each job before and after, the cost over five years on its own headcount, and the records brought across. Every number says where it comes from.</p>' +
        table(['', ''], [row(['Kind of business', esc(z.kind)]), row(['Size', size]), row(['Date', esc(b.at)]),
          row(['The plan', '<span class="mono">' + esc(b.plan.hash) + '</span>']), row(['This receipt', '<span class="mono">' + esc(r.hash) + '</span>']),
          row(['Signed by the device key', '<span class="mono">' + esc(r.pub) + '</span>']),
          row(['Agents switched on', esc(b.agents.on.length ? b.agents.on.map(agentName).join(', ') : 'none yet')])])) +
      panel('Each job, before and after', table(['Job', 'The brain', 'Checked on', 'Before', 'After', 'Answered by the brain itself'], b.jobs.map(jobRow)) +
        '<p class="note"><b>Before</b> is your own past decisions against what really happened, on the same cases the brain was checked on; where your file does not record past decisions, it is doing nothing — every case treated as a “no”. ' +
        '<b>After</b> is the brain grown from your file, on those same cases, which it never learned from. <b>Right</b> counts every case; <b>caught</b> counts the cases that mattered — the real yes cases — that were called yes. ' +
        'Where nearly every case is a “no”, doing nothing is right most of the time and catches none of them, so read the two together. <b>AUC</b> is how well the brain ranks the cases to catch above the rest: 0.5 is a coin toss, 1.0 is perfect. ' +
        'Where the brain cannot vouch for a case it does not answer, and the case goes to a person.</p>' + (logs.length ? '<ul class="xp-narr">' + logs.join('') + '</ul>' : '')) +
      officePanel(b.office) + bridgePanel(b.bridges) + livePanel(b.live) +
      panel('The files handed over', table(['File', 'What it is', 'Rows', 'Used', 'SHA-256'], b.files.map((f) => row(['<span class="mono">' + esc(f.name) + '</span>',
        esc(KIND_WORDS[f.kind] || 'not used'), num(f.rows), f.used ? 'yes' : 'no', '<span class="mono">' + esc(short(f.hash)) + '</span>'])))) +
      panel('Check it yourself', '<p class="note">This receipt’s SHA-256 is <span class="mono">' + esc(r.hash) + '</span>, signed with Ed25519 by the device key above. Re-hashing the body and checking the signature shows nothing was changed; every share on it re-derives from the counts beside it; and re-running the plan on the same files gives the same receipt, byte for byte. ' +
        'The brains answer the Konomi way — route, gate, then a verified answer or none (the Konomi architecture is Thomas Frumkin’s). Checking old decisions against what really happened, not only against the old rule, draws on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2.</p>') +
      '</div>';
  } catch { return ''; }
}
