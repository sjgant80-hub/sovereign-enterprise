// shell.test.mjs — node-shell + wiring. The agent shell is tested on the REAL spine: an owner, a hub and agent devices,
// each its own createNode with its own Ed25519 key (keys.mjs fromSeed), synced with nothing but pull(); the hub writes the
// work; each agent decides on its own device — including work its own brain cannot answer, answered by another device's
// brain over signed asks and replies, and money calls confirmed by a third device — and every device converges.
// Expected values are read off the spine, the envelopes and the published data, never off the shell's own exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import * as S from '../src/shell.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed, verify } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { canonical, utf8, toHex } from '../src/canon.mjs';
import { AGENTS, HUB, OWNER_OF, HOSTILE_TEXT } from '../src/company.mjs';
import { answer } from '../src/brain.mjs';
import { pickSecond } from '../src/mesh.mjs';
import { shopperRows, sample } from '../src/streams.mjs';
import { makeAntibody, NOVEL_ATTACK, NOVEL_PARAPHRASES } from '../src/antibody.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const INDEX = read('brains/index.json');
const FACTORY = Object.fromEntries(Object.entries(INDEX).map(([d, m]) => [d, read('brains/' + m.file)]));
const FEATURES = Object.fromEntries(Object.entries(FACTORY).map(([d, p]) => [d, p.features]));
const TITLES = Object.fromEntries(Object.entries(INDEX).map(([d, m]) => [d, m.title]));
const HALF = {};
for (const [d, m] of Object.entries(INDEX)) {
  if (!m.sample) continue;
  const rows = shopperRows(read('brains/' + m.sample));
  HALF[d] = { own: rows.filter((_, i) => i % 2 === 0), door: rows.filter((_, i) => i % 2 === 1) };
}
HALF.inventory = { own: sample('inventory', 11, 600).rows, door: sample('inventory', 12, 400).rows };
const rows = (d) => HALF[d].own;
const caseOf = (d, i) => { const { y, ...f } = HALF[d].door[i]; return f; };
const AG = (id) => AGENTS.find((a) => a.id === id);
const agentCols = (id) => [...AG(id).cols, 'wire', 'model'];
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Every envelope a node holds, parsed: who signed what. */
const envs = (node) => node.hashes().map((h) => JSON.parse(new TextDecoder().decode(node.bytes(h))));
const signers = (node, c, pred = () => true) => envs(node).filter((e) => e.op.k === 'put' && e.op.c === c && pred(e.op)).map((e) => e.from);

async function office({ agents = ['finance', 'ops', 'audit'], extra = [], cols = {} } = {}) {
  const k = {};
  for (const n of ['owner', 'hub', ...agents, ...extra]) k[n] = await fromSeed(sha256Bytes('shell-test/' + n));
  const G = k.owner.pub;
  const nodes = {};
  for (const n of Object.keys(k)) nodes[n] = createNode({ keys: k[n], genesis: G, name: n });
  await nodes.owner.grant('hub-door', k.hub.pub, 'hub', [...HUB.cols, 'wire']);
  for (const a of agents) await nodes.owner.grant('agent-' + a, k[a].pub, 'agent', cols[a] || agentCols(a));
  const sync = async (only = Object.keys(nodes)) => { for (let i = 0; i < 2; i++) for (const a of only) for (const b of only) if (a !== b) await pull(nodes[a], nodes[b]); };
  await sync();
  return { k, G, nodes, sync };
}
const stock = async (o, id, agent = AG(id)) => (await S.stockBrains({ node: o.nodes[id], agent, factory: FACTORY, features: FEATURES, titles: TITLES, rows: (d) => rows(d), seed: () => 7 })).lib;
const send = (o, id, to, d, i, extra = {}) => o.nodes.hub.put('inbox', id, { to, channel: d, customer: 'C' + (1000 + i), amount: 4321, text: '', features: JSON.stringify(caseOf(d, i)), status: 'open', ticks: 0, ...extra });
/** The first held-out case of a job for which pred(features) holds (pred reads the brains — the oracle, not the shell). */
const pick = (d, pred, from = 0) => { for (let i = from; i < HALF[d].door.length; i++) if (pred(caseOf(d, i))) return i; throw new Error('no case for ' + d); };
const rec = (node, c, id) => node.list(c).find((r) => r.id === id);
const decisionsFor = (node, event) => node.list('decisions').filter((d) => d.event === event);

// ── THE OFFICE: owner, hub, three agent devices on the real spine ───────────────────────────────────────────────────
test('an office on the real spine: work at the hub is decided across devices, asks answered by another device’s brain, every device converges', async () => {
  const o = await office();
  const fin = await stock(o, 'finance'), ops = await stock(o, 'ops');
  const aud = await stock(o, 'audit', { ...AG('audit'), grows: ['fraud'] });
  assert.deepEqual(Object.keys(fin).sort(), ['credit', 'fraud']);
  assert.deepEqual(Object.keys(ops).sort(), ['energy', 'inventory', 'maintenance']);
  assert.deepEqual(Object.keys(aud), ['fraud']);
  assert.notEqual(aud.fraud.patternId, fin.fraud.patternId, 'the Audit agent grew its own, independent fraud brain');
  // the cases — chosen by reading the brains themselves
  const both = (f) => { const a = answer({ fraud: fin.fraud }, f), b = answer(aud, f); return a.verdict === 'VERIFIED' && b.verdict === 'VERIFIED' && a.label === b.label; };
  const f1 = pick('fraud', both), f2 = pick('fraud', both, f1 + 1), f3 = pick('fraud', both, f2 + 1), f4 = pick('fraud', both, f3 + 1), f5 = pick('fraud', both, f4 + 1);
  const inv = pick('inventory', (f) => { const a = answer(ops, f); return a.verdict === 'VERIFIED' && a.domain === 'inventory' && a.confidence >= 0.05; });
  const cr = pick('credit', (f) => answer({ credit: fin.credit }, f).verdict === 'VERIFIED');
  await send(o, 'e000001', 'ops', 'fraud', f1);                      // misrouted: Ops has no fraud brain
  await send(o, 'e000002', 'finance', 'fraud', f2);                  // Finance's own job: a money call, a second brain must agree
  await send(o, 'e000003', 'ops', 'inventory', inv);                 // Ops' own job, confident: decided at once
  await send(o, 'e000004', 'ops', 'inventory', inv + 1, { text: HOSTILE_TEXT[0] });   // a hostile message: quarantined unread
  await send(o, 'e000005', 'finance', 'credit', cr);                 // no other device holds a credit brain: held for a person
  await send(o, 'e000007', 'ops', 'fraud', f3);
  await send(o, 'e000008', 'ops', 'fraud', f4);
  await send(o, 'e000010', 'ops', 'churn', 3);                       // re-addressed to Finance while Ops waits on the mesh
  await send(o, 'e000011', 'ops', 'shopper', 4);                     // closed elsewhere while Ops waits on the mesh
  let T = 0;
  const shell = (id, lib) => S.createAgentShell({ node: o.nodes[id], agentId: id, library: lib, now: () => T, deadline: 50, localRows: (d) => rows(d) });
  const shells = { finance: shell('finance', fin), ops: shell('ops', ops), audit: shell('audit', aud) };
  const round = async () => { await o.sync(); for (const id of ['finance', 'ops', 'audit']) await shells[id].tick(); await o.sync(); T++; };

  await round();                                                     // R1 (T=0): everyone opens its work
  const H = o.nodes.hub;
  assert.equal(decisionsFor(H, 'e000003')[0].by, 'own', 'decided at once by its own brain');
  assert.equal(decisionsFor(H, 'e000003')[0].state, 'done');
  assert.equal(decisionsFor(H, 'e000004')[0].by, 'screen');
  assert.equal(decisionsFor(H, 'e000004')[0].domain, '', 'no brain named a job: written as empty, never null');
  assert.equal(decisionsFor(H, 'e000003')[0].domain, 'inventory');
  assert.match(decisionsFor(H, 'e000003')[0].receipt, /^[0-9a-f]{16}$/, 'its own brain’s receipt rides on the signed decision');
  assert.equal(decisionsFor(H, 'e000001').length, 0, 'still waiting on the mesh');
  const opsAsks = () => H.list('ask').filter((a) => a.from === 'ops');
  assert.deepEqual(opsAsks().map((a) => a.item + '/' + a.kind).sort(), ['e000001/answer', 'e000007/answer', 'e000008/answer', 'e000010/answer', 'e000011/answer']);
  await H.put('inbox', 'e000010', { to: 'finance' });               // the door re-addresses one …
  await o.nodes.owner.put('inbox', 'e000011', { status: 'done', doneBy: 'owner' });   // … and a person closes another
  await round();                                                     // R2: the peers reply
  // ── a RESTART of the Ops device: a new shell on the same device and the same replica ──
  const before = opsAsks().length;
  shells.ops = shell('ops', ops);
  for (let i = 0; i < 6; i++) await round();                         // R3…R8
  assert.equal(opsAsks().filter((a) => a.kind === 'answer').length, before, 'after the restart Ops took back its own asks, it never asked again');
  for (const n of Object.values(o.nodes)) {                          // every device: each ask answered at most once by each device
    const seen = new Set();
    for (const r of n.list('reply')) { assert.ok(!seen.has(r.ask + '/' + r.by), 'a duplicate reply ' + r.ask + '/' + r.by); seen.add(r.ask + '/' + r.by); }
  }
  // e1: Ops could not answer — another device's brain did, and a third confirmed it
  const d1 = decisionsFor(H, 'e000001');
  assert.equal(d1.length, 1);
  assert.match(d1[0].by, /^mesh:(finance|audit)$/);
  assert.equal(d1[0].cross, true);
  assert.deepEqual([d1[0].by.slice(5), d1[0].second].sort(), ['audit', 'finance'], 'answered by one device, confirmed by the other');
  assert.deepEqual(signers(H, 'decisions', (op) => op.f.event === 'e000001'), [o.k.ops.pub], 'signed by the Ops device itself');
  const r1 = H.list('reply').filter((r) => r.item === 'e000001' && r.verdict === 'VERIFIED');
  assert.ok(r1.some((r) => r.by === d1[0].by.slice(5) && r.kind === 'answer') && r1.some((r) => r.by === d1[0].second && r.kind === 'second'));
  // what it writes: Ops' grant has no payments and no books — the money act is handed to Finance, who carries it out
  const h1 = H.list('handoff').find((h) => h.event === 'e000001');
  assert.equal(h1.from, 'ops');
  assert.equal(h1.to, 'finance');
  assert.equal(h1.status, 'done');
  assert.equal(h1.doneBy, 'finance');
  if (d1[0].action === 'release-payment') assert.ok(H.list('journal').some((j) => j.memo === 'Card sale C' + (1000 + f1)));
  else assert.ok(H.list('payments').some((p) => p.customer === 'C' + (1000 + f1) && p.status === 'held' && p.by === 'Finance agent'));
  // e2: Finance's own brain, confirmed by the Audit agent's independent brain (Ops abstained: no fraud brain then)
  const d2 = decisionsFor(H, 'e000002')[0];
  assert.equal(d2.by, 'own');
  assert.equal(d2.second, 'audit');
  assert.equal(d2.cross, true);
  assert.equal(d2.customer, 'C' + (1000 + f2));
  assert.equal(d2.domain, 'fraud');
  assert.equal(d2.channel, 'fraud');
  assert.ok(H.list('reply').some((r) => r.item === 'e000002' && r.by === 'ops' && r.verdict === 'ABSTAIN'));
  // e3, e4: Ops on its own job; a hostile message quarantined by the Ops device, never read by a brain
  if (decisionsFor(H, 'e000003')[0].action === 'raise-po') assert.ok(H.list('po').some((p) => p.supplier === 'Supplier for C' + (1000 + inv)));
  const q = H.list('quarantine').find((x) => x.event === 'e000004');
  assert.equal(q.agent, 'ops');
  assert.match(q.flags, /injection/);
  // e5: nobody else holds a credit brain — no second brain could confirm, so it waits for a person
  const d5 = decisionsFor(H, 'e000005')[0];
  assert.equal(d5.state, 'watch');
  assert.match(d5.why, /no second brain/);
  const w5 = H.list('watch').find((w) => w.event === 'e000005');
  assert.equal(w5.status, 'open');
  // e7, e8: asked three times about card fraud, Ops LEARNED Finance's brain — re-verified on its own cases
  const learnt = H.list('adopt').find((a) => a.by === 'ops' && a.source === 'learned' && a.domain === 'fraud');
  assert.equal(learnt.adopted, true);
  assert.equal(learnt.from, 'finance');
  assert.equal(learnt.patternId, fin.fraud.patternId);
  assert.ok((await shells.ops.tick()).brains.includes('fraud'));
  // e10 went to Finance after the door re-addressed it; e11 was closed by a person — Ops decided neither
  assert.deepEqual(decisionsFor(H, 'e000010').map((d) => d.agent), ['finance']);
  assert.deepEqual(decisionsFor(H, 'e000011'), []);
  // a later fraud case to Ops: its own (learned) brain answers now, and another device confirms
  await send(o, 'e000012', 'ops', 'fraud', f5);
  for (let i = 0; i < 4; i++) await round();
  const d12 = decisionsFor(H, 'e000012')[0];
  assert.equal(d12.by, 'own');
  assert.equal(d12.cross, true);
  // a person approves the held credit call; Finance carries it out on its next beat
  await o.nodes.owner.put('watch', w5.id, { status: 'approved', action: 'standard-terms', resolvedBy: 'Owner' });
  for (let i = 0; i < 2; i++) await round();
  assert.equal(rec(H, 'watch', w5.id).status, 'executed');
  assert.equal(rec(H, 'watch', w5.id).executedBy, 'finance');
  assert.ok(H.list('terms').some((t) => t.customer === 'C' + (1000 + cr) && t.terms === '30 days'));
  // everything at the door decided exactly once; every device holds the same company
  for (const it of H.list('inbox')) assert.equal(it.status, 'done', it.id);
  for (const id of ['e000001', 'e000002', 'e000003', 'e000004', 'e000005', 'e000007', 'e000008', 'e000010', 'e000012']) assert.equal(decisionsFor(H, id).length, 1, id);
  const fps = Object.values(o.nodes).map((n) => n.fingerprint());
  assert.ok(fps.every((f) => f === fps[0]), 'every device converged');
  assert.equal(o.nodes.owner.view().report.unauthorized, 0);
  const st = await shells.finance.tick();
  assert.equal(st.state, 'running');
  assert.equal(st.replies, H.list('reply').filter((r) => r.by === 'finance').length);
  assert.equal(st.decisions, H.list('decisions').filter((d) => d.agent === 'finance').length);
  assert.deepEqual(st.peers, ['audit', 'ops']);
  assert.ok(st.cols.includes('journal') && st.cols.includes('wire'));
  assert.equal(st.watch, 'learning');
});

