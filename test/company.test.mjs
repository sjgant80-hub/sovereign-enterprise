import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENTS, HUMANS, OWNER_OF, WEIGHTS, HOSTILE_TEXT, LEARN_AFTER, REGROW_EVERY, PROMOTE_BY, MISROUTE, HOSTILE, beats, agentName, pickEvent, agentStep, effects, splitEffects, poEntry, shouldLearn, challenge, boardKpis } from '../src/company.mjs';
import { sample } from '../src/streams.mjs';
import { prng } from '../src/sim.mjs';
import { validEntry } from '../src/books.mjs';
import { growPattern } from '../src/grow.mjs';
import { ACTIONS } from '../src/agent.mjs';

const brain = (d) => JSON.parse(readFileSync(new URL('../brains/' + d + '.slm.json', import.meta.url)));
const lib = (...ds) => Object.fromEntries(ds.map((d) => [d, brain(d)]));
const FRAUD = ['amount', 'hourOfDay', 'distanceKm', 'recentTx', 'merchantRisk', 'cardNotPresent'];
const auditFraud = growPattern('fraud', sample('fraud', 77, 700).rows, FRAUD, { seed: 77 }).pattern;
const peersAll = () => [
  { node: 'service', library: lib('churn') }, { node: 'finance', library: lib('fraud', 'credit') },
  { node: 'ops', library: lib('inventory', 'maintenance', 'energy') }, { node: 'systems', library: lib('intrusion') },
  { node: 'audit', library: { fraud: auditFraud } },
];
const ev = (domain, seed = 3, extra = {}) => { const r = sample(domain, seed, 1).rows[0]; const { y, ...features } = r; return { id: 'e1', domain, features, truth: y, customer: 'C1234', text: '', amount: 7100, ...extra }; };

test('the company: every domain has an owning agent whose brain covers it; the owner scopes reach every effect', () => {
  for (const [d, owner] of Object.entries(OWNER_OF)) {
    const a = AGENTS.find((x) => x.id === owner);
    assert.ok(a.domains.includes(d), d);
    assert.equal(ACTIONS[d].role, owner);
    assert.ok(WEIGHTS[d] > 0);
  }
  for (const a of AGENTS) assert.ok(a.cols.length <= 32 && a.job.length > 20);
  assert.equal(HUMANS.length, 2);
  assert.equal(agentName('finance'), 'Finance agent');
  assert.equal(agentName('nope'), 'nope');
  const audit = AGENTS.find((a) => a.id === 'audit');
  assert.deepEqual(audit.grows, Object.keys(ACTIONS).filter((d) => ACTIONS[d].stakes === 'high'));
});

test('pickEvent: deterministic, weighted, features stripped of the truth, misroutes about a quarter', () => {
  const pools = Object.fromEntries(Object.keys(WEIGHTS).filter((d) => d !== 'shopper').map((d) => [d, sample(d, 9, 50).rows]));
  const a = [], b = [];
  const r1 = prng(5), r2 = prng(5);
  for (let i = 0; i < 400; i++) { a.push(pickEvent(r1, pools, i)); b.push(pickEvent(r2, pools, i)); }
  assert.deepEqual(a, b);
  assert.ok(a.every((e) => !('y' in e.features) && (e.truth === 0 || e.truth === 1)));
  assert.ok(a.every((e) => e.domain !== 'shopper'));
  const mis = a.filter((e) => e.landsAt !== OWNER_OF[e.domain]).length;
  assert.ok(mis > 50 && mis < 130, 'misrouted ' + mis);
  const fraud = a.filter((e) => e.domain === 'fraud').length, energy = a.filter((e) => e.domain === 'energy').length;
  assert.ok(fraud > energy * 1.8, fraud + ' vs ' + energy);
  assert.ok(a.some((e) => e.domain === 'churn' && HOSTILE_TEXT.includes(e.text)));
  assert.ok(a.filter((e) => e.domain === 'fraud').every((e) => e.amount >= 100 && e.amount <= 1000000));
  assert.ok(a.filter((e) => e.domain === 'inventory').every((e) => e.amount >= 20000 && e.amount < 200000));
  assert.ok(a.filter((e) => e.domain === 'intrusion').every((e) => e.customer.startsWith('host-') && e.text === ''));
  assert.equal(a[7].id, 'e000007');
  assert.equal(pickEvent(prng(1), {}, 0), null);
  assert.equal(pickEvent(prng(1), null, 0), null);
  const one = pickEvent(() => 0.999999, { energy: [{ loadMW: 1, y: 1 }] }, 3);
  assert.equal(one.domain, 'energy');
  assert.equal(one.truth, 1);
});

