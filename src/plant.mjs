// plant.mjs — THE DIFFERENTIATION LAYER: the seed reads a business and grows the right organs.
// Pure, total, deterministic: hostile input gives a refusal value, never a throw; the same input gives the same plan,
// byte for byte, and the same planHash.
//
// Planting the company in a real business starts here. Whoever plants it names the kind of business (an ADOPTION id
// from src/explain.mjs — retail, services, manufacturing, saas, trades — or 'other'), gives the headcount per
// department (the src/adopt.mjs formFields ids) and hands over the records the business already has, as CSV text:
//   classifyFile   — what one file is, in words: 'outcomes' (a yes/no column to learn — a job brain grows from it),
//                    'decisions' (a log of the business's own past decisions, with or without what really happened —
//                    the legacy re-growth), 'bank' / 'crm' / 'trial-balance' (records: never a brain) or 'unknown'
//                    (refused, with the reason); and which of the company's eight jobs it teaches, how sure, and why.
//   differentiate  — THE PLAN: every job this kind of business needs, each with a brain grown from the business's own
//                    file (src/train.mjs), the shipped brain (which must still re-verify on their data when an agent
//                    adopts it — brain.mjs adopt), or none (the Watch list until data arrives); the agents that switch
//                    on and what each takes over; what the people keep; every gap as a plain sentence; the five-year
//                    office comparison on their own headcount (adopt.mjs fitPlan); and the plan's hash.
//   plannedLibrary — the brains the plan starts the company with: { [job]: pattern }.
//   planRecords    — the record bodies to sign onto the company spine: each brain grown from their data (brain.mjs
//                    toRecord), written by the agent that runs the job (every agent grant names 'brain'); and the
//                    plan and its legacy checks in a 'plan' collection, which only the owner or an admin can write
//                    (an admin grant covers every collection; no agent grant names 'plan').
// LEGACY RE-GROWTH is discombobulator's relearn kernel (sjgant80-hub/discombobulator, kernel/relearn.mjs @ 0843a51,
// vendored under ../vendor/discombobulator with only its csv-forge import repointed at this repo's byte-identical
// copy): prepareLog → grow → equivalence on held-out decisions the re-grown organ never grew on — "your old system
// decided X; the re-grown organ agrees on N% of the held-out cases", every mismatch listed.
//
// THE PLAN (model 'sovereign-enterprise/plant/1'; the per-planting receipt consumes this shape — keep it stable):
// { ok, why ('' when ok), model, seed,
//   business: { type, name, needs: [job] },                — needs: the jobs this kind of business uses (jobsFor)
//   files:    [{ name, kind, domain, confidence, reason, rows, used, why }]   — every file handed over, what became of it
//   jobs:     [{ domain, agent, needed, file, source: 'grown' | 'shipped' | 'none', verified, reverify, heldAuc, rows,
//                features: [{ name, from }], target, positive, pattern, why,
//                legacy: [{ file, decisionColumn, decisions, outcomeColumn, positiveDecision, n, same, equivalence,
//                           mismatches: [{ row, legacy, regrown, outcome? }], pastAccuracy, pastN, why }] }],
//   suite:    { agents: [{ id, name, jobs, takesOver }], off: [{ id, name, why }], humans: [what the people keep] },
//   records:  [{ file, kind, rows, why }],                 — bank statements, customer lists, trial balances: set aside
//   gaps:     [plain sentences],
//   office:   { ok, why, years, headcountToday, headcountAiNative, addedLeads, boxes, fits, todayTotal, aiNativeTotal,
//               saving, savingPermille, modelled: [the lines counted at the model office's headcount because none was given —
//               a line the model leaves at zero is not listed] },
//   planHash }                                              — sha256 of the canonical plan without planHash (hashPlan)
// A brain grown from their file that fails its gate is NOT swapped for the shipped one: their own data has spoken, and a
// shipped brain that never re-verified on it would be a guess — the job's work waits for a person instead.
// verified: the brain passed its held-out gate where it was grown — on the business's own rows ('grown'), on its
// published dataset ('shipped': reverify is then true — it must pass again on their data before it acts). heldAuc,
// rows, target and positive are null where they do not apply; pattern is null for 'none'. A job's file is the file
// its brain grew from (null unless 'grown'). In a legacy check, n is the number of held-out decisions, equivalence =
// same / n (to 3 places), row is the 1-based record number after the header, and outcome (on a mismatch) is what
// really happened when the log records it. pastAccuracy is the share of ALL logged decisions that matched what really
// happened — null unless the log records the outcome and its decisions read as yes/no (the same words as the
// outcome, or the file says which decision means yes: positiveDecision). canon.mjs takes whole numbers only, so
// hashPlan hashes every other number as its shortest decimal string.
import { parseCsv, inferColumns, suggestTarget, choosePositive } from '../vendor/csv-forge/csv.mjs';
import { prepareLog, grow, equivalence } from '../vendor/discombobulator/relearn.mjs';
import { trainFromCsv } from './train.mjs';
import { MIN_ROWS } from './grow.mjs';
import { validPattern, passesGate, toRecord } from './brain.mjs';
import { AGENTS, OWNER_OF, agentName } from './company.mjs';
import { ADOPTION } from './explain.mjs';
import { fitPlan, fitInput, formFields } from './adopt.mjs';
import { canonical } from './canon.mjs';
import { parseBankCsv, parseTrialBalance } from './bridge.mjs';
import { sha256 } from './sha256.mjs';