// ── deadlines: a granted peer that never answers is waited for — exactly as long as the deadline, no longer ──────────
test('deadline: a silent peer is waited for until the deadline, to the tick; 0 decides at once; a junk deadline is refused', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  await o.nodes.owner.grant('agent-service', (await fromSeed(sha256Bytes('shell-test/silent'))).pub, 'agent', agentCols('service'));   // granted, never runs
  await o.sync();
  const fin = await stock(o, 'finance'), ops = await stock(o, 'ops');
  const fi = pick('fraud', (f) => answer({ fraud: fin.fraud }, f).verdict === 'VERIFIED');
  await send(o, 'e000001', 'finance', 'fraud', fi);
  let T = 100;
  const sf = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => T, deadline: 3 });
  const so = S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops, now: () => T, deadline: 3 });
  const beat = async () => { await o.sync(); await sf.tick(); await so.tick(); await o.sync(); };
  await beat();                                                      // T=100: Finance asks for a second opinion
  assert.equal((await sf.tick()).pending, 1);
  assert.deepEqual((await sf.tick()).peers, ['ops', 'service']);
  T = 101; await beat();                                             // Ops replies (it abstains); the Service device is silent
  T = 102; await beat();
  assert.equal(decisionsFor(o.nodes.hub, 'e000001').length, 0, '2 ticks after asking, short of the 3-tick deadline: still waiting');
  T = 103; await beat();
  const d = decisionsFor(o.nodes.hub, 'e000001');
  assert.equal(d.length, 1, 'at the deadline it decides on what it has');
  assert.equal(d[0].state, 'watch');
  assert.match(d[0].why, /no second brain/);
  // deadline 0: decides in the same beat it asked; a negative or junk deadline falls back to the default (it waits)
  for (const [dl, decided] of [[0, true], [-1, false], ['5', false], [1.5, false]]) {
    const p = await office({ agents: ['finance', 'ops'] });
    const lib = await stock(p, 'finance');
    await send(p, 'e000001', 'finance', 'fraud', fi);
    await p.sync();
    const s = S.createAgentShell({ node: p.nodes.finance, agentId: 'finance', library: lib, now: () => 5, deadline: dl });
    await s.tick();
    assert.equal(decisionsFor(p.nodes.finance, 'e000001').length, decided ? 1 : 0, 'deadline ' + dl);
  }
  // a clock that returns junk reads as 0, and the deadline still holds
  const p = await office({ agents: ['finance', 'ops'] });
  const lib = await stock(p, 'finance');
  await send(p, 'e000001', 'finance', 'fraud', fi);
  await p.sync();
  const junk = S.createAgentShell({ node: p.nodes.finance, agentId: 'finance', library: lib, now: () => 'soon', deadline: 0 });
  await junk.tick();
  assert.equal(decisionsFor(p.nodes.finance, 'e000001').length, 1);
});

// ── the model tier on an agent device: only for work no brain covers, never for quarantined or verified work ─────────
test('the model tier: called only when nothing verified answered and the text passed the screen; every call audited on the spine', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const fin = await stock(o, 'finance'), ops = await stock(o, 'ops');
  const calls = { finance: 0, ops: 0 };
  const fake = (who) => ({ adapter: { name: 'fake', kind: 'local', model: 'm1', call: async () => { calls[who]++; return { ok: true, text: '1', tokensIn: 5, tokensOut: 1 }; } }, budget: 0 });
  const fi = pick('fraud', (f) => answer({ fraud: fin.fraud }, f).verdict === 'VERIFIED');
  await send(o, 'e000001', 'finance', 'intrusion', 2);               // no brain anywhere covers it → the model
  await send(o, 'e000002', 'finance', 'credit', 3, { text: HOSTILE_TEXT[5] });   // quarantined → never shown to a model
  await send(o, 'e000003', 'finance', 'fraud', fi);                  // its own brain answers → no model
  await send(o, 'e000004', 'ops', 'fraud', fi + 1);                  // another device's brain answers → no model
  let T = 0;
  const sf = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => T, deadline: 40, model: fake('finance') });
  const so = S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops, now: () => T, deadline: 40, model: fake('ops') });
  for (let i = 0; i < 6; i++) { await o.sync(); await sf.tick(); await so.tick(); await o.sync(); T++; }
  const H = o.nodes.hub;
  const d1 = decisionsFor(H, 'e000001')[0];
  assert.equal(d1.by, 'model:fake/m1');
  assert.equal(d1.state, 'watch', 'a model answered a security call: held for a person, never acted on');
  assert.equal(decisionsFor(H, 'e000002')[0].by, 'screen');
  assert.equal(decisionsFor(H, 'e000003')[0].by, 'own');
  assert.equal(decisionsFor(H, 'e000004')[0].by, 'mesh:finance');
  assert.deepEqual(calls, { finance: 1, ops: 0 });
  const audits = H.list('model');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].agent, 'finance');
  assert.equal(audits[0].ok, true);
  assert.deepEqual(signers(H, 'model'), [o.k.finance.pub]);
  assert.equal((await sf.tick()).model, true);
  assert.equal((await so.tick()).spent, 0);
});

// ── who may run: a grant, not paused, a real agent ──────────────────────────────────────────────────────────────────
test('a device runs its agent only with a live grant of its own, not while paused, and never an agent that does not exist', async () => {
  const o = await office({ agents: ['finance', 'ops'], extra: ['spare'] });
  const fin = await stock(o, 'finance');
  await send(o, 'e000001', 'finance', 'credit', 1);
  await o.sync();
  // no grant on THIS device (another device holds the Finance grant): it waits and writes nothing
  const size = o.nodes.spare.size();
  const spare = S.createAgentShell({ node: o.nodes.spare, agentId: 'finance', library: fin });
  const w = await spare.tick();
  assert.equal(w.state, 'waiting-grant');
  assert.match(w.why, /no live grant as the Finance agent/);
  assert.equal(o.nodes.spare.size(), size);
  assert.deepEqual(w.cols, []);
  // not an agent
  assert.equal((await S.createAgentShell({ node: o.nodes.ops, agentId: 'nobody' }).tick()).state, 'no-agent');
  for (const junk of [null, undefined, 7, 'x', {}, { node: null, agentId: 'ops' }]) assert.equal((await S.createAgentShell(junk).tick()).state, 'no-agent');
  // paused by a person: it does nothing — not even replying — until cleared
  await o.nodes.owner.put('control', 'finance', { paused: true, by: 'Owner', why: 'checking the books' });
  await o.sync();
  const sf = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => 0, deadline: 0 });
  const before = o.nodes.finance.size();
  const p = await sf.tick();
  assert.equal(p.state, 'paused');
  assert.equal(p.why, 'paused by Owner — checking the books. A person clears it on their device.');
  assert.equal(o.nodes.finance.size(), before);
  await o.nodes.owner.put('control', 'finance', { paused: true, by: '', why: '' });
  await o.sync();
  assert.equal((await sf.tick()).why, 'paused by a person. A person clears it on their device.');
  await o.nodes.owner.put('control', 'finance', { paused: false });
  await o.sync();
  const r = await sf.tick();
  assert.equal(r.state, 'running');
  assert.equal(decisionsFor(o.nodes.finance, 'e000001').length, 1);
  // a revoked grant: waiting again
  const g = o.nodes.owner.view().roster.find((x) => x.grant === 'agent-finance');
  await o.nodes.owner.revoke(g.grant, o.nodes.finance.tip().seq);
  await o.sync();
  assert.equal((await sf.tick()).state, 'waiting-grant');
});

test('two beats never overlap; a beat that fails is dropped and said, never thrown', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const fin = await stock(o, 'finance');
  const s = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin });
  const [a, b] = await Promise.all([s.tick(), s.tick()]);
  assert.equal(a.ticks, 1);
  assert.equal(b.ticks, 1);
  assert.equal((await s.tick()).ticks, 2);
  // a device whose replica fails mid-beat
  const pub = o.k.ops.pub;
  const broken = { pub, genesis: o.G, view: () => ({ roster: [{ grant: 'agent-ops', to: pub, role: 'agent', cols: ['inbox'], revoked: false }] }),
    list: (c) => { if (c === 'control') return []; throw new Error('disk on fire'); } };
  const bs = S.createAgentShell({ node: broken, agentId: 'ops' });
  const st = await bs.tick();
  assert.equal(st.state, 'error');
  assert.equal(st.why, 'this beat failed and was dropped: disk on fire');
  assert.equal(st.ok, false);
});

// ── after a crash between deciding and closing: closed, never decided twice ─────────────────────────────────────────
test('a restart closes work it decided before the crash and never decides it again', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const fin = await stock(o, 'finance');
  await send(o, 'e000001', 'finance', 'credit', 1);
  await send(o, 'e000002', 'finance', 'credit', 2);
  await send(o, 'e000003', 'finance', 'credit', 3, { status: 'done' });
  await o.sync();
  await o.nodes.finance.put('decisions', 'dthree', { agent: 'finance', event: 'e000003', domain: 'credit', action: 'standard-terms', state: 'done', by: 'own', cross: true, second: 'audit', conf: 500, receipt: '', why: 'long ago', customer: 'C1003', channel: 'credit' });
  // the device wrote its decision for e1 and crashed before closing the inbox record
  await o.nodes.finance.put('decisions', 'dcrash', { agent: 'finance', event: 'e000001', domain: 'credit', action: 'standard-terms', state: 'done', by: 'own', cross: true, second: 'audit', conf: 500, receipt: '', why: 'before the crash', customer: 'C1001', channel: 'credit' });
  await o.nodes.finance.put('decisions', 'dother', { agent: 'ops', event: 'e000002', domain: 'credit', action: 'standard-terms', state: 'done', by: 'own', cross: true, second: '', conf: 500, receipt: '', why: 'another agent', customer: 'C1002', channel: 'credit' });
  const s = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => 0, deadline: 0 });
  const st = await s.tick();
  assert.equal(st.closedAfterRestart, 1);
  assert.equal(rec(o.nodes.finance, 'inbox', 'e000001').status, 'done');
  assert.equal(rec(o.nodes.finance, 'inbox', 'e000001').doneBy, 'finance');
  assert.equal(decisionsFor(o.nodes.finance, 'e000001').length, 1, 'never decided twice');
  assert.equal(decisionsFor(o.nodes.finance, 'e000002').filter((d) => d.agent === 'finance').length, 1, 'another agent’s decision is not its own: it decides e2 itself');
  assert.equal(st.decidedHere, 1);
});

