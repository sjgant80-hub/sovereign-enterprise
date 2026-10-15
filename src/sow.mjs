// sow.mjs — CARRYING A PLAN INTO A COMPANY, and the planted brains onto its agent devices. Total: hostile input gives a
// refusal value, never a throw (the async ones never reject). The readers are pure functions of what a device holds.
//
// src/plant.mjs makes the plan on the planter's device. This is what happens next, in the company itself:
//   jobRecords   — beside each brain grown from the business's own file, the columns it reads and the outcome it learned,
//                  so an agent device can read ITS OWN copy of that file exactly the way the grower did (rowsFor).
//   tuneRecords  — the planter's choices: the agents' confidence floor (the 'policy/agents' record every agent reads) and
//                  the agents switched off for now (a pause a person clears, like the behaviour watch's).
//   publishPlan  — all of it, signed by the planter's device through its own gate: the owner's, or an admin's — on site, or
//                  remote, after joining the client's company by its invite link and being granted admin.
//   plantedFor   — on an agent device: every planted brain for its jobs, with the key that really wrote it. The name a
//                  record carries proves nothing (every agent may write brains); the spine proves which key wrote each
//                  field (src/shell.mjs signersOf — the one reading signedAs and ownRecords make).
//   judgePlanted — SIGNER FIRST: a planted brain is read at all only if the role tree grants its signer to plant that job —
//                  the owner, a live admin, or the agent that runs the job. THEN brain.mjs adopt on THIS device's own rows,
//                  against the brain it would replace (its shipped one, if that re-verifies here): a subtly worse brain
//                  never replaces a better one, and a brain whose measurements the device does not hold is refused in words.
//   recordPlanted — every verdict as a signed 'adopt' record (so the planter sees, remotely, what each device did), and each
//                  adopted brain re-published as the agent's own.
// The brains are Konomi SLM pattern libraries — route, gate, a verified answer or none (the Konomi architecture, Thomas
// Frumkin). Re-checking a brain on each device's own records before it acts is the mycelium rule of src/brain.mjs.
import { adopt, fromRecord, toRecord, validPattern } from './brain.mjs';
import { AGENTS, OWNER_OF, JOBS as JOB_WORDS, agentName } from './company.mjs';
import { planRecords, plannedLibrary } from './plant.mjs';
import { agentRoster, gateFor, signersOf, signedAs, uid } from './shell.mjs';
import { DEFAULT_POLICY } from './agent.mjs';
import { prepare } from '../vendor/csv-forge/csv.mjs';

export const SOURCE = 'planted';                // the source an agent device writes when it adopts a planted brain
export const PLANTING = 'Planting';             // who the planter's policy and pause records say they are from
export const FLOORS = Object.freeze([50, 100, 200, 350]);   // permille: the confidence floors the Board offers
export const MAX_COLUMNS = 1900;                // characters: a job record's column list (the spine's field limit is 2,000)
export const MAX_TEXT = 4000000;                // characters: the largest file rowsFor reads (src/plant.mjs MAX_CHARS)
const TAG = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PLANTED_SOURCES = new Set(['grown', SOURCE]);   // planRecords writes 'grown'; an agent re-publishing it, 'planted'
const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs.join(''));
const tagOf = (plan) => plan.planHash.slice(0, 16);

/** Beside each brain the plan grew from the business's own file: { by: 'admin', c: 'plan', id, f: { kind: 'job', domain, plan,
 *  patternId, target, positive, names, columns } } — names (the brain's features) and columns (the file's columns they are
 *  read from) as JSON lists. A job whose columns do not fit one spine field is left out. [] unless the plan's hash re-computes. */
export function jobRecords(plan) {
  try {
    const lib = plannedLibrary(plan);
    const out = [];
    for (const j of plan.jobs) {
      if (j.source !== 'grown' || lib[j.domain] !== j.pattern) continue;
      const columns = JSON.stringify(j.features.map((f) => String(f.from)));
      if (columns.length > MAX_COLUMNS) continue;
      out.push({ by: 'admin', c: 'plan', id: 'job-' + j.domain + '-' + tagOf(plan), f: { kind: 'job', domain: j.domain, plan: tagOf(plan),
        patternId: String(j.pattern.patternId), target: String(j.target), positive: String(j.positive), names: JSON.stringify(j.pattern.features), columns } });
    }
    return out;
  } catch { return []; }
}