export const PLAN_MODEL = 'sovereign-enterprise/plant/1';
export const JOBS = Object.freeze(Object.keys(OWNER_OF));     // the company's eight jobs, in the company's own order
export const KINDS = Object.freeze(['outcomes', 'decisions', 'bank', 'crm', 'trial-balance', 'unknown']);
export const MAX_FILES = 16;
export const MAX_CHARS = 4000000;
export const MIN_SCORE = 300;   // permille: the weakest evidence a job match may rest on — an outcome column named for the job, and nothing else
export const MARGIN = 100;      // permille: the runner-up must trail by one file-name cue's worth, or the match is too close to call

const JOB_NAME = Object.freeze({ shopper: 'buyers', churn: 'leavers', fraud: 'card fraud', credit: 'credit default', inventory: 'stock-out',
  maintenance: 'machine failure', energy: 'power overload', intrusion: 'intrusion' });

/** A column or file name → its lower-case word stems (camelCase and separators split; one-letter words and plural s dropped). */
export function tokensOf(s) {
  try {
    return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase()
      .split(/[^a-z0-9]+/).filter((t) => t.length > 1)
      .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
  } catch { return []; }
}
const bag = (s) => Object.freeze(new Set(tokensOf(s)));
const any = (toks, set) => toks.some((t) => set.has(t));
const lower = (s) => String(s).toLowerCase();

// What each job measures, in column words: every shipped brain's own features (tests/plant.test.mjs holds them to it), plus
// the words a business's own export would use for the same thing.
const VOCAB = Object.freeze({
  shopper: bag('administrative informational product related duration bounce exit page special session visit visitor browse cart basket checkout pageviews'),
  churn: bag('call failures complained complaint subscription months charge band use usage sms called contract plan inactive customer tenure minutes roaming subscriber'),
  fraud: bag('amount v1 v2 v3 v4 v5 v6 v7 v8 v9 v10 v11 v12 v13 v14 v15 v16 v17 v18 v19 v20 v21 v22 v23 v24 v25 v26 v27 v28 transaction card merchant terminal'),
  credit: bag('credit limit pay status sep aug jul jun may apr bill paid utilisation utilization loan income debt overdue repayment'),
  inventory: bag('stock lead demand reorder seasonality supplier reliab reliability sku units sold warehouse onhand inventory'),
  maintenance: bag('quality air temp temperature process rpm torque tool wear strain machine vibration pressure rotational speed power'),
  energy: bag('load kw reactive voltage kitchen wh laundry heater ac hour weekday month peak meter consumption kwh'),
  intrusion: bag('flow seconds fwd pkts bwd syn flags rst fin ack payload window udp tcp port packets bytes protocol src dst ip connection host'),
});
// What each job's outcome column is called.
const OUTCOME = Object.freeze({
  shopper: bag('purchase purchased buy bought converted conversion revenue ordered'),
  churn: bag('churn churned left leaver cancelled canceled lapsed attrition exited'),
  fraud: bag('fraud fraudulent chargeback'),
  credit: bag('default defaulted delinquent arrears writeoff'),
  inventory: bag('stockout outofstock shortage backorder'),
  maintenance: bag('failure failed breakdown fault'),
  energy: bag('peak overload spike'),
  intrusion: bag('attack intrusion malicious breach'),
});
const OUTCOME_ANY = bag([...JOBS.flatMap((d) => [...OUTCOME[d]]), 'outcome actual result target label class truth happened'].join(' '));
const DECISION = bag('decision decided verdict disposition action actioned ruling rule recommendation recommended triage');

