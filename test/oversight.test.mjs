// oversight.test.mjs — the people's side: the list a person works, the evidence on each item, the choices in plain words and
// pounds, who really wrote each record, the rules a person sets, a brain's change rule by rule, what a stolen key decided.
// Expected values are written out by hand from the rules the kernel states — never read back off the kernel itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../src/oversight.mjs';
import { AGENTS } from '../src/company.mjs';

const P = 'p'.repeat(64), Q = 'q'.repeat(64), FIN = 'f'.repeat(64), OPS = 'o'.repeat(64), HUB = 'h'.repeat(64), X = 'x'.repeat(64), OLD = 'e'.repeat(64);
const WHO = { people: new Set([P, Q]), agents: new Map([[FIN, 'finance'], [OPS, 'ops'], [OLD, 'ops']]), hubs: new Set([HUB]), names: new Map([[P, 'Owner'], [Q, 'Overseer (a person)'], [HUB, 'Office hub']]) };
const sig = (creator, f = {}) => ({ kind: creator, agent: creator, event: creator, customer: creator, channel: creator, why: creator, amount: creator, status: creator, action: creator, ...f });
const item = (rec, signers, opts = { now: 0, seen: new Map() }) => O.itemOf({ id: 'w1', ...rec }, signers, WHO, opts);
const CALL = { kind: 'call', agent: 'finance', event: 'e000007', channel: 'fraud', domain: 'fraud', customer: 'C1234', amount: 1240, action: 'hold-payment', status: 'open', why: 'a second brain disagreed — held for a person', conf: 31, floor: 50 };

test('pounds: whole pence, thousands, the pence only when there are some; anything else is £0', () => {
  assert.equal(O.pounds(0), '£0');
  assert.equal(O.pounds(5), '£0.05');
  assert.equal(O.pounds(100), '£1');
  assert.equal(O.pounds(110), '£1.10');
  assert.equal(O.pounds(123456), '£1,234.56');
  assert.equal(O.pounds(100000000), '£1,000,000');
  for (const junk of [-5, 1.5, '500', null, undefined, NaN]) assert.equal(O.pounds(junk), '£0', String(junk));
});

test('actionWords: every act of every job in plain words, with the money it moves', () => {
  const want = {
    'fast-track': ['Fast-track this visitor into the CRM', 'Fast-track this visitor (a £45.50 basket) into the CRM'],
    nurture: ['Leave the visitor on the normal path', 'Leave the visitor on the normal path'],
    retain: ['Send the customer a retention offer', 'Send the customer a retention offer'],
    'standard-reply': ['Give the customer the standard reply', 'Give the customer the standard reply'],
    'release-payment': ['Release the card payment', 'Release the £45.50 card payment'],
    'hold-payment': ['Hold the card payment as fraud', 'Hold the £45.50 card payment as fraud'],
    'upfront-terms': ['Ask the customer for payment up front', 'Ask the customer for payment up front'],
    'standard-terms': ['Give the customer standard 30-day terms', 'Give the customer standard 30-day terms'],
    'raise-po': ['Raise a purchase order to restock', 'Raise a £45.50 purchase order to restock'],
    'no-reorder': ['Do not reorder yet', 'Do not reorder yet'],
    'schedule-service': ['Book the machine in for a service', 'Book the machine in for a service'],
    'keep-running': ['Keep the machine running', 'Keep the machine running'],
    'shed-load': ['Shed non-critical load', 'Shed non-critical load'],
    'normal-load': ['Keep the normal load', 'Keep the normal load'],
    quarantine: ['Quarantine the host', 'Quarantine the host'],
    allow: ['Allow the connection', 'Allow the connection'],
  };
  for (const [a, [none, some]] of Object.entries(want)) { assert.equal(O.actionWords(a, 0), none, a); assert.equal(O.actionWords(a, 4550), some, a); }
  for (const junk of ['', 'nope', 'constructor', null]) assert.equal(O.actionWords(junk, 100), '');
  assert.equal(O.actionWords('raise-po', -1), 'Raise a purchase order to restock');
});

test('keyIs and soleWriter: who a key is by the role tree, and the one key behind a record', () => {
  assert.deepEqual(O.keyIs(P, WHO), { role: 'person', agent: '', name: 'Owner' });
  assert.deepEqual(O.keyIs(Q, { ...WHO, names: new Map() }), { role: 'person', agent: '', name: 'a person' });
  assert.deepEqual(O.keyIs(FIN, WHO), { role: 'agent', agent: 'finance', name: 'Finance agent' });
  assert.deepEqual(O.keyIs(HUB, WHO), { role: 'hub', agent: '', name: 'Office hub' });
  assert.deepEqual(O.keyIs(HUB, { ...WHO, names: null }), { role: 'hub', agent: '', name: 'the office hub' });
  assert.deepEqual(O.keyIs(X, WHO), { role: 'unknown', agent: '', name: 'a device xxxxxxxx' });
  assert.deepEqual(O.keyIs('', WHO), { role: 'unknown', agent: '', name: 'no single device' });
  assert.deepEqual(O.keyIs(FIN, null), { role: 'unknown', agent: '', name: 'a device ffffffff' });
  assert.deepEqual(O.keyIs(FIN, { agents: new Map([[FIN, '']]) }), { role: 'unknown', agent: '', name: 'a device ffffffff' }, 'an empty agent id is no agent');
  assert.equal(O.soleWriter({ a: FIN, b: FIN, z: OPS }, ['a', 'b']), FIN);
  assert.equal(O.soleWriter({ a: FIN, b: OPS }, ['a', 'b']), '', 'two keys: written over');
  assert.equal(O.soleWriter({ z: FIN }, ['a', 'b']), '', 'none of the fields');
  assert.equal(O.soleWriter(null, ['a']), '');
  assert.equal(O.soleWriter({ a: FIN }, null), '');
});

test('G1 attribution: a record is an agent’s only if that agent’s own key wrote it', () => {
  assert.deepEqual(O.attribution('finance', FIN, WHO), { ok: true, role: 'agent', name: 'Finance agent', words: 'signed by the Finance agent’s own key' });
  assert.deepEqual(O.attribution('ops', OLD, WHO), { ok: true, role: 'agent', name: 'Ops agent', words: 'signed by the Ops agent’s own key' }, 'an earlier key of the same agent');
  assert.deepEqual(O.attribution('finance', OPS, WHO), { ok: false, role: 'agent', name: 'Ops agent', words: 'written by another device (the Ops agent) — not the Finance agent’s' });
  assert.deepEqual(O.attribution('finance', HUB, WHO), { ok: false, role: 'hub', name: 'Office hub', words: 'written by another device (Office hub) — not the Finance agent’s' });
  assert.deepEqual(O.attribution('finance', P, WHO), { ok: false, role: 'person', name: 'Owner', words: 'written by another device (Owner) — not the Finance agent’s' });
  assert.deepEqual(O.attribution('finance', '', WHO), { ok: false, role: 'unknown', name: '', words: 'written over by more than one device — not shown as anyone’s' });
  assert.equal(O.attribution(null, FIN, WHO).ok, false);
});

