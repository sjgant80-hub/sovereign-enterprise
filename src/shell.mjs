// shell.mjs — NODE-SHELL: one real device runs one AI agent; and the tech person’s afternoon of wiring a company.
//
// (a) THE ONE AGENT STEP. stepAgent() is what an agent device does on each beat, on its own replica: reply to its peers’
//     asks from its own brain; open the new work the door addressed to it (the screen, its own brain, a signed ask when it
//     cannot answer, a signed ask for a second opinion on a money or security call); close the work whose replies are in
//     or whose deadline passed; write the decision, its effects within its own grant, and hand-offs for the rest. It is
//     built from company.mjs (openStep / afterMesh / closeStep / splitEffects) and mesh.mjs (askRecord / replyFor /
//     repliesTo / heardFrom / pickAnswer / pickSecond) — nothing here decides anything those do not. src/runtime.mjs runs
//     the demo’s six agents through this same function, so the headless re-run’s receipt pins it byte for byte.
//     createAgentShell() runs ONE agent on ONE real device with what that device knows for itself: its grant (its own
//     view of the role tree), its peers (the live agent grants it can see), its pause (a control record the overseer
//     writes when the behaviour watch flags it — src/watch.mjs), the antibodies it re-checks before adopting
//     (src/antibody.mjs), the hand-offs addressed to it and the calls a person approved for it. It survives a restart:
//     what it already answered and asked is read back from the spine, so it never answers an ask twice, never asks
//     again for work it is already waiting on, and never decides one piece of work twice.
// (b) WIRING. wiringView() reads, from a device’s own replica, who is granted, which devices have checked in and which
//     company each one says it holds; wiringChecklist() turns that into the ordered steps an IT person follows, each with
//     its status, plain instructions and an estimate of the minutes it takes; wiringReceipt() is the owner-signed record
//     of what was wired, verifiable by anyone with verifyWiringReceipt().
// Each agent’s brain is a Konomi SLM pattern library (Konomi architecture — Thomas Frumkin; brain.mjs): it answers with a
// receipt or abstains. The independent second opinion follows Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck
// Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2 (mesh.mjs).
// Every export is total: hostile or missing input → a refusal value, never a throw (the async ones never reject).
import { canonical, utf8, toHex } from './canon.mjs';
import { sha256 } from './sha256.mjs';
import { sign as signWith, verify } from './keys.mjs';
import { AGENTS, HUB, OWNER_OF, agentName, openStep, afterMesh, closeStep, effects, splitEffects, shouldLearn, pickEvent } from './company.mjs';
import { askRecord, replyFor, repliesTo, heardFrom, pickAnswer, pickSecond } from './mesh.mjs';
import { ACTIONS, DEFAULT_POLICY, moneyLimitOf } from './agent.mjs';
import { adopt, fromRecord, toRecord, GATE_AUC, HIGH_STAKES_GATE } from './brain.mjs';
import { growPattern } from './grow.mjs';
import { screenWith, adoptAntibody, BENIGN_CORPUS } from './antibody.mjs';
import { watchAll, shouldPause, DEFAULT_POLICY as WATCH_POLICY } from './watch.mjs';
import { leafHash, root, audit } from './vault.mjs';
import { encodeLines, validEntry } from './books.mjs';
import { ask } from './model.mjs';
import { prng } from './sim.mjs';

export const DEADLINE_MS = 12000;       // an agent device waits this long for its peers’ replies before deciding on what it has
export const WIRE = 'wire';             // the collection device check-ins, the cards mark and wiring receipts live in
export const RECEIPT_MODEL = 'sovereign-enterprise/wiring/1';
export const STAFF_COLS = Object.freeze(['tasks', 'msg', 'docs', 'crm', WIRE]);
export const ROLES = Object.freeze(['staff', 'admin', 'hub', 'agent']);
export const OSES = Object.freeze(['windows', 'mac', 'linux']);
const CHECKIN = ['kind', 'role', 'agent', 'name', 'mark', 'at', 'made', 'hash', 'sig', 'devices', 'same'];   // the fields a wiring record’s writer is read from
export const LOCAL_MODEL = 'qwen2.5:7b';
/** A grant id that names an agent: agent-<id>, or agent-<id>.<n> when that agent is granted again. */
export const AGENT_GRANT = /^agent-([a-z][a-z0-9_]{0,31})(?:\.[0-9]{1,6})?$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?$/;
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const no = (reason) => ({ ok: false, reason });
const str = (x) => (typeof x === 'string' ? x : '');
const pad = (n, w = 6) => String(n).padStart(w, '0');
const agentOf = (id) => AGENTS.find((a) => a.id === id) || null;

/** A record id unique to this device: its next clock tick + its key prefix — two devices never mint the same id. */
export const uid = (node, p) => p + pad(node.clock() + 1, 8) + '-' + node.pub.slice(0, 6);
/** The seed a device grows its own brain for a job with (deterministic per device and job). */
export const seedFor = (who, d) => (parseInt(sha256(who + '/' + d).slice(0, 8), 16) >>> 0) || 1;
/** Money and security jobs need more than the plain gate before a brain is trusted with them. */
export function gateFor(d) {
  try { return ACTIONS[d] && ACTIONS[d].stakes === 'high' ? HIGH_STAKES_GATE : GATE_AUC; } catch { return GATE_AUC; }
}

/** The agents’ policy as this device sees it on the spine (the overseer’s 'policy/agents' record), else the default. */
export function policyOf(node) {
  try {
    const p = node.list('policy').find((r) => r.id === 'agents');
    if (!p || !Number.isSafeInteger(p.minConfidence)) return DEFAULT_POLICY;
    return { minConfidence: p.minConfidence / 1000, moneyLimit: moneyLimitOf({ moneyLimit: p.moneyLimit }) };
  } catch { return DEFAULT_POLICY; }
}

/** Is this agent paused, by this device’s own view of the control records? */
export function isPaused(node, id) {
  try {
    const c = node.list('control').find((r) => r.id === id);
    return !!(c && c.paused);
  } catch { return false; }
}

/** The clearances people gave the behaviour watch: { [agentId]: { at, rebaseline } }. */
export function clearsOf(node) {
  try {
    return Object.fromEntries(node.list('control').filter((c) => typeof c.cleared === 'string' && c.cleared)
      .map((c) => [c.id, { at: c.cleared, rebaseline: c.rebaseline === true }]));
  } catch { return {}; }
}

// ── the books and the vault: the Finance agent posts, the Audit agent witnesses ─────────────────────────────────────
/** The vault as this device holds it: its records, tree heads, co-signatures and the audit of all of them. */
export function vaultState(node) {
  try {
    const recs = node.list('vault').map((r) => ({ index: r.index, leaf: r.leaf, entry: r.entry }));
    const heads = node.list('vault_head').map((h) => ({ size: h.size, root: h.root }));
    const cos = node.list('vault_cosig').map((h) => ({ size: h.size, root: h.root, by: h.by }));
    return { recs, heads, cos, a: audit(recs, heads) };
  } catch { return { recs: [], heads: [], cos: [], a: audit([], []) }; }
}