test('pickEvent: every boundary of the door, with a scripted dice', () => {
  const seq = (...v) => { let i = 0; return () => v[i++]; };
  const row = (extra) => ({ amount: 71.046542, PageValues: 12.3, y: 1, ...extra });
  // the weight walk: x lands exactly on shopper's upper edge → churn
  assert.equal(pickEvent(seq(0.5, 0, 0.9, 0.1, 0.9, 0), { shopper: [row()], churn: [row()] }, 0).domain, 'churn');
  assert.equal(pickEvent(seq(0.4999, 0, 0.9, 0.1), { shopper: [row()], churn: [row()] }, 0).domain, 'shopper');
  // misroute exactly at MISROUTE stays with the owner; just under it goes astray
  assert.equal(pickEvent(seq(0, 0, MISROUTE, 0.1, 0.9, 0), { churn: [row()] }, 0).landsAt, 'service');
  assert.equal(pickEvent(seq(0, 0, MISROUTE - 1e-9, 0, 0.1, 0.9, 0), { churn: [row()] }, 0).landsAt, 'sales');
  // hostile exactly at HOSTILE is a normal message; just under it is hostile
  const calm = pickEvent(seq(0, 0, 0.9, 0.1, HOSTILE, 0), { churn: [row()] }, 0);
  assert.equal(HOSTILE_TEXT.includes(calm.text), false);
  assert.ok(calm.text.length > 0);
  assert.equal(HOSTILE_TEXT.includes(pickEvent(seq(0, 0, 0.9, 0.1, HOSTILE - 1e-9, 0), { churn: [row()] }, 0).text), true);
  // each channel names its customer its own way; amounts exact
  const one = (d, extra) => pickEvent(seq(0, 0, 0.9, 0.5, 0.9, 0, 0.5), { [d]: [row(extra)] }, 0);
  assert.match(one('maintenance').customer, /^machine-[0-9]{4}$/);
  assert.match(one('inventory').customer, /^sku-[0-9]{4}$/);
  assert.match(one('intrusion').customer, /^host-[0-9]{4}$/);
  assert.match(one('energy').customer, /^C[0-9]{4}$/);
  assert.equal(one('fraud').amount, 7105);
  assert.equal(one('fraud', { amount: 'x' }).amount, 100);
  assert.equal(one('shopper').amount, 1230 + 2500);
  assert.equal(one('shopper', { PageValues: undefined }).amount, 2500);
  assert.equal(one('energy').amount, 0);
  assert.equal(one('inventory').amount, 20000 + 162000);                         // no message on this channel, so the 5th roll (0.9) sets the PO
  assert.equal(pickEvent(() => 1, { churn: [row()] }, 0), null);                    // a broken dice fails closed
});

test('beats: a challenger must clear the current brain by PROMOTE_BY — exactly at it is enough', () => {
  assert.equal(beats(0.5 + PROMOTE_BY, 0.5), true);
  assert.equal(beats(0.5 + PROMOTE_BY - 1e-9, 0.5), false);
});