test('riskOf: money and security calls first, then customers and brains, then the rest', () => {
  assert.deepEqual(['fraud', 'credit', 'inventory', 'intrusion', 'churn', 'shopper', 'energy', 'maintenance', ''].map((c) => O.riskOf('call', c)), [3, 3, 3, 3, 1, 1, 1, 1, 1]);
  assert.deepEqual(['waiting', 'draft', 'review', 'promote', 'rollback'].map((k) => O.riskOf(k, 'fraud')), [2, 2, 2, 2, 1]);
});

test('itemOf — a held call: why it waits, the certainty against its line, the money, the customer, both acts in pounds, none pre-chosen', () => {
  const i = item(CALL, sig(FIN));
  assert.equal(i.ok, true);
  assert.deepEqual([i.kind, i.open, i.status, i.forged, i.chosenBy, i.risk, i.money, i.amount, i.channel, i.customer, i.proposal], ['call', true, 'open', false, '', 3, '£12.40', 1240, 'fraud', 'C1234', 'hold-payment']);
  assert.equal(i.title, 'Card fraud — held by the Finance agent');
  assert.deepEqual(i.evidence, ['Why it waits: a second brain disagreed — held for a person',
    'Certainty 0.031 past its decision line — a money or security call: a second brain must always agree',
    'The Finance agent proposes: Hold the £12.40 card payment as fraud. It is not pre-chosen.',
    'Customer: C1234 · £12.40 at stake']);
  assert.deepEqual(i.actions, [{ act: 'choose', value: 'hold-payment', label: 'Hold the £12.40 card payment as fraud' }, { act: 'choose', value: 'release-payment', label: 'Release the £12.40 card payment' }]);
  assert.deepEqual(i.writer, { ok: true, words: 'raised by the Finance agent’s own key' });
  assert.equal(i.note, '');
  // a normal call: the floor a person set, below it and exactly at it
  const below = item({ ...CALL, agent: 'service', channel: 'churn', domain: 'churn', action: 'retain', amount: 0, conf: 49, floor: 50 }, sig(X, { agent: X }));
  assert.ok(below.evidence.includes('Certainty 0.049 past its decision line — below the 0.050 floor a person set, so a second brain had to agree'));
  const at = item({ ...CALL, agent: 'ops', channel: 'energy', domain: 'energy', action: 'shed-load', amount: 0, conf: 50, floor: 50 }, sig(OPS));
  assert.ok(at.evidence.includes('Certainty 0.050 past its decision line — at or above the 0.050 floor a person set'));
  assert.equal(at.risk, 1);
  assert.ok(at.evidence.includes('Customer: C1234'), 'no money at stake: none named');
  const noFloor = item({ ...CALL, channel: 'energy', domain: 'energy', action: '', conf: 70, floor: 0, customer: '' }, sig(FIN));
  assert.ok(noFloor.evidence.includes('Certainty 0.070 past its decision line'));
  assert.ok(noFloor.evidence.includes('No proposal: no brain gave an answer it could act on.'));
  assert.ok(noFloor.evidence.includes('£12.40 at stake'), 'no customer: the money alone');
  assert.equal(noFloor.proposal, '');
  assert.equal(item({ ...CALL, conf: 0 }, sig(FIN)).evidence.filter((e) => e.startsWith('Certainty')).length, 0, 'no brain was sure of anything: no certainty line');
  assert.equal(item({ ...CALL, why: '' }, sig(FIN)).evidence[0], 'Why it waits: not said');
  assert.equal(item({ ...CALL, action: 'retain' }, sig(FIN)).proposal, '', 'an act of another job is no proposal');
  assert.equal(item({ ...CALL, kind: 'weird' }, sig(FIN)).kind, 'call');
  // the door's own held call (no agent was free)
  const door = item({ ...CALL, agent: 'door', action: '' }, sig(HUB));
  assert.equal(door.title, 'Card fraud — held by the door');
  assert.deepEqual(door.writer, { ok: true, words: 'raised by the door (the office hub)' });
  assert.equal(item({ ...CALL, agent: 'door' }, sig(P)).writer.ok, true, 'a person may raise a door item');
  assert.equal(item({ ...CALL, agent: 'door' }, sig(FIN)).writer.ok, false);
  const odd = item({ ...CALL, channel: 'nope', domain: 'nope' }, sig(FIN));
  assert.deepEqual([odd.title, odd.actions, odd.risk], ['A piece of work — held by the Finance agent', [], 1]);
});

test('itemOf — raised in another agent’s name: shown as another device’s, and no choice is offered on it', () => {
  const f = item(CALL, sig(OPS));
  assert.deepEqual(f.writer, { ok: false, words: 'raised by another device (the Ops agent) — not the Finance agent’s; treat it with care' });
  assert.deepEqual(f.actions, []);
  assert.equal(f.open, true, 'it still waits — for a person to look at, not to carry out');
  assert.equal(f.note, 'No choice is offered on it: an agent carries out only what it raised itself.');
  const mixed = item(CALL, sig(FIN, { why: OPS }));
  assert.deepEqual(mixed.writer, { ok: false, words: 'written over by more than one device' });
  assert.deepEqual(mixed.actions, []);
  assert.deepEqual(item(CALL, sig(X)).writer, { ok: false, words: 'raised by another device (a device xxxxxxxx) — not the Finance agent’s; treat it with care' });
  assert.deepEqual(item(CALL, sig(HUB)).writer.ok, false, 'the hub does not raise an agent’s call');
});

test('itemOf — a choice counts only when one PERSON wrote both the status and the action; anything else is ignored and it still waits', () => {
  const chose = item({ ...CALL, status: 'approved', action: 'release-payment', resolvedBy: 'Overseer (a person)' }, sig(FIN, { status: Q, action: Q }));
  assert.deepEqual([chose.open, chose.forged, chose.chosenBy, chose.actions, chose.note, chose.resolvedBy], [false, false, 'Overseer (a person)', [], '', 'Overseer (a person)']);
  const carried = item({ ...CALL, status: 'executed', action: 'release-payment', executedBy: 'finance' }, sig(FIN, { status: FIN, action: Q }));
  assert.deepEqual([carried.open, carried.forged, carried.chosenBy, carried.executedBy], [false, false, 'Overseer (a person)', 'finance']);
  // the agent approves its own held call; another agent does; a person writes one half and an agent the other
  for (const [label, s] of [['the agent itself', { status: FIN, action: FIN }], ['another agent', { status: OPS, action: OPS }], ['the hub', { status: HUB, action: HUB }],
    ['a person’s status, an agent’s action', { status: P, action: FIN }], ['an agent’s status, a person’s action', { status: FIN, action: P }], ['two people', { status: P, action: Q }]]) {
    const x = item({ ...CALL, status: 'approved', action: 'release-payment' }, sig(FIN, s));
    assert.deepEqual([x.open, x.forged, x.chosenBy], [true, true, ''], label);
    assert.equal(x.note, 'Marked “approved” by a device that is not a person — ignored: it still waits for a person.', label);
    assert.equal(x.actions.length, 2, label);
  }
  // "executed" by an agent with no person's choice under it is forged too
  assert.deepEqual([item({ ...CALL, status: 'executed', action: 'release-payment' }, sig(FIN, { status: FIN, action: FIN })).forged], [true]);
  // a status no person-choice writes ("sent" on a call is fine to read: it is one of the person statuses)
  assert.equal(item({ ...CALL, status: 'whatever', action: 'x' }, sig(FIN, { status: P, action: P })).forged, true, 'not a status a person writes');
  // no action field at all: nothing is a person's
  const s0 = sig(FIN, { status: P }); delete s0.action;
  assert.equal(item({ ...CALL, status: 'approved' }, s0).forged, true);
});