// Records: what a bank statement, a customer list and a trial balance look like.
const DEBIT = new Set(['debit', 'debits', 'dr']), CREDIT = new Set(['credit', 'credits', 'cr']);
const LEDGER = bag('account nominal code ledger');
const DATE = bag('date');
const MONEY = bag('amount debit credit paid withdrawal deposit money');
const NARRATIVE = bag('description payee reference narrative memo details counterparty balance');
const PERSON = new Set(['name', 'firstname', 'lastname', 'fullname', 'contact', 'contactname', 'company', 'companyname', 'accountname',
  'organisation', 'organization', 'email', 'emailaddress', 'phone', 'phonenumber', 'mobile']);
const PIPELINE = bag('stage pipeline deal opportunity lead owner');
const RECORD_WHY = Object.freeze({
  'trial-balance': 'A trial balance: account codes with debit and credit columns. The books read it — there is nothing in it to learn a job from.',
  bank: 'A bank statement: dated money in and out. The books read it — there is nothing in it to learn a job from.',
  crm: 'A customer list: names or contact details with deal stages. The CRM keeps it — a list of people is not a set of cases to learn from.',
});
const RECORD_NAME = Object.freeze({ 'trial-balance': 'a trial balance', bank: 'a bank statement', crm: 'a customer list' });

function recordKind(cols) {
  const has = (set) => cols.some((c) => any(c.tokens, set));
  if (cols.some((c) => DEBIT.has(c.flat)) && cols.some((c) => CREDIT.has(c.flat)) && has(LEDGER)) return 'trial-balance';
  if (has(DATE) && has(MONEY) && has(NARRATIVE)) return 'bank';
  if (cols.some((c) => PERSON.has(c.flat) || c.tokens.includes('email')) && has(PIPELINE)) return 'crm';
  return null;
}

/** How well a file fits each job, in permille: the share of its columns that are that job's measurements (600), an
 *  outcome column named for it (300), a file name that names it (100). Sorted best first; ties keep the job order. */
function scoreJobs(features, cue, name) {
  return JOBS.map((d) => {
    const hits = features.filter((c) => any(c.tokens, VOCAB[d])).length;
    const t = any(cue, OUTCOME[d]);
    const nm = any(name, VOCAB[d]) || any(name, OUTCOME[d]);
    return { domain: d, score: (features.length ? Math.round(600 * hits / features.length) : 0) + (t ? 300 : 0) + (nm ? 100 : 0), hits, t, nm };
  }).sort((a, b) => b.score - a.score);
}

// What the bridges read is a record, not a case to learn from — and the bridge is the one judge of what a bank statement or
// a trial balance is. It is asked only where these headings found nothing: a statement with account details above its
// header, a trial balance under a package's own headings (N/C) or with one signed balance column. (A customer list still
// needs a deal stage here: a list of names alone — a staff list — is not the CRM's to keep.)
function bridgedKind(text) {
  if (parseBankCsv(text).rows.length) return 'bank';
  const tb = parseTrialBalance(text, { date: '2000-01-01' });
  return tb.rows.length + tb.rejected.length ? 'trial-balance' : null;
}
const EMPTY = Object.freeze({ kind: 'unknown', domain: null, confidence: 0, reason: '', columns: [], rows: 0, target: null, decision: null, outcome: null });
const unknown = (reason, base) => ({ ...EMPTY, ...base, reason });
const recordOr = (text, reason, base) => { const k = bridgedKind(text); return k ? { ...EMPTY, ...base, kind: k, reason: RECORD_WHY[k] } : unknown(reason, base); };
const list = (xs, and = ' and ') => (xs.length > 1 ? xs.slice(0, -1).join(', ') + and + xs[xs.length - 1] : xs.join(''));

/**
 * What a file is, and which job it teaches. hints (optional) = { domain, target, decision, outcome }: a job id the
 * business names, or the column to learn / the decision column / the outcome column, by name (any case).
 * → { kind, domain, confidence (0..1), reason (plain words), columns: [{ name, kind, distinct }], rows, target, decision, outcome }
 */