/** The planter's choices as records: the agents' confidence floor, and a pause for each agent switched off. tune = { floor
 *  (one of FLOORS, permille), agents: [the agents switched on] }; control = the company's control records now, so an agent
 *  this planting paused before and switches on now is un-paused. Junk → the default floor, every agent on. */
export function tuneRecords(tune, control) {
  try {
    const t = tune && typeof tune === 'object' ? tune : {};
    const floor = FLOORS.includes(t.floor) ? t.floor : Math.round(DEFAULT_POLICY.minConfidence * 1000);
    const on = Array.isArray(t.agents) ? t.agents : AGENTS.map((a) => a.id);
    const was = new Map((Array.isArray(control) ? control : []).filter((c) => c && typeof c === 'object').map((c) => [c.id, c]));
    const out = [{ c: 'policy', id: 'agents', f: { minConfidence: floor, by: PLANTING } }];
    for (const a of AGENTS) {
      const c = was.get(a.id);
      if (!on.includes(a.id)) out.push({ c: 'control', id: a.id, f: { paused: true, by: PLANTING, why: 'switched off at planting — a person switches it on', watch: '' } });
      else if (c && c.paused === true && c.by === PLANTING) out.push({ c: 'control', id: a.id, f: { paused: false, by: PLANTING, why: 'switched on at planting', watch: '' } });
    }
    return out;
  } catch { return []; }
}

/**
 * Publish a sealed plan into the company this device is in: the plan's own records (src/plant.mjs planRecords), the job
 * records, and the tune records — each signed by this device. Only the owner's device or an admin's may (the brains
 * then say who planted them). → { ok, why, records, wrote, refused: [{ id, reason }] }. Never rejects.
 */
export async function publishPlan(node, plan, tune) {
  const out = { ok: false, why: '', records: 0, wrote: 0, refused: [] };
  try {
    if (node.canWrite(null) !== true) return { ...out, why: 'only the owner’s device or an admin’s can plant — this device is neither, in this company' };
    const recs = planRecords(plan);
    if (!recs.length) return { ...out, why: 'the plan is not sealed: grow it again' };
    const all = [...recs, ...jobRecords(plan), ...tuneRecords(tune, node.list('control'))];
    for (const r of all) {
      const w = await node.put(r.c, r.id, r.f);
      if (w.ok) out.wrote++;
      else out.refused.push({ id: r.id, reason: String(w.reason || 'refused') });
    }
    const ok = out.refused.length === 0;
    return { ...out, ok, records: all.length, why: ok ? '' : out.refused.length + ' of ' + all.length + ' records were refused' };
  } catch { return { ...out, why: 'the plan could not be published' }; }
}

/** A business's CSV, read the way the grower read it, by a job record (jobRecords): → { ok, why, rows: [{ ...features, y }] }. */
export function rowsFor(job, text) {
  const no = (why) => ({ ok: false, why, rows: [] });
  try {
    const names = JSON.parse(job.names), columns = JSON.parse(job.columns);
    const fine = (xs) => Array.isArray(xs) && xs.every((x) => typeof x === 'string');
    if (!fine(names) || !fine(columns) || names.length !== columns.length || !names.length) return no('the job record does not say which columns its brain reads');
    if (typeof text !== 'string' || !text.trim()) return no('the file is empty');
    if (text.length > MAX_TEXT) return no('the file is too large to read here');
    const p = prepare(text, { targetName: job.target });
    if (p.targetName !== job.target) return no('the file has no ' + job.target + ' column with two values — the outcome this brain learned');
    if (p.positiveLabel !== job.positive) return no('in this file the case to catch reads ' + p.positiveLabel + ', not ' + job.positive);
    const at = columns.map((c) => p.featureNames.indexOf(c));
    const gone = columns.filter((_, k) => at[k] < 0);
    if (gone.length) return no('the file has no ' + list(gone.slice(0, 3)) + (gone.length > 3 ? ' (and ' + (gone.length - 3) + ' more)' : '') + ' — columns this brain reads');
    return { ok: true, why: '', rows: p.cases.map((c) => Object.fromEntries([...names.map((n, k) => [n, c.x[at[k]]]), ['y', c.y]])) };
  } catch { return no('the file could not be read'); }
}