test('agentStep: the owning agent answers from its own brain', () => {
  const s = agentStep({ agentId: 'ops', event: ev('inventory'), library: lib('inventory', 'maintenance', 'energy'), peers: peersAll() });
  assert.equal(s.decision.by, 'own');
  assert.equal(s.decision.state, 'done');
  assert.equal(s.decision.domain, 'inventory');
  assert.match(s.decision.receipt, /^[0-9a-f]{16}$/);
  assert.ok(s.decision.conf >= 0 && s.decision.conf <= 1000);
  assert.equal(s.askedMesh, null);
});

test('agentStep: misrouted work → the mesh answers, and the asking agent knows what it asked about', () => {
  const s = agentStep({ agentId: 'service', event: ev('inventory'), library: lib('churn'), peers: peersAll() });
  assert.equal(s.decision.by, 'mesh:ops');
  assert.equal(s.askedMesh, 'inventory');
});

test('agentStep: a high-stakes call is confirmed by the independent Audit brain — and held when Audit is offline', () => {
  let found = 0, held = 0;
  for (let seed = 1; seed < 40; seed++) {
    const e = ev('fraud', seed);
    const s = agentStep({ agentId: 'finance', event: e, library: lib('fraud', 'credit'), peers: peersAll() });
    if (s.decision.state === 'done') { assert.equal(s.decision.crossChecked, true); assert.equal(s.decision.secondBy, 'audit'); found++; }
    else { assert.match(s.decision.why, /disagreed/); held++; }
    const off = agentStep({ agentId: 'finance', event: e, library: lib('fraud', 'credit'), peers: peersAll().filter((p) => p.node !== 'audit') });
    assert.equal(off.decision.state, 'watch');              // finance's own copy elsewhere is no second opinion
    assert.match(off.decision.why, /no second brain/);
    assert.equal(off.effects[0].c, 'watch');
  }
  assert.ok(found > 20, 'confirmed ' + found);
  assert.ok(held >= 1, 'two independent brains do sometimes disagree — those go to the humans (' + held + ')');
});

test('agentStep: hostile text is quarantined before any brain reads it', () => {
  for (const text of HOSTILE_TEXT) {
    const s = agentStep({ agentId: 'service', event: ev('churn', 2, { text }), library: lib('churn'), peers: peersAll() });
    assert.equal(s.decision.action, 'quarantine-input');
    assert.equal(s.effects[0].c, 'quarantine');
    assert.ok(s.effects[0].f.flags.length > 0);
  }
  const ok = agentStep({ agentId: 'service', event: ev('churn', 2, { text: 'When does my contract end?' }), library: lib('churn'), peers: [] });
  assert.equal(ok.decision.by, 'own');
});

test('agentStep: nobody covers it → the watch list; junk fails closed', () => {
  const s = agentStep({ agentId: 'sales', event: ev('energy'), library: lib('shopper'), peers: [] });
  assert.equal(s.decision.state, 'watch');
  assert.equal(s.decision.by, 'none');
  assert.equal(s.effects[0].c, 'watch');
  assert.equal(s.effects[0].f.label, -1);
  assert.equal(agentStep().decision.by, 'fault');
  assert.equal(agentStep({ agentId: 'x', event: { get text() { throw new Error('x'); } } }).decision.state, 'watch');
});