/** Post one journal entry and sequence it into the vault: the journal record, its leaf, the new tree head. */
export async function postEntry(node, entry) {
  try {
    const v = validEntry(entry);
    if (!v.ok) return v;
    if (!node.canWrite('journal') || !node.canWrite('vault') || !node.canWrite('vault_head')) return no('not-authorised');
    const id = uid(node, 'j');
    const body = { date: entry.date, memo: String(entry.memo).slice(0, 200), lines: encodeLines(v.lines) };
    const r = await node.put('journal', id, body);
    if (!r.ok) return r;
    const { a } = vaultState(node);
    const leaf = leafHash(canonical({ id, ...body }));
    const leaves = [...a.leaves, leaf];
    await node.put('vault', 'v' + pad(a.size), { index: a.size, leaf, entry: id });
    await node.put('vault_head', 'h' + pad(leaves.length), { size: leaves.length, root: root(leaves) });
    return { ok: true };
  } catch { return no('fault'); }
}

/** Co-sign the vault’s latest tree head — only if the log this device holds audits. */
export async function witnessHead(node) {
  try {
    const { a, heads } = vaultState(node);
    const top = heads.sort((x, y) => y.size - x.size)[0];
    if (!top || !a.ok) return no('log does not audit');
    return await node.put('vault_cosig', 'c' + pad(top.size) + '-' + node.pub.slice(0, 6), { size: top.size, root: top.root, by: node.name });
  } catch { return no('fault'); }
}

/** The Audit agent’s housekeeping: co-sign once ten entries have gone in since its last co-signature. */
export async function witnessVault(node) {
  try {
    const { a, cos } = vaultState(node);
    const last = cos.reduce((m, c) => Math.max(m, c.size), 0);
    if (!a.ok || a.size < last + 10) return no('not due');
    return await witnessHead(node);
  } catch { return no('fault'); }
}

/** Carry out one effect of a decision: { post } → the books + vault; { c, f } → a new record. date: string or () → string. */
export async function applyEffect(node, e, date) {
  try {
    if (e && e.post) return await postEntry(node, { date: typeof date === 'function' ? date() : date, ...e.post });
    if (e && e.c && e.f) return await node.put(e.c, uid(node, e.c.slice(0, 2)), e.f);
    return { ok: false };
  } catch { return no('fault'); }
}

/** A brain as one signed record, published by the agent that holds it (so its peers can learn it). */
export function publishBrain(node, id, p, source, localAuc, n) {
  return node.put('brain', p.domain + '.' + id, { ...toRecord(p), by: id, source, localAuc: Math.round(localAuc * 1000), n: n | 0 });
}

// ── the one agent step ────────────────────────────────────────────────────────────────────────────────────────────
/** An agent device’s working memory: work waiting on the mesh, asks already answered, work already decided. */
export const createWork = () => ({ pending: new Map(), replied: new Set(), done: new Set(), tick: 0 });

/** An inbox record → the event an agent decides. Fields a hostile door could leave out are made safe. */
function eventOf(it) {
  let features = {};
  try { features = JSON.parse(it.features); } catch { features = {}; }
  return { id: it.id, domain: it.channel, features, customer: typeof it.customer === 'string' ? it.customer : '', amount: it.amount | 0, text: it.text || '' };
}

/** Post an ask — or, after a restart, take back the one this device already posted for the same work. → its id */
async function postAsk(ctx, fields) {
  const key = fields.item + '/' + fields.kind;
  const again = ctx.resume ? ctx.resume.get(key) : undefined;
  if (again) { ctx.resume.delete(key); return again; }
  const rec = askRecord(fields);
  const askId = uid(ctx.node, 'q');
  if (rec) await ctx.node.put('ask', askId, rec);
  return askId;
}

/** Ask the spine for an independent second opinion: another device, a different pattern. */
export async function askSecond(ctx, event, o, first, mesh = null) {
  const exclude = [...new Set([ctx.id, first.node])];
  const askId = await postAsk(ctx, { kind: 'second', item: event.id, from: ctx.id, features: event.features, domain: first.answer.domain, pattern: first.answer.receipt.patternId, exclude });
  ctx.work.pending.set(event.id, { stage: 'second', askId, since: ctx.clock(), o, event, first, mesh, exclude });
}

/** A peer’s brain answered: count it, and learn the job once it keeps being asked about it (if this device can). */
async function meshAnswered(ctx, mesh) {
  const d = mesh.answer.domain;
  ctx.asks[d] = (ctx.asks[d] || 0) + 1;
  if (ctx.onMesh) ctx.onMesh(mesh);
  if (ctx.learn && shouldLearn(ctx.asks, d, ctx.library())) await ctx.learn(d);
}

/** Decide, write the decision, its effects within the grant, hand-offs for the rest, and close the work. */
export async function finishWork(ctx, event, o, gathered = {}) {
  const { mesh = null, second = null, secondBy = '' } = gathered;
  const { node, id } = ctx;
  const policy = ctx.policy();
  let model = null;
  const quarantined = o.scr && !o.scr.ok;
  if (!quarantined && !(o.own && o.own.verdict === 'VERIFIED') && !mesh && ctx.modelAsk) {
    try { model = await ctx.modelAsk(id, event); } catch { model = null; }
  }
  const { decision: d, effects: fx } = closeStep({ agentId: id, event, scr: o.scr, own: o.own, mesh, second, secondBy, model, fault: o.fault, policy });
  await node.put('decisions', uid(node, 'd'), { agent: id, event: event.id, domain: d.domain || '', action: d.action || '', state: d.state, by: d.by,
    cross: !!d.crossChecked, second: d.secondBy || '', conf: d.conf | 0, receipt: d.receipt || '', why: String(d.why || '').slice(0, 300), customer: event.customer, channel: event.domain });
  const { mine, handoff } = splitEffects(fx, ctx.cols(), OWNER_OF[d.domain || event.domain]);
  for (const e of mine) await ctx.effect(node, e);
  for (const h of handoff) {
    const payload = JSON.stringify(h.payload);
    if (payload.length <= 1900) await node.put('handoff', uid(node, 'h'), { from: id, to: h.to, payload, status: 'open', event: event.id });
  }
  await node.put('inbox', event.id, { status: 'done', doneBy: id });
  ctx.work.done.add(event.id);
  return ctx.afterDecision ? ctx.afterDecision(event, o, d) : d;
}

/**
 * One beat of one agent device, on its own replica. ctx:
 *   node, id (the agent), work (createWork()), asks ({ domain: times asked }), clock() and deadline (same unit),
 *   library() → { domain: pattern }, screen(text), peers() → agent ids expected to reply, cols() → its grant,
 *   policy(), effect(node, e), modelAsk (or null), learn(domain) (or null), onMesh(mesh) and
 *   afterDecision(event, o, d) (or null), resume (a Map 'item/kind' → ask id, after a restart, or null).
 */