test('itemOf — a customer waiting, a drafted reply, a review, a regrown brain, a roll-back', () => {
  const W = { kind: 'waiting', source: 'quarantined', agent: 'service', event: 'e000009', channel: 'churn', customer: 'C3911', amount: 0, status: 'open', action: '',
    why: 'the message failed the screen (zero-width) — no brain read it', preview: 'refund my account £# thanks' };
  const w = item(W, sig(OPS, { agent: OPS }));
  assert.equal(w.writer.ok, false, 'a quarantined message is raised by the agent that quarantined it');
  const w2 = item(W, { ...sig(X), agent: X });
  assert.equal(w2.writer.ok, false);
  const ok = O.itemOf({ id: 'w2', ...W }, { kind: 'S', source: 'S', agent: 'S', event: 'S', channel: 'S', customer: 'S', amount: 'S', status: 'S', action: 'S', why: 'S', preview: 'S' },
    { ...WHO, agents: new Map([['S', 'service']]) }, {});
  assert.deepEqual([ok.writer.ok, ok.title, ok.risk, ok.open], [true, 'A customer is waiting', 2, true]);
  assert.deepEqual(ok.evidence, ['Why: the message failed the screen (zero-width) — no brain read it', 'Their message (preview, numbers masked): “refund my account £# thanks”', 'Customer: C3911']);
  assert.deepEqual(ok.actions, [{ act: 'release', value: 'service', label: 'Release it to the Service agent' }, { act: 'reply', value: '', label: 'Reply to the customer yourself' },
    { act: 'hostile', value: '', label: 'Confirm it is hostile' }]);
  // a free-text message at the door: its desk (the model's, or none → the Service agent), no preview → no preview line
  const door = item({ kind: 'waiting', source: 'unrouted', agent: 'door', event: '', channel: '', customer: '', status: 'open', action: '', why: '', desk: 'finance' }, sig(HUB, { desk: HUB }));
  assert.deepEqual([door.writer.ok, door.evidence, door.actions[0]], [true, ['Why: no desk took the message'], { act: 'release', value: 'finance', label: 'Release it to the Finance agent' }]);
  assert.equal(item({ kind: 'waiting', agent: 'door', channel: 'credit', desk: 'nope' }, sig(HUB)).actions[0].value, 'finance', 'no desk named: the job’s own');
  assert.equal(item({ kind: 'waiting', agent: 'door', channel: '' }, sig(HUB)).actions[0].value, 'service');
  // a draft: for a desk, the customer's words, what the check flagged
  const D = { kind: 'draft', agent: 'door', desk: 'finance', draft: 'Thanks — we are looking into it.', flags: 'it promises a refund no record holds — a person decides that, not the draft|a money message sent to sales — it belongs with finance or service', preview: 'I was charged twice', status: 'open', action: '', why: 'drafted' };
  const d = item(D, sig(HUB, { desk: HUB, draft: HUB, flags: HUB, preview: HUB }));
  assert.deepEqual([d.writer.ok, d.title, d.risk], [true, 'A drafted reply waits for a person — the model never sends', 2]);
  assert.deepEqual(d.evidence, ['For the Finance agent’s desk. The customer wrote: “I was charged twice”',
    'Check: it promises a refund no record holds — a person decides that, not the draft', 'Check: a money message sent to sales — it belongs with finance or service']);
  assert.deepEqual(d.actions.map((a) => a.act), ['send', 'discard']);
  assert.equal(item(D, sig(FIN)).writer.ok, false, 'only the door drafts');
  assert.deepEqual(item({ ...D, preview: '', flags: '' }, sig(HUB)).evidence, ['For the Finance agent’s desk']);
  // a review of a decision about a customer
  const R = { kind: 'review', agent: 'door', decidedBy: 'finance', was: 'release-payment', channel: 'fraud', domain: 'fraud', customer: 'C1', amount: 999, status: 'open', action: '', why: 'asked' };
  const r = item(R, sig(HUB, { decidedBy: HUB, was: HUB }));
  assert.deepEqual([r.writer.ok, r.title], [true, 'A customer asked a person to review a decision']);
  assert.deepEqual(r.evidence, ['The Finance agent decided: Release the £9.99 card payment.', 'UK GDPR Art. 22: a decision about a person, made by a machine, can be reviewed by a person on request.', 'Customer: C1 · £9.99 at stake']);
  assert.deepEqual(r.actions, [{ act: 'uphold', value: 'release-payment', label: 'Uphold it: Release the £9.99 card payment' }, { act: 'overturn', value: 'hold-payment', label: 'Overturn it: Hold the £9.99 card payment as fraud' }]);
  assert.deepEqual(item({ ...R, was: 'nope' }, sig(HUB)).actions, []);
  assert.equal(item({ ...R, was: 'nope' }, sig(HUB)).evidence[0], 'The Finance agent decided: not known.');
  assert.equal(item(R, sig(OPS)).writer.ok, false);
  // a regrown brain
  const B = { kind: 'promote', agent: 'finance', domain: 'fraud', channel: 'fraud', patternId: 'p2', fromPattern: 'p1', localAuc: 812, currentAuc: 790, n: 80, diff: 'adds +1 if V4 > 1.153', status: 'open', action: 'promote', why: 'beat it' };
  const b = item(B, sig(FIN, { domain: FIN, patternId: FIN, fromPattern: FIN, localAuc: FIN, currentAuc: FIN, n: FIN, diff: FIN }));
  assert.deepEqual([b.writer.ok, b.title, b.risk], [true, 'A regrown brain wants to replace the one in use — Card fraud, Finance agent', 2]);
  assert.deepEqual(b.evidence, ['On 80 outcomes neither brain had seen: AUC 0.790 now → 0.812 regrown.', 'What changes: adds +1 if V4 > 1.153']);
  assert.deepEqual(b.actions.map((a) => a.act), ['promote', 'refuse']);
  assert.equal(item({ ...B, domain: 'odd', diff: '' }, sig(FIN)).title, 'A regrown brain wants to replace the one in use — odd, Finance agent');
  assert.equal(item({ ...B, diff: '' }, sig(FIN)).evidence.length, 1);
  assert.equal(item(B, sig(OPS)).writer.ok, false, 'another agent cannot propose Finance’s brain');
  // a roll-back a person asked for: never open
  const RB = { kind: 'rollback', agent: 'finance', domain: 'fraud', channel: 'fraud', patternId: 'p1', status: 'approved', action: 'rollback', resolvedBy: 'Owner' };
  const rb = item(RB, sig(P, { domain: P, patternId: P }));
  assert.deepEqual([rb.writer.ok, rb.open, rb.forged, rb.chosenBy, rb.title, rb.evidence, rb.risk], [true, false, false, 'Owner', 'Roll back to an earlier brain — Card fraud, Finance agent', ['A person asked for brain p1 to be put back.'], 1]);
  assert.deepEqual([item(RB, sig(FIN)).writer.ok, item(RB, sig(FIN)).open], [false, false], 'an agent asking for a roll-back raises nothing a person chose');
  assert.equal(item({ ...RB, domain: 'odd' }, sig(P)).title, 'Roll back to an earlier brain — odd, Finance agent');
});