test('effects: each act writes the right record; postings balance; nothing for quiet acts', () => {
  const e = ev('fraud', 1, { amount: 12000 });
  const D = (action, extra = {}) => ({ state: 'done', action, crossChecked: false, ...extra });
  const rel = effects(D('release-payment'), e, 'finance');
  assert.equal(validEntry({ date: '2026-10-14', ...rel[0].post }).ok, true);
  assert.deepEqual(rel[0].post.lines, [['1200', 12000, 0], ['4000', 0, 10000], ['2200', 0, 2000]]);
  assert.equal(rel[1].f.status, 'released');
  const hold = effects(D('hold-payment', { crossChecked: true }), e, 'finance');
  assert.equal(hold[0].f.status, 'held');
  assert.match(hold[1].f.body, /£120\.00.*second brain agreed/);
  assert.match(effects(D('hold-payment'), e, 'finance')[1].f.body, /fraudulent\.$/);
  assert.equal(effects(D('fast-track'), { ...e, amount: 4200 }, 'sales')[0].f.value, 4200);
  assert.equal(effects(D('retain'), e, 'service').length, 2);
  assert.equal(effects(D('upfront-terms'), e, 'finance')[0].f.terms, 'payment up front');
  assert.equal(effects(D('standard-terms'), e, 'finance')[0].f.terms, '30 days');
  assert.deepEqual(effects(D('raise-po'), e, 'ops').map((x) => x.c), ['po', 'tasks']);
  assert.equal(effects(D('schedule-service'), e, 'ops')[0].c, 'tasks');
  assert.equal(effects(D('shed-load'), e, 'ops')[0].c, 'msg');
  assert.deepEqual(effects(D('quarantine', { crossChecked: true }), e, 'systems').map((x) => x.c), ['security', 'msg']);
  for (const quiet of ['nurture', 'standard-reply', 'no-reorder', 'keep-running', 'normal-load', 'allow']) assert.deepEqual(effects(D(quiet), e, 'ops'), []);
  const w = effects({ state: 'watch', by: 'own', domain: 'fraud', action: 'hold-payment', label: 1, why: 'x'.repeat(400) }, e, 'finance');
  assert.equal(w[0].f.why.length, 300);
  assert.equal(w[0].f.label, 1);
  assert.equal(w[0].f.status, 'open');
  assert.equal(w[0].f.amount, 12000);
  assert.equal(w[0].f.channel, 'fraud');
  assert.equal(w[0].f.domain, 'fraud');
  assert.equal(w[0].f.action, 'hold-payment');
  const blank = effects({ state: 'watch', by: 'none', domain: null, action: null, label: null, why: 'x' }, e, 'sales')[0].f;
  assert.deepEqual([blank.domain, blank.action, blank.label], ['', '', -1]);
  const q0 = effects({ state: 'watch', by: 'screen' }, e, 'service', null)[0];
  assert.deepEqual([q0.c, q0.f.flags, q0.f.preview], ['quarantine', '', '']);
  const q1 = effects({ state: 'watch', by: 'screen' }, e, 'service', { flags: ['bidi', 'control'], clean: 'abc' })[0].f;
  assert.deepEqual([q1.flags, q1.preview], ['bidi,control', 'abc']);                 // the door knows which channel it came in on
  assert.deepEqual(effects(null, e, 'x'), []);
  assert.deepEqual(effects(D('allow'), null, 'x'), []);
  for (const list of [rel, hold]) for (const x of list) if (x.f) for (const v of Object.values(x.f)) assert.ok(typeof v === 'string' ? v.length <= 2000 : Number.isSafeInteger(v) || typeof v === 'boolean');
});

test('splitEffects: what the grant covers is done here; the rest is handed to the scoped owner', () => {
  const list = [{ c: 'msg', f: {} }, { c: 'payments', f: {} }, { post: { memo: 'x' } }, null, 'junk'];
  const ops = splitEffects(list, AGENTS.find((a) => a.id === 'ops').cols, 'finance');
  assert.equal(ops.mine.length, 1);
  assert.deepEqual(ops.handoff.map((h) => h.to), ['finance', 'finance']);
  const fin = splitEffects(list, AGENTS.find((a) => a.id === 'finance').cols, 'finance');
  assert.equal(fin.mine.length, 3);
  assert.equal(splitEffects(list, ['*'], 'x').mine.length, 3);
  assert.equal(splitEffects(list, ['journal', 'vault'], 'x').handoff.length, 3);   // a posting needs all three scopes
  assert.equal(splitEffects(null, ['*']).mine.length, 0);
  assert.equal(splitEffects(list, null, 'x').mine.length, 0);
});