// ── antibodies on the agent device: re-checked on its own benign messages, adopted or refused; quarantine follows ─────
test('antibodies: an agent device adopts a confirmed attack only if it fires on none of its benign messages, then quarantines its paraphrases', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const fin = await stock(o, 'finance');
  const GENUINE = 'Can you confirm the refund went back to the card I paid with? It has been ten days.';
  const good = makeAntibody(NOVEL_ATTACK, { by: 'Owner', reason: 'asked us to wire a refund' });
  const bad = makeAntibody(GENUINE, { by: 'Owner', reason: 'confirmed by mistake' });
  await o.nodes.owner.put('antibody', 'ab-' + good.abId, good);
  await o.nodes.owner.put('antibody', 'ab-' + bad.abId, bad);
  await o.sync();
  const logs = [];
  const s = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => 0, deadline: 0, log: (x) => logs.push(x) });
  await s.tick();
  const ad = o.nodes.finance.list('adopt').filter((a) => a.source === 'antibody' && a.by === 'finance');
  assert.deepEqual(ad.map((a) => a.patternId + ':' + a.adopted).sort(), [bad.abId + ':false', good.abId + ':true'].sort());
  assert.equal((await s.tick()).antibodies, 1);
  assert.equal(logs.filter((l) => /re-ran antibody/.test(l)).length, 2);
  assert.ok(logs.some((l) => l.startsWith('Finance agent re-ran antibody ' + good.abId.slice(0, 8) + ' on its own ') && l.includes('ADOPTED')));
  assert.ok(ad.every((a) => a.from === 'Owner'));
  await send(o, 'e000001', 'finance', 'credit', 1, { text: NOVEL_PARAPHRASES[0] });
  await send(o, 'e000002', 'finance', 'credit', 2, { text: GENUINE });
  await o.sync();
  await s.tick();
  assert.equal(decisionsFor(o.nodes.finance, 'e000001')[0].by, 'screen');
  assert.match(o.nodes.finance.list('quarantine').find((q) => q.event === 'e000001').flags, /antibody/);
  assert.notEqual(decisionsFor(o.nodes.finance, 'e000002')[0].by, 'screen', 'the mistaken antibody was refused: a genuine message passes');
  // a restart: the antibodies already re-run are not re-run (no new adopt records), and the adopted one still screens
  const s2 = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => 0, deadline: 0 });
  await send(o, 'e000003', 'finance', 'credit', 3, { text: NOVEL_PARAPHRASES[1] });
  await o.sync();
  const st = await s2.tick();
  assert.equal(o.nodes.finance.list('adopt').filter((a) => a.source === 'antibody' && a.by === 'finance').length, 2);
  assert.equal(st.antibodies, 1);
  assert.equal(decisionsFor(o.nodes.finance, 'e000003')[0].by, 'screen');
  // with its own benign messages given, a device judges on those (too few here → it refuses to adopt anything)
  const s3 = S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: {}, benign: ['hello there'] });
  await s3.tick();
  const opsAd = o.nodes.ops.list('adopt').filter((a) => a.by === 'ops' && a.source === 'antibody');
  assert.equal(opsAd.length, 2);
  assert.ok(opsAd.every((a) => a.adopted === false && /known-benign messages here/.test(a.reason)));
});

// ── the Audit agent device witnesses the vault ──────────────────────────────────────────────────────────────────────
test('the Audit agent device co-signs the vault once ten entries have gone in, and not before', async () => {
  const o = await office({ agents: ['finance', 'audit'] });
  const entry = (i) => ({ date: '2026-10-15', memo: 'Sale ' + i, lines: [['1200', 1000 + i, 0], ['4000', 0, 1000 + i]] });
  for (let i = 0; i < 9; i++) assert.equal((await S.postEntry(o.nodes.finance, entry(i))).ok, true);
  await o.sync();
  const sa = S.createAgentShell({ node: o.nodes.audit, agentId: 'audit', library: {} });
  await sa.tick();
  assert.equal(o.nodes.audit.list('vault_cosig').length, 0, 'nine entries: not yet');
  await S.postEntry(o.nodes.finance, entry(9));
  await o.sync();
  await sa.tick();
  const cos = o.nodes.audit.list('vault_cosig');
  assert.equal(cos.length, 1);
  assert.equal(cos[0].size, 10);
  assert.equal(cos[0].by, 'audit');
  assert.deepEqual(signers(o.nodes.audit, 'vault_cosig'), [o.k.audit.pub]);
  await sa.tick();
  assert.equal(o.nodes.audit.list('vault_cosig').length, 1, 'not again until ten more');
});

// ── more of what one agent device does on its own ──────────────────────────────────────────────────────────────────
test('work the door re-addresses, or a person closes, while the agent waits on the mesh is dropped — never decided by it', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const fin = await stock(o, 'finance'), ops = await stock(o, 'ops');
  await send(o, 'e000010', 'ops', 'churn', 3);
  await send(o, 'e000011', 'ops', 'shopper', 4);
  await send(o, 'e000012', 'ops', 'churn', 5);
  let T = 0;
  const sf = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => T, deadline: 50 });
  const so = S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops, now: () => T, deadline: 50 });
  const round = async () => { await o.sync(); await so.tick(); await sf.tick(); await o.sync(); T++; };
  await round();                                                     // Ops asks about all three
  await o.nodes.hub.put('inbox', 'e000010', { to: 'finance' });
  await o.nodes.owner.put('inbox', 'e000011', { status: 'done', doneBy: 'owner' });
  for (let i = 0; i < 5; i++) await round();
  const H = o.nodes.hub;
  assert.deepEqual(decisionsFor(H, 'e000010').map((d) => d.agent), ['finance']);
  assert.deepEqual(decisionsFor(H, 'e000011'), []);
  assert.deepEqual(decisionsFor(H, 'e000012').map((d) => d.agent), ['ops'], 'the one left to it, it decides');
  assert.equal(rec(H, 'inbox', 'e000011').doneBy, 'owner');
});

test('after a restart it never answers an ask again — even one only it answered', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const ops = await stock(o, 'ops');
  const { askRecord } = await import('../src/mesh.mjs');
  await o.nodes.finance.put('ask', 'q-only', askRecord({ kind: 'answer', item: 'e000001', from: 'finance', features: caseOf('inventory', 1) }));
  await o.sync();
  await S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops }).tick();
  const mine = () => o.nodes.ops.list('reply').filter((r) => r.ask === 'q-only' && r.by === 'ops');
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].verdict, 'VERIFIED');
  await S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops }).tick();   // the device restarted
  assert.equal(mine().length, 1);
});

test('a hand-off is carried out only from a live agent whose own device wrote it — never from a name another device wrote', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const pay = (c) => JSON.stringify({ c: 'payments', f: { customer: c, amount: 1, status: 'released', by: 'x' } });
  await o.nodes.owner.put('handoff', 'h1', { from: 'stranger', to: 'finance', payload: pay('S1'), status: 'open', event: 'e1' });
  await o.nodes.owner.put('handoff', 'h2', { from: 'ops', to: 'finance', payload: pay('S2'), status: 'open', event: 'e2' });   // names Ops; the owner's key wrote it
  await o.nodes.ops.put('handoff', 'h3', { from: 'ops', to: 'finance', payload: pay('S3'), status: 'open', event: 'e3' });     // Ops' own device
  await o.sync();
  await S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: {} }).tick();
  assert.deepEqual(['h1', 'h2', 'h3'].map((id) => rec(o.nodes.finance, 'handoff', id).status), ['refused', 'refused', 'done']);
  assert.deepEqual(o.nodes.finance.list('payments').map((p) => p.customer), ['S3']);
});

test('learning by being asked needs a published brain and the device’s own rows; without either it carries on, learning nothing', async () => {
  const run = async (publish, localRows) => {
    const o = await office({ agents: ['finance', 'ops'] });
    const fin = publish ? await stock(o, 'finance') : { fraud: FACTORY.fraud, credit: FACTORY.credit };   // given, never published
    const ops = await stock(o, 'ops');
    const fi = (n) => pick('fraud', (f) => answer({ fraud: FACTORY.fraud }, f).verdict === 'VERIFIED', n);
    let at = 0;
    for (let i = 0; i < 3; i++) { at = fi(at) + 1; await send(o, 'e00000' + (i + 1), 'ops', 'fraud', at - 1); }
    let T = 0;
    const sf = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => T, deadline: 4 });
    const so = S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops, now: () => T, deadline: 4, localRows });
    let st = null;
    for (let i = 0; i < 8; i++) { await o.sync(); await sf.tick(); st = await so.tick(); await o.sync(); T++; }
    return { st, o };
  };
  const a = await run(false, (d) => rows(d));
  assert.equal(a.st.state, 'running');
  assert.ok(!a.st.brains.includes('fraud'), 'nothing published to learn');
  const asked = (x) => x.o.nodes.ops.list('ask').filter((q) => q.from === 'ops' && q.kind === 'answer').length;
  assert.equal(a.o.nodes.ops.list('decisions').filter((d) => d.by === 'mesh:finance').length, 3, 'asked three times, answered three times');
  assert.equal(asked(a), 3, 'one ask per piece of work: no beat failed and asked again');
  const b = await run(true, null);
  assert.equal(b.st.state, 'running');
  assert.ok(!b.st.brains.includes('fraud'), 'no rows of its own to re-verify on: it does not learn');
  assert.equal(b.o.nodes.ops.list('adopt').filter((x) => x.source === 'learned').length, 0);
  assert.equal(asked(b), 3);
  assert.equal(b.o.nodes.ops.list('decisions').length, 3);
  const d = await run(true, (x) => rows(x).slice(0, 10));
  assert.ok(!d.st.brains.includes('fraud'), 'too few rows of its own to re-verify on: the published brain is refused, not taken');
  assert.deepEqual(d.o.nodes.ops.list('adopt').filter((x) => x.source === 'learned').map((x) => x.adopted), [false]);
  const c = await run(true, (d) => rows(d));
  assert.ok(c.st.brains.includes('fraud'), 'both: it learns');
});

test('the policy: one given to the shell is used; otherwise the overseer’s on the spine', async () => {
  const o = await office({ agents: ['ops', 'finance'] });   // Finance is granted, never runs: a second opinion is waited for
  const ops = await stock(o, 'ops');
  const inv = pick('inventory', (f) => { const a = answer(ops, f); return a.verdict === 'VERIFIED' && a.domain === 'inventory' && a.confidence >= 0.05 && a.confidence < 0.5; });
  await send(o, 'e000001', 'ops', 'inventory', inv);
  await o.sync();
  // the default floor (0.05): confident enough to decide at once
  await S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops }).tick();
  assert.equal(decisionsFor(o.nodes.ops, 'e000001')[0].by, 'own');
  // a policy given to the shell: below it, a second brain is asked first
  await send(o, 'e000002', 'ops', 'inventory', inv);
  await o.sync();
  await S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops, policy: { minConfidence: 0.99 } }).tick();
  assert.equal(decisionsFor(o.nodes.ops, 'e000002').length, 0);
  assert.equal(o.nodes.ops.list('ask').filter((a) => a.item === 'e000002' && a.kind === 'second').length, 1);
  // the overseer's policy on the spine, when none is given
  await o.nodes.owner.put('policy', 'agents', { minConfidence: 990 });
  await send(o, 'e000003', 'ops', 'inventory', inv);
  await o.sync();
  await S.createAgentShell({ node: o.nodes.ops, agentId: 'ops', library: ops }).tick();
  assert.equal(decisionsFor(o.nodes.ops, 'e000003').length, 0);
  assert.equal(o.nodes.ops.list('ask').filter((a) => a.item === 'e000003' && a.kind === 'second').length, 1);
});

// ── the shared pieces, one at a time ────────────────────────────────────────────────────────────────────────────────
test('uid, seedFor, gateFor, createWork: the ids, seeds and gates every device uses', async () => {
  const o = await office({ agents: ['ops'] });
  const n = o.nodes.ops;
  const c = n.clock();
  assert.equal(S.uid(n, 'd'), 'd' + String(c + 1).padStart(8, '0') + '-' + o.k.ops.pub.slice(0, 6));
  await n.put('tasks', 't1', { title: 'x' });
  assert.equal(S.uid(n, 'q'), 'q' + String(c + 2).padStart(8, '0') + '-' + o.k.ops.pub.slice(0, 6));
  assert.equal(S.seedFor('audit', 'fraud'), parseInt(sha('audit/fraud').slice(0, 8), 16) >>> 0);
  assert.equal(S.seedFor('x', 'y'), parseInt(sha('x/y').slice(0, 8), 16) >>> 0);
  assert.notEqual(S.seedFor('audit', 'fraud'), S.seedFor('audit', 'credit'));
  for (const d of ['fraud', 'credit', 'intrusion']) assert.equal(S.gateFor(d), 0.65, d);
  for (const d of ['churn', 'shopper', 'inventory', 'maintenance', 'energy', 'nope', '']) assert.equal(S.gateFor(d), 0.6, d);
  const w = S.createWork();
  assert.ok(w.pending instanceof Map && w.replied instanceof Set && w.done instanceof Set);
  assert.equal(w.tick, 0);
  assert.notEqual(S.createWork().pending, w.pending);
});

test('policyOf, isPaused, clearsOf: read from the device’s own view of the spine', async () => {
  const o = await office({ agents: ['ops'] });
  const n = o.nodes.ops;
  assert.deepEqual(S.policyOf(n), { minConfidence: 0.05, moneyLimit: 0 });
  await o.nodes.owner.put('policy', 'agents', { minConfidence: 200 });
  await o.nodes.owner.put('policy', 'other', { minConfidence: 900 });
  await o.sync();
  assert.deepEqual(S.policyOf(n), { minConfidence: 0.2, moneyLimit: 0 });
  await o.nodes.owner.put('policy', 'agents', { minConfidence: 200, moneyLimit: 250000 });   // a person sets a £2,500 limit
  await o.sync();
  assert.deepEqual(S.policyOf(n), { minConfidence: 0.2, moneyLimit: 250000 });
  await o.nodes.owner.put('policy', 'agents', { minConfidence: 200, moneyLimit: -1 });
  await o.sync();
  assert.deepEqual(S.policyOf(n), { minConfidence: 0.2, moneyLimit: 0 }, 'a limit that is not a whole number of pence is no limit');
  await o.nodes.owner.put('policy', 'agents', { minConfidence: 'high' });
  await o.sync();
  assert.deepEqual(S.policyOf(n), { minConfidence: 0.05, moneyLimit: 0 });
  assert.equal(S.isPaused(n, 'ops'), false);
  await o.nodes.owner.put('control', 'sales', { paused: true });
  await o.sync();
  assert.equal(S.isPaused(n, 'ops'), false);
  assert.equal(S.isPaused(n, 'sales'), true);
  await o.nodes.owner.put('control', 'sales', { paused: false, cleared: 'd0042', rebaseline: true });
  await o.nodes.owner.put('control', 'ops', { paused: false, cleared: 'd0007' });
  await o.nodes.owner.put('control', 'finance', { paused: false, cleared: '' });
  await o.sync();
  assert.equal(S.isPaused(n, 'sales'), false);
  assert.deepEqual(S.clearsOf(n), { ops: { at: 'd0007', rebaseline: false }, sales: { at: 'd0042', rebaseline: true } });
  for (const junk of [null, {}, 7]) { assert.deepEqual(S.policyOf(junk), { minConfidence: 0.05, moneyLimit: 0 }); assert.equal(S.isPaused(junk, 'ops'), false); assert.deepEqual(S.clearsOf(junk), {}); }
});