test('itemOf — how long it has waited on this device, in words; junk is an unreadable item, never a throw', () => {
  const at = (now, seen) => item(CALL, sig(FIN), { now, seen: new Map([['w1', seen]]) });
  assert.deepEqual([at(1000, 1000).age, at(1000, 1000).ageWords, at(1000, 1000).at], [0, '0 s', 1000]);
  assert.deepEqual([at(59999, 0).age, at(59999, 0).ageWords], [59999, '59 s']);
  assert.equal(at(60000, 0).ageWords, '1 min');
  assert.equal(at(3599999, 0).ageWords, '59 min');
  assert.equal(at(3600000, 0).ageWords, '1 h');
  assert.equal(at(86399999, 0).ageWords, '23 h');
  assert.equal(at(86400000, 0).ageWords, '1 day');
  assert.equal(at(172799999, 0).ageWords, '1 day');
  assert.equal(at(172800000, 0).ageWords, '2 days');
  assert.deepEqual([at(5, 10).age, at(5, 10).ageWords, at(5, 10).at], [-1, '', 10], 'a clock behind the first sighting: no age');
  assert.deepEqual([at(5, 'x').age, at(5, 'x').at], [-1, -1]);
  assert.deepEqual([item(CALL, sig(FIN), undefined).age, item(CALL, sig(FIN), undefined).ok], [-1, true]);
  assert.deepEqual([item(CALL, sig(FIN), { now: 'x', seen: new Map([['w1', 0]]) }).age], [-1]);
  for (const junk of [null, undefined, 7, 'x', [], { id: 7 }]) {
    const u = O.itemOf(junk, {}, WHO, {});
    assert.deepEqual([u.ok, u.open, u.title, u.actions], [false, false, 'An unreadable item', []]);
  }
  const toxic = { id: 'w9', get kind() { throw new Error('boom'); } };
  assert.equal(O.itemOf(toxic, {}, WHO, {}).ok, false);
  assert.equal(O.itemOf({ id: 'w', ...CALL }, null, null, null).ok, true, 'no signers, no roles: readable, raised by no one');
});

const items = () => [
  item({ ...CALL, amount: 500 }, sig(FIN)),                                                                             // money call £5
  O.itemOf({ id: 'w2', ...CALL, channel: 'intrusion', domain: 'intrusion', agent: 'systems', action: 'quarantine', amount: 0 }, sig('S'), { ...WHO, agents: new Map([['S', 'systems']]) }, {}),
  O.itemOf({ id: 'w3', ...CALL, channel: 'churn', domain: 'churn', agent: 'service', action: 'retain', amount: 0 }, sig('V'), { ...WHO, agents: new Map([['V', 'service']]) }, { now: 100, seen: new Map([['w3', 0]]) }),
  O.itemOf({ id: 'w4', kind: 'waiting', agent: 'door', channel: '', amount: 0, status: 'open' }, sig(HUB), WHO, { now: 100, seen: new Map([['w4', 50]]) }),
  O.itemOf({ id: 'w5', kind: 'draft', agent: 'door', desk: 'finance', amount: 0, status: 'open' }, sig(HUB), WHO, {}),
  O.itemOf({ id: 'w6', kind: 'review', agent: 'door', channel: 'fraud', was: 'hold-payment', amount: 90000, status: 'open' }, sig(HUB), WHO, {}),
  O.itemOf({ id: 'w7', kind: 'promote', agent: 'finance', domain: 'fraud', channel: 'fraud', amount: 0, status: 'open', action: 'promote' }, sig(FIN), WHO, {}),
  O.itemOf({ id: 'w8', ...CALL, channel: 'inventory', domain: 'inventory', agent: 'ops', action: 'raise-po', amount: 150000 }, sig(OPS), WHO, { now: 100, seen: new Map([['w8', 0]]) }),
  O.itemOf({ id: 'w9', ...CALL, status: 'approved', action: 'release-payment' }, sig(FIN, { status: P, action: P }), WHO, {}),   // decided: not on the list
];

test('queue: the open items, counted; sorted by risk, by money or by age; filtered by kind of work', () => {
  const q = O.queue(items());
  assert.deepEqual([q.waiting, q.shown], [8, 8]);
  assert.deepEqual(q.counts, { customers: 1, drafts: 1, reviews: 1, brains: 1, calls: 4, money: 2, security: 1 });
  assert.deepEqual(q.items.map((i) => i.id), ['w8', 'w1', 'w2', 'w6', 'w4', 'w5', 'w7', 'w3'], 'risk, then money, then write order');
  assert.deepEqual(O.queue(items(), { sort: 'money' }).items.map((i) => i.id), ['w8', 'w6', 'w1', 'w2', 'w4', 'w5', 'w7', 'w3'], 'money, then risk, then write order');
  assert.deepEqual(O.queue(items(), { sort: 'age' }).items.map((i) => i.id), ['w3', 'w8', 'w4', 'w1', 'w2', 'w5', 'w6', 'w7'], 'oldest first; seen at 0 counts as seen');
  assert.deepEqual(O.queue(items(), { filter: 'customers' }).items.map((i) => i.id), ['w6', 'w4', 'w5']);
  assert.deepEqual(O.queue(items(), { filter: 'money' }).items.map((i) => i.id), ['w8', 'w1']);
  assert.deepEqual(O.queue(items(), { filter: 'security' }).items.map((i) => i.id), ['w2']);
  assert.deepEqual(O.queue(items(), { filter: 'brains' }).items.map((i) => i.id), ['w7']);
  assert.deepEqual(O.queue(items(), { filter: 'other' }).items.map((i) => i.id), ['w3']);
  assert.deepEqual(O.queue(items(), { filter: 'all', sort: 'nope' }).items.map((i) => i.id), q.items.map((i) => i.id));
  assert.deepEqual(O.queue(items(), { filter: 'constructor' }).shown, 8);
  const f = O.queue(items(), { filter: 'customers' });
  assert.deepEqual([f.shown, f.waiting], [3, 8], 'the count is of everything waiting, whatever is shown');
  // the same id twice (never on a real list): the order given is kept
  const a = { ...items()[0], tag: 'a' }, b = { ...items()[0], tag: 'b' };
  for (const s of ['risk', 'money', 'age']) {
    assert.deepEqual(O.queue([a, b], { sort: s }).items.map((i) => i.tag), ['a', 'b'], s);
    assert.deepEqual(O.queue([b, a], { sort: s }).items.map((i) => i.tag), ['b', 'a'], s);
  }
  for (const junk of [null, 'x', [null, 7, { ok: true, open: false }]]) assert.deepEqual(O.queue(junk), { items: [], shown: 0, waiting: 0, counts: { customers: 0, drafts: 0, reviews: 0, brains: 0, calls: 0, money: 0, security: 0 } });
  assert.equal(O.queue([{ ok: true, open: true, get kind() { throw new Error('x'); } }]).shown, 0);
});