export function classifyFile(name, text, hints) {
  try {
    const h = hints && typeof hints === 'object' ? hints : {};
    if (typeof text !== 'string' || !text.trim()) return unknown('The file is empty, or it is not text.');
    if (text.length > MAX_CHARS) return unknown('The file is too large to read here (more than ' + MAX_CHARS + ' characters) — split it into smaller files.');
    const { header, rows } = parseCsv(text);
    const inferred = inferColumns(header, rows);
    const cols = inferred.map((c) => ({ name: c.name, kind: c.kind, distinct: c.distinct, levels: c.levels, tokens: tokensOf(c.name), flat: lower(c.name).replace(/[^a-z0-9]/g, '') }));
    const base = { columns: cols.map((c) => ({ name: c.name, kind: c.kind, distinct: c.distinct })), rows: rows.length };
    if (cols.length < 2 || !rows.length) return recordOr(text, 'It could not be read as a table — it needs a header row, two or more columns and at least one row of data.', base);
    const rec = recordKind(cols);
    if (rec) return { ...EMPTY, ...base, kind: rec, reason: RECORD_WHY[rec] };
    const asked = (k, auto) => (typeof h[k] === 'string' ? cols.find((c) => lower(c.name) === lower(h[k])) : auto());
    const binary = (c) => !!c && c.kind === 'categorical' && c.distinct === 2;
    const dc = asked('decision', () => cols.find((c) => c.kind === 'categorical' && any(c.tokens, DECISION)));
    const decision = dc && dc.kind === 'categorical' ? dc : null;
    let kind, target = null, outcome = null, what;
    if (decision) {
      kind = 'decisions';
      outcome = asked('outcome', () => cols.find((c) => c !== decision && binary(c) && any(c.tokens, OUTCOME_ANY))) || null;
      what = 'A log of past decisions: ' + decision.name + ' records what was decided (' + decision.levels.join(' / ') + ')' +
        (outcome ? ', and ' + outcome.name + ' records what really happened' : ', but no column records what really happened');
    } else {
      kind = 'outcomes';
      target = asked('target', () => cols.find((c) => binary(c) && any(c.tokens, OUTCOME_ANY)) || cols[suggestTarget(inferred)]);
      if (!binary(target)) return recordOr(text, 'There is no column with exactly two values to learn — a yes/no, churned/stayed or paid/defaulted column.', base);
      what = 'A yes/no column to learn: ' + target.name + ' (' + target.levels.join(' / ') + ')';
    }
    const cue = target || outcome || decision;
    const feats = cols.filter((c) => c !== cue && c !== decision);
    const fileWords = tokensOf(String(name).replace(/\.[a-z0-9]{1,5}$/i, ''));
    const out = { ...base, kind, target: target && target.name, decision: decision && decision.name, outcome: outcome && outcome.name };
    if (JOBS.includes(h.domain)) return { ...out, domain: h.domain, confidence: 1, reason: what + '. You said it teaches the ' + JOB_NAME[h.domain] + ' job.' };
    const [best, next] = scoreJobs(feats, cue.tokens, fileWords);
    if (best.score < MIN_SCORE) return { ...out, domain: null, confidence: 0, reason: what + '. It does not look like any of the company’s eight jobs — name the job to use it.' };
    if (best.score - next.score < MARGIN) return { ...out, domain: null, confidence: 0, reason: what + '. It fits the ' + JOB_NAME[best.domain] + ' and ' + JOB_NAME[next.domain] + ' jobs about equally — name the job to use it.' };
    const why = [best.hits + ' of its other ' + feats.length + ' columns are measurements that job uses'];
    if (best.t) why.push('its ' + cue.name + ' column is named for it');
    if (best.nm) why.push('the file’s name points to it');
    return { ...out, domain: best.domain, confidence: best.score / 1000, reason: what + '. It teaches the ' + JOB_NAME[best.domain] + ' job: ' + list(why) + '.' };
  } catch {
    return unknown('The file could not be read.');
  }
}

const JOB_CUES = Object.freeze({ shopper: /session|visit|enquir|sign-up/i, churn: /leav|lapse|cancel/i, fraud: /fraud|card payment/i, credit: /terms/i,
  inventory: /run out/i, maintenance: /before (?:it|they) fail/i, energy: /load/i, intrusion: /intrusion/i });
/** The jobs a kind of business uses — read from the adoption guide's own words for each of its agents. 'other': all eight. */
export function jobsFor(type) {
  try {
    if (type === 'other') return JOBS.slice();
    const b = ADOPTION.find((x) => x.id === type);
    return b ? JOBS.filter((d) => JOB_CUES[d].test(b.agents[OWNER_OF[d]])) : [];
  } catch { return []; }
}

const DQ = '"';
const quote = (v) => DQ + v.split(DQ).join(DQ + DQ) + DQ;   // every cell quoted: always valid CSV, and no quote mark inside a regex (the witness masks strings, not regexes)
/** The CSV without one column (a decision log's decision must not teach the brain that replaces it). */
function dropColumn(text, name) {
  const { header, rows } = parseCsv(text);
  const k = header.indexOf(name);
  const keep = (r) => r.filter((_, i) => i !== k).map(quote).join(',');
  return [header, ...rows].map(keep).join('\n');
}