test('the books and the vault: an entry is posted and sequenced; a device without the whole scope refuses; the witness co-signs only a log that audits', async () => {
  const o = await office({ agents: ['finance', 'ops'], extra: ['clerk'] });
  await o.nodes.owner.grant('clerk-1', o.k.clerk.pub, 'staff', ['journal', 'vault_head']);
  await o.sync();
  const f = o.nodes.finance;
  const entry = { date: '2026-10-15', memo: 'Opening', lines: [['1200', 500, 0], ['3000', 0, 500]] };
  assert.deepEqual(await S.postEntry(f, { ...entry, lines: [['1200', 500, 0], ['3000', 0, 400]] }), { ok: false, reason: 'unbalanced' });
  const clerk = o.nodes.clerk, size = clerk.size();
  assert.deepEqual(await S.postEntry(clerk, entry), { ok: false, reason: 'not-authorised' }, 'journal and head, but not the vault: refused before anything is written');
  assert.equal(clerk.size(), size);
  assert.deepEqual(await S.postEntry(o.nodes.ops, entry), { ok: false, reason: 'not-authorised' });
  assert.deepEqual(await S.postEntry(f, entry), { ok: true });
  assert.deepEqual(await S.postEntry(f, { ...entry, memo: 'Second' }), { ok: true });
  const v = S.vaultState(f);
  assert.equal(v.a.ok, true);
  assert.equal(v.a.size, 2);
  assert.deepEqual(v.recs.map((r) => r.index), [0, 1]);
  assert.deepEqual(v.heads.map((h) => h.size).sort(), [1, 2]);
  assert.deepEqual(f.list('journal').map((j) => j.memo).sort(), ['Opening', 'Second']);
  assert.ok(f.list('vault_head').some((h) => h.id === 'h000002' && h.root === v.a.root));
  assert.deepEqual(S.vaultState(null), { recs: [], heads: [], cos: [], a: S.vaultState(o.nodes.hub).a });
  // a head that does not match its leaves: the witness refuses to co-sign it
  await o.sync();
  await o.nodes.owner.put('vault_head', 'h000002', { root: 'ab'.repeat(32) });
  await o.sync();
  assert.equal(S.vaultState(f).a.ok, false);
  assert.deepEqual(await S.witnessHead(f), { ok: false, reason: 'log does not audit' });
  assert.deepEqual(await S.witnessHead(o.nodes.hub), { ok: false, reason: 'log does not audit' }, 'an empty log has no head');
  for (const junk of [null, {}, 'x']) {
    assert.deepEqual(await S.postEntry(junk, entry), { ok: false, reason: 'fault' });
    assert.equal((await S.witnessHead(junk)).ok, false);
    assert.equal((await S.witnessVault(junk)).ok, false);
  }
});

test('applyEffect: a record, a journal posting (date given or computed), or a refusal — exactly', async () => {
  const o = await office({ agents: ['finance'] });
  const f = o.nodes.finance;
  const r1 = await S.applyEffect(f, { c: 'payments', f: { customer: 'C1', amount: 5, status: 'held', by: 'x' } }, '2026-10-15');
  assert.equal(r1.ok, true);
  const p = f.list('payments')[0];
  assert.match(p.id, /^pa\d{8}-/);
  assert.equal(p.status, 'held');
  assert.deepEqual(await S.applyEffect(f, { post: { memo: 'Sale', lines: [['1200', 600, 0], ['4000', 0, 600]] } }, '2026-10-15'), { ok: true });
  assert.deepEqual(await S.applyEffect(f, { post: { memo: 'Sale 2', lines: [['1200', 700, 0], ['4000', 0, 700]] } }, () => '2026-10-16'), { ok: true });
  assert.deepEqual(f.list('journal').map((j) => j.date).sort(), ['2026-10-15', '2026-10-16']);
  assert.deepEqual(await S.applyEffect(f, { post: { memo: 'Sale 3', lines: [['1200', 1, 0], ['4000', 0, 1]] } }, () => 'not a date'), { ok: false, reason: 'date' });
  assert.deepEqual(await S.applyEffect(f, {}, 'x'), { ok: false });
  assert.deepEqual(await S.applyEffect(f, { c: 'payments' }, 'x'), { ok: false });
  assert.deepEqual(await S.applyEffect(f, { f: { a: 1 } }, 'x'), { ok: false });
  assert.deepEqual(await S.applyEffect(f, null, 'x'), { ok: false });
  assert.deepEqual(await S.applyEffect(f, { c: 'payments', f: { bad: undefined } }, 'x'), { ok: false, reason: 'fault' });
  assert.deepEqual(await S.applyEffect(null, { c: 'payments', f: { a: 1 } }, 'x'), { ok: false, reason: 'fault' });
});

test('finishWork: a hand-off travels only if it fits a record (1,900 characters, not one more); what the grant lacks goes to the job’s owner', async () => {
  const o = await office({ agents: ['ops'], cols: { ops: ['decisions', 'inbox', 'handoff', 'watch', 'msg'] } });
  const n = o.nodes.ops;
  const yes = pick('shopper', (f) => { const a = answer({ shopper: FACTORY.shopper }, f); return a.verdict === 'VERIFIED' && a.label === 1 && a.confidence >= 0.05; });
  const features = caseOf('shopper', yes);
  const own = answer({ shopper: FACTORY.shopper }, features);
  const ctx = (extra = {}) => ({ node: n, id: 'ops', work: S.createWork(), asks: {}, clock: () => 0, deadline: 0, library: () => ({}), screen: () => ({ ok: true }), peers: () => [],
    cols: () => ['decisions', 'inbox', 'handoff', 'watch', 'msg'], policy: () => ({ minConfidence: 0.05 }), effect: (x, e) => S.applyEffect(x, e, '2026-10-15'), modelAsk: null, ...extra });
  const finish = (id, customer) => S.finishWork(ctx(), { id, domain: 'shopper', features, customer, amount: 100, text: '' }, { scr: null, own });
  const d = await finish('e000001', 'X');
  assert.equal(d.action, 'fast-track', 'with no afterDecision, the decision itself comes back');
  const h = n.list('handoff').find((x) => x.event === 'e000001');
  assert.equal(h.to, 'sales', 'the CRM is the Sales agent’s: handed to it');
  const base = h.payload.length - 1;
  await finish('e000002', 'X'.repeat(1900 - base));
  await finish('e000003', 'X'.repeat(1901 - base));
  assert.equal(n.list('handoff').find((x) => x.event === 'e000002').payload.length, 1900);
  assert.equal(n.list('handoff').filter((x) => x.event === 'e000003').length, 0, 'one character over: not handed off');
  for (const id of ['e000001', 'e000002', 'e000003']) assert.equal(rec(n, 'inbox', id).status, 'done');
  // a quarantine the grant cannot write: handed to the owner of the work's own job (the brains named none)
  const ev = { id: 'e000004', domain: 'fraud', features: {}, customer: 'C4', amount: 1, text: HOSTILE_TEXT[0] };
  const { openStep } = await import('../src/company.mjs');
  await S.finishWork(ctx({ cols: () => ['decisions', 'inbox', 'handoff'] }), ev, openStep({ agentId: 'ops', event: ev, library: {} }));
  const hq = n.list('handoff').find((x) => x.event === 'e000004');
  assert.equal(hq.to, 'finance');
  assert.equal(JSON.parse(hq.payload).c, 'quarantine');
  // the model is asked only when there is nothing else; a model that throws is treated as no answer
  const ev5 = { id: 'e000005', domain: 'energy', features: {}, customer: 'C5', amount: 1, text: '' };
  const d5 = await S.finishWork(ctx({ modelAsk: async () => { throw new Error('model down'); } }), ev5, openStep({ agentId: 'ops', event: ev5, library: {} }));
  assert.equal(d5.by, 'none');
});

test('honourWork: hand-offs to this agent from a live sender are carried out; approved calls for it (or its job at the door) are executed — nothing else', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const W = o.nodes.owner;
  const pay = (customer) => JSON.stringify({ c: 'payments', f: { customer, amount: 10, status: 'released', by: 'Ops agent' } });
  const O = o.nodes.ops;   // a hand-off is written by its sender's own device
  await O.put('handoff', 'h1', { from: 'ops', to: 'finance', payload: pay('P1'), status: 'open', event: 'e1' });
  await W.put('handoff', 'h2', { from: 'stranger', to: 'finance', payload: pay('P2'), status: 'open', event: 'e2' });
  await O.put('handoff', 'h3', { from: 'ops', to: 'finance', payload: '{not json', status: 'open', event: 'e3' });
  await O.put('handoff', 'h4', { from: 'ops', to: 'ops', payload: pay('P4'), status: 'open', event: 'e4' });
  await O.put('handoff', 'h5', { from: 'ops', to: 'finance', payload: pay('P5'), status: 'done', event: 'e5' });
  const watch = (id, f) => W.put('watch', id, { event: 'e9', customer: 'C9', amount: 500, status: 'approved', ...f });
  await watch('w1', { agent: 'door', channel: 'fraud', action: 'hold-payment' });
  await watch('w2', { agent: 'ops', channel: 'fraud', action: 'hold-payment' });
  await watch('w3', { agent: 'finance', channel: 'credit', action: 'upfront-terms', status: 'open' });
  await watch('w4', { agent: 'finance', channel: 'credit', action: '' });
  await watch('w5', { agent: 'door', channel: 'churn', action: 'retain' });
  await watch('w6', { agent: 'finance', channel: 'shopper', action: 'fast-track', customer: 'C7', amount: 100 });
  await o.sync();
  const f = o.nodes.finance;
  const r = await S.honourWork({ node: f, id: 'finance', cols: agentCols('finance'), honoured: (from) => from === 'ops', effect: (n, e) => S.applyEffect(n, e, '2026-10-15') });
  assert.deepEqual(r, { ok: true });
  const st = (id) => rec(f, 'handoff', id);
  assert.deepEqual([st('h1').status, st('h2').status, st('h3').status, st('h4').status, st('h5').status], ['done', 'refused', 'refused', 'open', 'done']);
  assert.equal(st('h1').doneBy, 'finance');
  assert.deepEqual(f.list('payments').map((p) => p.customer + ':' + p.status).sort(), ['C9:held', 'P1:released']);
  const ws = (id) => rec(f, 'watch', id).status;
  assert.deepEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(ws), ['executed', 'approved', 'open', 'approved', 'approved', 'executed']);
  assert.equal(rec(f, 'watch', 'w1').executedBy, 'finance');
  const hs = f.list('handoff').filter((h) => h.event === 'e9');
  assert.equal(hs.length, 1, 'the CRM write it could not make went to the Sales agent');
  assert.equal(hs[0].to, 'sales');
  assert.equal(hs[0].from, 'finance');
  assert.deepEqual(await S.honourWork(null), { ok: false, reason: 'fault' });
});

test('oversee: the watch pauses an agent that acted off its own work, once; a policy can leave it to people; nothing else is paused', async () => {
  const o = await office({ agents: ['finance', 'ops'] });
  const F = o.nodes.finance;
  for (let i = 1; i <= 3; i++) {
    await F.put('decisions', 'd' + i, { agent: 'finance', event: 'e00000' + i, domain: 'fraud', action: 'quarantine', state: 'done', by: 'own', cross: true, second: '', conf: 900, receipt: '', why: 'x', customer: 'C', channel: 'fraud' });
  }
  await o.nodes.ops.put('decisions', 'd9', { agent: 'ops', event: 'e000009', domain: 'inventory', action: 'raise-po', state: 'done', by: 'own', cross: false, second: '', conf: 900, receipt: '', why: 'x', customer: 'C', channel: 'inventory' });
  await o.sync();
  const W = o.nodes.owner;
  assert.deepEqual(await S.oversee({ node: W, agents: ['finance', 'ops'], policy: { auto: false } }), []);
  assert.deepEqual(await S.oversee({ node: W, agents: ['ops'] }), []);
  const logs = [];
  assert.deepEqual(await S.oversee({ node: W, agents: ['finance', 'ops'], by: 'Night watch', log: (s) => logs.push(s) }), ['finance']);
  const c = rec(W, 'control', 'finance');
  assert.equal(c.paused, true);
  assert.equal(c.by, 'Night watch');
  assert.equal(c.watch, 'hijacked');
  assert.match(c.why, /off its own work/);
  assert.equal(c.flaggedAt, 'd3', 'the decision that tipped it: the third act off its work');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^AI overseer paused the Finance agent — the watch read it as hijacked/);
  assert.deepEqual(await S.oversee({ node: W, agents: ['finance', 'ops'] }), [], 'already paused: not again');
  assert.deepEqual(await S.oversee({ node: W, agents: ['finance'], paused: () => false }), ['finance'], 'by the caller’s own view of who is paused');
  // a clearance: judged afresh from there
  await W.put('control', 'finance', { paused: false, cleared: 'd3' });
  assert.deepEqual(await S.oversee({ node: W, agents: ['finance'] }), []);
  assert.deepEqual(await S.oversee(null), []);
});