test('bulkPlan: the held proposals a person may accept in one go under a £ limit — never a security call, never one another device raised', () => {
  const all = items();
  assert.deepEqual(O.bulkPlan(all, 500), { ids: ['w1', 'w3'], n: 2, total: 500, words: 'Accept 2 proposals of £5 or less (£5 in all)' });
  assert.deepEqual(O.bulkPlan(all, 499), { ids: ['w3'], n: 1, total: 0, words: 'Accept 1 proposal of £4.99 or less (£0 in all)' });
  assert.deepEqual(O.bulkPlan(all, 150000).ids, ['w1', 'w3', 'w8']);
  assert.deepEqual(O.bulkPlan(all, 0).ids, ['w3'], 'a £0 limit takes the calls with nothing at stake');
  for (const bad of [-1, 1.5, '500', null]) assert.deepEqual(O.bulkPlan(all, bad), { ids: [], n: 0, total: 0, words: 'Nothing held is at or under £0' }, String(bad));
  const forged = O.itemOf({ id: 'wf', ...CALL, amount: 1 }, sig(OPS), WHO, {});
  const noProposal = O.itemOf({ id: 'wn', ...CALL, amount: 1, action: '' }, sig(FIN), WHO, {});
  assert.deepEqual(O.bulkPlan([forged, noProposal, null, { ...all[0], ok: false }, { ...all[0], open: false }], 1e9).ids, []);
  assert.deepEqual(O.bulkPlan('x', 5), { ids: [], n: 0, total: 0, words: 'Nothing held is at or under £0.05' });
  assert.deepEqual(O.bulkPlan([{ ok: true, open: true, kind: 'call', proposal: 'x', get writer() { throw new Error('x'); } }], 5), { ids: [], n: 0, total: 0, words: 'Nothing to accept' });
});

test('falsePositives: of the messages the screen quarantined, the share a person released as genuine', () => {
  const q = (id, done, action, source = 'quarantined') => O.itemOf({ id, kind: 'waiting', source, agent: 'service', channel: 'churn', status: done ? 'released' : 'open', action },
    done ? { kind: 'S', agent: 'S', status: P, action: P } : { kind: 'S', agent: 'S' }, { ...WHO, agents: new Map([['S', 'service']]) }, {});
  assert.deepEqual(O.falsePositives([q('a', true, 'release'), q('b', false, ''), q('c', false, ''), q('d', true, 'release', 'unrouted')]), { quarantined: 3, released: 1, permille: 333 });
  assert.deepEqual(O.falsePositives([q('a', true, 'release'), q('b', true, 'release')]), { quarantined: 2, released: 2, permille: 1000 });
  const hostile = O.itemOf({ id: 'h', kind: 'waiting', source: 'quarantined', agent: 'service', status: 'hostile', action: 'hostile' }, { kind: 'S', agent: 'S', status: P, action: P }, { ...WHO, agents: new Map([['S', 'service']]) }, {});
  assert.deepEqual(O.falsePositives([hostile]), { quarantined: 1, released: 0, permille: 0 }, 'confirmed hostile: a true positive');
  assert.deepEqual(O.falsePositives([]), { quarantined: 0, released: 0, permille: null });
  assert.deepEqual(O.falsePositives([{ ...CALL, ok: true, kind: 'call', record: { source: 'quarantined' } }, null, { ok: true, kind: 'waiting', record: null }]), { quarantined: 0, released: 0, permille: null });
  assert.deepEqual(O.falsePositives('x'), { quarantined: 0, released: 0, permille: null });
  assert.deepEqual(O.falsePositives([{ ok: true, kind: 'waiting', get record() { throw new Error('x'); } }]), { quarantined: 0, released: 0, permille: null });
});

test('policyForm and policyWords: the money limit (£ → pence), the confidence floor, the automatic pause — refusals in words', () => {
  const ok = (limit, floor = '0.05', autoPause = true) => O.policyForm({ limit, floor, autoPause });
  assert.deepEqual(ok('500'), { ok: true, fields: { moneyLimit: 50000, minConfidence: 50, autoPause: true } });
  assert.deepEqual(ok('£1,250.50', '0.1', false), { ok: true, fields: { moneyLimit: 125050, minConfidence: 100, autoPause: false } });
  assert.deepEqual(ok(' £ 12.5 ', '.35').fields, { moneyLimit: 1250, minConfidence: 350, autoPause: true });
  assert.deepEqual(ok('0', '0').fields, { moneyLimit: 0, minConfidence: 0, autoPause: true });
  assert.deepEqual(ok('7', '1').fields.minConfidence, 1000);
  assert.deepEqual(ok('7', '1.000').fields.minConfidence, 1000);
  assert.deepEqual(ok('1000000000').fields.moneyLimit, 1e11, 'exactly the largest limit');
  assert.deepEqual(ok('1000000000.01'), { ok: false, field: 'limit', why: O.POLICY_WHY['limit-size'] });
  assert.deepEqual(ok('999999999999'), { ok: false, field: 'limit', why: O.POLICY_WHY['limit-size'] });
  for (const bad of ['', '£', '-5', '5.123', '1,00', '5k', 'five', '1 000', null, 7]) assert.deepEqual(ok(bad), { ok: false, field: 'limit', why: 'the money limit is pounds and pence, like 500 or £1,250.50 — 0 means no limit' }, String(bad));
  for (const bad of ['', '1.5', '2', '-0.1', '0.1234', 'x', null, 0.1]) assert.deepEqual(ok('5', bad), { ok: false, field: 'floor', why: 'the confidence floor is a number from 0 to 1, like 0.10' }, String(bad));
  // called directly: the helper's default would turn undefined into true
  for (const bad of ['on', 1, null, undefined]) assert.deepEqual(O.policyForm({ limit: '5', floor: '0.1', autoPause: bad }), { ok: false, field: 'pause', why: 'the automatic pause is on or off' }, String(bad));
  assert.deepEqual(O.policyForm(null), { ok: false, field: 'limit', why: O.POLICY_WHY.limit });
  // what a person reads back
  assert.deepEqual(O.policyWords({ moneyLimit: 50000, minConfidence: 100, autoPause: true }), [
    'Money limit £500: above it, a person decides any act that commits money — letting a payment through, standard credit terms, a purchase order.',
    'Confidence floor 0.100: a normal call with less certainty than this needs a second brain to agree; money and security calls always do.',
    'The behaviour watch (automatic) pauses an agent that stops behaving like itself, until a person clears it.']);
  assert.deepEqual(O.policyWords({ moneyLimit: 0, minConfidence: 0, autoPause: false }), [
    'No money limit: the agents act on money calls a second brain confirms, at any amount.',
    'Confidence floor 0.000: a normal call with less certainty than this needs a second brain to agree; money and security calls always do.',
    'The behaviour watch (automatic) only flags an agent; a person decides whether to pause it.']);
  assert.deepEqual(O.policyWords({ moneyLimit: 1, minConfidence: -1 }).slice(0, 2).map((s) => s.split(':')[0]), ['Money limit £0.01', 'Confidence floor 0.050']);
  for (const junk of [null, 7, 'x', { moneyLimit: 1.5, minConfidence: 'x' }]) assert.deepEqual(O.policyWords(junk).map((s) => s.split(':')[0]), ['No money limit', 'Confidence floor 0.050', 'The behaviour watch (automatic) pauses an agent that stops behaving like itself, until a person clears it.']);
});