/** The job record a planting wrote for a job, or null. The 'plan' collection is the owner's and the admins' alone (no agent
 *  grant names it), so the role tree has already decided who could write it. */
export function jobFor(node, domain, plan) {
  try { return node.list('plan').find((r) => r.kind === 'job' && r.domain === domain && r.plan === plan) || null; } catch { return null; }
}

/** May this key plant a brain for this job — by this device's own view of the role tree, now? → { ok, role, why } */
export function planterOf(node, pub, domain) {
  try {
    if (typeof pub !== 'string' || !HEX64.test(pub)) return { ok: false, role: '', why: 'no one device wrote all of it — another device wrote over part of it' };
    if (pub === node.genesis) return { ok: true, role: 'owner', why: '' };
    if (node.view().roster.some((g) => g.to === pub && g.role === 'admin' && !g.revoked)) return { ok: true, role: 'admin', why: '' };
    const runs = Object.hasOwn(OWNER_OF, domain) ? OWNER_OF[domain] : '';
    const mine = agentRoster(node).filter((g) => g.pub === pub);
    if (runs !== '' && mine.some((g) => g.agent === runs)) return { ok: true, role: runs, why: '' };
    const said = mine.length ? 'the ' + agentName(mine[0].agent) + '’s device' : 'a device with no live grant to plant brains';
    const may = runs === '' ? 'only the owner or an admin may plant a brain for a job this company does not run'
      : 'only the owner, an admin, or the ' + agentName(runs) + ' that runs the ' + JOB_WORDS[domain].toLowerCase() + ' job may plant its brain';
    return { ok: false, role: mine.length ? mine[0].agent : '', why: 'signed by ' + said + ' — ' + may };
  } catch { return { ok: false, role: '', why: 'the company’s role tree could not be read' }; }
}

/** On one agent device: every planted brain for the jobs its agent runs — [{ id, domain, plan, patternId, signer, role,
 *  trusted, why, pattern }]. pattern is read (fromRecord) only when the signer may plant that job; otherwise it is null. */
export function plantedFor(node, agentId) {
  try {
    const a = AGENTS.find((x) => x.id === agentId);
    const by = signersOf(node, 'brain');
    const out = [];
    for (const r of node.list('brain')) {
      if (!a.domains.includes(r.domain) || !TAG.test(r.plan) || !PLANTED_SOURCES.has(r.source)) continue;
      const signer = by.get(r.id) || '';
      const who = planterOf(node, signer, r.domain);
      out.push({ id: r.id, domain: r.domain, plan: r.plan, patternId: typeof r.patternId === 'string' ? r.patternId.slice(0, 64) : '', signer, role: who.role, trusted: who.ok, why: who.why,
        pattern: who.ok ? fromRecord(r) : null });
    }
    return out;
  } catch { return []; }
}

const verdict = (e, adopted, localAuc, n, reason) => ({ id: e.id, domain: e.domain, plan: e.plan, patternId: e.patternId, signer: e.signer, role: e.role,
  trusted: e.trusted, adopted, localAuc, n, reason, pattern: adopted ? e.pattern : null });

/**
 * Judge the planted brains on one agent device. input = { node, agentId, rows(domain) → this device's own rows for that job,
 * shipped: { [domain]: the shipped brain } }. → { ok, why, agent, results: [{ id, domain, plan, patternId, signer, role,
 * trusted, adopted, localAuc, n, reason, pattern }], library: { [domain]: the brain to hold }, held: [domains], kept:
 * { [domain]: 'planted' | 'shipped' | 'none' } }. held = the jobs with a planted brain from a key that may plant it: for those
 * jobs the device holds what this judged (the planted brain, else its shipped one if that re-verifies here, else none).
 */