const pct = (x) => (x * 100).toFixed(1) + '%';
/** Re-grow a decision log with discombobulator's relearn kernel and check it on the decisions it never grew on. */
function regrowLegacy(file, text, cls, positiveDecision) {
  const p = prepareLog(text, { decisionColumn: cls.decision });
  if (p.entries.length < MIN_ROWS) return { ok: false, why: 'it needs at least ' + MIN_ROWS + ' decisions to re-grow and check honestly (this log has ' + p.entries.length + ')' };
  const out = cls.outcome;
  const keep = (names) => names.filter((n) => n !== out);       // what really happened never teaches the copy of the old rule
  const g = grow({ ...p, schema: { numeric: keep(p.schema.numeric), categorical: keep(p.schema.categorical) } });
  const held = p.entries.filter((e) => e.slice === 'holdout');
  const eq = equivalence(g.tree, held);
  const at = new Map(held.map((e) => [e.id, e]));
  const mismatches = eq.mismatches.map((m) => ({ row: m.id + 1, legacy: m.legacy, regrown: m.regrown, ...(out ? { outcome: at.get(m.id).x[out] } : {}) }));
  let pastAccuracy = null, pastN = 0, yesDecision = null, right = 0;
  if (out) {
    const known = p.entries.filter((e) => e.x[out] !== '');
    const counts = new Map([...new Set(known.map((e) => e.x[out]))].map((v) => [v, known.filter((e) => e.x[out] === v).length]));   // first-seen order, as csv-forge counts
    const yes = choosePositive([...counts.keys()], counts);
    yesDecision = counts.size === 2 && p.decisions.includes(positiveDecision) ? positiveDecision : counts.size === 2 && p.decisions.every((v) => counts.has(v)) ? yes : null;
    if (yesDecision !== null) {
      pastN = known.length;
      right = known.filter((e) => (e.y === yesDecision) === (e.x[out] === yes)).length;
      pastAccuracy = Math.round(right / pastN * 1000) / 1000;
    }
  }
  const why = 'Your ' + cls.decision + ' column decided ' + list(p.decisions, ' or ') + '. The organ re-grown from your log agrees with it on ' + eq.same + ' of ' + eq.total +
    ' held-out decisions it never grew on (' + pct(eq.rate) + '); every mismatch is listed.' +
    (pastAccuracy === null ? '' : ' Your past decisions matched what really happened in ' + right + ' of ' + pastN + ' cases (' + pct(pastAccuracy) + ').');
  return { ok: true, log: { file, decisionColumn: cls.decision.slice(0, 120), decisions: p.decisions, outcomeColumn: out, positiveDecision: yesDecision,
    n: eq.total, same: eq.same, equivalence: eq.rate, mismatches, pastAccuracy, pastN, why } };
}

/** One file handed over → what it is, the brain it grows, the legacy check it gives. Never throws. */
function plantFile(f, seed) {
  let name = 'an unnamed file';
  try {
    const o = f && typeof f === 'object' ? f : {};
    if (typeof o.name === 'string' && o.name) name = o.name.slice(0, 120);
    const cls = classifyFile(name, o.text, o);
    const entry = { name, kind: cls.kind, domain: cls.domain, confidence: cls.confidence, reason: cls.reason, rows: cls.rows, used: false, why: '' };
    if (!cls.domain) return { entry };
    const legacy = cls.kind === 'decisions' ? regrowLegacy(name, o.text, cls, o.positiveDecision) : null;
    const target = cls.target || cls.outcome;
    const t = target ? trainFromCsv(cls.decision ? dropColumn(o.text, cls.decision) : o.text, { target, domain: cls.domain, seed }) : null;
    return { entry, legacy, t };
  } catch {
    return { entry: { name, kind: 'unknown', domain: null, confidence: 0, reason: 'The file could not be read.', rows: 0, used: false, why: '' } };
  }
}

const auc3 = (x) => x.toFixed(3);
/** The brain grown from a file outranks a failed one; then the higher held-out AUC; ties keep the file order. */
const rank = (c) => (c.t.verified ? 10 : 0) + (c.t.ok ? c.t.pattern.heldAuc : 0);
const heldWords = (c) => (c.t.ok ? 'AUC ' + auc3(c.t.pattern.heldAuc) : 'no brain');
function shippedBrain(shipped, d) {
  const p = shipped && shipped.patterns && shipped.patterns[d];
  if (!validPattern(p) || p.domain !== d || !passesGate(p.heldAuc)) return null;
  const meta = (shipped.index || {})[d] || {};
  return { pattern: p, dataset: typeof meta.sample === 'string' ? String(meta.dataset).slice(0, 120) : meta.real === false ? 'realistic-synthetic data — no open dataset exists for it' : '' };
}