export async function stepAgent(ctx) {
  const { node, id, work: w } = ctx;
  const policy = ctx.policy();
  const replies = signedAs(node, 'reply', (r) => r.by);   // an answer or a second opinion counts only from the device that gave it
  // 1. answer the peers: every ask on the spine this device has not answered, from its OWN library
  for (const a of node.list('ask')) {
    if (w.replied.has(a.id) || a.from === id) continue;
    w.replied.add(a.id);
    const r = replyFor(a, ctx.library(), id);
    if (r) await node.put('reply', uid(node, 'r'), r);
  }
  const inbox = node.list('inbox');
  // 2. open the new work addressed to this device
  for (const it of inbox) {
    if (it.to !== id || it.status !== 'open' || w.pending.has(it.id) || w.done.has(it.id)) continue;
    const event = eventOf(it);
    const o = openStep({ agentId: id, event, library: ctx.library(), policy, screenFn: ctx.screen });
    if (o.next === 'final') { await finishWork(ctx, event, o, {}); continue; }
    if (o.next === 'mesh') {
      const askId = await postAsk(ctx, { kind: 'answer', item: it.id, from: id, features: event.features });
      w.pending.set(it.id, { stage: 'mesh', askId, since: ctx.clock(), o, event, exclude: [id] });
      continue;
    }
    await askSecond(ctx, event, o, o.first);
  }
  // 3. close the work whose replies are in (or whose deadline passed)
  const addressed = new Map(inbox.map((x) => [x.id, x]));
  for (const [itemId, p] of [...w.pending]) {
    const it = addressed.get(itemId);
    if (it && (it.to !== id || it.status !== 'open')) { w.pending.delete(itemId); continue; }   // re-addressed, or closed elsewhere
    const mine = repliesTo(replies, p.askId);
    const expected = ctx.peers().filter((x) => !p.exclude.includes(x));
    if (!heardFrom(mine, expected) && ctx.clock() - p.since < ctx.deadline) continue;
    w.pending.delete(itemId);
    if (p.stage === 'mesh') {
      const mesh = pickAnswer(mine);
      if (mesh) await meshAnswered(ctx, mesh);
      if (afterMesh(mesh, policy) === 'second') { await askSecond(ctx, p.event, p.o, mesh, mesh); continue; }
      await finishWork(ctx, p.event, p.o, { mesh });
      continue;
    }
    const s = pickSecond(mine, p.first.answer.domain, p.first.answer.receipt.patternId, p.exclude);
    await finishWork(ctx, p.event, p.o, { mesh: p.mesh || null, second: s ? s.answer : null, secondBy: s ? s.node : '' });
  }
  w.tick++;
}

// ── what else an agent device does: learn, stock its brains, adopt antibodies, honour hand-offs ──────────────────────
/**
 * Learn a job by being asked about it: take the brain a peer published (the job’s own agent first), re-verify it on
 * THIS device’s own rows, and record the adoption either way. → { rec, pattern, v } | null (nothing published).
 */
export async function learnBrain(input) {
  try {
    const { node, me, domain, rows, reference = null } = input;
    const recs = node.list('brain').filter((r) => r.domain === domain && r.by !== me);
    const rec = recs.find((r) => r.by === OWNER_OF[domain]) || recs[0];
    if (!rec) return null;
    const p = fromRecord(rec);
    const v = adopt(p, typeof rows === 'function' ? rows() : rows, gateFor(domain), reference);
    await node.put('adopt', uid(node, 'a'), { domain, patternId: rec.patternId || '', from: rec.by || '', by: me, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'learned' });
    return { rec, pattern: p, v };
  } catch { return null; }
}

/**
 * Stock an agent device with its brains: each job’s shipped brain file, re-verified on the device’s own rows before it is
 * trusted; the Audit agent grows its own, independent ones. Every adoption is recorded and every kept brain published.
 * input = { node, agent (an AGENTS entry), factory, features, titles, rows(domain, n), seed?, log? } → { ok, lib, src }
 */
export async function stockBrains(input) {
  const lib = {}, src = {};
  try {
    const { node, agent: a, factory = {}, features = {}, titles = {}, rows, seed = seedFor, log = () => {} } = input;
    for (const d of a.domains) {
      const p = factory[d];
      const v = adopt(p, rows(d, 600), gateFor(d));
      await node.put('adopt', uid(node, 'a'), { domain: d, patternId: p.patternId, from: 'factory', by: a.id, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'factory' });
      if (!v.adopt) { log(a.name + ' REFUSED its own ' + d + ' brain file — it did not re-verify here (' + v.reason + ')'); continue; }
      lib[d] = p;
      src[d] = { source: 'factory file', localAuc: v.localAuc, n: v.n };
      await publishBrain(node, a.id, p, 'factory', v.localAuc, v.n);
    }
    for (const d of a.grows || []) {
      const g = growPattern(d, rows(d, 700), features[d], { seed: seed(a.id, d), grownBy: a.id });
      if (!g.verified) { log(a.name + ' grew a ' + d + ' brain but it failed its held-out gate — CUT'); continue; }
      g.pattern.title = titles[d] + ' (grown by Audit)'; g.pattern.role = 'audit';
      lib[d] = g.pattern;
      src[d] = { source: 'grown here', localAuc: g.pattern.heldAuc, n: g.pattern.held };
      await publishBrain(node, a.id, g.pattern, 'grown', g.pattern.heldAuc, g.pattern.held);
      log(a.name + ' grew its own ' + d + ' brain on ' + (g.pattern.train + g.pattern.held) + ' of its own cases — held-out AUC ' + g.pattern.heldAuc.toFixed(3));
    }
    return { ok: true, lib, src };
  } catch { return { ok: false, lib, src }; }
}

/** Re-run every antibody on the spine this device has not seen on its own known-benign messages; adopt the clean ones. */
export async function adoptAntibodiesOn(input) {
  try {
    const { node, id, name = agentName(id), seen, adopted, benign = BENIGN_CORPUS, log = () => {} } = input;
    for (const r of node.list('antibody')) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const v = adoptAntibody(r, benign);
      await node.put('adopt', uid(node, 'a'), { domain: 'antibody', patternId: String(r.abId || '').slice(0, 64), from: String(r.by || '').slice(0, 64), by: id, adopted: v.adopt, localAuc: 0, n: v.n, reason: v.reason.slice(0, 200), source: 'antibody' });
      if (v.adopt) adopted.push(r);
      log(name + ' re-ran antibody ' + String(r.abId || '?').slice(0, 8) + ' on its own ' + v.n + ' known-benign messages — ' + (v.adopt ? 'ADOPTED' : 'REFUSED') + ' (' + v.reason + ')');
    }
    return { ok: true };
  } catch { return no('fault'); }
}

/**
 * Housekeeping for one agent device: carry out the hand-offs addressed to it — only those its named sender's own live agent
 * key wrote (signedAs; honoured(fromId) may add a caller's own rule) — and the held calls a PERSON approved for it (the
 * owner or a live admin wrote the approval: personApproved).
 */
export async function honourWork(input) {
  try {
    const { node, id, cols, honoured = () => true, effect } = input;   // honoured(from): any extra rule a caller adds
    const sent = new Set(signedAs(node, 'handoff', (x) => x.from).map((x) => x.id));   // written by the sender it names
    for (const h of node.list('handoff').filter((x) => x.to === id && x.status === 'open')) {
      let payload = null;
      try { payload = JSON.parse(h.payload); } catch { payload = null; }
      const ok = payload && sent.has(h.id) && honoured(h.from) ? (await effect(node, payload)).ok : false;
      await node.put('handoff', h.id, { status: ok ? 'done' : 'refused', doneBy: id });
    }
    const approved = personApproved(node, 'watch');
    for (const w of node.list('watch').filter((x) => (x.agent === id || (x.agent === 'door' && OWNER_OF[x.channel] === id)) && x.status === 'approved' && x.action && approved.has(x.id))) {
      const d = { state: 'done', action: w.action, domain: w.channel, crossChecked: false };   // what a person chose; effects() reads the action
      const { mine, handoff } = splitEffects(effects(d, { id: w.event, customer: w.customer, amount: w.amount | 0, domain: w.channel }, id), cols, OWNER_OF[w.channel]);
      for (const e of mine) await effect(node, e);
      for (const h of handoff) await node.put('handoff', uid(node, 'h'), { from: id, to: h.to, payload: JSON.stringify(h.payload), status: 'open', event: w.event });
      await node.put('watch', w.id, { status: 'executed', executedBy: id });
    }
    return { ok: true };
  } catch { return no('fault'); }
}

