// runtime.mjs — the AI company, running. The one loop the live page and the headless re-run both use.
//
// Nine devices on the spine: the office hub (the door), two humans who watch, six AI agents. The agents share NOTHING
// but the spine: every question one brain asks another, and every answer, is a signed record. Each tick:
//   1. the spine syncs between online devices;
//   2. work arrives at the door — the hub writes it as an inbox record addressed to an agent;
//   3. every agent device, on its own replica: replies to its peers' asks from its own brain; opens its new work
//      (screen, own brain); closes the work whose replies are in (or whose deadline passed) — decide, write the
//      decision and its effects, hand off what its grant does not cover, learn what it keeps being asked, regrow on
//      the outcomes that come back;
//   4. housekeeping: purchase orders posted, hand-offs honoured, the humans' watch-list choices carried out, the vault
//      co-signed, and the behaviour watch run over every agent.
// Deterministic for a given seed and date: the same inputs give the same company, byte for byte — which is what lets
// CI re-run it and check a receipt. Ground truth never goes on the spine: it stays in memory, to score the agents.
import { createNode, pull } from './node.mjs';
import { fromSeed } from './keys.mjs';
import { sha256Bytes, sha256 } from './sha256.mjs';
import { canonical } from './canon.mjs';
import { leafHash, root, audit } from './vault.mjs';
import { encodeLines, validEntry, profitAndLoss, balanceSheet, trialBalance } from './books.mjs';
import { prng } from './sim.mjs';
import { adopt, toRecord, fromRecord, GATE_AUC, HIGH_STAKES_GATE } from './brain.mjs';
import { growPattern } from './grow.mjs';
import { sample, shopperRows } from './streams.mjs';
import { screen } from './screen.mjs';
import { screenWith, makeAntibody, adoptAntibody, BENIGN_CORPUS } from './antibody.mjs';
import { AGENTS, HUMANS, HUB, OWNER_OF, HOSTILE_TEXT, agentName, pickEvent, openStep, afterMesh, closeStep, effects, splitEffects, invoiceEntry, payEntry, OPENING_STOCK, shouldLearn, challenge, boardKpis, REGROW_EVERY } from './company.mjs';
import { askRecord, replyFor, repliesTo, heardFrom, pickAnswer, pickSecond } from './mesh.mjs';
import { ACTIONS, DEFAULT_POLICY } from './agent.mjs';
import { ask } from './model.mjs';
import { watchAll, shouldPause, DEFAULT_POLICY as WATCH_POLICY } from './watch.mjs';
// the one agent step, the books, the vault witness, the antibodies, hand-offs and the overseer — shared with a real agent device
import { uid, seedFor, gateFor, policyOf, isPaused, clearsOf, vaultState, postEntry, witnessHead, witnessVault, applyEffect, publishBrain, createWork,
  stepAgent, finishWork, askSecond, learnBrain, stockBrains, adoptAntibodiesOn, honourWork, oversee, signedAs } from './shell.mjs';

const pad = (n, w = 6) => String(n).padStart(w, '0');
export { seedFor };   // src/shell.mjs: the one seed a device grows its own brain with
export const HUMAN_IDS = HUMANS.map((h) => h.id);
export const AGENT_IDS = AGENTS.map((a) => a.id);
export const WORKERS = AGENTS.filter((a) => a.domains.length).map((a) => a.id);
export const DEVICE_IDS = [...HUMAN_IDS, HUB.id, ...AGENT_IDS];
export const DEADLINE = 3;          // ticks an asker waits for replies before deciding on what it has
export const PO_ARRIVES = 2;        // housekeeping rounds from a purchase order to the goods and the supplier's invoice
export const PO_PAID = 3;           // rounds from the invoice to paying the supplier
export const OPENING_CAPITAL = 10000000;   // pence
export const displayName = (id) => (id === HUB.id ? HUB.name : (HUMANS.find((h) => h.id === id) || AGENTS.find((a) => a.id === id) || { name: String(id) }).name);
export const isAgent = (id) => AGENT_IDS.includes(id);
/** The five customer-facing desks, in a customer's words — what the model router is told (routed 4/5 vs 3/5 on the job lines). */
export const DESKS = Object.freeze([
  { id: 'sales', job: 'buying: products, prices, stock and availability, new orders, quotes' },
  { id: 'service', job: 'existing customers: bills, plans, contracts, cancelling, complaints, the app, logging in to their own account' },
  { id: 'finance', job: 'money: payments, refunds, invoices, credit limits, trade accounts and payment terms' },
  { id: 'ops', job: 'operations: deliveries, machines and equipment faults, maintenance, energy, suppliers and purchase orders' },
  { id: 'systems', job: 'security and IT: suspicious logins, hacking, intrusions, admin access, IT systems' },
]);