export function judgePlanted(input) {
  try {
    const { node, agentId, rows, shipped = {} } = input;
    if (!node || typeof rows !== 'function') return NOT_READ();
    const cache = new Map();
    const rowsOf = (d) => { if (!cache.has(d)) { const r = rows(d); cache.set(d, Array.isArray(r) ? r.filter((x) => x !== null && typeof x === 'object') : []); } return cache.get(d); };
    const entries = plantedFor(node, agentId);      // in record-id order: the order every device lists them in
    const held = [...new Set(entries.filter((e) => e.trusted).map((e) => e.domain))].sort();
    const library = {}, base = {};
    for (const d of held) {
      const s = shipped[d];
      base[d] = validPattern(s) && s.domain === d && adopt(s, rowsOf(d), gateFor(d)).adopt ? s : null;
      if (base[d]) library[d] = s;
    }
    const results = entries.map((e) => {
      if (!e.trusted) return verdict(e, false, 0, 0, 'Refused before it was read: ' + e.why + '.');
      if (!e.pattern) return verdict(e, false, 0, 0, 'Refused: it does not read as a brain.');
      const R = rowsOf(e.domain);
      const missing = e.pattern.features.filter((f) => !R.some((r) => Number.isFinite(Number(r[f]))));
      if (missing.length) {
        return verdict(e, false, 0, R.length, 'Refused: this device’s own records do not hold ' + list(missing.slice(0, 3)) + (missing.length > 3 ? ' (and ' + (missing.length - 3) + ' more)' : '') +
          ' — measurements this brain reads. Give the device its own copy of the business’s records for this job.');
      }
      const v = adopt(e.pattern, R, gateFor(e.domain), library[e.domain] || null);
      if (v.adopt) library[e.domain] = e.pattern;
      return verdict(e, v.adopt, v.localAuc, v.n, (v.adopt ? 'Adopted: ' : 'Refused: ') + v.reason + '.');
    });
    const kept = Object.fromEntries(held.map((d) => [d, !library[d] ? 'none' : library[d] === base[d] ? 'shipped' : 'planted']));
    return { ok: true, why: '', agent: agentId, results, library, held, kept };
  } catch { return NOT_READ(); }
}
const NOT_READ = () => ({ ok: false, why: 'the planted brains could not be read', agent: '', results: [], library: {}, held: [], kept: {} });

/** Write a judgement down on the agent device: one 'adopt' record per verdict (source 'planted'), and each brain it now holds
 *  from a planting re-published as this agent's own. → { ok, wrote }. Never rejects. */
export async function recordPlanted(node, agentId, judged) {
  let wrote = 0;
  try {
    for (const r of judged.results) {
      const w = await node.put('adopt', uid(node, 'a'), { domain: r.domain, patternId: r.patternId, from: r.role || 'unknown', by: agentId, adopted: r.adopted,
        localAuc: Math.round(r.localAuc * 1000), n: r.n, reason: r.reason.slice(0, 200), source: SOURCE, plan: r.plan });
      if (w.ok) wrote++;
    }
    for (const d of Object.keys(judged.library)) {
      const r = judged.results.find((x) => x.pattern === judged.library[d]);
      if (!r) continue;
      const w = await node.put('brain', d + '.' + agentId, { ...toRecord(r.pattern), by: agentId, source: SOURCE, localAuc: Math.round(r.localAuc * 1000), n: r.n, plan: r.plan });
      if (w.ok) wrote++;
    }
    return { ok: true, wrote };
  } catch { return { ok: false, wrote }; }
}

/** judgePlanted, then recordPlanted. → judgePlanted's answer + { wrote }. Never rejects. */
export async function loadPlanted(input) {
  const j = judgePlanted(input);
  try {
    if (!j.ok) return { ...j, wrote: 0 };
    const w = await recordPlanted(input.node, input.agentId, j);
    return { ...j, wrote: w.wrote };
  } catch { return { ...j, wrote: 0 }; }
}

/** What the agent devices reported about a planting, read from the spine: their 'adopt' records with source 'planted', each
 *  counted only if the agent it names really wrote it (src/shell.mjs signedAs). plan (optional) = one planting's tag.
 *  → [{ agent, domain, plan, adopted, localAuc (permille), n, reason }] */
export function plantedReports(node, plan) {
  try {
    return signedAs(node, 'adopt', (r) => r.by).filter((r) => r.source === SOURCE && (plan === undefined || r.plan === plan))
      .map((r) => ({ agent: r.by, domain: String(r.domain), plan: String(r.plan), adopted: r.adopted === true, localAuc: Number.isSafeInteger(r.localAuc) ? r.localAuc : 0,
        n: Number.isSafeInteger(r.n) ? r.n : 0, reason: String(r.reason) }));
  } catch { return []; }
}