test('ruleDiff and diffText: a regrown brain against the one in use, rule by rule, in plain words', () => {
  const A = { threshold: 2, rules: [{ feat: 'V3', op: '>', v: 0.748905, w: -1 }, { feat: 'V14', op: '<=', v: -0.838428, w: 0.5 }, { feat: 'V4', op: '>', v: 1.152671, w: 2 }, { feat: 'V4', op: '>', v: 3, w: 1 }] };
  const B = { threshold: 1.5, rules: [{ feat: 'V3', op: '>', v: 0.748905, w: -0.5 }, { feat: 'V4', op: '>', v: 1.152671, w: 2 }, { feat: 'V4', op: '>', v: 3.5, w: 1 }, { feat: 'V16', op: '>', v: -0.959881, w: 0 }] };
  const d = O.ruleDiff(A, B);
  assert.deepEqual(d, { ok: true, added: [B.rules[3]], removed: [A.rules[1]], changed: [{ key: 'V3 >', from: A.rules[0], to: B.rules[0] }, { key: 'V4 >', from: A.rules[3], to: B.rules[2] }], threshold: { from: 2, to: 1.5 }, same: 1 });
  assert.equal(O.diffText(d), 'adds 0 if V16 > -0.96; drops +0.5 if V14 ≤ -0.838; changes -1 if V3 > 0.749 → -0.5 if V3 > 0.749; changes +1 if V4 > 3 → +1 if V4 > 3.5; moves the line it acts above from 2 to 1.5 (1 rule unchanged)');
  const same = O.ruleDiff(A, A);
  assert.deepEqual(same, { ok: true, added: [], removed: [], changed: [], threshold: null, same: 4 });
  assert.equal(O.diffText(same), 'the same rules (4 rules unchanged)');
  assert.equal(O.diffText(O.ruleDiff({ threshold: 1, rules: [] }, { threshold: 1, rules: [] })), 'the same rules');
  // a change below the third decimal is no change on the page
  assert.equal(O.ruleDiff(A, { ...A, rules: A.rules.map((r, i) => (i ? r : { ...r, v: r.v + 0.0001 })) }).changed.length, 0);
  assert.equal(O.ruleDiff(A, { ...A, rules: A.rules.map((r, i) => (i ? r : { ...r, w: -0.9 })) }).changed.length, 1);
  assert.deepEqual(O.ruleDiff(null, B), { ok: false, added: [], removed: [], changed: [], threshold: null, same: 0 });
  assert.equal(O.diffText(O.ruleDiff(A, 'x')), 'the two brains could not be compared');
  assert.equal(O.diffText(null), 'the two brains could not be compared');
});

const dec = (id, at, channel, action, state = 'done', extra = {}) => ({ id, agent: 'ops', event: 'e' + String(at).padStart(6, '0'), channel, domain: channel, action, state, by: 'own', cross: true, customer: 'C' + at, ...extra });
const DECS = [dec('d01', 1, 'inventory', 'raise-po'), dec('d02', 2, 'energy', 'normal-load'), dec('d03', 3, 'maintenance', 'release-payment'), dec('d04', 4, 'inventory', 'no-reorder'), dec('d05', 5, 'energy', 'quarantine'), dec('d06', 6, 'inventory', '', 'watch')];

test('firstSign and theftList: what a key decided from where the trouble began, each act and whether it fits the work', () => {
  assert.equal(O.firstSign(DECS, ''), 'd03', 'the first act its work does not call for');
  assert.equal(O.firstSign(DECS, 'd03'), 'd05', 'after a clearance at d03: judged afresh');
  assert.equal(O.firstSign(DECS, 'd02'), 'd03');
  assert.equal(O.firstSign(DECS.slice(0, 2), ''), '');
  assert.equal(O.firstSign([dec('d01', 1, 'inventory', 'raise-po'), dec('d02', 1, 'inventory', 'raise-po')], ''), 'd02', 'the same work twice');
  assert.equal(O.firstSign([...DECS].reverse(), ''), 'd03', 'in any order');
  assert.equal(O.firstSign(null, ''), '');
  const t = O.theftList(DECS, 'd03');
  assert.deepEqual([t.ok, t.from, t.n, t.fits, t.offWork], [true, 'd03', 4, 2, 2]);
  assert.deepEqual(t.list.map((x) => [x.id, x.event, x.channel, x.customer, x.action, x.state, x.words, x.fits, x.why]), [
    ['d03', 'e000003', 'maintenance', 'C3', 'release-payment', 'done', 'Release the card payment', false, 'an act its work does not call for'],
    ['d04', 'e000004', 'inventory', 'C4', 'no-reorder', 'done', 'Do not reorder yet', true, ''],
    ['d05', 'e000005', 'energy', 'C5', 'quarantine', 'done', 'Quarantine the host', false, 'an act its work does not call for'],
    ['d06', 'e000006', 'inventory', 'C6', '', 'watch', 'held it for a person', true, '']]);
  assert.equal(O.theftList([dec('d09', 9, 'energy', 'do-a-dance')], 'd09').list[0].words, 'did “do-a-dance”');
  assert.equal(O.theftList([...DECS].reverse(), 'd05').list.map((x) => x.id).join(), 'd05,d06');
  assert.deepEqual(O.theftList(DECS, 'd99').n, 0);
  for (const from of ['', null, 7]) assert.deepEqual(O.theftList(DECS, from), { ok: false, from: '', n: 0, fits: 0, offWork: 0, list: [] });
  assert.deepEqual(O.theftList('x', 'd01'), { ok: false, from: '', n: 0, fits: 0, offWork: 0, list: [] });
  assert.equal(O.theftList([null, 7, { id: 5 }, dec('d07', 7, 'energy', 'shed-load')], 'd01').n, 1);
});