test('learnBrain: the job’s own agent’s published brain is preferred, re-verified on this device’s rows, recorded either way', async () => {
  const o = await office({ agents: ['finance', 'ops', 'audit'] });
  await stock(o, 'audit', { ...AG('audit'), grows: ['fraud'] });
  await o.sync();
  assert.equal(await S.learnBrain({ node: o.nodes.ops, me: 'ops', domain: 'credit', rows: rows('credit') }), null, 'nothing published for credit');
  const onlyAudit = await S.learnBrain({ node: o.nodes.ops, me: 'ops', domain: 'fraud', rows: rows('fraud') });
  assert.equal(onlyAudit.rec.by, 'audit');
  await stock(o, 'finance');
  await o.sync();
  const r = await S.learnBrain({ node: o.nodes.ops, me: 'ops', domain: 'fraud', rows: () => rows('fraud') });
  assert.equal(r.rec.by, 'finance', 'the fraud job is Finance’s: its brain first');
  assert.equal(r.v.adopt, true);
  assert.equal(o.nodes.ops.list('adopt').filter((a) => a.source === 'learned').pop().patternId, FACTORY.fraud.patternId);
  assert.equal(r.pattern.patternId, FACTORY.fraud.patternId);
  const few = await S.learnBrain({ node: o.nodes.ops, me: 'ops', domain: 'fraud', rows: rows('fraud').slice(0, 10) });
  assert.equal(few.v.adopt, false);
  const ad = o.nodes.ops.list('adopt').filter((a) => a.by === 'ops' && a.source === 'learned');
  assert.equal(ad.length, 3);
  assert.deepEqual(ad.map((a) => a.adopted + ':' + a.from).sort(), ['false:finance', 'true:audit', 'true:finance']);
  assert.ok(ad.every((a) => a.domain === 'fraud' && Number.isSafeInteger(a.localAuc)));
  // its own published brain is never "learned" from itself
  assert.equal((await S.learnBrain({ node: o.nodes.audit, me: 'audit', domain: 'fraud', rows: rows('fraud') })).rec.by, 'finance');
  assert.equal(await S.learnBrain(null), null);
});

test('stockBrains: a shipped brain that does not re-verify here is refused and said; a grown brain that fails its gate is cut', async () => {
  const o = await office({ agents: ['finance', 'audit'] });
  const logs = [];
  const r = await S.stockBrains({ node: o.nodes.finance, agent: AG('finance'), factory: FACTORY, features: FEATURES, titles: TITLES,
    rows: (d) => (d === 'credit' ? rows('credit').slice(0, 20) : rows(d)), log: (s) => logs.push(s) });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.lib), ['fraud']);
  assert.equal(r.src.fraud.source, 'factory file');
  assert.equal(r.src.fraud.n, rows('fraud').length);
  assert.deepEqual(logs, ['Finance agent REFUSED its own credit brain file — it did not re-verify here (not enough local data to verify)']);
  const ad = o.nodes.finance.list('adopt');
  assert.deepEqual(ad.map((a) => a.domain + ':' + a.adopted + ':' + a.source).sort(), ['credit:false:factory', 'fraud:true:factory']);
  assert.deepEqual(o.nodes.finance.list('brain').map((b) => b.id), ['fraud.finance']);
  const glog = [];
  const g = await S.stockBrains({ node: o.nodes.audit, agent: { ...AG('audit'), grows: ['fraud', 'credit'] }, factory: FACTORY, features: FEATURES, titles: TITLES,
    rows: (d, n) => (d === 'credit' ? rows('credit').slice(0, 30) : rows(d).slice(0, n)), log: (s) => glog.push(s) });
  assert.deepEqual(Object.keys(g.lib), ['fraud']);
  assert.equal(g.src.fraud.source, 'grown here');
  assert.equal(g.lib.fraud.title, TITLES.fraud + ' (grown by Audit)');
  assert.equal(g.lib.fraud.role, 'audit');
  assert.equal(glog.length, 2);
  assert.match(glog[0], /^Audit agent grew its own fraud brain on \d+ of its own cases — held-out AUC 0\.\d{3}$/);
  assert.equal(glog[1], 'Audit agent grew a credit brain but it failed its held-out gate — CUT');
  const pub = o.nodes.audit.list('brain').find((b) => b.id === 'fraud.audit');
  assert.equal(pub.source, 'grown');
  assert.equal(pub.title, TITLES.fraud + ' (grown by Audit)');
  // the default seed is the device's own (seedFor): the same device grows the same brain again
  const again = await S.stockBrains({ node: o.nodes.audit, agent: { ...AG('audit'), grows: ['fraud'] }, factory: FACTORY, features: FEATURES, titles: TITLES, rows: (d) => rows(d) });
  const twice = await S.stockBrains({ node: o.nodes.audit, agent: { ...AG('audit'), grows: ['fraud'] }, factory: FACTORY, features: FEATURES, titles: TITLES, rows: (d) => rows(d), seed: S.seedFor });
  assert.equal(again.lib.fraud.patternId, twice.lib.fraud.patternId);
  assert.deepEqual(await S.stockBrains(null), { ok: false, lib: {}, src: {} });
});

test('agentRoster: the live agent grants a device can see, and only those', async () => {
  const o = await office({ agents: ['ops'], extra: ['a2', 'a3', 'a4', 'a5'] });
  const W = o.nodes.owner;
  await W.grant('agent-finance.2', o.k.a2.pub, 'agent', ['inbox']);
  await W.grant('agent-sales', o.k.a3.pub, 'agent', ['inbox']);
  await W.grant('agent-Bad', o.k.a4.pub, 'agent', ['inbox']);
  await W.grant('hub-x', o.k.a5.pub, 'agent', ['inbox']);
  await W.grant('agent-service', o.k.a5.pub, 'staff', ['inbox']);
  await W.revoke('agent-sales', 0);
  await o.sync();
  assert.deepEqual(S.agentRoster(o.nodes.ops).map((g) => [g.agent, g.grant, g.pub === o.k[g.agent === 'ops' ? 'ops' : 'a2'].pub]),
    [['finance', 'agent-finance.2', true], ['ops', 'agent-ops', true]]);
  assert.deepEqual(S.agentRoster(o.nodes.ops)[1].cols, agentCols('ops'));
  assert.deepEqual(S.agentRoster(null), []);
});

// ── WIRING ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('companyMark: the same company on every device that holds the same writes — wiring records aside', async () => {
  const o = await office({ agents: ['ops'] });
  const W = o.nodes.owner, H = o.nodes.hub;
  const m0 = S.companyMark(W);
  assert.match(m0, /^[0-9a-f]{16}$/);
  assert.equal(S.companyMark(H), m0);
  await W.put('wire', 'note', { kind: 'note' });
  assert.equal(S.companyMark(W), m0, 'a wiring record does not change the company');
  await W.put('tasks', 't1', { title: 'ship it' });
  const m1 = S.companyMark(W);
  assert.notEqual(m1, m0);
  assert.equal(S.companyMark(H), m0, 'the hub has not synced yet');
  await o.sync();
  assert.equal(S.companyMark(H), m1);
  assert.equal(S.companyMark(null), '');
  assert.equal(S.companyMark({ view: () => ({ state: { cols: { x: { bad: 1n } }, docs: {} } }) }), '');
});

test('checkIn: a device says what it is and which company it holds — only when something changed, only with a grant to', async () => {
  const o = await office({ agents: ['ops'], extra: ['clerk'] });
  await o.nodes.owner.grant('staff-clerk', o.k.clerk.pub, 'staff', ['tasks']);
  await o.sync();
  assert.deepEqual(await S.checkIn(o.nodes.clerk, { role: 'staff' }), { ok: false, reason: 'not-authorised' });
  const H = o.nodes.hub;
  const a = await S.checkIn(H, { role: 'hub', name: 'Back office PC', at: '2026-10-15T10:00:00.000Z' });
  assert.deepEqual(a, { ok: true, wrote: true, mark: S.companyMark(H), reason: undefined });
  const r = rec(H, 'wire', 'dev-' + o.k.hub.pub.slice(0, 16));
  assert.deepEqual({ ...r }, { id: 'dev-' + o.k.hub.pub.slice(0, 16), kind: 'device', role: 'hub', agent: '', name: 'Back office PC', mark: a.mark, at: '2026-10-15T10:00:00.000Z' });
  const n = H.size();
  assert.deepEqual(await S.checkIn(H, { role: 'hub', name: 'Back office PC', at: 'later' }), { ok: true, wrote: false, mark: a.mark });
  assert.equal(H.size(), n, 'nothing changed: nothing written');
  assert.equal((await S.checkIn(H, { role: 'hub', name: 'Front office PC' })).wrote, true);
  assert.equal((await S.checkIn(H, { role: 'hub', name: 'Front office PC', agent: 'ops' })).wrote, true);
  await o.nodes.owner.put('tasks', 't', { title: 'x' });
  await o.sync();
  const b = await S.checkIn(H, { role: 'hub', name: 'Front office PC', agent: 'ops' });
  assert.equal(b.wrote, true, 'its company changed: it says so');
  assert.notEqual(b.mark, a.mark);
  const long = await S.checkIn(H, { role: 'h'.repeat(40), agent: 'a'.repeat(60), name: 'n'.repeat(80), at: 't'.repeat(80) });
  const lr = rec(H, 'wire', 'dev-' + o.k.hub.pub.slice(0, 16));
  assert.equal(long.wrote, true);
  assert.deepEqual([lr.role.length, lr.agent.length, lr.name.length, lr.at.length], [16, 32, 40, 40]);
  assert.equal((await S.checkIn(H, { role: 7, agent: null })).wrote, true);
  assert.deepEqual([rec(H, 'wire', 'dev-' + o.k.hub.pub.slice(0, 16)).role, rec(H, 'wire', 'dev-' + o.k.hub.pub.slice(0, 16)).agent], ['', '']);
  assert.deepEqual(await S.checkIn(null, {}), { ok: false, reason: 'fault' });
  assert.equal((await S.checkIn(H)).ok, true);
});

test('wiringView: devices, check-ins only their own device wrote, the owner’s marks, and the work each agent’s own device did', async () => {
  const o = await office({ agents: ['finance', 'ops'], extra: ['clerk'] });
  const W = o.nodes.owner, H = o.nodes.hub, F = o.nodes.finance, P = o.nodes.ops, C = o.nodes.clerk;
  await W.grant('staff-clerk', o.k.clerk.pub, 'staff', S.STAFF_COLS);
  await W.grant('agent-sales', 'e'.repeat(64), 'agent', ['inbox']);
  await W.grant('agent-service', 'd'.repeat(64), 'staff', ['tasks']);   // a staff grant whose id merely looks like an agent's
  await W.revoke('agent-sales', 0);
  await o.sync();
  await S.checkIn(H, { role: 'hub' });
  const fm = (await S.checkIn(F, { role: 'agent', agent: 'finance', name: 'AI box · finance' })).mark;
  await S.checkIn(C, { role: 'staff', name: 'Front desk' });
  await C.put('wire', 'cards', { kind: 'cards', made: '2026-01-01' });                    // a staff device cannot mark the cards
  await C.put('wire', 'receipt-x', { kind: 'receipt', hash: 'h', at: 'a', devices: 9, mark: 'm' });
  await F.put('decisions', 'd1', { agent: 'finance', event: 'e000001' });
  await F.put('decisions', 'd2', { agent: 'finance', event: 'e000002' });
  await P.put('decisions', 'd3', { agent: 'finance', event: 'e000003' });                  // Ops claiming to be Finance: not counted
  await F.put('reply', 'r1', { by: 'finance', ask: 'q1', verdict: 'VERIFIED' });
  await F.put('reply', 'r2', { by: 'finance', ask: 'q2', verdict: 'ABSTAIN' });
  await P.put('reply', 'r3', { by: 'finance', ask: 'q3', verdict: 'VERIFIED' });
  await P.put('reply', 'r4', { by: 'ops', ask: 'q4', verdict: 'VERIFIED' });
  await o.sync();
  let v = S.wiringView(W);
  assert.equal(v.ok, true);
  assert.equal(v.genesis, o.G);
  assert.equal(v.me, o.G);
  assert.equal(v.owner, true);
  assert.equal(S.wiringView(H).owner, false);
  assert.deepEqual(v.devices.map((d) => [d.role, d.agent, d.pub === o.k[d.agent || (d.role === 'hub' ? 'hub' : 'clerk')].pub]),
    [['agent', 'finance', true], ['agent', 'ops', true], ['staff', '', false], ['hub', '', true], ['staff', '', true]], 'the revoked grant is gone; a staff grant names no agent');
  assert.deepEqual(v.grants, ['agent-finance', 'agent-ops', 'agent-sales', 'agent-service', 'hub-door', 'staff-clerk']);
  assert.deepEqual(Object.keys(v.checkins).sort(), [o.k.hub.pub, o.k.finance.pub, o.k.clerk.pub].sort());
  assert.deepEqual(v.checkins[o.k.finance.pub], { role: 'agent', agent: 'finance', name: 'AI box · finance', mark: fm, at: '' }, 'the company it held when it checked in');
  assert.equal(v.cards, false);
  assert.deepEqual(v.receipts, []);
  assert.deepEqual(v.decided, { finance: 2 });
  assert.deepEqual(v.replied, { finance: 1, ops: 1 });
  assert.equal(v.mark, S.companyMark(W));
  // the owner marks the cards; its own receipt record counts
  await W.put('wire', 'cards', { kind: 'cards', made: '2026-10-15' });
  await W.put('wire', 'receipt-abc', { kind: 'receipt', hash: 'ab'.repeat(32), at: '2026-10-15T12:00:00.000Z', devices: 4, mark: 'm1', sig: 's', same: 4 });
  v = S.wiringView(W);
  assert.equal(v.cards, true);
  assert.equal(v.cardsMade, '2026-10-15');
  assert.deepEqual(v.receipts, [{ id: 'receipt-abc', hash: 'ab'.repeat(32), at: '2026-10-15T12:00:00.000Z', devices: 4, mark: 'm1' }]);
  // a device writing over another device's check-in: that check-in no longer counts — until its own device writes again
  await P.put('wire', 'dev-' + o.k.hub.pub.slice(0, 16), { kind: 'device', role: 'hub', mark: 'forged' });
  await o.sync();
  assert.equal(S.wiringView(W).checkins[o.k.hub.pub], undefined);
  assert.equal((await S.checkIn(H, { role: 'hub' })).wrote, true);
  await o.sync();
  assert.equal(S.wiringView(W).checkins[o.k.hub.pub].mark, S.companyMark(H));
  // a record at its own id that is not a check-in is not one
  await C.put('wire', 'dev-' + o.k.clerk.pub.slice(0, 16), { kind: 'note' });
  await o.sync();
  assert.equal(S.wiringView(W).checkins[o.k.clerk.pub], undefined);
  await C.put('wire', 'dev-', { kind: 'device', role: 'staff', name: 'x' });
  await o.sync();
  await P.put('wire', 'dev-', { kind: 'device', role: 'agent' });   // over two of its three fields: the record is contested
  await o.sync();
  assert.ok(!Object.keys(S.wiringView(W).checkins).includes(''));
  // wireRecords names the writer of each
  const wr = S.wireRecords(W);
  assert.equal(wr.find((r) => r.id === 'cards').writer, o.G);
  assert.equal(wr.find((r) => r.id === 'dev-').writer, '');
  assert.deepEqual(S.wireRecords(null), []);
  const bad = S.wiringView(null);
  assert.equal(bad.ok, false);
  assert.deepEqual([bad.devices, bad.checkins, bad.receipts, bad.mark], [[], {}, [], '']);
});

