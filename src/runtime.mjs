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

const pad = (n, w = 6) => String(n).padStart(w, '0');
const uid = (node, p) => p + pad(node.clock() + 1, 8) + '-' + node.pub.slice(0, 6);
export const seedFor = (who, d) => (parseInt(sha256(who + '/' + d).slice(0, 8), 16) >>> 0) || 1;
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
  // money and security jobs need more than the plain gate before a brain is trusted with them
  const gateFor = (d) => (ACTIONS[d] && ACTIONS[d].stakes === 'high' ? HIGH_STAKES_GATE : GATE_AUC);
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
  co.publishBrain = (id, p, source, localAuc, n) =>
    co.nodes[id].put('brain', p.domain + '.' + id, { ...toRecord(p), by: id, source, localAuc: Math.round(localAuc * 1000), n: n | 0 });

  // ── what a device may do right now ──
  co.grantLive = (id) => { const n = co.nodes[id]; return n.pub === n.genesis || n.canWrite(null) || n.canWrite(isAgent(id) ? 'brain' : id === HUB.id ? 'inbox' : 'msg'); };
  co.paused = (id) => { const c = co.nodes[id].list('control').find((r) => r.id === id); return !!(c && c.paused); };
  co.available = (id) => !!id && !!co.online[id] && co.grantLive(id) && !co.paused(id);
  co.policyOf = (node) => {
    const p = node.list('policy').find((r) => r.id === 'agents');
    return p && Number.isSafeInteger(p.minConfidence) ? { minConfidence: p.minConfidence / 1000 } : DEFAULT_POLICY;
  };
  const idOfPub = (pub) => DEVICE_IDS.find((id) => co.keys[id] && co.keys[id].pub === pub);
  /** The agents this device believes can answer: a live agent grant in ITS OWN view of the roster. */
  co.peersOf = (id) => {
    const v = co.nodes[id].view();
    return v.roster.filter((r) => !r.revoked).map((r) => idOfPub(r.to)).filter((x) => x && x !== id && isAgent(x)).sort();
  };

  // ── the books + the vault (Finance sequences; Audit witnesses) ──
  co.vaultState = (node) => {
    const recs = node.list('vault').map((r) => ({ index: r.index, leaf: r.leaf, entry: r.entry }));
    const heads = node.list('vault_head').map((h) => ({ size: h.size, root: h.root }));
    const cos = node.list('vault_cosig').map((h) => ({ size: h.size, root: h.root, by: h.by }));
    return { recs, heads, cos, a: audit(recs, heads) };
  };
  co.postEntry = async (node, entry) => {
    const v = validEntry(entry);
    if (!v.ok) return v;
    if (!node.canWrite('journal') || !node.canWrite('vault') || !node.canWrite('vault_head')) return { ok: false, reason: 'not-authorised' };
    const id = uid(node, 'j');
    const body = { date: entry.date, memo: String(entry.memo).slice(0, 200), lines: encodeLines(v.lines) };
    const r = await node.put('journal', id, body);
    if (!r.ok) return r;
    const { a } = co.vaultState(node);
    const leaf = leafHash(canonical({ id, ...body }));
    const leaves = [...a.leaves, leaf];
    await node.put('vault', 'v' + pad(a.size), { index: a.size, leaf, entry: id });
    await node.put('vault_head', 'h' + pad(leaves.length), { size: leaves.length, root: root(leaves) });
    return { ok: true };
  };
  co.witnessHead = async (node) => {
    const { a, heads } = co.vaultState(node);
    const top = heads.sort((x, y) => y.size - x.size)[0];
    if (!top || !a.ok) return { ok: false, reason: 'log does not audit' };
    return node.put('vault_cosig', 'c' + pad(top.size) + '-' + node.pub.slice(0, 6), { size: top.size, root: top.root, by: node.name });
  };
  co.doEffect = (node, e) => {
    if (e && e.post) return co.postEntry(node, { date: date(), ...e.post });
    if (e && e.c && e.f) return node.put(e.c, uid(node, e.c.slice(0, 2)), e.f);
    return Promise.resolve({ ok: false });
  };

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
    for (const a of AGENTS) { co.libs[a.id] = {}; co.src[a.id] = {}; co.local[a.id] = {}; co.outcomes[a.id] = {}; co.asks[a.id] = {}; co.work[a.id] = { pending: new Map(), replied: new Set(), done: new Set(), tick: 0 }; }
    for (const a of AGENTS) {
      const node = co.nodes[a.id];
      for (const d of a.domains) {          // every agent re-verifies even its own job's brain file on ITS OWN data before trusting it
        const p = co.factory[d];
        const v = adopt(p, co.localRows(a.id, d), gateFor(d));
        await node.put('adopt', uid(node, 'a'), { domain: d, patternId: p.patternId, from: 'factory', by: a.id, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'factory' });
        if (!v.adopt) { brainLog(`${a.name} REFUSED its own ${d} brain file — it did not re-verify here (${v.reason})`); continue; }
        co.libs[a.id][d] = p;
        co.src[a.id][d] = { source: 'factory file', localAuc: v.localAuc, n: v.n };
        await co.publishBrain(a.id, p, 'factory', v.localAuc, v.n);
      }
      for (const d of a.grows || []) {      // the Audit agent GROWS its own independent brains for every high-stakes call
        const g = growPattern(d, co.localRows(a.id, d, 700), co.features[d], { seed: seedFor(a.id, d), grownBy: a.id });
        if (!g.verified) { brainLog(`${a.name} grew a ${d} brain but it failed its held-out gate — CUT`); continue; }
        g.pattern.title = co.titles[d] + ' (grown by Audit)'; g.pattern.role = 'audit';
        co.libs[a.id][d] = g.pattern;
        co.src[a.id][d] = { source: 'grown here', localAuc: g.pattern.heldAuc, n: g.pattern.held };
        await co.publishBrain(a.id, g.pattern, 'grown', g.pattern.heldAuc, g.pattern.held);
        brainLog(`${a.name} grew its own ${d} brain on ${g.pattern.train + g.pattern.held} of its own cases — held-out AUC ${g.pattern.heldAuc.toFixed(3)}`);
      }
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

  // ── one agent device's tick, on its own replica ──
  co.agentTick = async (id) => {
    if (co.stolen[id] > 0) { co.stolen[id]--; return co.thiefTick(id); }   // a thief holds this device's key (co.steal)
    const w = co.work[id];
    if (!co.available(id)) return;
    const node = co.nodes[id];
    const policy = co.policyOf(node);
    const replies = node.list('reply');
    // 1. answer the peers: every ask on the spine this device has not answered, from its OWN library
    for (const a of node.list('ask')) {
      if (w.replied.has(a.id) || a.from === id) continue;
      w.replied.add(a.id);
      const r = replyFor(a, co.libs[id], id);
      if (r) await node.put('reply', uid(node, 'r'), r);
    }
    const inbox = node.list('inbox');
    // 2. open the new work addressed to this device
    for (const it of inbox) {
      if (it.to !== id || it.status !== 'open' || w.pending.has(it.id) || w.done.has(it.id)) continue;
      let features = {};
      try { features = JSON.parse(it.features); } catch { features = {}; }
      const event = { id: it.id, domain: it.channel, features, customer: it.customer, amount: it.amount | 0, text: it.text || '' };
      const o = openStep({ agentId: id, event, library: co.libs[id], policy, screenFn: co.screenFor(id) });
      if (o.next === 'final') { await co.finish(id, event, o, {}); continue; }
      if (o.next === 'mesh') {
        const rec = askRecord({ kind: 'answer', item: it.id, from: id, features });
        const askId = uid(node, 'q');
        if (rec) await node.put('ask', askId, rec);
        w.pending.set(it.id, { stage: 'mesh', askId, since: w.tick, o, event, exclude: [id] });
        continue;
      }
      await co.askSecond(id, event, o, o.first, w.tick);
    }
    // 3. close the work whose replies are in (or whose deadline passed)
    const addressed = new Map(inbox.map((x) => [x.id, x]));
    for (const [itemId, p] of [...w.pending]) {
      const it = addressed.get(itemId);
      if (it && (it.to !== id || it.status !== 'open')) { w.pending.delete(itemId); continue; }   // the door re-addressed it, or it is already closed (a thief on this key closed it)
      const mine = repliesTo(replies, p.askId);
      const expected = co.peersOf(id).filter((x) => !p.exclude.includes(x));
      if (!heardFrom(mine, expected) && w.tick - p.since < DEADLINE) continue;
      if (p.stage === 'mesh') {
        const mesh = pickAnswer(mine);
        if (mesh) {
          bump(co.meshEdges, mesh.node + '>' + id);
          co.asks[id][mesh.answer.domain] = (co.asks[id][mesh.answer.domain] || 0) + 1;
          if (shouldLearn(co.asks[id], mesh.answer.domain, co.libs[id])) await co.learn(id, mesh.answer.domain);
        }
        if (afterMesh(mesh, policy) === 'second') { w.pending.delete(itemId); await co.askSecond(id, p.event, p.o, mesh, w.tick, mesh); continue; }
        w.pending.delete(itemId);
        await co.finish(id, p.event, p.o, { mesh });
        continue;
      }
      const s = pickSecond(mine, p.first.answer.domain, p.first.answer.receipt.patternId, p.exclude);
      w.pending.delete(itemId);
      await co.finish(id, p.event, p.o, { mesh: p.mesh || null, second: s ? s.answer : null, secondBy: s ? s.node : '' });
    }
    w.tick++;
  };

  co.askSecond = async (id, event, o, first, tick, mesh = null) => {
    const node = co.nodes[id];
    const exclude = [...new Set([id, first.node])];
    const rec = askRecord({ kind: 'second', item: event.id, from: id, features: event.features, domain: first.answer.domain, pattern: first.answer.receipt.patternId, exclude });
    const askId = uid(node, 'q');
    if (rec) await node.put('ask', askId, rec);
    co.work[id].pending.set(event.id, { stage: 'second', askId, since: tick, o, event, first, mesh, exclude });
  };

  /** Decide, write, hand off, score, learn. */
  co.finish = async (id, event, o, { mesh = null, second = null, secondBy = '' }) => {
    const node = co.nodes[id];
    const w = co.work[id];
    const policy = co.policyOf(node);
    let model = null;
    const quarantined = o.scr && !o.scr.ok;
    if (!quarantined && !(o.own && o.own.verdict === 'VERIFIED') && !mesh && co.modelAsk) {
      try { model = await co.modelAsk(id, event); } catch { model = null; }
    }
    const { decision: d, effects: fx } = closeStep({ agentId: id, event, scr: o.scr, own: o.own, mesh, second, secondBy, model, fault: o.fault, policy });
    await node.put('decisions', uid(node, 'd'), { agent: id, event: event.id, domain: d.domain || '', action: d.action || '', state: d.state, by: d.by,
      cross: !!d.crossChecked, second: d.secondBy || '', conf: d.conf | 0, receipt: d.receipt || '', why: String(d.why || '').slice(0, 300), customer: event.customer, channel: event.domain });
    const agent = AGENTS.find((a) => a.id === id);
    const { mine, handoff } = splitEffects(fx, agent.cols, OWNER_OF[d.domain || event.domain]);
    for (const e of mine) await co.doEffect(node, e);
    for (const h of handoff) {
      const payload = JSON.stringify(h.payload);
      if (payload.length <= 1900) await node.put('handoff', uid(node, 'h'), { from: id, to: h.to, payload, status: 'open', event: event.id });
    }
    await node.put('inbox', event.id, { status: 'done', doneBy: id });
    w.done.add(event.id);
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
    const node = co.nodes[id];
    const recs = node.list('brain').filter((r) => r.domain === domain && r.by !== id);   // no trust in labels: adopt() re-verifies
    const rec = recs.find((r) => r.by === OWNER_OF[domain]) || recs[0];
    co.asks[id][domain] = 0;
    if (!rec) return null;
    const p = fromRecord(rec);
    const v = adopt(p, co.localRows(id, domain), gateFor(domain), referenceFor(id, domain));
    await node.put('adopt', uid(node, 'a'), { domain, patternId: rec.patternId || '', from: rec.by || '', by: id, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'learned' });
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
      for (const h of node.list('handoff').filter((x) => x.to === a.id && x.status === 'open')) {
        let payload = null;
        try { payload = JSON.parse(h.payload); } catch { payload = null; }
        const ok = payload && co.honoured(node, h.from) ? (await co.doEffect(node, payload)).ok : false;
        await node.put('handoff', h.id, { status: ok ? 'done' : 'refused', doneBy: a.id });
      }
      for (const w of node.list('watch').filter((x) => (x.agent === a.id || (x.agent === 'door' && OWNER_OF[x.channel] === a.id)) && x.status === 'approved' && x.action)) {
        const label = ACTIONS[w.channel] && ACTIONS[w.channel][1] === w.action ? 1 : 0;
        const d = { state: 'done', action: w.action, label, domain: w.channel, crossChecked: false };
        const { mine, handoff } = splitEffects(effects(d, { id: w.event, customer: w.customer, amount: w.amount | 0, domain: w.channel }, a.id), a.cols, OWNER_OF[w.channel]);
        for (const e of mine) await co.doEffect(node, e);
        for (const h of handoff) await node.put('handoff', uid(node, 'h'), { from: a.id, to: h.to, payload: JSON.stringify(h.payload), status: 'open', event: w.event });
        await node.put('watch', w.id, { status: 'executed', executedBy: a.id });
      }
    }
    // the door re-addresses open work whose agent is no longer reachable
    const hub = co.nodes.hub;
    if (co.available(HUB.id)) {
      for (const it of hub.list('inbox').filter((x) => x.status === 'open' && !co.available(x.to) && co.tickN - (x.ticks | 0) >= DEADLINE)) {
        const to = co.route({ landsAt: it.to, domain: it.channel });
        if (to && to !== it.to) await hub.put('inbox', it.id, { to, ticks: co.tickN });
      }
    }
    if (co.available('audit')) {
      const au = co.nodes.audit;
      const { a, cos } = co.vaultState(au);
      const last = cos.reduce((m, c) => Math.max(m, c.size), 0);
      if (a.ok && a.size >= last + 10) await co.witnessHead(au);
    }
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
  co.clearsOf = (node) => Object.fromEntries(node.list('control').filter((c) => typeof c.cleared === 'string' && c.cleared)
    .map((c) => [c.id, { at: c.cleared, rebaseline: c.rebaseline === true }]));
  co.watch = (viewId = 'overseer') => { const node = co.nodes[viewId]; return watchAll(node.list('decisions'), {}, co.clearsOf(node)); };
  co.watchTick = async () => {
    const ov = co.nodes.overseer;
    if (!co.online.overseer || !ov.canWrite('control')) return [];
    const seen = co.watch('overseer'), paused = [];
    for (const id of AGENT_IDS) {
      const r = seen[id];
      if (!r || !shouldPause(r, WATCH_POLICY) || co.paused(id)) continue;
      await ov.put('control', id, { paused: true, by: 'AI overseer', watch: r.verdict, why: String(r.reason).slice(0, 300), flaggedAt: r.flaggedAt });
      brainLog(`AI overseer paused the ${agentName(id)} — the watch read it as ${r.verdict}: ${r.reason}`);
      paused.push(id);
    }
    return paused;
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
      const node = co.nodes[a.id];
      const seen = co.antibodySeen[a.id] || (co.antibodySeen[a.id] = new Set());
      for (const r of node.list('antibody')) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const v = adoptAntibody(r, co.benignFor(a.id));
        await node.put('adopt', uid(node, 'a'), { domain: 'antibody', patternId: String(r.abId || '').slice(0, 64), from: String(r.by || '').slice(0, 64), by: a.id, adopted: v.adopt, localAuc: 0, n: v.n, reason: v.reason.slice(0, 200), source: 'antibody' });
        if (v.adopt) (co.antibodies[a.id] || (co.antibodies[a.id] = [])).push(r);
        brainLog(a.name + ' re-ran antibody ' + String(r.abId || '?').slice(0, 8) + ' on its own ' + v.n + ' known-benign messages — ' + (v.adopt ? 'ADOPTED' : 'REFUSED') + ' (' + v.reason + ')');
      }
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