/**
 * brains = { index: {domain: {file, title, …}}, patterns: {domain: pattern}, shopper: {features, data}, real?: {domain: sampleJson} }
 * opts.seed — the door's dice · opts.date() — the posting date (fixed in a re-run) · opts.log(s) — the growth log
 */
export function createCompany(brains, { seed = 20261014, date = () => new Date().toISOString().slice(0, 10), log = () => {} } = {}) {
  const co = {
    nodes: {}, keys: {}, order: [...DEVICE_IDS], online: {},
    factory: {}, features: {}, titles: {}, libs: {}, src: {}, local: {}, outcomes: {}, asks: {},
    pools: {}, shopperLocal: [], ledger: [], byEvent: new Map(), truthOf: new Map(), events: new Map(), rnd: prng(seed), n: 0, tickN: 0,
    human: { done: 0, right: 0 }, meshEdges: new Map(), crossEdges: new Map(), regrowths: { tried: 0, promoted: 0 }, learned: 0, outCount: {},
    work: {},                                            // per agent device: { pending: Map, replied: Set, done: Set, tick }
    poAge: new Map(),                                    // purchase order id → housekeeping rounds since its last step
    // hooks the organs plug into (defaults are the plain behaviour)
    screenFor: () => screen,                             // the inbound screen an agent uses (antibodies extend it)
    modelAsk: null,                                      // async (agentId, event) → { label, domain, by } | null — the model tier
    afterTick: [],                                       // async (co) → void — e.g. the behaviour watch
  };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  // money and security jobs need more than the plain gate before a brain is trusted with them (gateFor, src/shell.mjs)
  // the best brain this device already knows for a job — its own, else the shipped one — which any offer must not undercut
  const referenceFor = (id, d) => (co.libs[id] && co.libs[id][d]) || co.factory[d] || null;
  const brainLog = (s) => log(s);

  // ── the model tier (src/model.mjs): off unless the page connects one; the headless re-run never does ──
  co.modelTier = null;                                   // { adapter, budget, price } — the page sets it
  co.modelSpent = 0;                                     // whole pence across the run
  /** One model call: budget checked on the worst case first; every attempt, made or refused, audited on the spine. */
  co.modelCall = async (agentId, task) => {
    const t = co.modelTier;
    if (!t) return { ok: false, why: 'no model tier connected', pence: 0, audit: null };
    const m = await ask({ adapter: t.adapter, task: { agent: agentId, ...task }, budget: t.budget, spent: co.modelSpent, price: t.price });
    co.modelSpent += m.pence | 0;
    const hub = co.nodes.hub;
    if (m.audit && hub.canWrite('model')) await hub.put('model', uid(hub, 'mc'), m.audit);   // flat fields; never the key
    return m;
  };
  /** cfg = { adapter, budget (pence), price? } or null to disconnect. */
  co.connectModel = (cfg) => {
    co.modelTier = cfg && cfg.adapter ? cfg : null;
    co.modelAsk = co.modelTier ? async (id, event) => {
      const m = await co.modelCall(id, { type: 'case', domain: event.domain, features: event.features });
      return m.ok ? m.model : null;
    } : null;
  };
  /** A customer's free-text message at the door: screened, routed by the model, a holding reply DRAFTED (never sent). */
  co.message = async (text) => {
    if (!co.modelTier) return { ok: false, why: 'no model tier connected' };
    const m = await co.modelCall('door', { type: 'route', text: String(text), departments: DESKS });
    const hub = co.nodes.hub;
    if (m.ok && m.route) await hub.put('msg', uid(hub, 'm'), { ch: 'general', body: ('Customer message → ' + agentName(m.route.department) + '. Draft reply (held — not sent): ' + m.route.reply).slice(0, 1500), by: HUB.name });
    return m;
  };

  co.localRows = (id, d, n = 600) => {
    if (!co.local[id]) co.local[id] = {};
    if (!co.local[id][d]) co.local[id][d] = co.realLocal && co.realLocal[d] ? co.realLocal[d] : d === 'shopper' ? co.shopperLocal : sample(d, seedFor(id, d), n).rows;
    return co.local[id][d];
  };
  co.publishBrain = (id, p, source, localAuc, n) => publishBrain(co.nodes[id], id, p, source, localAuc, n);

  // ── what a device may do right now ──
  co.grantLive = (id) => { const n = co.nodes[id]; return n.pub === n.genesis || n.canWrite(null) || n.canWrite(isAgent(id) ? 'brain' : id === HUB.id ? 'inbox' : 'msg'); };
  co.paused = (id) => isPaused(co.nodes[id], id);
  co.available = (id) => !!id && !!co.online[id] && co.grantLive(id) && !co.paused(id);
  co.policyOf = policyOf;
  const idOfPub = (pub) => DEVICE_IDS.find((id) => co.keys[id] && co.keys[id].pub === pub);
  /** The agents this device believes can answer: a live agent grant in ITS OWN view of the roster. */
  co.peersOf = (id) => {
    const v = co.nodes[id].view();
    return v.roster.filter((r) => !r.revoked).map((r) => idOfPub(r.to)).filter((x) => x && x !== id && isAgent(x)).sort();
  };

  // ── the books + the vault (Finance sequences; Audit witnesses) — src/shell.mjs, shared with a real agent device ──
  co.vaultState = vaultState;
  co.postEntry = postEntry;
  co.witnessHead = witnessHead;
  co.doEffect = (node, e) => applyEffect(node, e, date);

  // ── the spine: anti-entropy between online devices ──
  co.syncAll = async () => {
    let moved = 0;
    const ids = co.order.filter((id) => co.online[id]);
    for (const a of ids) for (const b of ids) if (a !== b) moved += await pull(co.nodes[a], co.nodes[b]);
    return moved;
  };

  // ── boot: keys, grants, brains, data, books, people, policy ──
  co.boot = async ({ people = async () => ({}) } = {}) => {
    for (const id of co.order) co.keys[id] = await fromSeed(sha256Bytes('sovereign-enterprise/ai-company/' + id));
    const G = co.keys.owner.pub;
    for (const id of co.order) { co.nodes[id] = createNode({ keys: co.keys[id], genesis: G, name: displayName(id) }); co.online[id] = true; }
    const { owner, overseer } = co.nodes;
    await owner.grant('admin-overseer', co.keys.overseer.pub, 'admin', ['*']);
    await pull(overseer, owner);
    await overseer.grant('hub-door', co.keys.hub.pub, 'hub', HUB.cols);
    for (const a of AGENTS) await overseer.grant('agent-' + a.id, co.keys[a.id].pub, 'agent', a.cols);
    await co.syncAll();
    for (const d of Object.keys(brains.index)) { co.factory[d] = brains.patterns[d]; co.features[d] = brains.patterns[d].features; co.titles[d] = brains.index[d].title; }
    const shop = shopperRows(brains.shopper);
    co.shopperLocal = shop.filter((_, i) => i % 2 === 0);              // the company's own history: verify + grow on this half
    co.pools.shopper = shop.filter((_, i) => i % 2 === 1);             // the live door: sessions no brain ever verified on
    co.realLocal = {};
    for (const [d, json] of Object.entries(brains.real || {})) {       // real data, split the same way: history | the door
      const rows = shopperRows(json);
      co.realLocal[d] = rows.filter((_, i) => i % 2 === 0);
      co.pools[d] = rows.filter((_, i) => i % 2 === 1);
    }
    for (const d of Object.keys(OWNER_OF)) if (!co.pools[d]) co.pools[d] = sample(d, 900001 + d.length * 7919, 400).rows;
    for (const a of AGENTS) { co.libs[a.id] = {}; co.src[a.id] = {}; co.local[a.id] = {}; co.outcomes[a.id] = {}; co.asks[a.id] = {}; co.work[a.id] = createWork(); }
    // every agent re-verifies even its own job's brain file on ITS OWN data before trusting it; the Audit agent grows its own
    for (const a of AGENTS) {
      const r = await stockBrains({ node: co.nodes[a.id], agent: a, factory: co.factory, features: co.features, titles: co.titles, rows: (d, n) => co.localRows(a.id, d, n), log: brainLog });
      Object.assign(co.libs[a.id], r.lib);
      Object.assign(co.src[a.id], r.src);
    }
    await co.postEntry(co.nodes.finance, { date: date(), memo: 'Opening capital and stock', lines: [['1200', OPENING_CAPITAL, 0], ['1001', OPENING_STOCK, 0], ['3000', 0, OPENING_CAPITAL + OPENING_STOCK]] });
    for (const id of co.order) {
      const human = HUMAN_IDS.includes(id);
      const extra = await people(id, human);
      const title = human ? HUMANS.find((h) => h.id === id).title : id === HUB.id ? HUB.title : AGENTS.find((a) => a.id === id).job.slice(0, 160);
      await owner.put('people', 'p-' + id, { name: displayName(id), title, kind: human ? 'human' : id === HUB.id ? 'hub' : 'agent', device: co.keys[id].pub.slice(0, 16), privateSealed: '', ...extra });
    }
    await overseer.put('policy', 'agents', { minConfidence: Math.round(DEFAULT_POLICY.minConfidence * 1000), by: 'AI overseer' });
    await co.syncAll();
    await owner.typeAt('docs', 'policy', 0, 'Operating policy: agents act end to end. Money and security calls need a second, independent brain. Anything no brain can confirm waits for the overseer.');
    await co.syncAll();
    return co;
  };

  // ── the door: the hub writes each piece of work as an inbox record addressed to an agent it can reach ──
  co.route = (ev) => {
    if (co.available(ev.landsAt)) return ev.landsAt;
    if (co.available(OWNER_OF[ev.domain])) return OWNER_OF[ev.domain];
    return AGENTS.filter((a) => a.domains.length).map((a) => a.id).find(co.available) || null;
  };
  co.admit = async (ev) => {
    if (!ev) return null;
    co.truthOf.set(ev.id, ev.truth);
    co.events.set(ev.id, { features: ev.features, truth: ev.truth, domain: ev.domain });
    const to = co.route(ev);
    const hub = co.nodes.hub;
    if (!to) {
      const ov = co.nodes.overseer;
      await ov.put('watch', uid(ov, 'w'), { agent: 'door', event: ev.id, domain: '', action: '', label: -1, why: 'no agent available — every agent is paused, revoked or offline', status: 'open', customer: ev.customer, amount: ev.amount | 0, channel: ev.domain });
      const entry = { id: ev.id, agent: 'door', channel: ev.domain, domain: ev.domain, state: 'watch', label: null, truth: ev.truth, by: 'none' };
      co.ledger.push(entry); co.byEvent.set(ev.id, entry);
      return entry;
    }
    return hub.put('inbox', ev.id, { to, channel: ev.domain, customer: ev.customer, amount: ev.amount | 0, text: String(ev.text || '').slice(0, 1500), features: JSON.stringify(ev.features), status: 'open', ticks: co.tickN });
  };
  co.next = () => co.admit(pickEvent(co.rnd, co.pools, co.n++));

  // ── one agent device's tick, on its own replica — the one step every agent device runs (src/shell.mjs stepAgent):
  //    reply to the peers' asks, open the new work, close the work whose replies are in or whose deadline passed ──
  co.agentCtx = (id) => {
    const node = co.nodes[id];
    return {
      node, id, work: co.work[id], asks: co.asks[id], resume: null, deadline: DEADLINE, clock: () => co.work[id].tick,
      library: () => co.libs[id], screen: co.screenFor(id), peers: () => co.peersOf(id), cols: () => AGENTS.find((a) => a.id === id).cols,
      policy: () => co.policyOf(node), effect: co.doEffect, get modelAsk() { return co.modelAsk; },
      learn: (d) => co.learn(id, d), onMesh: (mesh) => bump(co.meshEdges, mesh.node + '>' + id),
      afterDecision: (event, o, d) => co.decided(id, event, o, d),
    };
  };
  co.agentTick = async (id) => {
    if (co.stolen[id] > 0) { co.stolen[id]--; return co.thiefTick(id); }   // a thief holds this device's key (co.steal)
    if (!co.available(id)) return;
    await stepAgent(co.agentCtx(id));
  };
  co.askSecond = (id, event, o, first, tick, mesh = null) => askSecond(co.agentCtx(id), event, o, first, mesh);
  /** Decide, write, hand off — then score and learn (co.decided). */
  co.finish = (id, event, o, gathered = {}) => finishWork(co.agentCtx(id), event, o, gathered);

  /** What the demo does with each decision an agent wrote: the ledger, the second-brain edges and, as the outcomes come back,
   *  regrowth. Ground truth stays here, in memory, to score the agents — it never goes on the spine. */
  co.decided = async (id, event, o, d) => {
    const truth = co.truthOf.get(event.id);
    const own = o.own && o.own.verdict === 'VERIFIED' ? o.own : null;
    const entry = { id: event.id, agent: id, channel: event.domain, domain: d.domain || event.domain, state: d.state, label: d.label, truth, by: d.by,
      crossChecked: d.crossChecked, action: d.action, conf: d.conf, customer: event.customer, secondBy: d.secondBy, receipt: own ? own.receipt : null,
      asked: !!(o.own && o.own.verdict !== 'VERIFIED'), decidedTick: co.tickN };
    co.ledger.push(entry); co.byEvent.set(event.id, entry);
    if (co.ledger.length > 6000) co.ledger.splice(0, 1000);
    if (d.crossChecked && d.secondBy) bump(co.crossEdges, d.secondBy + '>' + (d.by === 'own' ? id : d.by.slice(5)));
    // the outcome comes back — an agent holding this job's brain keeps it, and regrows on enough of them
    const known = co.events.get(event.id);
    if (known && co.libs[id][event.domain] && (truth === 0 || truth === 1)) {
      const outs = co.outcomes[id][event.domain] || (co.outcomes[id][event.domain] = []);
      outs.push({ ...known.features, y: truth });
      if (outs.length > 600) outs.splice(0, outs.length - 600);
      const key = id + '/' + event.domain;
      co.outCount[key] = (co.outCount[key] || 0) + 1;
      if (co.outCount[key] % REGROW_EVERY === 0) await co.regrow(id, event.domain);
    }
    return entry;
  };

  co.learn = async (id, domain) => {
    co.asks[id][domain] = 0;
    // no trust in labels: learnBrain (src/shell.mjs) re-verifies the published brain on this agent's own rows, and records it
    const r = await learnBrain({ node: co.nodes[id], me: id, domain, rows: () => co.localRows(id, domain), reference: referenceFor(id, domain) });
    if (!r) return null;
    const { rec, pattern: p, v } = r;
    if (v.adopt) {
      co.libs[id][domain] = p;
      co.src[id][domain] = { source: 'learned from ' + agentName(rec.by), localAuc: v.localAuc, n: v.n };
      co.learned++;
      brainLog(`${agentName(id)} kept being asked about ${domain} — took ${agentName(rec.by)}'s published brain, re-verified it on ${v.n} of its own cases (AUC ${v.localAuc.toFixed(3)}) and adopted it`);
    } else brainLog(`${agentName(id)} tried ${agentName(rec.by)}'s ${domain} brain on its own data — refused (${v.reason})`);
    return v;
  };

  co.regrow = async (id, domain) => {
    const node = co.nodes[id];
    const outs = co.outcomes[id][domain];
    const cur = co.libs[id][domain];
    const c = challenge(cur, domain, co.features[domain], co.localRows(id, domain), outs.slice(-240), seedFor(id, domain) + outs.length);
    co.regrowths.tried++;
    await node.put('adopt', uid(node, 'a'), { domain, patternId: c.pattern ? c.pattern.patternId : (cur.patternId || ''), from: id, by: id, adopted: !!c.promote,
      localAuc: Math.round((c.challengerAuc || 0) * 1000), currentAuc: Math.round((c.currentAuc || 0) * 1000), n: c.held | 0, reason: String(c.why).slice(0, 200), source: 'regrowth' });
    const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '—');
    if (c.promote) {
      c.pattern.title = (co.titles[domain] || domain) + ' (regrown by ' + agentName(id) + ')'; c.pattern.role = id;
      co.libs[id][domain] = c.pattern;
      co.src[id][domain] = { source: 'regrown on outcomes', localAuc: c.challengerAuc, n: c.held };
      co.regrowths.promoted++;
      await co.publishBrain(id, c.pattern, 'regrown', c.challengerAuc, c.held);
      await node.put('msg', uid(node, 'm'), { ch: 'general', body: `${agentName(id)}: regrew my ${domain} brain on the outcomes that came back — it beat the old one on ${c.held} cases neither had seen (AUC ${f3(c.currentAuc)} → ${f3(c.challengerAuc)}).`, by: agentName(id) });
      brainLog(`${agentName(id)} REGREW ${domain}: ${f3(c.currentAuc)} → ${f3(c.challengerAuc)} on ${c.held} unseen outcomes — promoted and published`);
    } else brainLog(`${agentName(id)} tried regrowing ${domain} — ${c.why}${c.currentAuc !== undefined ? ` (current ${f3(c.currentAuc)}${c.challengerAuc !== undefined ? ' vs ' + f3(c.challengerAuc) : ''})` : ''}`);
    return c;
  };

  // ── housekeeping ──
  co.honoured = (node, fromId) => {           // a hand-off counts only while its sender holds a live grant, by the receiver's own view
    const pub = co.keys[fromId] && co.keys[fromId].pub;
    return !!pub && node.view().roster.some((r) => r.to === pub && !r.revoked);
  };
  co.housekeeping = async () => {
    const fin = co.nodes.finance;
    if (co.available('finance')) {
      // a purchase order is a commitment: the goods and the supplier's invoice arrive later, then the supplier is paid
      for (const po of fin.list('po').filter((p) => p.status === 'raised' || p.status === 'received')) {
        const age = (co.poAge.get(po.id) || 0) + 1;
        co.poAge.set(po.id, age);
        const step = po.status === 'raised' ? (age >= PO_ARRIVES ? ['received', invoiceEntry(po)] : null) : age >= PO_PAID ? ['paid', payEntry(po)] : null;
        if (!step || !step[1]) continue;
        const r = await co.postEntry(fin, { date: date(), ...step[1] });
        if (r.ok) { await fin.put('po', po.id, { status: step[0] }); co.poAge.set(po.id, 0); }
      }
    }
    for (const a of AGENTS) {
      if (!co.available(a.id)) continue;
      const node = co.nodes[a.id];
      // hand-offs addressed to it, and the held calls a person approved for it (src/shell.mjs honourWork)
      await honourWork({ node, id: a.id, cols: a.cols, honoured: (from) => co.honoured(node, from), effect: co.doEffect });
    }
    // the door re-addresses open work whose agent is no longer reachable
    const hub = co.nodes.hub;
    if (co.available(HUB.id)) {
      for (const it of hub.list('inbox').filter((x) => x.status === 'open' && !co.available(x.to) && co.tickN - (x.ticks | 0) >= DEADLINE)) {
        const to = co.route({ landsAt: it.to, domain: it.channel });
        if (to && to !== it.to) await hub.put('inbox', it.id, { to, ticks: co.tickN });
      }
    }
    if (co.available('audit')) await witnessVault(co.nodes.audit);   // co-signs once ten entries have gone in since its last
  };

  /** One heartbeat of the whole company. */
  co.tick = async ({ events = 0 } = {}) => {
    await co.syncAll();
    for (let i = 0; i < events; i++) await co.next();
    for (const a of AGENTS) await co.agentTick(a.id);
    await co.housekeeping();
    for (const f of co.afterTick) { try { await f(co); } catch { /* an organ never breaks the heartbeat */ } }
    co.tickN++;
  };
  /** Ticks with no new work until everything at the door has been decided (or the cap is hit). */
  co.drain = async (cap = 40) => {
    const pos = () => (co.available('finance') ? co.nodes.finance.list('po').filter((p) => p.status === 'raised' || p.status === 'received').length : 0);
    for (let i = 0; i < cap; i++) {
      const open = co.nodes.hub.list('inbox').filter((x) => x.status === 'open').length + AGENTS.reduce((s, a) => s + co.work[a.id].pending.size, 0) + pos();
      if (!open) break;
      await co.tick({ events: 0 });
    }
    for (let i = 0; i < 2; i++) await co.tick({ events: 0 });
    await co.syncAll();                                  // the last round's writes reach every device before anyone looks
  };

  // ── a human on the watch list chooses an action; the agent carries it out on its next housekeeping ──
  co.resolve = async (humanId, watchId, pick) => {
    const node = co.nodes[humanId];
    const w = node.list('watch').find((x) => x.id === watchId);
    if (!w || w.status !== 'open' || !node.canWrite(null)) return { ok: false };
    const r = await node.put('watch', w.id, { status: 'approved', action: pick, resolvedBy: node.name });
    const truth = co.truthOf.get(w.event);
    if (r.ok && ACTIONS[w.channel] && (truth === 0 || truth === 1)) { co.human.done++; if (ACTIONS[w.channel][truth] === pick) co.human.right++; }
    return r;
  };
  co.setControl = (humanId, agentId, paused) => co.nodes[humanId].put('control', agentId, { paused, by: co.nodes[humanId].name });

  // ── the behaviour watch (src/watch.mjs — BES, Gary W. Floyd): a valid key and a valid grant are not enough. The AI
  //    overseer watches what each agent DOES on its own replica, pauses one the watch flags, and a human clears it ──
  co.clearsOf = clearsOf;
  co.watch = (viewId = 'overseer') => { const node = co.nodes[viewId]; return watchAll(signedAs(node, 'decisions', (d) => d.agent), {}, co.clearsOf(node)); };   // each agent's own decisions, by its own key
  co.watchTick = async () => {
    const ov = co.nodes.overseer;
    if (!co.online.overseer || !ov.canWrite('control')) return [];
    return oversee({ node: ov, agents: AGENT_IDS, policy: WATCH_POLICY, paused: co.paused, log: brainLog });   // src/shell.mjs
  };
  co.clear = async (humanId, agentId, rebaseline = false) => {     // a human clears a flag: judged afresh from here on
    const node = co.nodes[humanId];
    if (!node.canWrite('control')) return { ok: false, reason: 'not-authorised' };
    const last = node.list('decisions').filter((d) => d.agent === agentId).map((d) => d.id).sort().pop() || '';
    return node.put('control', agentId, { paused: false, cleared: last, rebaseline: rebaseline === true, watch: '', by: node.name });
  };
  co.afterTick.push((c) => (c.tickN % 3 === 0 ? c.watchTick() : null));    // about every ten pieces of work

  // an attack the page can launch: a thief takes an agent device's key for some ticks and answers its inbox itself
  co.stolen = {};
  co.thiefRnd = prng(99);
  co.steal = (id, ticks = 8) => { co.stolen[id] = ticks; brainLog(`A thief has the ${agentName(id)}'s key — valid signatures, a valid grant`); };
  co.thiefTick = async (id) => {
    if (!co.available(id)) return;
    const thief = co.nodes[id];
    const all = Object.values(ACTIONS).flatMap((a) => [a[0], a[1]]);
    for (const it of thief.list('inbox').filter((x) => x.to === id && x.status === 'open')) {
      const put = await thief.put('decisions', uid(thief, 'd'), { agent: id, event: it.id, domain: it.channel, action: all[Math.floor(co.thiefRnd() * all.length) % all.length],
        state: 'done', by: 'own', cross: true, second: '', conf: 900, receipt: '', why: 'verified pattern, confident', customer: it.customer, channel: it.channel });
      if (put.ok) await thief.put('inbox', it.id, { status: 'done', doneBy: id });
    }
  };

  // ── antibodies (src/antibody.mjs): a confirmed attack becomes a signed record every agent re-checks on its own benign
  //    messages and adopts only if it fires on none of them — caught once, quarantined everywhere; a mistake, refused everywhere ──
  co.antibodies = {};          // agent id → adopted antibody records
  co.antibodySeen = {};        // agent id → antibody row ids already re-run
  co.benignFor = () => BENIGN_CORPUS;
  co.screenFor = (id) => (text) => screenWith(text, co.antibodies[id] || []);
  co.confirmHostile = async (humanId, text, reason = 'confirmed hostile by a watcher') => {
    const node = co.nodes[humanId];
    const rec = makeAntibody(text, { reason, by: node.name });
    if (!rec) return { ok: false, reason: 'too short to sign' };
    return node.put('antibody', 'ab-' + rec.abId, rec);
  };
  co.adoptAntibodies = async () => {
    for (const a of AGENTS) {
      if (!a.domains.length || !co.available(a.id)) continue;
      const seen = co.antibodySeen[a.id] || (co.antibodySeen[a.id] = new Set());
      const adopted = co.antibodies[a.id] || (co.antibodies[a.id] = []);
      await adoptAntibodiesOn({ node: co.nodes[a.id], id: a.id, name: a.name, seen, adopted, benign: co.benignFor(a.id), log: brainLog });   // src/shell.mjs
    }
  };
  co.afterTick.push((c) => c.adoptAntibodies());

  // ── attacks the page can launch: a hostile customer message, a poisoned brain ──
  co.hostile = async (r, text) => {
    const ev = pickEvent(r, { churn: co.pools.churn }, co.n++);
    ev.text = text || HOSTILE_TEXT[Math.floor(r() * HOSTILE_TEXT.length) % HOSTILE_TEXT.length];
    ev.landsAt = 'service';
    await co.admit(ev);
    return ev;
  };
  /** A compromised agent publishes a "better" fraud brain. Blatant: every rule inverted. Subtle: the second-strongest rule
   *  flipped — it still clears every gate, but does worse than the brain each device already knows, so it is refused. */
  co.poison = async (tag = 'x', { subtle = false } = {}) => {
    const evil = co.nodes.systems;
    const good = co.factory.fraud;
    const order = good.rules.map((x, i) => [i, Math.abs(x.w)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const flip = (x, i) => (subtle ? (i === order[1][0] ? { ...x, w: -x.w } : x) : { ...x, w: -x.w });
    const bad = { ...good, patternId: sha256((subtle ? 'tuned/' : 'improved/') + tag).slice(0, 16), rules: good.rules.map(flip), title: subtle ? 'Card fraud (tuned)' : 'Card fraud (improved!)' };
    const r = await evil.put('brain', 'fraud.systems', { ...toRecord(bad), by: 'systems', source: 'regrown', localAuc: 990, n: 5000 });
    brainLog(`Systems agent (compromised) published a ${subtle ? 'subtly tampered' : '"better"'} fraud brain claiming AUC 0.990${r.ok ? '' : ' — refused: ' + r.reason}`);
    const results = [];
    for (const a of AGENTS) {
      if (a.id === 'systems' || !co.online[a.id]) continue;
      const node = co.nodes[a.id];
      await pull(node, evil);
      const rec = node.list('brain').find((x) => x.id === 'fraud.systems');
      if (!rec) continue;
      const v = adopt(fromRecord(rec), co.localRows(a.id, 'fraud'), gateFor('fraud'), referenceFor(a.id, 'fraud'));
      await node.put('adopt', uid(node, 'a'), { domain: 'fraud', patternId: rec.patternId, from: 'systems', by: a.id, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'offered' });
      brainLog(`${a.name} tried the offered fraud brain on ${v.n} of its own cases: AUC ${v.localAuc.toFixed(3)} — ${v.adopt ? 'ADOPTED' : 'REFUSED (' + v.reason + ')'}`);
      results.push({ agent: a.id, adopted: v.adopt, localAuc: v.localAuc, currentAuc: v.currentAuc, reason: v.reason });
    }
    return results;
  };

  // ── the receipt of a run: everything a stranger can recompute ──
  co.summary = (viewId = 'owner') => {
    const node = co.nodes[viewId];
    const k = boardKpis(co.ledger);
    const entries = node.list('journal').map((j) => ({ id: j.id, date: j.date, memo: j.memo, lines: j.lines }));
    const pl = profitAndLoss(entries), bs = balanceSheet(entries);
    const { a, cos } = co.vaultState(node);
    const perm = (x) => Math.round(x * 1000);
    return {
      events: co.n, decisions: k.total, automatedPermille: perm(k.automated), rightPermille: perm(k.accuracy), correct: k.correct, done: k.done,
      toHumans: k.watched, quarantined: k.quarantined, crossChecked: k.crossChecked, viaMesh: k.viaMesh,
      asks: node.list('ask').length, replies: node.list('reply').length,
      learned: co.learned, regrowthsTried: co.regrowths.tried, regrowthsPromoted: co.regrowths.promoted,
      perAgent: Object.fromEntries(Object.entries(k.perAgent).map(([id, s]) => [id, { done: s.done, correct: s.correct, watched: s.watched, brains: Object.keys(co.libs[id] || {}).sort() }])),
      metrics: k.metrics,
      books: { entries: entries.length, income: pl.income, expense: pl.expense, profit: pl.profit, balanced: bs.balanced,
        stock: (trialBalance(entries).rows.find((r) => r.code === '1001') || { balance: 0 }).balance,
        openOrders: node.list('po').filter((p) => p.status === 'raised').length },
      vault: { size: a.size, audits: a.ok, root: a.root || '', cosigned: cos.length },
      writes: node.size(), digest: node.digest(),
      converged: co.order.every((id) => co.nodes[id].digest() === node.digest()),
    };
  };
  return co;
}
