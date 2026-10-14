// runtime.mjs — the AI company, running. The one loop the live page and the headless re-run both use.
//
// Eight devices (two humans, six agents) on the spine. Each tick: the spine syncs between online devices, work
// arrives at the door, the agent it lands on decides (company.agentStep), writes the decision and its effects as signed
// records, hands off what its grant does not cover, learns what it keeps being asked about, and regrows on the
// outcomes that come back. Housekeeping posts purchase orders, honours hand-offs, carries out what the humans chose
// on the watch list, and has the Audit agent co-sign the vault. Deterministic for a given seed and date: the same
// inputs give the same company, byte for byte — which is what lets CI re-run it and check a receipt.
import { createNode, pull } from './node.mjs';
import { fromSeed } from './keys.mjs';
import { sha256Bytes, sha256 } from './sha256.mjs';
import { canonical } from './canon.mjs';
import { leafHash, root, audit } from './vault.mjs';
import { encodeLines, validEntry, profitAndLoss, balanceSheet } from './books.mjs';
import { prng } from './sim.mjs';
import { adopt, toRecord, fromRecord, answer } from './brain.mjs';
import { growPattern } from './grow.mjs';
import { sample, shopperRows } from './streams.mjs';
import { AGENTS, HUMANS, OWNER_OF, HOSTILE_TEXT, agentName, pickEvent, agentStep, effects, splitEffects, poEntry, shouldLearn, challenge, boardKpis, REGROW_EVERY } from './company.mjs';
import { ACTIONS, DEFAULT_POLICY } from './agent.mjs';

const pad = (n, w = 6) => String(n).padStart(w, '0');
const uid = (node, p) => p + pad(node.clock() + 1, 8) + '-' + node.pub.slice(0, 6);
export const seedFor = (who, d) => (parseInt(sha256(who + '/' + d).slice(0, 8), 16) >>> 0) || 1;
export const HUMAN_IDS = HUMANS.map((h) => h.id);
export const AGENT_IDS = AGENTS.map((a) => a.id);
export const WORKERS = AGENTS.filter((a) => a.domains.length).map((a) => a.id);
export const displayName = (id) => (HUMANS.find((h) => h.id === id) || AGENTS.find((a) => a.id === id) || { name: String(id) }).name;
export const isAgent = (id) => AGENT_IDS.includes(id);

/**
 * brains = { index: {domain: {file, title, …}}, patterns: {domain: pattern}, shopper: {features, data} }
 * opts.seed — the door's dice · opts.date() — the posting date (fixed in a re-run) · opts.log(s) — the growth log
 */