test('poEntry: net + 20% input VAT against the supplier, balanced', () => {
  const p = poEntry({ supplier: 'Acme', net: 50000 });
  assert.deepEqual(p.lines, [['5000', 50000, 0], ['2201', 10000, 0], ['2100', 0, 60000]]);
  assert.equal(validEntry({ date: '2026-10-14', ...p }).ok, true);
  assert.match(poEntry({ net: 1 }).memo, /supplier/);
  for (const bad of [null, {}, { net: 0 }, { net: -5 }, { net: 1.5 }]) assert.equal(poEntry(bad), null);
});

test('shouldLearn: only after enough asks, and only what it does not hold', () => {
  assert.equal(shouldLearn({ fraud: LEARN_AFTER }, 'fraud', {}), true);
  assert.equal(shouldLearn({ fraud: LEARN_AFTER - 1 }, 'fraud', {}), false);
  assert.equal(shouldLearn({ fraud: LEARN_AFTER }, 'fraud', { fraud: {} }), false);
  assert.equal(shouldLearn({ fraud: LEARN_AFTER }, 'fraud', null), true);
  assert.equal(shouldLearn(null, 'fraud', {}), false);
  assert.equal(shouldLearn({ fraud: 'x' }, 'fraud', {}), false);
});

test('challenge: a regrown brain is promoted only when it beats the current one on outcomes neither saw', () => {
  const local = sample('fraud', 11, 500).rows;
  const outcomes = sample('fraud', 12, 300).rows;
  const weak = growPattern('fraud', local, ['hourOfDay', 'recentTx'], { seed: 4 }).pattern;     // a deliberately thin brain
  const c = challenge(weak, 'fraud', FRAUD, local, outcomes, 9);
  assert.equal(c.promote, true);
  assert.ok(c.challengerAuc >= c.currentAuc + PROMOTE_BY);
  assert.equal(c.held, 100);
  assert.match(c.why, /beat the current one on 100/);
  const strong = c.pattern;
  const again = challenge(strong, 'fraud', FRAUD, local, outcomes, 9);              // the same challenger cannot beat itself
  assert.equal(again.promote, false);
  assert.match(again.why, /held/);
  assert.equal(challenge(weak, 'fraud', FRAUD, local, outcomes.slice(0, REGROW_EVERY - 1), 9).promote, false);
  assert.match(challenge(weak, 'fraud', FRAUD, null, outcomes.slice(0, REGROW_EVERY), 9).why, /own held-out gate|beat|held/);
  const noise = outcomes.map((r, i) => ({ ...r, y: i % 2 }));
  assert.match(challenge(weak, 'fraud', FRAUD, [], noise, 9).why, /own held-out gate/);
  assert.equal(challenge(weak, 'fraud', FRAUD, local, null, 9).promote, false);
  assert.equal(challenge(weak, 'fraud', FRAUD, local, 'x'.repeat(REGROW_EVERY * 3), 9).why, 'not enough outcomes yet');
});

test('boardKpis: automation, accuracy and the human load, per agent and company-wide', () => {
  const L = [
    { agent: 'sales', state: 'done', label: 1, truth: 1, by: 'own' },
    { agent: 'sales', state: 'done', label: 0, truth: 1, by: 'mesh:ops' },
    { agent: 'finance', state: 'done', label: 1, truth: 1, by: 'own', crossChecked: true },
    { agent: 'finance', state: 'watch', label: 1, truth: 1, by: 'own' },
    { agent: 'service', state: 'watch', label: null, truth: 0, by: 'screen' },
    null,
  ];
  const k = boardKpis(L);
  assert.deepEqual([k.total, k.done, k.watched, k.quarantined, k.correct, k.crossChecked, k.viaMesh], [5, 3, 2, 1, 2, 1, 1]);
  assert.equal(k.automated, 0.6);
  assert.equal(k.accuracy, 2 / 3);
  assert.deepEqual(k.perAgent.sales, { done: 2, correct: 1, watched: 0, accuracy: 0.5 });
  assert.equal(k.perAgent.audit, undefined);
  assert.equal(boardKpis(null).automated, 0);
});