function grownJob(d, agent, needed, c) {
  const t = c.t, ok = t.ok === true;
  const verified = ok && t.verified === true;
  if (ok) { t.pattern.title = JOB_NAME[d] + ' (grown from ' + c.file + ')'; t.pattern.role = agent; }
  return { domain: d, agent, needed, file: c.file, source: 'grown', verified, reverify: false, heldAuc: ok ? t.pattern.heldAuc : null, rows: t.rows || null,
    features: (t.features || []).map((x) => ({ name: x.name, from: String(x.from).slice(0, 120) })), target: t.target || null, positive: t.positive || null,
    pattern: ok ? t.pattern : null,
    why: verified ? 'Grown from your file ' + c.file + ': ' + t.rows + ' rows, learning ' + t.target + ' (' + t.positive + ' is the case to catch). On the rows it never grew on it scored AUC ' + auc3(t.pattern.heldAuc) + ' — it passed.'
      : 'The brain grown from your file ' + c.file + ' did not pass: ' + t.why + '. The ' + agentName(agent) + ' holds this work for a person until more of your data arrives.' };
}
function shippedJob(d, agent, needed, sh) {
  const p = sh.pattern;
  return { domain: d, agent, needed, file: null, source: 'shipped', verified: true, reverify: true, heldAuc: p.heldAuc, rows: null,
    features: p.features.map((n) => ({ name: n, from: n })), target: null, positive: null, pattern: p,
    why: 'No file of yours for this job: the ' + agentName(agent) + ' starts on the shipped brain' + (sh.dataset ? ', grown on ' + sh.dataset : '') +
      '. It scored AUC ' + auc3(p.heldAuc) + ' on rows it never grew on, and must re-verify on your own records before it acts.' };
}
const noneJob = (d, agent, needed) => ({ domain: d, agent, needed, file: null, source: 'none', verified: false, reverify: false, heldAuc: null, rows: null,
  features: [], target: null, positive: null, pattern: null, why: 'No file of yours and no shipped brain for this job: its work waits on the Watch list for a person until data arrives.' });

const OTHER_HUMANS = Object.freeze(['Direction, and the decisions only people should make', 'Relationships with customers and suppliers', 'Every call no brain could confirm (the Watch list)']);

function officeOf(pairs, shipped) {
  try {
    const base = shipped.office, basis = shipped.basis;
    if (!base || typeof base !== 'object' || !basis || typeof basis !== 'object') return { ok: false, why: 'the model office and its sourced figures were not given' };
    if (!Array.isArray(pairs) || !pairs.length) return { ok: false, why: 'no headcount was given — it needs one per department' };
    const r = fitPlan(fitInput(pairs), base, basis);
    if (!r.ok) return { ok: false, why: r.why };
    const p = r.plan;
    const given = new Set(pairs.map((x) => x && x.id));
    return { ok: true, why: '', years: p.years, headcountToday: p.today.headcount, headcountAiNative: p.sovereign.headcount, addedLeads: r.added, boxes: p.capacity.boxes,
      fits: p.human.fits, todayTotal: Math.round(p.today.total), aiNativeTotal: Math.round(p.sovereign.total), saving: Math.round(p.saving),
      savingPermille: Math.round(p.savingPct * 1000), modelled: formFields(base).filter((x) => x.value > 0 && !given.has(x.id)).map((x) => x.id) };
  } catch { return { ok: false, why: 'the office comparison could not be made' }; }
}

const refuse = (why) => ({ ok: false, why, model: PLAN_MODEL, seed: 0, business: null, files: [], jobs: [], suite: { agents: [], off: [], humans: [] },
  records: [], gaps: [], office: null, planHash: '' });

/**
 * THE PLAN. input = { business: { type, pairs: [{ id, value }] }, files: [{ name, text, domain?, target?, decision?, outcome?, positiveDecision? }] };
 * shipped = the brains exactly as runtime.mjs createCompany receives them ({ index, patterns, … }) plus, for the office
 * comparison, office (data/office.json) and basis (data/basis.json); opts = { seed }. Never throws.
 */