test('grantFor: the exact grant each role needs, refused when it cannot be right', () => {
  const G = 'a'.repeat(64), K = 'b'.repeat(64), K2 = 'c'.repeat(64);
  const view = { genesis: G, owner: true, devices: [{ pub: K2, role: 'agent', agent: 'ops', grant: 'agent-ops' }, { pub: K2, role: 'staff', agent: '', grant: 'staff-cccccccc' }],
    grants: ['agent-ops', 'agent-finance', 'agent-finance.2', 'staff-cccccccc', 'hub-bbbbbbbb'] };
  assert.deepEqual(S.grantFor(view, { role: 'agent', agent: 'finance', pub: K }), { ok: true, id: 'agent-finance.3', to: K, role: 'agent', cols: [...AG('finance').cols, 'wire', 'model'] });
  assert.deepEqual(S.grantFor(view, { role: 'agent', agent: 'sales', pub: K }), { ok: true, id: 'agent-sales', to: K, role: 'agent', cols: [...AG('sales').cols, 'wire', 'model'] });
  assert.deepEqual(S.grantFor(view, { role: 'agent', agent: 'ops', pub: K }).id, 'agent-ops.2');
  assert.deepEqual(S.grantFor(view, { role: 'hub', pub: K }), { ok: true, id: 'hub-bbbbbbbb.2', to: K, role: 'hub', cols: ['inbox', 'msg', 'model', 'wire'] });
  assert.deepEqual(S.grantFor(view, { role: 'staff', pub: K }), { ok: true, id: 'staff-bbbbbbbb', to: K, role: 'staff', cols: ['tasks', 'msg', 'docs', 'crm', 'wire'] });
  assert.deepEqual(S.grantFor(view, { role: 'admin', pub: K }), { ok: true, id: 'admin-bbbbbbbb', to: K, role: 'admin', cols: ['*'] });
  assert.deepEqual(S.grantFor({ ...view, owner: false }, { role: 'admin', pub: K }), { ok: false, reason: 'only-the-owner' });
  assert.equal(S.grantFor({ ...view, owner: false }, { role: 'staff', pub: K }).ok, true, 'an admin may grant staff');
  assert.deepEqual(S.grantFor(view, { role: 'agent', agent: 'ops', pub: K2 }), { ok: false, reason: 'already' });
  assert.deepEqual(S.grantFor(view, { role: 'staff', pub: K2 }), { ok: false, reason: 'already' });
  assert.equal(S.grantFor(view, { role: 'agent', agent: 'finance', pub: K2 }).ok, true, 'the same device may run another agent');
  assert.equal(S.grantFor(view, { role: 'hub', pub: K2 }).ok, true);
  assert.deepEqual(S.grantFor(view, { role: 'agent', agent: 'nobody', pub: K }), { ok: false, reason: 'agent' });
  assert.deepEqual(S.grantFor(view, { role: 'agent', pub: K }), { ok: false, reason: 'agent' });
  assert.deepEqual(S.grantFor(view, { role: 'boss', pub: K }), { ok: false, reason: 'role' });
  assert.deepEqual(S.grantFor(view, { role: 'staff', pub: G }), { ok: false, reason: 'owner' });
  for (const pub of ['B'.repeat(64), 'b'.repeat(63), '', null]) assert.deepEqual(S.grantFor(view, { role: 'staff', pub }), { ok: false, reason: 'key' });
  assert.deepEqual(S.grantFor(null, { role: 'staff', pub: K }), { ok: false, reason: 'fault' });
  assert.deepEqual(S.grantFor(view, null), { ok: false, reason: 'fault' });
});

test('testWork: one real held-out case per working agent, addressed to it, shaped exactly as the door writes work', () => {
  const pools = { fraud: HALF.fraud.door, inventory: HALF.inventory.door };
  const w = S.testWork({ agents: ['finance', 'audit', 'ops', 'nobody', 'service'], pools, seed: 3, base: 100000000 });
  assert.deepEqual(w.map((x) => [x.id, x.f.to, x.f.channel]), [['e100000000', 'finance', 'fraud'], ['e100000001', 'ops', 'inventory']]);
  for (const x of w) {
    assert.deepEqual(Object.keys(x.f).sort(), ['amount', 'channel', 'customer', 'features', 'status', 'text', 'ticks', 'to']);
    assert.equal(x.f.status, 'open');
    assert.equal(x.f.ticks, 0);
    const f = JSON.parse(x.f.features);
    const rows = pools[x.f.channel].map(({ y, ...r }) => JSON.stringify(r));
    assert.ok(rows.includes(JSON.stringify(f)), 'a real row from the held-out half');
    assert.ok(Number.isSafeInteger(x.f.amount));
  }
  assert.deepEqual(S.testWork({ agents: ['finance'], pools, seed: 3, base: 100000000 }), w.slice(0, 1), 'deterministic for a seed');
  assert.notDeepEqual(S.testWork({ agents: ['finance'], pools, seed: 4 }).map((x) => x.f.features), w.slice(0, 1).map((x) => x.f.features));
  assert.equal(S.testWork({ agents: ['ops'], pools, base: 7 })[0].id, 'e000007');
  assert.equal(S.testWork({ agents: ['ops'], pools })[0].id, 'e000000');
  const svc = S.testWork({ agents: ['service'], pools: { churn: HALF.churn.door } })[0];
  assert.equal(svc.f.channel, 'churn');
  assert.ok(svc.f.text.length > 10, 'a customer’s words travel with the case: ' + svc.f.text);
  assert.deepEqual(S.testWork(null), []);
  assert.deepEqual(S.testWork({ agents: ['finance'], pools: null }), []);
});

test('ollamaSteps: the exact commands, per system, for the origin this page is served from', () => {
  const o = 'https://sjgant80-hub.github.io';
  const cmds = (os, origin = o) => S.ollamaSteps(os, origin).steps.map((s) => s.cmd).filter(Boolean);
  assert.deepEqual(cmds('windows'), ['ollama pull qwen2.5:7b', 'setx OLLAMA_ORIGINS "https://sjgant80-hub.github.io"']);
  assert.deepEqual(cmds('mac'), ['ollama pull qwen2.5:7b', 'launchctl setenv OLLAMA_ORIGINS "https://sjgant80-hub.github.io"']);
  assert.deepEqual(cmds('linux'), ['curl -fsSL https://ollama.com/install.sh | sh', 'ollama pull qwen2.5:7b', 'sudo systemctl edit ollama.service',
    '[Service]\nEnvironment="OLLAMA_ORIGINS=https://sjgant80-hub.github.io"', 'sudo systemctl daemon-reload && sudo systemctl restart ollama']);
  const w = S.ollamaSteps('windows', o);
  assert.deepEqual([w.os, w.origin, w.local], ['windows', o, false]);
  assert.match(w.steps[0].say, /Windows from ollama\.com\/download/);
  assert.match(S.ollamaSteps('mac', o).steps[0].say, /macOS/);
  assert.match(S.ollamaSteps('mac', o).steps[3].say, /until the Mac restarts/);
  assert.match(w.steps[w.steps.length - 1].say, /Check for a local model/);
  assert.equal(w.steps.length, 5);
  // served from this machine: nothing to allow
  for (const local of ['http://localhost:8080', 'http://127.0.0.1:5173', 'http://localhost', '']) {
    const l = S.ollamaSteps('mac', local);
    assert.equal(l.local, true, local);
    assert.deepEqual(l.steps.map((s) => s.cmd).filter(Boolean), ['ollama pull qwen2.5:7b']);
    assert.match(l.steps[2].say, /nothing to allow/);
  }
  assert.equal(S.ollamaSteps('mac', 'https://localhost.evil.com').local, false);
  assert.equal(S.ollamaSteps('mac', 'https://a.example:8443').origin, 'https://a.example:8443');
  // nothing that is not a plain origin ever reaches a command line
  for (const bad of ['https://x.com"; rm -rf /', 'https://x.com/path', 'javascript:alert(1)', 'https://x .com', 7, null]) {
    const b = S.ollamaSteps('linux', bad);
    assert.equal(b.origin, '', String(bad));
    assert.ok(b.steps.every((s) => !s.cmd.includes('rm -rf') && !s.cmd.includes('javascript')));
  }
  assert.equal(S.ollamaSteps('beos', o).os, 'windows');
  assert.equal(S.ollamaSteps(undefined, o).os, 'windows');
});

test('planOf: how many people and which agents — junk means the defaults', () => {
  const all = AGENTS.map((a) => a.id);
  assert.deepEqual(S.planOf(undefined), { people: 1, agents: all });
  assert.deepEqual(S.planOf({ people: 0, agents: ['ops', 'bogus', 'finance'] }), { people: 0, agents: ['finance', 'ops'] });
  assert.deepEqual(S.planOf({ people: 64 }), { people: 64, agents: all });
  for (const people of [65, -1, 1.5, '3', null]) assert.equal(S.planOf({ people }).people, 1, String(people));
  assert.deepEqual(S.planOf({ agents: 'ops' }).agents, all);
  assert.deepEqual(S.planOf({ agents: [] }).agents, []);
});

const PK = (c) => c.repeat(64);
const G0 = PK('a'), P1 = PK('b'), H1 = PK('c'), F1 = PK('d'), A1 = PK('e');
const baseView = () => ({ ok: true, genesis: G0, me: G0, owner: true, devices: [], grants: [], checkins: {}, cards: false, cardsMade: '', receipts: [], decided: {}, replied: {}, mark: 'm0' });
const probes = (extra = {}) => ({ plan: { people: 1, agents: ['finance', 'audit'] }, pending: 0, model: null, os: 'windows', origin: 'https://example.org', link: 'https://example.org/#join=' + G0, ...extra });
const statuses = (c) => Object.fromEntries(c.steps.map((s) => [s.id, s.status]));
const step = (c, id) => c.steps.find((s) => s.id === id);