/**
 * The overseer’s pass of the behaviour watch (src/watch.mjs — Behavioral Entropy Signatures, the work of Gary W. Floyd, Lumiea
 * Systems Research Division — ThunderStruck Service, LLC): read every agent’s decisions on this
 * device and pause each agent the watch flags, until a person clears it. → the ids paused now.
 */
export async function oversee(input) {
  const out = [];
  try {
    const { node, agents, policy = WATCH_POLICY, paused = (x) => isPaused(node, x), by = 'AI overseer', log = () => {} } = input;
    const seen = watchAll(signedAs(node, 'decisions', (d) => d.agent), {}, clearsOf(node));
    for (const id of agents) {
      const r = seen[id];
      if (!r || !shouldPause(r, policy) || paused(id)) continue;
      await node.put('control', id, { paused: true, by, watch: r.verdict, why: String(r.reason).slice(0, 300), flaggedAt: r.flaggedAt });
      log('AI overseer paused the ' + agentName(id) + ' — the watch read it as ' + r.verdict + ': ' + r.reason);
      out.push(id);
    }
  } catch { /* the watch never breaks the heartbeat */ }
  return out;
}

// ── who is who on a real company ──────────────────────────────────────────────────────────────────────────────────
/** The live agent grants this device can see: [{ agent, pub, grant, cols }] (grant ids agent-<id> or agent-<id>.<n>). */
export function agentRoster(node) {
  try {
    const out = [];
    for (const r of node.view().roster) {
      const m = AGENT_GRANT.exec(r.grant);
      if (!r.revoked && r.role === 'agent' && m) out.push({ agent: m[1], pub: r.to, grant: r.grant, cols: r.cols.slice() });
    }
    return out;
  } catch { return []; }
}

/** Each record of a collection → the one device whose writes its named fields show ('' if they came from two devices — someone
 *  wrote over another device’s record; the device itself wins those fields back with its next write, which comes later). */
function writers(node, c, keys) {
  const out = new Map();
  const col = node.view().state.cols[c];
  if (!col) return out;
  for (const id of Object.keys(col)) {
    const f = col[id].f;
    const by = new Set(keys.filter((k) => f[k]).map((k) => f[k][1]));
    out.set(id, by.size === 1 ? [...by][0] : '');
  }
  return out;
}

// ── who really wrote it: a record is an agent's only if that agent's own key wrote it ─────────────────────────────
// Every agent may write the shared collections (asks, replies, decisions, hand-offs, the watch list), so a field that
// NAMES an agent proves nothing: a compromised agent can write "from: finance" or "by: audit". What the spine does prove
// is which key wrote each field. So every reader that acts on such a record — answers and second opinions, hand-offs,
// approvals, the behaviour watch — reads the signer, not the name.
export const SIGNED_FIELDS = Object.freeze({
  adopt: Object.freeze(['domain', 'patternId', 'from', 'by', 'adopted', 'localAuc', 'n', 'reason', 'source', 'plan']),
  brain: Object.freeze(['domain', 'title', 'role', 'real', 'features', 'rules', 'dist', 'threshold', 'spread', 'base', 'heldAuc', 'heldAcc', 'held', 'patternId', 'by', 'source', 'localAuc', 'n', 'plan']),
  reply: Object.freeze(['ask', 'item', 'by', 'kind', 'verdict', 'why', 'domain', 'label', 'conf', 'route', 'pattern', 'receipt']),
  handoff: Object.freeze(['from', 'to', 'payload', 'event']),
  decisions: Object.freeze(['agent', 'event', 'domain', 'action', 'state', 'by', 'cross', 'second', 'conf', 'receipt', 'customer', 'channel']),
  ask: Object.freeze(['item', 'from', 'kind', 'domain', 'features', 'pattern', 'exclude']),
});
export const APPROVAL_FIELDS = Object.freeze(['status', 'action']);

/** The records of collection c that really are the agent's they name — who(record) → that agent's id: every field in
 *  SIGNED_FIELDS[c] written by ONE key, and that key the one the role tree grants to that agent now. A record another
 *  device wrote, or wrote over, is not that agent's, whatever it says. */
export function signedAs(node, c, who) {
  try {
    const pubs = new Map(agentRoster(node).map((g) => [g.pub, g.agent]));
    const w = writers(node, c, SIGNED_FIELDS[c]);
    return node.list(c).filter((r) => { const a = pubs.get(w.get(r.id)); return a !== undefined && a === who(r); });
  } catch { return []; }
}

/** This device's own records of collection c: every field in SIGNED_FIELDS[c] written by its own key. */
export function ownRecords(node, c) {
  try {
    const w = writers(node, c, SIGNED_FIELDS[c]);
    return node.list(c).filter((r) => w.get(r.id) === node.pub);
  } catch { return []; }
}

/** The ids of the records of collection c whose status and action ONE person wrote — the owner, or a live admin. An
 *  approval is a person's decision: an agent that writes "approved" on a held call (its own, or another's) decides nothing. */
export function personApproved(node, c) {
  try {
    const people = new Set([node.genesis, ...node.view().roster.filter((r) => r.role === 'admin' && !r.revoked).map((r) => r.to)]);
    const w = writers(node, c, APPROVAL_FIELDS);
    return new Set([...w].filter(([, pub]) => people.has(pub)).map(([id]) => id));
  } catch { return new Set(); }
}

/** Who wrote each record of collection c: id → the ONE key that wrote every field in SIGNED_FIELDS[c] it holds, or '' when
 *  another device wrote over part of it. The same reading signedAs and ownRecords make — for readers that also accept a
 *  person's key (src/sow.mjs: a planted brain may be signed by the owner or an admin who planted it). */
export function signersOf(node, c) {
  try { return writers(node, c, SIGNED_FIELDS[c]); } catch { return new Map(); }
}

// ── the agent shell ───────────────────────────────────────────────────────────────────────────────────────────────
const dayOf = (t) => { try { return new Date(t).toISOString().slice(0, 10); } catch { return '1970-01-01'; } };

/**
 * ONE real device runs ONE agent. opts:
 *   node      — this device (src/node.mjs createNode), already in the company
 *   agentId   — which agent it runs (an AGENTS id); the owner grants this device that agent’s scope
 *   library   — its brains { domain: pattern } (stockBrains gives them)
 *   policy    — a fixed policy, else the one on the spine · now() — ms clock · deadline — ms to wait for replies
 *   localRows(domain) — its own rows, if it may learn a peer’s brain (re-verified on them) · benign — its known-benign
 *   messages for antibodies · model — { adapter, budget, price } for the work no brain covers · log(s)
 * → { tick() → Promise<status>, status() }. tick never rejects; two ticks never overlap.
 */