test('reviewable and reviewItem: only a finished decision about a customer — the door raises one item per decision', () => {
  const d = { agent: 'finance', event: 'e000042', channel: 'credit', action: 'standard-terms', state: 'done', customer: 'C42' };
  assert.deepEqual(O.reviewable(d), { ok: true, why: '' });
  assert.deepEqual(O.reviewable({ ...d, channel: 'inventory', action: 'raise-po' }), { ok: false, why: 'only a decision about a customer can be reviewed' });
  assert.deepEqual(O.reviewable({ ...d, state: 'watch' }), { ok: false, why: 'it is already waiting for a person' });
  assert.deepEqual(O.reviewable({ ...d, action: 'retain' }), { ok: false, why: 'the decision names no act to review' });
  assert.deepEqual(O.reviewable({ ...d, customer: '' }), { ok: false, why: 'no customer is named on it' });
  assert.deepEqual(O.reviewable(null), { ok: false, why: 'the decision could not be read' });
  for (const c of ['shopper', 'churn', 'fraud', 'credit']) assert.equal(O.reviewable({ ...d, channel: c, action: { shopper: 'nurture', churn: 'retain', fraud: 'hold-payment', credit: 'upfront-terms' }[c] }).ok, true, c);
  assert.deepEqual(O.reviewItem(d, 5000), { id: 'rv-e000042', fields: { kind: 'review', agent: 'door', decidedBy: 'finance', was: 'standard-terms', event: 'e000042', domain: 'credit', channel: 'credit',
    action: '', label: -1, customer: 'C42', amount: 5000, why: 'the customer asked for a person to review this decision', status: 'open' } });
  assert.equal(O.reviewItem(d, -3).fields.amount, 0);
  assert.equal(O.reviewItem({ ...d, state: 'watch' }, 1), null);
});

test('choiceFields: what a person writes for each choice — only a choice that fits an open item its own agent raised', () => {
  const call = item(CALL, sig(FIN));
  assert.deepEqual(O.choiceFields(call, 'choose', 'release-payment', 'Overseer (a person)'), { status: 'approved', action: 'release-payment', resolvedBy: 'Overseer (a person)' });
  assert.equal(O.choiceFields(call, 'choose', 'retain', 'x'), null, 'an act of another job');
  assert.equal(O.choiceFields(call, 'choose', '', 'x'), null);
  assert.equal(O.choiceFields(call, 'release', 'finance', 'x'), null, 'not a choice for a held call');
  assert.equal(O.choiceFields(item(CALL, sig(OPS)), 'choose', 'hold-payment', 'x'), null, 'raised in Finance’s name by another device');
  assert.equal(O.choiceFields(item({ ...CALL, status: 'approved', action: 'hold-payment' }, sig(FIN, { status: P, action: P })), 'choose', 'hold-payment', 'x'), null, 'already decided');
  assert.equal(O.choiceFields(item({ ...CALL, channel: 'nope' }, sig(FIN)), 'choose', 'hold-payment', 'x'), null);
  const W = O.itemOf({ id: 'ww', kind: 'waiting', agent: 'door', channel: '', status: 'open' }, sig(HUB), WHO, {});
  assert.deepEqual(O.choiceFields(W, 'release', 'finance', 'Owner'), { status: 'released', action: 'release', resolvedBy: 'Owner', releasedTo: 'finance' });
  assert.equal(O.choiceFields(W, 'release', 'audit', 'Owner'), null, 'not a desk');
  assert.deepEqual(O.choiceFields(W, 'reply', '  Sorry — a colleague will call you today.  ', 'Owner'), { status: 'replied', action: 'reply', resolvedBy: 'Owner', reply: 'Sorry — a colleague will call you today.' });
  assert.equal(O.choiceFields(W, 'reply', '   ', 'Owner'), null);
  assert.equal(O.choiceFields(W, 'reply', 'x'.repeat(O.MAX_REPLY), 'Owner').reply.length, O.MAX_REPLY);
  assert.equal(O.choiceFields(W, 'reply', 'x'.repeat(O.MAX_REPLY + 1), 'Owner'), null);
  assert.equal(O.choiceFields(W, 'reply', 7, 'Owner'), null);
  assert.deepEqual(O.choiceFields(W, 'hostile', '', 'Owner'), { status: 'hostile', action: 'hostile', resolvedBy: 'Owner' });
  const D = O.itemOf({ id: 'wd', kind: 'draft', agent: 'door', status: 'open' }, sig(HUB), WHO, {});
  assert.deepEqual(O.choiceFields(D, 'send', 'Thanks — we will look today.', 'Owner'), { status: 'sent', action: 'send', resolvedBy: 'Owner', reply: 'Thanks — we will look today.' });
  assert.deepEqual(O.choiceFields(D, 'discard', '', 'Owner'), { status: 'discarded', action: 'discard', resolvedBy: 'Owner' });
  const R = O.itemOf({ id: 'wr', kind: 'review', agent: 'door', channel: 'fraud', was: 'release-payment', status: 'open' }, sig(HUB), WHO, {});
  assert.deepEqual(O.choiceFields(R, 'overturn', 'hold-payment', 'Owner'), { status: 'approved', action: 'hold-payment', resolvedBy: 'Owner' });
  assert.equal(O.choiceFields(R, 'overturn', 'release-payment', 'Owner'), null, 'an overturn is the other act');
  assert.deepEqual(O.choiceFields(R, 'uphold', '', 'Owner'), { status: 'upheld', action: 'uphold', resolvedBy: 'Owner' });
  const B = O.itemOf({ id: 'wb', kind: 'promote', agent: 'finance', domain: 'fraud', status: 'open', action: 'promote' }, sig(FIN), WHO, {});
  assert.deepEqual(O.choiceFields(B, 'promote', '', 'Owner'), { status: 'approved', action: 'promote', resolvedBy: 'Owner' });
  assert.deepEqual(O.choiceFields(B, 'refuse', '', 7), { status: 'refused', action: 'refuse', resolvedBy: '' });
  assert.equal(O.choiceFields(null, 'promote', '', 'x'), null);
  assert.equal(O.choiceFields({ open: true, writer: { ok: true }, kind: 'nope' }, 'promote', '', 'x'), null);
  assert.deepEqual(O.STATUS_OF, { choose: 'approved', release: 'released', reply: 'replied', hostile: 'hostile', send: 'sent', discard: 'discarded', uphold: 'upheld', overturn: 'approved', promote: 'approved', refuse: 'refused', rollback: 'approved' });
});