test('wiringChecklist: a company just founded — the order, the statuses, the next step and the minutes', () => {
  const c = S.wiringChecklist({ view: baseView(), probes: probes() });
  assert.equal(c.ok, true);
  assert.deepEqual(c.steps.map((s) => s.id), ['found', 'cards', 'invite', 'roles', 'hub', 'agents', 'machines', 'model', 'proof', 'same', 'receipt']);
  assert.deepEqual(c.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(statuses(c), { found: 'done', cards: 'todo', invite: 'todo', roles: 'todo', hub: 'todo', agents: 'todo', machines: 'todo', model: 'optional', proof: 'todo', same: 'waiting', receipt: 'todo' });
  assert.deepEqual(c.steps.map((s) => s.minutes), [3, 5, 2, 1, 10, 12, 3, 20, 3, 2, 2]);
  assert.deepEqual(c.steps.filter((s) => s.optional).map((s) => s.id), ['model']);
  assert.deepEqual([c.next, c.complete, c.done, c.required, c.minutesLeft, c.minutesTotal], ['cards', false, 1, 10, 40, 43]);
  for (const s of c.steps) {
    assert.ok(s.title.length > 10 && s.say.length > 30 && s.who.length > 2, s.id);
    assert.ok(Array.isArray(s.how) && s.how.length >= 1 && s.how.every((x) => typeof x === 'string' && x.length > 10), s.id);
    assert.ok(Array.isArray(s.detail) && s.detail.length >= 1, s.id);
  }
  assert.ok(step(c, 'invite').how.includes('Invite link: https://example.org/#join=' + G0));
  assert.deepEqual(step(c, 'invite').detail, ['0 of 1 planned people’s devices have reached the company.']);
  assert.deepEqual(step(c, 'cards').detail, ['Not marked printed yet. If the cards were printed before this step existed, the owner presses “The cards are printed and stored” in Wire it.']);
  assert.ok(step(c, 'model').how.some((x) => x.includes('setx OLLAMA_ORIGINS "https://example.org"')));
  assert.deepEqual(step(c, 'model').detail, ['No local model checked on this machine.']);
  assert.deepEqual(step(c, 'agents').detail, ['Finance agent: not granted yet', 'Audit agent: not granted yet']);
  assert.deepEqual(step(c, 'machines').detail, ['No other device is granted yet.']);
  assert.deepEqual(step(c, 'proof').detail, ['Finance agent: nothing decided yet', 'Audit agent: no second opinion given yet']);
  assert.deepEqual(step(c, 'receipt').detail, ['No receipt signed yet.']);
  assert.deepEqual(step(c, 'hub').detail, ['No hub granted yet.']);
  assert.equal(step(c, 'found').detail[0], 'Company ' + G0.slice(0, 8) + ' is founded.');
  assert.equal(step(c, 'same').say.endsWith('every mark must match this one: m0.'), true);
  // no link given: no link line
  assert.ok(!S.wiringChecklist({ view: baseView(), probes: probes({ link: '' }) }).steps[2].how.some((x) => x.startsWith('Invite link')));
});

test('wiringChecklist: every step done — complete, nothing left, the receipt covers every device', () => {
  const v = { ...baseView(), cards: true, cardsMade: '2026-10-15',
    devices: [{ pub: P1, role: 'staff', agent: '' }, { pub: H1, role: 'hub', agent: '' }, { pub: F1, role: 'agent', agent: 'finance' }, { pub: A1, role: 'agent', agent: 'audit' }],
    checkins: Object.fromEntries([P1, H1, F1, A1].map((p) => [p, { mark: 'm0' }])), receipts: [{ hash: 'f'.repeat(64), at: '2026-10-15T12:00:00.000Z', devices: 4 }],
    decided: { finance: 2 }, replied: { audit: 1 } };
  const c = S.wiringChecklist({ view: v, probes: probes({ model: { ok: true, models: ['qwen2.5:7b', 'llama3.2'] } }) });
  assert.ok(c.steps.every((s) => s.status === 'done'), JSON.stringify(statuses(c)));
  assert.deepEqual([c.next, c.complete, c.done, c.required, c.minutesLeft, c.minutesTotal], [null, true, 10, 10, 0, 52]);
  assert.equal(step(c, 'machines').minutes, 12);
  assert.deepEqual(step(c, 'cards').detail, ['The owner marked the cards printed on 2026-10-15.']);
  assert.deepEqual(step(c, 'model').detail, ['A local model answers on this machine: qwen2.5:7b, llama3.2.']);
  assert.deepEqual(step(c, 'proof').detail, ['Finance agent: 2 decided on its own device', 'Audit agent: 1 second opinions given']);
  assert.deepEqual(step(c, 'same').detail, ['Every device that checked in shows m0.']);
  assert.deepEqual(step(c, 'machines').detail, ['Every granted device has checked in here.']);
  assert.deepEqual(step(c, 'hub').detail, ['Hub ' + H1.slice(0, 8) + ' is granted and has checked in.']);
  assert.deepEqual(step(c, 'agents').detail, ['Finance agent: granted and checked in', 'Audit agent: granted and checked in']);
  assert.deepEqual(step(c, 'roles').detail, ['1 of 1 people’s devices granted (0 admin).']);
  assert.match(step(c, 'receipt').detail[0], /^Last receipt ffffffffffffffff at 2026-10-15T12:00:00\.000Z covers 4 devices\.$/);
  // cards marked without a date
  assert.deepEqual(step(S.wiringChecklist({ view: { ...v, cardsMade: '' }, probes: probes() }), 'cards').detail, ['The owner marked the cards printed.']);
  // a fifth device granted since the receipt: sign again
  const more = { ...v, devices: [...v.devices, { pub: PK('f'), role: 'admin', agent: '' }], checkins: { ...v.checkins, [PK('f')]: { mark: 'm0' } } };
  const c2 = S.wiringChecklist({ view: more, probes: probes() });
  assert.equal(step(c2, 'receipt').status, 'todo');
  assert.equal(c2.next, 'receipt');
  assert.deepEqual(step(c2, 'roles').detail, ['2 of 1 people’s devices granted (1 admin).']);
  assert.equal(step(c2, 'model').status, 'optional');
  assert.equal(c2.done, 9);
  assert.equal(c2.minutesLeft, 2);
});

test('wiringChecklist: in between — waiting on a device, a pending key, a silent machine, a different company, a missing proof', () => {
  // a key that reached this device, not granted yet: invited, not yet given a role
  let c = S.wiringChecklist({ view: baseView(), probes: probes({ pending: 1 }) });
  assert.deepEqual([step(c, 'invite').status, step(c, 'roles').status], ['done', 'todo']);
  assert.deepEqual(step(c, 'invite').detail, ['1 of 1 planned people’s devices have reached the company (1 waiting for a grant).']);
  for (const junk of [-3, 1.5, '2', null]) assert.equal(step(S.wiringChecklist({ view: baseView(), probes: probes({ pending: junk }) }), 'invite').status, 'todo', String(junk));
  // the hub granted but not heard from
  const hubOnly = { ...baseView(), devices: [{ pub: H1, role: 'hub', agent: '' }] };
  c = S.wiringChecklist({ view: hubOnly, probes: probes() });
  assert.deepEqual([step(c, 'hub').status, step(c, 'machines').status], ['waiting', 'waiting']);
  assert.deepEqual(step(c, 'hub').detail, ['Hub ' + H1.slice(0, 8) + ' is granted but has not checked in — connect it (step 7).']);
  assert.deepEqual(step(c, 'machines').detail, ['Not heard from yet: ' + H1.slice(0, 8) + ' (hub).']);
  // agents: one heard, one granted only → waiting; one not granted → todo
  const ag = { ...baseView(), devices: [{ pub: F1, role: 'agent', agent: 'finance' }, { pub: A1, role: 'agent', agent: 'audit' }], checkins: { [F1]: { mark: 'm0' } } };
  c = S.wiringChecklist({ view: ag, probes: probes() });
  assert.equal(step(c, 'agents').status, 'waiting');
  assert.deepEqual(step(c, 'agents').detail, ['Finance agent: granted and checked in', 'Audit agent: granted, not checked in yet']);
  assert.deepEqual(step(c, 'machines').detail, ['Not heard from yet: ' + A1.slice(0, 8) + ' (Audit agent).']);
  c = S.wiringChecklist({ view: { ...ag, devices: ag.devices.slice(0, 1) }, probes: probes() });
  assert.equal(step(c, 'agents').status, 'todo');
  assert.equal(step(c, 'machines').status, 'done', 'every granted device is heard from');
  assert.equal(step(c, 'same').status, 'done');
  // the same company: one device holds a different one
  const two = { ...baseView(), devices: [{ pub: P1, role: 'staff', agent: '' }, { pub: H1, role: 'hub', agent: '' }], checkins: { [P1]: { mark: 'mX' }, [H1]: { mark: 'm0' }, [G0]: { mark: 'old' } } };
  c = S.wiringChecklist({ view: two, probes: probes() });
  assert.equal(step(c, 'same').status, 'waiting');
  assert.deepEqual(step(c, 'same').detail, ['Different company mark: ' + P1.slice(0, 8) + ' shows mX.'], 'this device’s own old check-in does not count against it');
  c = S.wiringChecklist({ view: { ...two, checkins: { [P1]: { mark: 'm0' } } }, probes: probes() });
  assert.equal(step(c, 'same').status, 'waiting', 'the hub has not checked in: not every device is known to match');
  c = S.wiringChecklist({ view: { ...baseView(), checkins: { [G0]: { mark: 'm0' } } }, probes: probes() });
  assert.equal(step(c, 'same').status, 'waiting', 'only this device: nothing to compare');
  // the proof: a working agent must decide on its own device; the Audit agent must give a second opinion — if planned
  const pv = (decided, replied, agents) => step(S.wiringChecklist({ view: { ...baseView(), decided, replied }, probes: probes({ plan: { people: 1, agents } }) }), 'proof').status;
  assert.equal(pv({ finance: 1 }, { audit: 1 }, ['finance', 'audit']), 'done');
  assert.equal(pv({ finance: 1 }, {}, ['finance', 'audit']), 'todo');
  assert.equal(pv({}, { audit: 1 }, ['finance', 'audit']), 'todo');
  assert.equal(pv({ finance: 1 }, {}, ['finance']), 'done');
  assert.equal(pv({ finance: 1, ops: 0 }, {}, ['finance', 'ops']), 'todo');
  assert.equal(pv({}, {}, ['audit']), 'todo');
  assert.equal(pv({}, { audit: 2 }, ['audit']), 'done');
  // nobody else to invite
  c = S.wiringChecklist({ view: baseView(), probes: probes({ plan: { people: 0, agents: [] } }) });
  assert.deepEqual([step(c, 'invite').status, step(c, 'roles').status, step(c, 'invite').minutes, step(c, 'agents').minutes, step(c, 'agents').status], ['done', 'done', 0, 0, 'done']);
  // junk plan → the defaults: one person, all six agents
  c = S.wiringChecklist({ view: baseView(), probes: { plan: 'x' } });
  assert.equal(step(c, 'agents').minutes, 36);
  assert.equal(step(c, 'invite').minutes, 2);
  c = S.wiringChecklist({ view: baseView() });
  assert.equal(c.ok, true);
  assert.equal(step(c, 'agents').detail.length, 6);
});

test('wiringChecklist: no company on this device yet, or junk, is refused, never thrown', () => {
  for (const input of [undefined, null, {}, { view: null }, { view: { ok: false } }, 7]) {
    const c = S.wiringChecklist(input);
    assert.deepEqual(c, { ok: false, reason: 'no company on this device yet', steps: [], next: 'found', complete: false, done: 0, required: 0, minutesLeft: 0, minutesTotal: 0 });
  }
  const c = S.wiringChecklist({ view: { ok: true } });
  assert.deepEqual(c, { ok: false, reason: 'the checklist could not read this view', steps: [], next: null, complete: false, done: 0, required: 0, minutesLeft: 0, minutesTotal: 0 });
});

test('wiringReceipt: signed by the owner device, checkable by anyone with the receipt alone — and every change is caught', async () => {
  const o = await office({ agents: ['finance'] });
  await S.checkIn(o.nodes.hub, { role: 'hub' });
  await S.checkIn(o.nodes.finance, { role: 'agent', agent: 'finance' });
  await o.sync();
  const view = S.wiringView(o.nodes.owner);
  const checklist = S.wiringChecklist({ view, probes: probes() });
  const at = '2026-10-15T12:00:00.000Z';
  const r = await S.wiringReceipt({ view, checklist, keys: o.k.owner, at });
  assert.equal(r.ok, true);
  const { hash, sig, ...body } = r.receipt;
  assert.equal(body.model, 'sovereign-enterprise/wiring/1');
  assert.equal(body.company, o.G);
  assert.equal(body.by, o.G);
  assert.equal(body.at, at);
  assert.equal(body.mark, S.companyMark(o.nodes.owner));
  assert.equal(hash, sha(canonical(body)), 'the hash is of exactly the body');
  assert.equal(await verify(o.G, sig, utf8(canonical(body))), true, 'the owner key signed exactly the body');
  assert.deepEqual(body.devices.map((d) => [d.role, d.agent, d.heard, d.same]).sort(), [['agent', 'finance', true, true], ['hub', '', true, true]]);
  assert.deepEqual(body.steps, checklist.steps.map((s) => ({ id: s.id, status: s.status })));
  assert.deepEqual(await S.verifyWiringReceipt(r.receipt), { ok: true, company: o.G, at, devices: 2, same: 2 });
  // the same view in another order: the same receipt
  const flipped = await S.wiringReceipt({ view: { ...view, devices: [...view.devices].reverse() }, checklist, keys: o.k.owner, at });
  assert.equal(flipped.receipt.hash, hash);
  // a key-store device signs too (sign(bytes) → bytes), and the result is the same Ed25519 signature
  const store = { pub: o.k.owner.pub, sign: async (b) => new Uint8Array(await webcrypto.subtle.sign('Ed25519', o.k.owner.priv, b)) };
  const r2 = await S.wiringReceipt({ view, checklist, keys: store, at });
  assert.equal(r2.receipt.sig, sig);
  // without a checklist: no steps; a device that has not checked in is listed as not heard
  const noHub = { ...view, checkins: { [o.k.finance.pub]: view.checkins[o.k.finance.pub] } };
  const r3 = await S.wiringReceipt({ view: noHub, keys: o.k.owner, at });
  assert.deepEqual(r3.receipt.steps, []);
  assert.deepEqual(r3.receipt.devices.find((d) => d.role === 'hub'), { agent: '', heard: false, mark: '', pub: o.k.hub.pub, role: 'hub', same: false });
  const diff = { ...view, checkins: { ...view.checkins, [o.k.hub.pub]: { ...view.checkins[o.k.hub.pub], mark: 'elsewhere' } } };
  assert.deepEqual((await S.wiringReceipt({ view: diff, keys: o.k.owner, at })).receipt.devices.find((d) => d.role === 'hub'), { agent: '', heard: true, mark: 'elsewhere', pub: o.k.hub.pub, role: 'hub', same: false });
  // refusals
  assert.deepEqual(await S.wiringReceipt({ view, keys: o.k.finance, at }), { ok: false, reason: 'not-owner' });
  assert.deepEqual(await S.wiringReceipt({ view, keys: null, at }), { ok: false, reason: 'not-owner' });
  for (const bad of ['2026-10-15', '2026-10-15 12:00:00Z', 7, null]) assert.deepEqual(await S.wiringReceipt({ view, keys: o.k.owner, at: bad }), { ok: false, reason: 'at' });
  assert.equal((await S.wiringReceipt({ view, keys: o.k.owner, at: '2026-10-15T12:00:00Z' })).ok, true);
  assert.deepEqual(await S.wiringReceipt({ view: { ok: false }, keys: o.k.owner, at }), { ok: false, reason: 'view' });
  assert.deepEqual(await S.wiringReceipt(null), { ok: false, reason: 'fault' });
  assert.deepEqual(await S.wiringReceipt({ view, keys: { pub: o.G, sign: async () => { throw new Error('no'); } }, at }), { ok: false, reason: 'fault' });
  // tampering: every change is caught
  const t = (f) => { const x = JSON.parse(JSON.stringify(r.receipt)); f(x); return S.verifyWiringReceipt(x); };
  assert.deepEqual(await t((x) => { x.devices[0].role = 'admin'; }), { ok: false, reason: 'hash' });
  assert.deepEqual(await t((x) => { x.devices[0].role = 'admin'; const { hash: h, sig: s, ...b } = x; x.hash = sha(canonical(b)); }), { ok: false, reason: 'signature' });
  assert.deepEqual(await t((x) => { x.by = o.k.finance.pub; }), { ok: false, reason: 'not-owner' });
  assert.deepEqual(await t((x) => { x.by = 'zz'; x.company = 'zz'; }), { ok: false, reason: 'not-owner' });
  assert.deepEqual(await t((x) => { x.model = 'other/1'; }), { ok: false, reason: 'model' });
  assert.deepEqual(await t((x) => { x.sig = '00'.repeat(64); }), { ok: false, reason: 'signature' });
  for (const junk of [null, 7, 'x', [], { model: 'sovereign-enterprise/wiring/1', by: o.G, company: o.G }]) assert.equal((await S.verifyWiringReceipt(junk)).ok, false);
  // the spine record of it
  const rr = S.receiptRecord(r.receipt);
  assert.deepEqual(rr, { id: 'receipt-' + hash.slice(0, 16), f: { kind: 'receipt', hash, sig, at, mark: body.mark, devices: 2, same: 2 } });
  assert.equal(S.receiptRecord(null), null);
  assert.equal((await o.nodes.owner.put('wire', rr.id, rr.f)).ok, true, 'it fits one record on the spine');
  assert.deepEqual(S.wiringView(o.nodes.owner).receipts.map((x) => x.devices), [2]);
});

// ── fuzz: every export, junk in every position — a refusal, never a throw or a rejection ───────────────────────────
test('fuzz: no export throws or rejects on junk', async () => {
  const toxic = { get node() { throw new Error('boom'); }, get view() { throw new Error('boom'); }, get agents() { throw new Error('boom'); }, get plan() { throw new Error('boom'); },
    get pub() { throw new Error('boom'); }, get role() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s')];
  const fns = Object.entries(S).filter(([, v]) => typeof v === 'function');
  assert.deepEqual(fns.map(([k]) => k).sort(), ['adoptAntibodiesOn', 'agentRoster', 'applyEffect', 'askSecond', 'checkIn', 'clearsOf', 'companyMark', 'createAgentShell', 'createWork',
    'finishWork', 'gateFor', 'grantFor', 'honourWork', 'isPaused', 'learnBrain', 'ollamaSteps', 'oversee', 'ownRecords', 'personApproved', 'planOf', 'policyOf', 'postEntry', 'publishBrain', 'receiptRecord',
    'seedFor', 'signedAs', 'stepAgent', 'stockBrains', 'testWork', 'uid', 'vaultState', 'verifyWiringReceipt', 'wireRecords', 'wiringChecklist', 'wiringReceipt', 'wiringView', 'witnessHead', 'witnessVault']);
  // the parts of the agent step (stepAgent, finishWork, askSecond, publishBrain, uid, seedFor) take a context only the runtime and the shell build —
  // they are reached through createAgentShell here, whose tick never rejects
  const internal = new Set(['stepAgent', 'finishWork', 'askSecond', 'publishBrain', 'uid', 'seedFor']);
  for (const [name, fn] of fns) {
    if (internal.has(name)) continue;
    for (const a of JUNK) for (const b of JUNK.slice(0, 8)) {
      let out;
      assert.doesNotThrow(() => { out = fn(a, b, a); }, name);
      if (out && typeof out.then === 'function') await assert.doesNotReject(out, name);
      if (name === 'createAgentShell') await assert.doesNotReject(out.tick(), name);
    }
  }
});


// ── a compromised agent writes in another's name: every reader that acts reads the signer, never the name ──────────
// Every agent may write the shared collections, so "from: finance" or "by: audit" proves nothing. These are the attacks
// a compromised agent (here the Systems agent's device) can make with its own, valid key — each refused.
test('attack: a hand-off forged in another agent’s name, or written over, is refused; the real one is carried out', async () => {
  const o = await office({ agents: ['finance', 'ops', 'systems'] });
  const pay = (c) => JSON.stringify({ c: 'payments', f: { customer: c, amount: 1, status: 'released', by: 'x' } });
  const X = o.nodes.systems;
  await X.put('handoff', 'f1', { from: 'ops', to: 'finance', payload: pay('FORGED'), status: 'open', event: 'e1' });   // "from Ops" — Systems' key
  await o.nodes.ops.put('handoff', 'r1', { from: 'ops', to: 'finance', payload: pay('REAL'), status: 'open', event: 'e2' });
  await o.nodes.ops.put('handoff', 'r2', { from: 'ops', to: 'finance', payload: pay('ORIGINAL'), status: 'open', event: 'e3' });
  await o.sync();
  await X.put('handoff', 'r2', { payload: pay('SWAPPED') });                                     // Systems writes over Ops' payload
  await o.sync();
  assert.equal(rec(o.nodes.finance, 'handoff', 'r2').payload, pay('SWAPPED'), 'the overwrite wins the field — so the field alone proves nothing');
  await S.honourWork({ node: o.nodes.finance, id: 'finance', cols: agentCols('finance'), honoured: () => true, effect: (n, e) => S.applyEffect(n, e, '2026-10-15') });
  assert.deepEqual(['f1', 'r1', 'r2'].map((id) => rec(o.nodes.finance, 'handoff', id).status), ['refused', 'done', 'refused']);
  assert.deepEqual(o.nodes.finance.list('payments').map((p) => p.customer), ['REAL']);
});

test('attack: an agent cannot approve a held call — its own or another’s; only a person (the owner or an admin) can', async () => {
  const o = await office({ agents: ['finance', 'systems'], extra: ['overseer'] });
  await o.nodes.owner.grant('admin-overseer', o.k.overseer.pub, 'admin', ['*']);
  await o.sync();
  const F = o.nodes.finance, X = o.nodes.systems;
  const held = (id) => F.put('watch', id, { agent: 'finance', event: 'e-' + id, channel: 'fraud', customer: 'C1', amount: 900, status: 'open', action: '' });
  for (const id of ['w1', 'w2', 'w3', 'w4']) await held(id);
  await o.sync();
  await F.put('watch', 'w1', { status: 'approved', action: 'release-payment' });                 // Finance approves its own held call
  await X.put('watch', 'w2', { status: 'approved', action: 'release-payment' });                 // Systems approves Finance's
  await o.nodes.overseer.put('watch', 'w3', { status: 'approved', action: 'hold-payment' });     // a person (an admin)
  await o.nodes.owner.put('watch', 'w4', { status: 'approved', action: 'release-payment' });     // a person (the owner)
  await o.sync();
  assert.deepEqual([...S.personApproved(F, 'watch')].sort(), ['w3', 'w4']);
  await S.honourWork({ node: F, id: 'finance', cols: agentCols('finance'), honoured: () => true, effect: (n, e) => S.applyEffect(n, e, '2026-10-15') });
  assert.deepEqual(['w1', 'w2', 'w3', 'w4'].map((id) => rec(F, 'watch', id).status), ['approved', 'approved', 'executed', 'executed']);
  // once the agent has carried it out, its own "executed" is not a person's approval any more
  assert.deepEqual([...S.personApproved(F, 'watch')].sort(), []);
});

test('attack: a second opinion forged in the Audit agent’s name does not confirm a money call — it is held for a person', async () => {
  const o = await office({ agents: ['finance', 'audit', 'systems'] });
  const fin = await stock(o, 'finance');
  const i = pick('fraud', (f) => answer({ fraud: fin.fraud }, f).verdict === 'VERIFIED');
  await send(o, 'e100001', 'finance', 'fraud', i);
  let T = 0;
  const sync = () => o.sync(['owner', 'hub', 'finance', 'systems']);   // the Audit agent's device is offline: no real second opinion can come
  const shell = S.createAgentShell({ node: o.nodes.finance, agentId: 'finance', library: fin, now: () => T, deadline: 3 });
  await sync(); await shell.tick(); await sync(); T++;
  const ask = o.nodes.systems.list('ask').find((a) => a.item === 'e100001' && a.kind === 'second');
  assert.ok(ask, 'Finance asked for a second opinion on its own money call');
  const own = answer({ fraud: fin.fraud }, caseOf('fraud', i));
  const forged = { ask: ask.id, item: ask.item, by: 'audit', kind: 'second', verdict: 'VERIFIED', domain: 'fraud', label: own.label, conf: 900, route: 900,
    pattern: 'f'.repeat(16), receipt: '0'.repeat(16) };
  await o.nodes.systems.put('reply', 'q-forged', forged);                                       // "by: audit" — the Systems agent's key
  // the forgery is well-formed: by the reply alone it would pass as an independent second opinion
  assert.equal(pickSecond([forged], 'fraud', ask.pattern).node, 'audit');
  await sync();
  assert.deepEqual(S.signedAs(o.nodes.finance, 'reply', (r) => r.by).filter((r) => r.id === 'q-forged'), [], 'Systems is not Audit');
  for (let k = 0; k < 5; k++) { await sync(); await shell.tick(); await sync(); T++; }
  const d = decisionsFor(o.nodes.finance, 'e100001');
  assert.equal(d.length, 1);
  assert.equal(d[0].cross, false, 'no second brain confirmed it');
  assert.notEqual(d[0].second, 'audit');
  assert.equal(d[0].state, 'watch', 'a money call no independent brain confirmed waits for a person');
});

test('attack: decisions forged in another agent’s name neither frame it to the behaviour watch nor count as its work; a restart reads only its own key', async () => {
  const o = await office({ agents: ['finance', 'ops', 'systems'] });
  const X = o.nodes.systems, P = o.nodes.ops;
  await P.put('decisions', 'd-real', { agent: 'ops', event: 'e1', domain: 'inventory', action: 'raise-po', state: 'done', by: 'own' });
  await X.put('decisions', 'd-forged', { agent: 'ops', event: 'e2', domain: 'fraud', action: 'release-payment', state: 'done', by: 'own' });
  await X.put('reply', 'r-forged', { ask: 'q1', item: 'e3', by: 'ops', kind: 'answer', verdict: 'VERIFIED', domain: 'inventory', label: 1 });
  await X.put('ask', 'q-forged', { item: 'e4', from: 'ops', kind: 'answer', features: '{}', domain: '', pattern: '', exclude: '' });
  await o.sync();
  assert.deepEqual(S.signedAs(P, 'decisions', (d) => d.agent).map((d) => d.id), ['d-real']);
  assert.deepEqual(S.ownRecords(P, 'decisions').map((d) => d.id), ['d-real']);
  assert.deepEqual(S.ownRecords(P, 'reply'), [], 'a reply in Ops’ name that Ops never wrote is not one Ops gave');
  assert.deepEqual(S.ownRecords(P, 'ask'), []);
  assert.deepEqual(S.ownRecords(X, 'decisions').map((d) => d.id), ['d-forged'], 'the forger’s own records are its own');
  // junk never throws
  for (const n of [null, {}, { list() { throw new Error('x'); } }]) {
    assert.deepEqual(S.signedAs(n, 'reply', (r) => r.by), []);
    assert.deepEqual(S.ownRecords(n, 'reply'), []);
    assert.deepEqual([...S.personApproved(n, 'watch')], []);
  }
  assert.deepEqual(S.signedAs(P, 'nope', (r) => r.by), []);
});