export function differentiate(input, shipped, opts) {
  try {
    const { business, files = [] } = input || {};
    const { seed = 1 } = opts || {};
    const type = business && business.type;
    const adoption = ADOPTION.find((b) => b.id === type);
    if (!adoption && type !== 'other') return refuse('the kind of business must be one of ' + list([...ADOPTION.map((b) => b.id), 'other'], ' or '));
    if (!Array.isArray(files) || files.length > MAX_FILES) return refuse('the files must be a list of at most ' + MAX_FILES + ' CSV files');
    const s = Math.max(1, seed >>> 0);
    const needs = jobsFor(type);
    const read = files.map((f) => plantFile(f, s));
    const gaps = [], records = [];
    const cands = {}, logs = {};
    read.forEach((r, i) => {
      const e = r.entry;
      if (RECORD_NAME[e.kind]) {
        records.push({ file: e.name, kind: e.kind, rows: e.rows, why: e.reason });
        e.why = 'Set aside as a record — not a brain.';
        gaps.push(e.name + ' is ' + RECORD_NAME[e.kind] + ': it was recognised and set aside — bringing it into the books or the CRM is not part of planting yet.');
        return;
      }
      if (!e.domain) { e.why = 'Not used.'; gaps.push(e.name + ' was not used. ' + e.reason); return; }
      const g = r.legacy && r.legacy.log;
      if (r.legacy && !g) gaps.push(e.name + ' could not be re-grown: ' + r.legacy.why + '.');
      if (g) (logs[e.domain] || (logs[e.domain] = [])).push(g);
      if (g && g.outcomeColumn === null) gaps.push(e.name + ' records your past decisions but not what really happened, so how often they were right cannot be measured.');
      if (g && g.outcomeColumn !== null && g.pastAccuracy === null) {
        gaps.push(e.name + ': its decisions (' + g.decisions.join(' / ') + ') do not read as yes or no for ' + g.outcomeColumn + ' — say which decision means yes to measure how often they were right.');
      }
      if (r.t) (cands[e.domain] || (cands[e.domain] = [])).push({ file: e.name, t: r.t, i });
    });
    const jobs = [];
    for (const d of JOBS) {
      const mine = cands[d] || [], theirLogs = logs[d] || [];
      const needed = needs.includes(d);
      if (!needed && !mine.length && !theirLogs.length) continue;
      const agent = OWNER_OF[d];
      const best = mine.slice().sort((a, b) => rank(b) - rank(a))[0];
      const sh = best ? null : shippedBrain(shipped, d);
      const job = best ? grownJob(d, agent, needed, best) : sh ? shippedJob(d, agent, needed, sh) : noneJob(d, agent, needed);
      if (!needed) job.why = 'This kind of business does not usually need the ' + JOB_NAME[d] + ' job; it is planted because your file teaches it. ' + job.why;
      job.legacy = theirLogs;
      jobs.push(job);
      for (const c of mine) {
        read[c.i].brain = c === best ? 'Grew the ' + JOB_NAME[d] + ' brain' + (job.verified ? '.' : ' — it did not pass its check.') : 'Set aside: the plan grows the ' + JOB_NAME[d] + ' brain from ' + best.file + '.';
        read[c.i].chosen = c === best;
        if (c !== best) gaps.push(c.file + ' also teaches the ' + JOB_NAME[d] + ' job; the plan uses ' + best.file + ' (on the rows each never grew on: ' + heldWords(best) + ' against ' + heldWords(c) + '; the earlier file wins a tie).');
      }
      if (job.source === 'grown' && !job.verified) gaps.push('The ' + JOB_NAME[d] + ' brain grown from ' + job.file + ' did not pass its check on rows it never grew on — that work waits for a person until more of your data arrives.');
      if (job.source === 'shipped') gaps.push('No file of yours for the ' + JOB_NAME[d] + ' job: the ' + agentName(agent) + ' starts on the shipped brain, which must re-verify on your own records before it acts.');
      if (job.source === 'none') gaps.push('No data and no brain for the ' + JOB_NAME[d] + ' job: its work waits on the Watch list until data arrives.');
    }
    for (const r of read) {                    // what became of each file that teaches a job
      if (!r.entry.domain) continue;
      const g = r.legacy && r.legacy.log;
      r.entry.used = r.chosen === true || !!g;
      r.entry.why = [r.brain || '', g ? 'Your past decisions were re-grown and checked.' : r.legacy ? 'Its decisions could not be re-grown.' : ''].filter(Boolean).join(' ');
    }
    const working = new Set(jobs.filter((j) => j.verified).map((j) => j.domain));
    const ownData = new Set(jobs.filter((j) => j.verified && j.source === 'grown').map((j) => j.domain));
    const agents = [], off = [];
    for (const a of AGENTS) {
      const mine = a.domains.length ? a.domains.filter((d) => working.has(d)) : a.grows.filter((d) => ownData.has(d));
      if (mine.length) { agents.push({ id: a.id, name: a.name, jobs: mine, takesOver: adoption ? adoption.agents[a.id] : a.job }); continue; }
      const why = a.domains.length ? 'none of its jobs has a brain that passed its check — its work waits for a person'
        : 'no file of yours for ' + list(a.grows.map((d) => JOB_NAME[d]), ' or ') + ' to grow its own second brain from — until one arrives, a money or security call no second brain confirms waits for a person';
      off.push({ id: a.id, name: a.name, why });
      gaps.push('The ' + a.name + ' stays off: ' + why + '.');
    }
    const pairs = business.pairs;
    const office = officeOf(pairs, shipped || {});
    if (!office.ok) gaps.push('The office comparison was not made: ' + office.why + '.');
    if (office.ok && office.modelled.length) {
      const label = new Map(formFields(shipped.office).map((x) => [x.id, x.label]));
      gaps.push('No headcount was given for ' + list(office.modelled.map((id) => label.get(id))) + ' — the comparison keeps the model office’s headcount there.');
    }
    const plan = { ok: true, why: '', model: PLAN_MODEL, seed: s, business: { type, name: adoption ? adoption.name : 'Other', needs },
      files: read.map((r) => r.entry), jobs, suite: { agents, off, humans: (adoption ? adoption.humans : OTHER_HUMANS).slice() }, records, gaps, office };
    plan.planHash = hashPlan(plan);
    return plan;
  } catch {
    return refuse('the input could not be read');
  }
}