test('brainHistory: the brain changes a person approved, newest first — and the one that may be rolled back', () => {
  const pr = (id, patternId, from, status, signers = { status: Q, action: Q }) => O.itemOf({ id, kind: 'promote', agent: 'finance', domain: 'fraud', channel: 'fraud', patternId, fromPattern: from, status, action: 'promote', resolvedBy: 'Overseer (a person)' },
    sig(FIN, signers), WHO, {});
  const rows = O.brainHistory([pr('p1', 'b1', 'b0', 'executed', { status: FIN, action: Q }), pr('p2', 'b2', 'b1', 'executed', { status: FIN, action: Q }), pr('p3', 'b3', 'b2', 'approved'),
    pr('p4', 'b4', 'b3', 'approved', { status: FIN, action: FIN }), O.itemOf({ id: 'p5', kind: 'promote', agent: 'finance', domain: 'fraud', status: 'refused', action: 'refuse' }, sig(FIN, { status: Q, action: Q }), WHO, {})],
  { 'finance/fraud': 'b2' });
  assert.deepEqual(rows.map((r) => [r.id, r.carried, r.rollback, r.by]), [['p3', false, false, 'Overseer (a person)'], ['p2', true, true, 'Overseer (a person)'], ['p1', true, false, 'Overseer (a person)']],
    'p4 an agent approved itself; p5 a person refused — neither is in the history');
  assert.deepEqual(rows[1], { id: 'p2', kind: 'promote', agent: 'finance', domain: 'fraud', patternId: 'b2', fromPattern: 'b1', by: 'Overseer (a person)', carried: true, rollback: true });
  // a roll-back a person made: in the history, newest; the promotion it undid can no longer be rolled back
  const rb = O.itemOf({ id: 'p6', kind: 'rollback', agent: 'finance', domain: 'fraud', channel: 'fraud', patternId: 'b1', status: 'executed', action: 'rollback', resolvedBy: 'Owner' }, sig(P, { status: FIN, action: P }), WHO, {});
  const after = O.brainHistory([pr('p2', 'b2', 'b1', 'executed', { status: FIN, action: Q }), rb], { 'finance/fraud': 'b1' });
  assert.deepEqual(after.map((r) => [r.id, r.kind, r.rollback]), [['p6', 'rollback', false], ['p2', 'promote', false]]);
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', '', 'executed', { status: FIN, action: Q })], { 'finance/fraud': 'b2' })[0].rollback, false, 'nothing to roll back to');
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', 'b1', 'executed', { status: FIN, action: Q })], {})[0].rollback, false, 'no longer the brain in use');
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', 'b1', 'executed', { status: FIN, action: Q }), pr('p7', 'b2', 'b1', 'executed', { status: FIN, action: Q })], { 'finance/fraud': 'b2' }).map((r) => r.rollback), [true, false], 'only the newest');
  assert.deepEqual(O.brainHistory(null, {}), []);
  assert.deepEqual(O.brainHistory([{ ok: true, kind: 'promote', open: false, get record() { throw new Error('x'); } }], {}), []);
});

test('the kernel’s tables: every kind has its choices, every agent its desk or none, nothing throws on junk', () => {
  assert.deepEqual(O.KINDS, ['call', 'waiting', 'draft', 'review', 'promote', 'rollback']);
  assert.deepEqual(Object.keys(O.CHOICES), O.KINDS);
  assert.deepEqual(O.DESKS, AGENTS.filter((a) => a.domains.length).map((a) => a.id));
  assert.deepEqual([O.SORTS, O.FILTERS], [['risk', 'money', 'age'], ['all', 'customers', 'money', 'security', 'brains', 'other']]);
  assert.ok(O.CREATOR_FIELDS.length <= 32 && !O.CREATOR_FIELDS.includes('status') && !O.CREATOR_FIELDS.includes('action'));
  const toxic = { get id() { throw new Error('boom'); }, toString() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1];
  for (const [name, fn] of Object.entries(O).filter(([, v]) => typeof v === 'function')) for (const a of JUNK) for (const b of JUNK.slice(0, 7)) assert.doesNotThrow(() => fn(a, b, a, b), name);
});


test('the edges: each count on its own, a draft or review only the door raises, a roll-back only for the brain in use, junk records unreadable', () => {
  // without w3 there are 3 held calls and 4 other open items — no count can stand in for another
  const q = O.queue(items().filter((i) => i.id !== 'w3'));
  assert.deepEqual(q.counts, { customers: 1, drafts: 1, reviews: 1, brains: 1, calls: 3, money: 2, security: 1 });
  assert.equal(q.waiting, 7);
  // a draft or a review raised by a person, not the door: not raised right, so no choice is offered
  for (const kind of ['draft', 'review']) {
    const i = O.itemOf({ id: 'k-' + kind, kind, agent: 'door', channel: 'fraud', was: 'hold-payment', status: 'open' }, sig(P), WHO, {});
    assert.equal(i.writer.ok, false, kind);
    assert.deepEqual(i.actions, [], kind);
    assert.equal(O.itemOf({ id: 'k-' + kind, kind, agent: 'door', channel: 'fraud', was: 'hold-payment', status: 'open' }, sig(HUB), WHO, {}).writer.ok, true, kind);
  }
  // a promotion that was carried out but is not the brain in use now cannot be rolled back
  const pr = (id, patternId, from) => O.itemOf({ id, kind: 'promote', agent: 'finance', domain: 'fraud', channel: 'fraud', patternId, fromPattern: from, status: 'executed', action: 'promote', resolvedBy: 'Overseer (a person)' }, sig(FIN, { status: FIN, action: Q }), WHO, {});
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', 'b1')], { 'finance/fraud': 'b9' }).map((r) => [r.id, r.rollback]), [['p2', false]]);
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', 'b1')], { 'finance/fraud': 'b2' }).map((r) => [r.id, r.rollback]), [['p2', true]]);
  assert.deepEqual(O.brainHistory([pr('p2', 'b2', 'b1')], {}).map((r) => [r.id, r.rollback]), [['p2', false]]);
  // a record with no readable id is an unreadable item, never a throw
  for (const junk of [null, undefined, 7, 'w1', {}, { id: 5 }, { id: null }]) assert.equal(O.itemOf(junk, {}, WHO, {}).ok, false, String(junk));
  assert.equal(O.itemOf({ id: 'ok' }, {}, WHO, {}).ok, true);
  // a regrown brain with a rule repeated: each copy matched in order, nothing invented
  const r = (feat, op, v, w) => ({ feat, op, v, w });
  const d = O.ruleDiff({ rules: [r('a', '>', 1, 1), r('a', '>', 2, 1)], threshold: 0.5 }, { rules: [r('a', '>', 1, 1), r('a', '>', 3, 1), r('a', '>', 4, 1)], threshold: 0.5 });
  assert.deepEqual([d.added.length, d.removed.length, d.changed.length, d.same], [1, 0, 1, 1]);
  assert.deepEqual(d.changed[0].from.v, 2);
  assert.deepEqual(d.changed[0].to.v, 3);
  assert.deepEqual(d.added[0].v, 4);
});