export function createCompany(brains, { seed = 20261014, date = () => new Date().toISOString().slice(0, 10), log = () => {} } = {}) {
  const co = {
    nodes: {}, keys: {}, order: [...HUMAN_IDS, ...AGENT_IDS], online: {},
    factory: {}, features: {}, titles: {}, libs: {}, src: {}, local: {}, outcomes: {}, asks: {},
    pools: {}, shopperLocal: [], ledger: [], byEvent: new Map(), truthOf: new Map(), rnd: prng(seed), n: 0,
    human: { done: 0, right: 0 }, meshEdges: new Map(), crossEdges: new Map(), regrowths: { tried: 0, promoted: 0 }, learned: 0, outCount: {},
  };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const brainLog = (s) => log(s);

  co.localRows = (id, d, n = 600) => {
    if (!co.local[id]) co.local[id] = {};
    if (!co.local[id][d]) co.local[id][d] = d === 'shopper' ? co.shopperLocal : sample(d, seedFor(id, d), n).rows;
    return co.local[id][d];
  };
  co.publishBrain = (id, p, source, localAuc, n) =>
    co.nodes[id].put('brain', p.domain + '.' + id, { ...toRecord(p), by: id, source, localAuc: Math.round(localAuc * 1000), n: n | 0 });

  // ── what a device may do right now ──
  co.grantLive = (id) => { const n = co.nodes[id]; return n.pub === n.genesis || n.canWrite(null) || n.canWrite(isAgent(id) ? 'brain' : 'msg'); };
  co.paused = (id) => { const c = co.nodes[id].list('control').find((r) => r.id === id); return !!(c && c.paused); };
  co.available = (id) => !!id && !!co.online[id] && co.grantLive(id) && !co.paused(id);
  co.policyOf = (node) => {
    const p = node.list('policy').find((r) => r.id === 'agents');
    return p && Number.isSafeInteger(p.minConfidence) ? { minConfidence: p.minConfidence / 1000 } : DEFAULT_POLICY;
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
    for (const a of AGENTS) await overseer.grant('agent-' + a.id, co.keys[a.id].pub, 'agent', a.cols);
    await co.syncAll();
    for (const d of Object.keys(brains.index)) { co.factory[d] = brains.patterns[d]; co.features[d] = brains.patterns[d].features; co.titles[d] = brains.index[d].title; }
    const shop = shopperRows(brains.shopper);
    co.shopperLocal = shop.filter((_, i) => i % 2 === 0);              // the company's own history: verify + grow on this half
    co.pools.shopper = shop.filter((_, i) => i % 2 === 1);             // the live door: sessions no brain ever verified on
    for (const d of Object.keys(OWNER_OF)) if (d !== 'shopper') co.pools[d] = sample(d, 900001 + d.length * 7919, 400).rows;
    for (const a of AGENTS) { co.libs[a.id] = {}; co.src[a.id] = {}; co.local[a.id] = {}; co.outcomes[a.id] = {}; co.asks[a.id] = {}; }
    for (const a of AGENTS) {
      const node = co.nodes[a.id];
      for (const d of a.domains) {          // every agent re-verifies even its own job's brain file on ITS OWN data before trusting it
        const p = co.factory[d];
        const v = adopt(p, co.localRows(a.id, d));
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
    await co.postEntry(co.nodes.finance, { date: date(), memo: 'Opening capital', lines: [['1200', 2500000, 0], ['3000', 0, 2500000]] });
    for (const id of co.order) {
      const human = HUMAN_IDS.includes(id);
      const extra = await people(id, human);
      await owner.put('people', 'p-' + id, { name: displayName(id), title: human ? HUMANS.find((h) => h.id === id).title : AGENTS.find((a) => a.id === id).job.slice(0, 160),
        kind: human ? 'human' : 'agent', device: co.keys[id].pub.slice(0, 16), privateSealed: '', ...extra });
    }
    await overseer.put('policy', 'agents', { minConfidence: Math.round(DEFAULT_POLICY.minConfidence * 1000), by: 'AI overseer' });
    await co.syncAll();
    await owner.typeAt('docs', 'policy', 0, 'Operating policy: agents act end to end. Money and security calls need a second, independent brain. Anything no brain can confirm waits for the overseer.');
    await co.syncAll();
    return co;
  };

  // ── one piece of work arrives at the door ──
  co.handleEvent = async (ev) => {
    if (!ev) return null;
    let at = ev.landsAt;
    if (!co.available(at)) at = co.available(OWNER_OF[ev.domain]) ? OWNER_OF[ev.domain] : WORKERS.find(co.available);
    if (!at) {
      const ov = co.nodes.overseer;
      await ov.put('watch', uid(ov, 'w'), { agent: 'door', event: ev.id, domain: '', action: '', label: -1, why: 'no agent available — every agent is paused, revoked or offline', status: 'open', customer: ev.customer, amount: ev.amount | 0, channel: ev.domain });
      const entry = { id: ev.id, agent: 'door', channel: ev.domain, domain: ev.domain, state: 'watch', label: null, truth: ev.truth, by: 'none' };
      co.ledger.push(entry); co.byEvent.set(ev.id, entry); co.truthOf.set(ev.id, ev.truth);
      return entry;
    }
    const node = co.nodes[at];
    const peers = AGENTS.filter((a) => a.id !== at && co.online[a.id] && co.grantLive(a.id)).map((a) => ({ node: a.id, library: co.libs[a.id] }));
    const step = agentStep({ agentId: at, event: ev, library: co.libs[at], peers, policy: co.policyOf(node) });
    const d = step.decision;
    await node.put('decisions', uid(node, 'd'), { agent: at, event: ev.id, domain: d.domain || '', action: d.action || '', state: d.state, by: d.by,
      cross: !!d.crossChecked, second: d.secondBy || '', conf: d.conf | 0, receipt: d.receipt || '', why: String(d.why || '').slice(0, 300), customer: ev.customer, channel: ev.domain });
    const agent = AGENTS.find((a) => a.id === at);
    const { mine, handoff } = splitEffects(step.effects, agent.cols, OWNER_OF[d.domain || ev.domain]);
    for (const e of mine) await co.doEffect(node, e);
    for (const h of handoff) {
      const payload = JSON.stringify(h.payload);
      if (payload.length <= 1900) await node.put('handoff', uid(node, 'h'), { from: at, to: h.to, payload, status: 'open', event: ev.id });
    }
    const own = d.by === 'own' ? answer(co.libs[at], ev.features) : null;   // deterministic: the same call agentStep made
    const entry = { id: ev.id, agent: at, channel: ev.domain, domain: d.domain || ev.domain, state: d.state, label: d.label, truth: ev.truth, by: d.by,
      crossChecked: d.crossChecked, action: d.action, conf: d.conf, customer: ev.customer, secondBy: d.secondBy, receipt: own && own.receipt };
    co.ledger.push(entry); co.byEvent.set(ev.id, entry); co.truthOf.set(ev.id, ev.truth);
    if (co.ledger.length > 6000) co.ledger.splice(0, 1000);
    if (d.by && d.by.startsWith('mesh:')) bump(co.meshEdges, d.by.slice(5) + '>' + at);
    if (d.crossChecked && d.secondBy) bump(co.crossEdges, d.secondBy + '>' + (d.by === 'own' ? at : d.by.slice(5)));
    if (step.askedMesh) {                   // the mycelium learns what it keeps being asked about
      co.asks[at][step.askedMesh] = (co.asks[at][step.askedMesh] || 0) + 1;
      if (shouldLearn(co.asks[at], step.askedMesh, co.libs[at])) await co.learn(at, step.askedMesh);
    }
    if (co.libs[at][ev.domain]) {           // the outcome comes back; regrow on enough of them
      const outs = co.outcomes[at][ev.domain] || (co.outcomes[at][ev.domain] = []);
      outs.push({ ...ev.features, y: ev.truth });
      if (outs.length > 600) outs.splice(0, outs.length - 600);
      const key = at + '/' + ev.domain;
      co.outCount[key] = (co.outCount[key] || 0) + 1;
      if (co.outCount[key] % REGROW_EVERY === 0) await co.regrow(at, ev.domain);
    }
    return entry;
  };
  co.next = () => co.handleEvent(pickEvent(co.rnd, co.pools, co.n++));

  co.learn = async (id, domain) => {
    const node = co.nodes[id];
    const recs = node.list('brain').filter((r) => r.domain === domain && r.by !== id);   // no trust in labels: adopt() re-verifies
    const rec = recs.find((r) => r.by === OWNER_OF[domain]) || recs[0];
    co.asks[id][domain] = 0;
    if (!rec) return null;
    const p = fromRecord(rec);
    const v = adopt(p, co.localRows(id, domain));
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

  // ── housekeeping: purchase orders, hand-offs, approved watch items, the vault witness ──
  co.honoured = (node, fromId) => {           // a hand-off counts only while its sender holds a live grant, by the receiver's own view
    const pub = co.keys[fromId] && co.keys[fromId].pub;
    return !!pub && node.view().roster.some((r) => r.to === pub && !r.revoked);
  };
  co.housekeeping = async () => {
    const fin = co.nodes.finance;
    if (co.available('finance')) {
      for (const po of fin.list('po').filter((p) => p.status === 'raised')) {
        const e = poEntry(po);
        if (e) { const r = await co.postEntry(fin, { date: date(), ...e }); if (r.ok) await fin.put('po', po.id, { status: 'posted' }); }
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
    if (co.available('audit')) {
      const au = co.nodes.audit;
      const { a, cos } = co.vaultState(au);
      const last = cos.reduce((m, c) => Math.max(m, c.size), 0);
      if (a.ok && a.size >= last + 10) await co.witnessHead(au);
    }
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

  // ── attacks the page can launch: a hostile customer message, a poisoned brain ──
  co.hostile = async (r) => {
    const ev = pickEvent(r, { churn: co.pools.churn }, co.n++);
    ev.text = HOSTILE_TEXT[Math.floor(r() * HOSTILE_TEXT.length) % HOSTILE_TEXT.length];
    ev.landsAt = 'service';
    return co.handleEvent(ev);
  };
  co.poison = async (tag = 'x') => {
    const evil = co.nodes.systems;
    const good = co.factory.fraud;
    const bad = { ...good, patternId: sha256('improved/' + tag).slice(0, 16), rules: good.rules.map((x) => ({ ...x, w: -x.w })), title: 'Card fraud (improved!)' };
    const r = await evil.put('brain', 'fraud.systems', { ...toRecord(bad), by: 'systems', source: 'regrown', localAuc: 990, n: 5000 });
    brainLog(`Systems agent (compromised) published a "better" fraud brain claiming AUC 0.990${r.ok ? '' : ' — refused: ' + r.reason}`);
    const results = [];
    for (const a of AGENTS) {
      if (a.id === 'systems' || !co.online[a.id]) continue;
      const node = co.nodes[a.id];
      await pull(node, evil);
      const rec = node.list('brain').find((x) => x.id === 'fraud.systems');
      if (!rec) continue;
      const v = adopt(fromRecord(rec), co.localRows(a.id, 'fraud'));
      await node.put('adopt', uid(node, 'a'), { domain: 'fraud', patternId: rec.patternId, from: 'systems', by: a.id, adopted: v.adopt, localAuc: Math.round(v.localAuc * 1000), n: v.n, reason: v.reason.slice(0, 200), source: 'offered' });
      brainLog(`${a.name} tried the "better" fraud brain on ${v.n} of its own cases: AUC ${v.localAuc.toFixed(3)} — ${v.adopt ? 'ADOPTED' : 'REFUSED'}`);
      results.push({ agent: a.id, adopted: v.adopt, localAuc: v.localAuc });
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
      learned: co.learned, regrowthsTried: co.regrowths.tried, regrowthsPromoted: co.regrowths.promoted,
      perAgent: Object.fromEntries(Object.entries(k.perAgent).map(([id, s]) => [id, { done: s.done, correct: s.correct, watched: s.watched, brains: Object.keys(co.libs[id] || {}).sort() }])),
      books: { entries: entries.length, income: pl.income, expense: pl.expense, profit: pl.profit, balanced: bs.balanced },
      vault: { size: a.size, audits: a.ok, root: a.root || '', cosigned: cos.length },
      writes: node.size(), digest: node.digest(),
      converged: co.order.every((id) => co.nodes[id].digest() === node.digest()),
    };
  };
  return co;
}