export function createAgentShell(opts) {
  let node = null, agentId = '', lib = {}, fixed = null, now = Date.now, deadline = DEADLINE_MS, localRows = null, model = null, benign = BENIGN_CORPUS, log = () => {};
  try {
    const o = opts;
    ({ node, agentId } = o);
    lib = { ...(o.library || {}) };
    fixed = o.policy || null;
    if (typeof o.now === 'function') now = o.now;
    if (Number.isSafeInteger(o.deadline) && o.deadline >= 0) deadline = o.deadline;
    if (typeof o.localRows === 'function') localRows = o.localRows;
    if (o.model && o.model.adapter) model = o.model;
    if (Array.isArray(o.benign)) benign = o.benign;
    if (typeof o.log === 'function') log = o.log;
  } catch { node = null; }
  const agent = agentOf(agentId);
  const work = createWork();
  const asks = {};
  const seen = new Set(), adopted = [];
  const resume = new Map();
  const st = { state: 'new', why: '', ticks: 0, decided: 0, spent: 0, closed: 0 };
  let started = false, busy = null;
  const clock = () => { const t = Number(now()); return Number.isFinite(t) ? t : 0; };
  const grants = () => agentRoster(node).filter((g) => g.agent === agentId && g.pub === node.pub);
  const peers = () => [...new Set(agentRoster(node).map((g) => g.agent))].filter((x) => x !== agentId).sort();
  const cols = () => [...new Set(grants().flatMap((g) => g.cols))];
  const effect = (n, e) => applyEffect(n, e, () => dayOf(clock()));
  async function modelAsk(id, event) {
    const m = await ask({ adapter: model.adapter, task: { agent: id, type: 'case', domain: event.domain, features: event.features }, budget: model.budget, spent: st.spent, price: model.price });
    st.spent += m.pence | 0;
    if (m.audit) await node.put('model', uid(node, 'mc'), m.audit);   // refused, unsigned, unless its grant names 'model'
    return m.ok ? m.model : null;
  }
  async function learn(domain) {
    asks[domain] = 0;
    const r = await learnBrain({ node, me: agentId, domain, rows: () => localRows(domain) });   // it learns only a job it holds no brain for
    if (r && r.v.adopt) { lib[domain] = r.pattern; log(agentName(agentId) + ' learned the ' + domain + ' brain from ' + agentName(r.rec.by) + ' — re-verified on ' + r.v.n + ' of its own cases'); }
  }
  const ctx = { node, id: agentId, work, asks, resume, deadline, clock, library: () => lib, screen: (text) => screenWith(text, adopted), peers, cols,
    policy: () => fixed || policyOf(node), effect, modelAsk: model ? modelAsk : null, learn: localRows ? learn : null, onMesh: null,
    afterDecision: async (event, o, d) => { st.decided++; return d; } };

  /** After a restart: what this device already answered, asked and decided is on the spine — pick it up from there. */
  async function resumeFromSpine() {
    for (const r of ownRecords(node, 'reply')) if (r.by === agentId) work.replied.add(r.ask);
    const decided = new Set(ownRecords(node, 'decisions').filter((d) => d.agent === agentId).map((d) => d.event));
    const open = node.list('inbox').filter((x) => x.to === agentId && x.status === 'open').map((x) => x.id);
    for (const a of ownRecords(node, 'ask')) if (a.from === agentId) resume.set(a.item + '/' + a.kind, a.id);   // its latest ask per piece of work and kind
    const rerun = new Set(node.list('adopt').filter((x) => x.by === agentId && x.source === 'antibody').map((x) => x.patternId));
    for (const r of node.list('antibody')) {
      if (!rerun.has(String(r.abId || '').slice(0, 64))) continue;
      seen.add(r.id);
      if (adoptAntibody(r, benign).adopt) adopted.push(r);
    }
    for (const id of open.filter((x) => decided.has(x))) {          // decided before the restart, never closed: close it, never decide again
      await node.put('inbox', id, { status: 'done', doneBy: agentId });
      work.done.add(id);
      st.closed++;
    }
  }
  const set = (state, why) => { st.state = state; st.why = why; };
  async function beat() {
    st.ticks++;
    if (!node || !agent) return set('no-agent', 'there is no agent called ' + str(agentId) + ' in this company');
    if (!grants().length) return set('waiting-grant', 'this device holds no live grant as the ' + agent.name + ' yet — the owner grants it on their device');
    if (isPaused(node, agentId)) {
      const c = node.list('control').find((r) => r.id === agentId);
      return set('paused', 'paused by ' + (str(c.by) || 'a person') + (str(c.why) ? ' — ' + c.why : '') + '. A person clears it on their device.');
    }
    if (!started) { started = true; await resumeFromSpine(); }
    await stepAgent(ctx);
    await honourWork({ node, id: agentId, cols: cols(), effect });   // a hand-off counts only if its sender's live agent key wrote it (signedAs)
    if (agent.domains.length) await adoptAntibodiesOn({ node, id: agentId, name: agent.name, seen, adopted, benign, log });
    else await witnessVault(node);
    set('running', 'working: ' + work.pending.size + ' waiting on replies');
  }
  function status() {
    try {
      const mineDecisions = node.list('decisions').filter((d) => d.agent === agentId);
      const w = watchAll(mineDecisions)[agentId];
      return { ok: true, agent: agentId, name: agent ? agent.name : '', state: st.state, why: st.why, ticks: st.ticks, cols: cols(), brains: Object.keys(lib).sort(),
        pending: work.pending.size, decidedHere: st.decided, closedAfterRestart: st.closed, decisions: mineDecisions.length,
        replies: node.list('reply').filter((r) => r.by === agentId).length, antibodies: adopted.length, peers: peers(),
        watch: w ? w.verdict : 'learning', model: !!model, spent: st.spent, last: mineDecisions.slice(-5).reverse() };
    } catch { return { ok: false, agent: str(agentId), state: st.state, why: st.why, ticks: st.ticks }; }
  }
  return {
    tick() {
      if (!busy) {
        busy = beat().catch((e) => set('error', 'this beat failed and was dropped: ' + String((e && e.message) || e).slice(0, 160)))
          .then(() => { busy = null; });
      }
      return busy.then(status);
    },
    status,
  };
}

// ── wiring: what a device can see of the company it is in ──────────────────────────────────────────────────────────
/** The company as this device holds it, without its wiring records: the same on every device that holds the same writes. */
export function companyMark(node) {
  try {
    const s = node.view().state;
    const cols = {};
    for (const c of Object.keys(s.cols)) if (c !== WIRE) cols[c] = s.cols[c];
    return sha256(canonical({ cols, docs: s.docs })).slice(0, 16);
  } catch { return ''; }
}

/** The wiring records, each with the one device that wrote it (writer; '' if two devices wrote that id). */
export function wireRecords(node) {
  try {
    const by = writers(node, WIRE, CHECKIN);
    return node.list(WIRE).map((r) => ({ ...r, writer: by.get(r.id) || '' }));
  } catch { return []; }
}