function wholeOnly(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : String(v);
  if (Array.isArray(v)) return v.map(wholeOnly);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wholeOnly(x)]));
  return v;
}
/** sha256 of the canonical plan without its planHash (JSON-normalised; numbers that are not whole as their decimal string). '' on junk. */
export function hashPlan(plan) {
  try {
    const { planHash, ...rest } = plan;
    return sha256(canonical(wholeOnly(JSON.parse(JSON.stringify(rest)))));
  } catch { return ''; }
}
function sealed(plan) {
  const h = hashPlan(plan);
  return plan.ok === true && h !== '' && plan.planHash === h;
}

/** The brains the plan starts the company with — { [job]: pattern } for every job whose brain passed its gate. {} unless the plan's hash re-computes. */
export function plannedLibrary(plan) {
  try {
    if (!sealed(plan)) return {};
    const out = {};
    for (const j of plan.jobs) if (j.verified && JOBS.includes(j.domain) && validPattern(j.pattern) && j.pattern.domain === j.domain && passesGate(j.pattern.heldAuc)) out[j.domain] = j.pattern;
    return out;
  } catch { return {}; }
}

/**
 * The record bodies to sign onto the spine: [{ by, c, id, f }] — by is the agent that writes it, or 'admin' (the owner or
 * an admin device: the person planting). Brains grown from the business's own data go to 'brain' (each agent's grant
 * names it); the plan and each legacy check go to 'plan'. Every field is a string, a whole number or a boolean.
 * [] unless the plan's hash re-computes.
 */
export function planRecords(plan) {
  try {
    if (!sealed(plan)) return [];
    const tag = plan.planHash.slice(0, 16);
    const lib = plannedLibrary(plan);
    const out = [];
    for (const j of plan.jobs) {
      const agent = OWNER_OF[j.domain];
      if (j.source === 'grown' && lib[j.domain] === j.pattern) {
        out.push({ by: agent, c: 'brain', id: j.domain + '.' + agent, f: { ...toRecord(j.pattern), by: agent, source: 'grown', localAuc: Math.round(j.pattern.heldAuc * 1000),
          n: Number.isSafeInteger(j.pattern.held) ? j.pattern.held : 0, plan: tag } });
      }
      j.legacy.forEach((g, k) => out.push({ by: 'admin', c: 'plan', id: 'legacy-' + j.domain + '-' + k + '-' + tag, f: { kind: 'legacy', domain: j.domain,
        file: String(g.file).slice(0, 120), decision: String(g.decisionColumn).slice(0, 120), n: g.n, same: g.same, mismatches: g.mismatches.length,
        equivalencePermille: Math.round(g.equivalence * 1000), pastPermille: g.pastAccuracy === null ? -1 : Math.round(g.pastAccuracy * 1000), pastN: g.pastN, plan: tag } }));
    }
    out.push({ by: 'admin', c: 'plan', id: 'plan-' + tag, f: { kind: 'plan', business: String(plan.business.type), planHash: plan.planHash,
      jobs: plan.jobs.map((j) => j.domain + ':' + j.source + ':' + (j.verified ? 1 : 0)).join(';'), agents: plan.suite.agents.map((a) => a.id).join(','),
      gaps: plan.gaps.length, files: plan.files.length, by: 'planting' } });
    return out;
  } catch { return []; }
}