/** This device says, on the spine, what it is and which company it holds. Written only when something changed. */
export async function checkIn(node, info) {
  try {
    const { role = '', agent = '', name = '', at = '' } = info || {};
    if (!node.canWrite(WIRE)) return no('not-authorised');
    const f = { kind: 'device', role: str(role).slice(0, 16), agent: str(agent).slice(0, 32), name: str(name).slice(0, 40), mark: companyMark(node) };
    const id = 'dev-' + node.pub.slice(0, 16);
    const had = wireRecords(node).find((r) => r.id === id);
    if (had && had.writer === node.pub && ['kind', 'role', 'agent', 'name', 'mark'].every((k) => had[k] === f[k])) return { ok: true, wrote: false, mark: f.mark };
    const r = await node.put(WIRE, id, { ...f, at: str(at).slice(0, 40) });
    return { ok: r.ok, wrote: r.ok, mark: f.mark, reason: r.reason };
  } catch { return no('fault'); }
}

/**
 * The wiring view of a company from one device: the live devices and their roles, the devices that checked in (only a
 * check-in its own device wrote counts), whether the owner marked the recovery cards printed, the owner’s receipts,
 * the work each agent’s own device decided or answered, and this device’s company mark.
 */
export function wiringView(node) {
  try {
    const v = node.view();
    const genesis = node.genesis, me = node.pub;
    const devices = [];
    for (const r of v.roster) {
      if (r.revoked) continue;
      const m = AGENT_GRANT.exec(r.grant);
      devices.push({ pub: r.to, role: r.role, agent: r.role === 'agent' && m ? m[1] : '', grant: r.grant });
    }
    const wire = wireRecords(node);
    const checkins = {};
    for (const w of wire) {
      if (w.kind === 'device' && w.writer !== '' && w.id === 'dev-' + w.writer.slice(0, 16)) {
        checkins[w.writer] = { role: str(w.role), agent: str(w.agent), name: str(w.name), mark: str(w.mark), at: str(w.at) };
      }
    }
    const cards = wire.find((w) => w.id === 'cards' && w.kind === 'cards' && w.writer === genesis);
    const receipts = wire.filter((w) => w.kind === 'receipt' && w.writer === genesis)
      .map((w) => ({ id: w.id, hash: str(w.hash), at: str(w.at), devices: w.devices | 0, mark: str(w.mark) }));
    const agentPubs = new Map(agentRoster(node).map((g) => [g.pub, g.agent]));
    const decided = {}, replied = {};
    const dw = writers(node, 'decisions', ['agent', 'event']), rw = writers(node, 'reply', ['by', 'ask']);
    for (const d of node.list('decisions')) if (agentPubs.get(dw.get(d.id)) === d.agent) decided[d.agent] = (decided[d.agent] || 0) + 1;
    for (const r of node.list('reply')) if (r.verdict === 'VERIFIED' && agentPubs.get(rw.get(r.id)) === r.by) replied[r.by] = (replied[r.by] || 0) + 1;
    return { ok: true, genesis, me, owner: me === genesis, devices, grants: v.roster.map((r) => r.grant), checkins, cards: !!cards, cardsMade: cards ? str(cards.made) : '',
      receipts, decided, replied, mark: companyMark(node) };
  } catch {
    return { ok: false, genesis: '', me: '', owner: false, devices: [], grants: [], checkins: {}, cards: false, cardsMade: '', receipts: [], decided: {}, replied: {}, mark: '' };
  }
}

/** The grant a device needs for a role: { ok, id, to, role, cols } — the owner (or an admin) signs it with node.grant. */
export function grantFor(view, req) {
  try {
    const { role, agent = '', pub } = req;
    if (!HEX64.test(pub)) return no('key');
    if (pub === view.genesis) return no('owner');
    if (!ROLES.includes(role)) return no('role');
    if (role === 'admin' && view.owner !== true) return no('only-the-owner');
    const a = agentOf(agent);
    if (role === 'agent' && !a) return no('agent');
    if (view.devices.some((d) => d.pub === pub && d.role === role && d.agent === (role === 'agent' ? agent : ''))) return no('already');
    const used = new Set(view.grants);
    const free = (base) => { if (!used.has(base)) return base; let i = 2; while (used.has(base + '.' + i)) i++; return base + '.' + i; };
    const cols = role === 'agent' ? [...a.cols, WIRE, 'model'] : role === 'hub' ? [...HUB.cols, WIRE] : role === 'admin' ? ['*'] : [...STAFF_COLS];
    return { ok: true, id: free(role === 'agent' ? 'agent-' + agent : role + '-' + pub.slice(0, 8)), to: pub, role, cols };
  } catch { return no('fault'); }
}

/**
 * A test piece of work for each agent that decides work, drawn by the door’s own pick (company.pickEvent) from the
 * held-out half of the published data, addressed to that agent. → [{ id, f }] — the hub writes each as put('inbox', id, f).
 */
export function testWork(input) {
  try {
    const { agents, pools, seed = 1, base = 0 } = input;
    const rnd = prng(seed);
    const out = [];
    let n = base;
    for (const id of agents) {
      const a = agentOf(id);
      if (!a || !a.domains.length) continue;
      const d = a.domains[0];
      const ev = pickEvent(rnd, { [d]: pools[d] }, n);
      n++;
      if (ev) out.push({ id: ev.id, f: { to: id, channel: ev.domain, customer: ev.customer, amount: ev.amount | 0, text: String(ev.text || '').slice(0, 1500), features: JSON.stringify(ev.features), status: 'open', ticks: 0 } });
    }
    return out;
  } catch { return []; }
}

// ── the tech person’s afternoon ───────────────────────────────────────────────────────────────────────────────────
/** The exact steps to put a local model on the AI box for this page (checked against Ollama’s own documentation). */
export function ollamaSteps(os, origin) {
  const which = OSES.includes(os) ? os : 'windows';
  const o = typeof origin === 'string' && ORIGIN.test(origin) ? origin : '';
  const local = o === '' || LOOPBACK.test(o);
  const pull = { say: 'Download the model the agents use (about 4.7 GB):', cmd: 'ollama pull ' + LOCAL_MODEL };
  const check = { say: 'Check it: open Wire it on the AI box and press “Check for a local model”. If the browser asks whether this page may connect to apps on this device or your local network, allow it.', cmd: '' };
  const allow = local ? [{ say: 'This page is served from this machine, so Ollama already accepts it — nothing to allow.', cmd: '' }]
    : which === 'windows' ? [{ say: 'Allow this page to call it. Quit Ollama (right-click its icon by the clock → Quit), then in PowerShell:', cmd: 'setx OLLAMA_ORIGINS "' + o + '"' },
      { say: 'Start Ollama again from the Start menu. (setx is the same as adding OLLAMA_ORIGINS under Settings → “Edit environment variables for your account”.)', cmd: '' }]
      : which === 'mac' ? [{ say: 'Allow this page to call it — in Terminal:', cmd: 'launchctl setenv OLLAMA_ORIGINS "' + o + '"' },
        { say: 'Quit Ollama from the menu bar and open it again. This setting lasts until the Mac restarts: run the line again after a restart.', cmd: '' }]
        : [{ say: 'Allow this page to call it. Open the service settings:', cmd: 'sudo systemctl edit ollama.service' },
          { say: 'Add these two lines, save and close:', cmd: '[Service]\nEnvironment="OLLAMA_ORIGINS=' + o + '"' },
          { say: 'Restart Ollama:', cmd: 'sudo systemctl daemon-reload && sudo systemctl restart ollama' }];
  const install = which === 'linux' ? { say: 'Install Ollama:', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' }
    : { say: 'Install Ollama for ' + (which === 'mac' ? 'macOS' : 'Windows') + ' from ollama.com/download and start it.', cmd: '' };
  return { os: which, origin: o, local, steps: [install, pull, ...allow, check] };
}

/** Minutes a stranger needs per unit of each step — our estimate, not yet timed with a stranger. */
export const MINUTES = Object.freeze({ found: 3, cards: 5, invite: 2, roles: 1, hub: 10, agents: 6, machines: 3, model: 20, proof: 3, same: 2, receipt: 2 });
const PERSON = ['staff', 'admin'];

/** The plan being wired: how many people’s devices besides the owner’s, and which agents. Junk → the defaults. */
export function planOf(plan) {
  let people = 1, agents = AGENTS.map((a) => a.id);
  try {
    if (Number.isSafeInteger(plan.people) && plan.people >= 0 && plan.people <= 64) people = plan.people;
    if (Array.isArray(plan.agents)) agents = AGENTS.map((a) => a.id).filter((id) => plan.agents.includes(id));
  } catch { /* the defaults */ }
  return { people, agents };
}

/**
 * The checklist, live: { view: wiringView(node), probes } → { ok, steps, next, complete, done, required, minutesLeft,
 * minutesTotal }. probes = { plan: { people, agents }, pending (devices that reached this one and hold no grant yet),
 * model: { ok, models } (a local model found on this machine), os, origin, link (the invite link) }.
 * Each step: { id, n, title, status: done | todo | waiting | optional, who, minutes, say, how: [lines], detail: [lines] }.
 */
export function wiringChecklist(input) {
  let view = null, probes = {};
  try { ({ view, probes = {} } = input); } catch { view = null; }
  if (!view || view.ok !== true) return { ok: false, reason: 'no company on this device yet', steps: [], next: 'found', complete: false, done: 0, required: 0, minutesLeft: 0, minutesTotal: 0 };
  try {
    const plan = planOf(probes.plan);
    const pending = Number.isSafeInteger(probes.pending) ? Math.max(0, probes.pending) : 0;
    const link = str(probes.link);
    const heard = (pub) => Object.prototype.hasOwnProperty.call(view.checkins, pub);
    const people = view.devices.filter((d) => PERSON.includes(d.role));
    const hub = view.devices.find((d) => d.role === 'hub');
    const agents = plan.agents.map((id) => {
      const g = view.devices.find((d) => d.role === 'agent' && d.agent === id);
      return { id, name: agentName(id), granted: !!g, heard: !!g && heard(g.pub) };
    });
    const others = view.devices.filter((d) => d.pub !== view.me);
    const silent = view.devices.filter((d) => !heard(d.pub));
    const differ = Object.keys(view.checkins).filter((p) => p !== view.me && view.checkins[p].mark !== view.mark);
    const workers = plan.agents.filter((id) => agentOf(id).domains.length);
    const proved = workers.filter((id) => (view.decided[id] | 0) > 0);
    const auditOk = !plan.agents.includes('audit') || (view.replied.audit | 0) > 0;
    const model = probes.model && probes.model.ok === true;
    const lastReceipt = view.receipts[view.receipts.length - 1];
    const short = (p) => p.slice(0, 8);
    const steps = [
      { id: 'found', title: 'Found the company on the owner’s device', who: 'the owner, with you beside them', units: 1, status: 'done',
        say: 'The owner’s own laptop becomes the root of the company. Its key is made there, and the browser will not let anything copy it off.',
        how: ['On the owner’s laptop, open this page and choose Run your own → “Found a company on this device”.'], detail: ['Company ' + short(view.genesis) + ' is founded.'] },
      { id: 'cards', title: 'Print the owner’s recovery cards and store them apart', who: 'the owner', units: 1, status: view.cards ? 'done' : 'todo',
        say: 'Three printed cards; any two bring the owner back on a new machine if the laptop is lost. One card alone reveals nothing.',
        how: ['On the owner’s laptop, straight after founding: “Print recovery cards”, then “I have printed and stored them”.', 'Keep each card in a different place — a safe, a bank box, a trusted director. Never photograph them.'],
        detail: [view.cards ? 'The owner marked the cards printed' + (view.cardsMade ? ' on ' + view.cardsMade : '') + '.' : 'Not marked printed yet. If the cards were printed before this step existed, the owner presses “The cards are printed and stored” in Wire it.'] },
      { id: 'invite', title: 'Invite each person’s device', who: 'you, then each person', units: plan.people, status: people.length + pending >= plan.people ? 'done' : 'todo',
        say: 'Each person who works with the company opens the invite link on their own laptop or phone. That device makes its own key there.',
        how: ['Send each person the invite link over something you already trust (in person, a work chat). The link names the company; it gives no access by itself.', 'They open it and choose Wire it → “A person’s device”. Their screen shows their device key — they send it to the owner.'].concat(link ? ['Invite link: ' + link] : []),
        detail: [(people.length + pending) + ' of ' + plan.people + ' planned people’s devices have reached the company' + (pending ? ' (' + pending + ' waiting for a grant)' : '') + '.'] },
      { id: 'roles', title: 'Grant each person’s device its role', who: 'the owner', units: plan.people, status: people.length >= plan.people ? 'done' : 'todo',
        say: 'Nothing a device writes counts until the owner (or an admin) grants it. Staff can use tasks, chat, documents and the CRM; an admin can grant and revoke.',
        how: ['On the owner’s laptop, in Wire it → Devices, paste the device key (or use the button beside a device that has connected) and pick its role.', 'Make one trusted person a second admin on their own machine, so the company is never stuck if the owner’s laptop is lost.'],
        detail: [people.length + ' of ' + plan.people + ' people’s devices granted (' + people.filter((d) => d.role === 'admin').length + ' admin).'] },
      { id: 'hub', title: 'Stand up the office hub', who: 'you', units: 1, status: !hub ? 'todo' : heard(hub.pub) ? 'done' : 'waiting',
        say: 'The hub is the door: an always-on machine in the office where the work arrives and is handed to the agents.',
        how: ['On the always-on office machine, open the invite link in Chrome or Edge and choose Wire it → “The office hub”. Send its device key to the owner.', 'On the owner’s laptop, grant that key as the hub. Leave the hub’s page open.'],
        detail: [!hub ? 'No hub granted yet.' : heard(hub.pub) ? 'Hub ' + short(hub.pub) + ' is granted and has checked in.' : 'Hub ' + short(hub.pub) + ' is granted but has not checked in — connect it (step 7).'] },
      { id: 'agents', title: 'Stand up each AI agent device', who: 'you, then the owner', units: plan.agents.length, status: agents.every((a) => a.heard) ? 'done' : agents.every((a) => a.granted) ? 'waiting' : 'todo',
        say: 'Each agent is its own device with its own key, on the AI box. One browser profile per agent: a key may be open in one place only.',
        how: ['On the AI box, make one browser profile per agent (Chrome: the profile icon → Add; name it after the agent).', 'In each profile open the invite link, choose Wire it → “An AI agent”, pick the agent and send the device key to the owner.', 'On the owner’s laptop, grant each key as that agent; then press “Start the agent” in each profile. It starts again by itself when that window reopens — leave each window open.'],
        detail: agents.map((a) => a.name + ': ' + (a.heard ? 'granted and checked in' : a.granted ? 'granted, not checked in yet' : 'not granted yet')) },
      { id: 'machines', title: 'Connect the machines to each other', who: 'you', units: Math.max(1, others.length), status: others.length && !silent.length ? 'done' : others.length ? 'waiting' : 'todo',
        say: 'There is no server: devices on different machines (or in different browser profiles) connect directly. Every device must link to at least one other.',
        how: ['On a device already in the company: Run your own → Connect another machine → “Host — make a code”.', 'Carry the code to the new device (it contains that machine’s network address — do not post it publicly), choose “I have a code”, paste it, and carry the reply back.', 'Machines in the office connect directly. A machine on another network needs a router that allows a direct connection; this page never relays through a server.'],
        detail: silent.length ? ['Not heard from yet: ' + silent.map((d) => short(d.pub) + ' (' + (d.agent ? agentName(d.agent) : d.role) + ')').join(', ') + '.'] : [others.length ? 'Every granted device has checked in here.' : 'No other device is granted yet.'] },
      { id: 'model', title: 'Optional: a language model on the AI box', who: 'you', units: 1, status: model ? 'done' : 'optional',
        say: 'The brains decide structured cases without one. A local model reads free text no brain covers — on your own machine, with nothing sent out.',
        how: ollamaSteps(probes.os, probes.origin).steps.map((s) => s.say + (s.cmd ? ' ' + s.cmd : '')),
        detail: [model ? 'A local model answers on this machine: ' + (Array.isArray(probes.model.models) ? probes.model.models.slice(0, 4).join(', ') : '') + '.' : 'No local model checked on this machine.'] },
      { id: 'proof', title: 'Send each agent a test piece of work', who: 'you, at the hub', units: 1, status: proved.length === workers.length && auditOk ? 'done' : 'todo',
        say: 'The proof it works: real cases from published data go in at the hub, each agent decides one on its own device, and a money call is confirmed by another device’s brain.',
        how: ['On the hub, in Wire it, press “Send a test piece of work to each agent”.', 'Within a minute each agent’s line below says it decided one, and each agent window lists what it decided and whose brain answered.'],
        detail: workers.map((id) => agentName(id) + ': ' + ((view.decided[id] | 0) > 0 ? (view.decided[id] | 0) + ' decided on its own device' : 'nothing decided yet')).concat(plan.agents.includes('audit') ? ['Audit agent: ' + ((view.replied.audit | 0) > 0 ? (view.replied.audit | 0) + ' second opinions given' : 'no second opinion given yet')] : []) },
      { id: 'same', title: 'Every device shows the same company', who: 'you', units: 1, status: Object.keys(view.checkins).some((p) => p !== view.me) && !differ.length && !silent.length ? 'done' : 'waiting',
        say: 'Each device reports the mark of the company it holds. When no work is moving, every mark must match this one: ' + view.mark + '.',
        how: ['When no work is moving, press “Ask every device to check in” on the owner’s laptop (Wire it → Devices). Every device with this page open answers with the company it holds.', 'A device whose mark differs is not connected to the rest — connect it (step 7), then ask again.'],
        detail: differ.length ? ['Different company mark: ' + differ.map((p) => short(p) + ' shows ' + view.checkins[p].mark).join(', ') + '.'] : ['Every device that checked in shows ' + view.mark + '.'] },
      { id: 'receipt', title: 'Sign the wiring receipt', who: 'the owner', units: 1, status: lastReceipt && lastReceipt.devices === view.devices.length ? 'done' : 'todo',
        say: 'The owner signs a record of every device, its role and the company it showed: the proof this planting was wired, kept on the spine and saved as a file.',
        how: ['On the owner’s laptop, in Wire it, press “Sign the wiring receipt”, then “Save the receipt”.'],
        detail: [lastReceipt ? 'Last receipt ' + lastReceipt.hash.slice(0, 16) + ' at ' + lastReceipt.at + ' covers ' + lastReceipt.devices + ' devices.' : 'No receipt signed yet.'] },
    ].map((s, i) => ({ ...s, n: i + 1, minutes: MINUTES[s.id] * s.units, optional: s.id === 'model' }));
    const required = steps.filter((s) => !s.optional);
    const open = required.filter((s) => s.status !== 'done');
    return { ok: true, steps, next: open.length ? open[0].id : null, complete: !open.length, done: required.length - open.length, required: required.length,
      minutesLeft: open.reduce((m, s) => m + s.minutes, 0), minutesTotal: required.reduce((m, s) => m + s.minutes, 0) };
  } catch { return { ok: false, reason: 'the checklist could not read this view', steps: [], next: null, complete: false, done: 0, required: 0, minutesLeft: 0, minutesTotal: 0 }; }
}

/**
 * The wiring receipt: what was wired, when, every device’s role and the company mark it showed — signed by the OWNER’s
 * device. keys = keys.mjs keys { pub, priv } or a key-store device { pub, sign(bytes) }. → { ok, receipt } | refusal.
 */
export async function wiringReceipt(input) {
  try {
    const { view, checklist = null, keys, at } = input;
    if (!view || view.ok !== true) return no('view');
    if (!keys || keys.pub !== view.genesis) return no('not-owner');
    if (typeof at !== 'string' || !ISO.test(at)) return no('at');
    const devices = view.devices.map((d) => {
      const c = view.checkins[d.pub];
      return canonical({ pub: d.pub, role: d.role, agent: d.agent, heard: !!c, mark: c ? c.mark : '', same: !!c && c.mark === view.mark });
    }).sort().map((s) => JSON.parse(s));
    const steps = checklist && Array.isArray(checklist.steps) ? checklist.steps.map((s) => ({ id: str(s.id), status: str(s.status) })) : [];
    const body = { model: RECEIPT_MODEL, company: view.genesis, at, mark: view.mark, devices, steps, by: keys.pub };
    const text = canonical(body);
    const sig = typeof keys.sign === 'function' ? toHex(await keys.sign(utf8(text))) : await signWith(keys, utf8(text));
    return { ok: true, receipt: { ...body, hash: sha256(text), sig } };
  } catch { return no('fault'); }
}

/** Check a wiring receipt with nothing but itself: its hash, and the owner’s signature over it. → { ok, … } | refusal */
export async function verifyWiringReceipt(receipt) {
  try {
    const { hash, sig, ...body } = receipt;
    if (body.model !== RECEIPT_MODEL) return no('model');
    if (body.by !== body.company || !HEX64.test(body.by)) return no('not-owner');
    const text = canonical(body);
    if (sha256(text) !== hash) return no('hash');
    if (!(await verify(body.by, sig, utf8(text)))) return no('signature');
    return { ok: true, company: body.company, at: body.at, devices: body.devices.length, same: body.devices.filter((d) => d.same).length };
  } catch { return no('fault'); }
}

/** The receipt as one wiring record on the spine (the owner writes it; its own signature on the envelope vouches for it). */
export function receiptRecord(receipt) {
  try {
    return { id: 'receipt-' + receipt.hash.slice(0, 16), f: { kind: 'receipt', hash: receipt.hash, sig: receipt.sig, at: receipt.at, mark: receipt.mark,
      devices: receipt.devices.length, same: receipt.devices.filter((d) => d.same).length } };
  } catch { return null; }
}
