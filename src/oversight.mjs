// oversight.mjs — the people's side of the company. Pure, total, deterministic.
//
// Six agents run the work; two people — the owner and the overseer, an admin — watch. Everything that waits for a
// person lands on one list: a call no brain could confirm, a customer whose message no desk took, a reply a model
// drafted, a customer's request for a person to review a decision, a regrown brain that wants to replace the one in use.
// This kernel turns the records on the spine into that list, with the evidence a person needs for each item — why it
// waits, how sure the brain was against its decision line, the money at stake, the customer, how long it has waited —
// and the choices, in plain words and pounds, with none of them pre-chosen.
//
// It reads WHO wrote each field, never the names a record carries: every agent may write the shared collections, so a
// record that says "the Finance agent" proves nothing. An item counts as the agent's only if that agent's own key wrote
// it; a choice counts only if a PERSON's key (the owner, or a live admin) wrote it. A choice another device wrote is
// shown as ignored and the item keeps waiting. The rules a person sets (the money limit, the confidence floor, the
// automatic pause) are read and written here too, and so are the after-a-theft list and a brain's rule-by-rule change.
import { ACTIONS, MAX_LIMIT, opposite } from './agent.mjs';
import { OWNER_OF, CUSTOMER_JOBS, JOBS, agentName } from './company.mjs';
import { offWork, readDecision } from './watch.mjs';

export const KINDS = Object.freeze(['call', 'waiting', 'draft', 'review', 'promote', 'rollback']);
/** What a person may write on an item, by kind — each a status and the action that goes with it. */
export const CHOICES = Object.freeze({
  call: Object.freeze(['choose']),
  waiting: Object.freeze(['release', 'reply', 'hostile']),
  draft: Object.freeze(['send', 'discard']),
  review: Object.freeze(['uphold', 'overturn']),
  promote: Object.freeze(['promote', 'refuse']),
  rollback: Object.freeze([]),
});
/** The status each choice writes (the action field carries the choice itself, or the act chosen for a call). */
export const STATUS_OF = Object.freeze({ choose: 'approved', release: 'released', reply: 'replied', hostile: 'hostile', send: 'sent', discard: 'discarded',
  uphold: 'upheld', overturn: 'approved', promote: 'approved', refuse: 'refused', rollback: 'approved' });
const PERSON_STATUS = new Set(Object.values(STATUS_OF));
// the fields that make an item what it is — written once, by whoever raised it
export const CREATOR_FIELDS = Object.freeze(['kind', 'agent', 'event', 'domain', 'label', 'why', 'customer', 'amount', 'channel', 'conf', 'floor', 'source', 'preview',
  'desk', 'draft', 'flags', 'was', 'decidedBy', 'patternId', 'fromPattern', 'localAuc', 'currentAuc', 'n', 'diff']);
export const SECURITY_JOBS = Object.freeze(['intrusion']);
export const MONEY_JOBS = Object.freeze(['fraud', 'credit', 'inventory']);
export const SORTS = Object.freeze(['risk', 'money', 'age']);
export const FILTERS = Object.freeze(['all', 'customers', 'money', 'security', 'brains', 'other']);
export const DESKS = Object.freeze(['sales', 'service', 'finance', 'ops', 'systems']);
export const MAX_REPLY = 1200;

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const str = (x, n = 300) => (typeof x === 'string' ? x.slice(0, n) : '');
const nat = (x) => (Number.isSafeInteger(x) ? Math.max(0, x) : 0);
const inSet = (s, x) => { try { return s.has(x); } catch { return false; } };
const fromMap = (m, k) => { try { return m.get(k); } catch { return undefined; } };
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const jobOf = (ch) => (own(ACTIONS, ch) ? ACTIONS[ch] : null);
const jobWords = (ch) => (own(JOBS, ch) ? JOBS[ch] : '');

/** Whole pence → '£1,234.50' ('£500' when there are no pence). */
export function pounds(p) {
  const n = nat(p);
  const pence = n % 100;
  return '£' + thousands(Math.floor(n / 100)) + (pence ? '.' + String(pence).padStart(2, '0') : '');
}

// ── what each choice does, in plain words ────────────────────────────────────────────────────────────────────────
const WORDS = Object.freeze({
  'fast-track': (m) => 'Fast-track this visitor' + (m ? ' (a ' + m + ' basket)' : '') + ' into the CRM',
  nurture: () => 'Leave the visitor on the normal path',
  retain: () => 'Send the customer a retention offer',
  'standard-reply': () => 'Give the customer the standard reply',
  'release-payment': (m) => 'Release the ' + (m || 'card') + (m ? ' card payment' : ' payment'),
  'hold-payment': (m) => 'Hold the ' + (m || 'card') + (m ? ' card payment' : ' payment') + ' as fraud',
  'upfront-terms': () => 'Ask the customer for payment up front',
  'standard-terms': () => 'Give the customer standard 30-day terms',
  'raise-po': (m) => 'Raise a ' + (m ? m + ' ' : '') + 'purchase order to restock',
  'no-reorder': () => 'Do not reorder yet',
  'schedule-service': () => 'Book the machine in for a service',
  'keep-running': () => 'Keep the machine running',
  'shed-load': () => 'Shed non-critical load',
  'normal-load': () => 'Keep the normal load',
  quarantine: () => 'Quarantine the host',
  allow: () => 'Allow the connection',
});
/** An act, in plain words, with the money it moves. '' for an act no job defines. */
export function actionWords(action, amount) {
  try { return own(WORDS, action) ? WORDS[action](nat(amount) ? pounds(amount) : '') : ''; } catch { return ''; }
}

// ── who wrote it ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Who a key is, by this device's role tree: { role: 'person' | 'agent' | 'hub' | 'unknown', agent, name }. who = { people:
 *  Set of person keys, agents: Map key → agent id (fired agents too: their old records still name their writer), hubs: Set,
 *  names: Map key → a person's or device's name }. */
export function keyIs(pub, who) {
  const w = who !== null && typeof who === 'object' ? who : {};
  const name = str(fromMap(w.names, pub), 60);
  if (inSet(w.people, pub)) return { role: 'person', agent: '', name: name || 'a person' };
  const a = fromMap(w.agents, pub);
  if (typeof a === 'string' && a) return { role: 'agent', agent: a, name: agentName(a) };
  if (inSet(w.hubs, pub)) return { role: 'hub', agent: '', name: name || 'the office hub' };
  return { role: 'unknown', agent: '', name: typeof pub === 'string' && pub ? 'a device ' + pub.slice(0, 8) : 'no single device' };
}

/** The one key that wrote every one of `fields` a record holds — '' when two keys did (written over), or none did. */
export function soleWriter(signers, fields) {
  try {
    const by = new Set(fields.filter((k) => own(signers, k)).map((k) => signers[k]));
    return by.size === 1 ? [...by][0] : '';
  } catch { return ''; }
}

/**
 * G1 — a decision (or any record that names an agent) and the key that wrote it → { ok, words, name, role }. ok only when
 * the key the role tree gives that agent wrote it; anything else is "written by another device", never shown as theirs.
 */
export function attribution(named, pub, who) {
  const k = keyIs(pub, who);
  const theirs = str(named, 40);
  if (!pub) return { ok: false, role: 'unknown', name: '', words: 'written over by more than one device — not shown as anyone’s' };
  if (k.role === 'agent' && k.agent === theirs) return { ok: true, role: 'agent', name: k.name, words: 'signed by the ' + k.name + '’s own key' };
  return { ok: false, role: k.role, name: k.name, words: 'written by another device (' + (k.role === 'agent' ? 'the ' : '') + k.name + ') — not the ' + agentName(theirs) + '’s' };
}

// which kind of key may raise each kind of item
function raisedRight(kind, rec, k) {
  if (kind === 'rollback') return k.role === 'person';
  if (kind === 'draft' || kind === 'review') return k.role === 'hub';
  if (rec.agent === 'door') return k.role === 'hub' || k.role === 'person';
  return k.role === 'agent' && k.agent === rec.agent;
}

const ageWords = (ms) => (ms < 60000 ? Math.floor(ms / 1000) + ' s' : ms < 3600000 ? Math.floor(ms / 60000) + ' min' : ms < 86400000 ? Math.floor(ms / 3600000) + ' h' : Math.floor(ms / 86400000) + (ms < 172800000 ? ' day' : ' days'));
const deskOf = (rec) => (DESKS.includes(rec.desk) ? rec.desk : own(OWNER_OF, rec.channel) ? OWNER_OF[rec.channel] : 'service');
/** How much rides on an item: 3 money or security, 2 a customer or a brain, 1 the rest. */
export function riskOf(kind, channel) {
  if (kind === 'call') return SECURITY_JOBS.includes(channel) || MONEY_JOBS.includes(channel) ? 3 : 1;
  return kind === 'rollback' ? 1 : 2;
}

/**
 * One watch record → the item a person sees. signers = { field: key } (who wrote each field, from this device's spine);
 * opts = { now, seen (Map id → when this device first saw it, ms) }. Never throws: junk is an unreadable item.
 */
export function itemOf(rec, signers, who, opts) {
  try {
    if (typeof Object(rec).id !== 'string') throw new Error('no record');   // null, a number, a string, an object without an id: unreadable
    const kind = KINDS.includes(rec.kind) ? rec.kind : 'call';
    const channel = str(rec.channel, 32), customer = str(rec.customer, 40), amount = nat(rec.amount), status = str(rec.status, 16);
    const creator = soleWriter(signers, CREATOR_FIELDS);
    const ck = keyIs(creator, who);
    const raised = creator !== '' && raisedRight(kind, rec, ck);
    // a choice is a person's only when one person's key wrote both the status and the action
    const statusBy = own(signers, 'status') ? signers.status : '', actionBy = own(signers, 'action') ? signers.action : '';
    const person = actionBy !== '' && inSet(who && who.people, actionBy);
    const chosen = PERSON_STATUS.has(status) && statusBy === actionBy && person;
    const carried = status === 'executed' && person;
    const forged = status !== 'open' && !chosen && !carried;
    const open = !chosen && !carried;
    const m = amount ? pounds(amount) : '';
    const agentWords = rec.agent === 'door' ? 'the door' : 'the ' + agentName(rec.agent);
    const job = jobOf(channel);
    const proposal = kind === 'call' && job && (rec.action === job[0] || rec.action === job[1]) ? rec.action : '';
    const evidence = [];
    let title = '', actions = [];
    if (kind === 'call') {
      title = (jobWords(channel) || 'A piece of work') + ' — held by ' + agentWords;
      evidence.push('Why it waits: ' + (str(rec.why) || 'not said'));
      const conf = nat(rec.conf), floor = nat(rec.floor);
      if (conf) {
        const high = !!job && job.stakes === 'high';
        evidence.push('Certainty ' + (conf / 1000).toFixed(3) + ' past its decision line' + (high ? ' — a money or security call: a second brain must always agree'
          : floor ? (conf < floor ? ' — below the ' + (floor / 1000).toFixed(3) + ' floor a person set, so a second brain had to agree' : ' — at or above the ' + (floor / 1000).toFixed(3) + ' floor a person set') : ''));
      }
      if (proposal) evidence.push(agentWords.charAt(0).toUpperCase() + agentWords.slice(1) + ' proposes: ' + actionWords(proposal, amount) + '. It is not pre-chosen.');
      else evidence.push('No proposal: no brain gave an answer it could act on.');
      actions = job ? [job[1], job[0]].map((a) => ({ act: 'choose', value: a, label: actionWords(a, amount) })) : [];
    } else if (kind === 'waiting') {
      const desk = deskOf(rec);
      title = 'A customer is waiting';
      evidence.push('Why: ' + (str(rec.why) || 'no desk took the message'));
      if (str(rec.preview)) evidence.push('Their message (preview, numbers masked): “' + str(rec.preview, 600) + '”');
      actions = [{ act: 'release', value: desk, label: 'Release it to the ' + agentName(desk) }, { act: 'reply', value: '', label: 'Reply to the customer yourself' }, { act: 'hostile', value: '', label: 'Confirm it is hostile' }];
    } else if (kind === 'draft') {
      title = 'A drafted reply waits for a person — the model never sends';
      evidence.push('For the ' + agentName(deskOf(rec)) + '’s desk' + (str(rec.preview) ? '. The customer wrote: “' + str(rec.preview, 600) + '”' : ''));
      for (const f of str(rec.flags, 600).split('|').filter(Boolean)) evidence.push('Check: ' + f);
      actions = [{ act: 'send', value: '', label: 'Approve & send this reply' }, { act: 'discard', value: '', label: 'Discard the draft' }];
    } else if (kind === 'review') {
      const was = str(rec.was, 40), opp = opposite(channel, was);
      title = 'A customer asked a person to review a decision';
      evidence.push('The ' + agentName(rec.decidedBy) + ' decided: ' + (actionWords(was, amount) || 'not known') + '.');
      evidence.push('UK GDPR Art. 22: a decision about a person, made by a machine, can be reviewed by a person on request.');
      actions = opp ? [{ act: 'uphold', value: was, label: 'Uphold it: ' + actionWords(was, amount) }, { act: 'overturn', value: opp, label: 'Overturn it: ' + actionWords(opp, amount) }] : [];
    } else if (kind === 'promote') {
      title = 'A regrown brain wants to replace the one in use — ' + (jobWords(rec.domain) || str(rec.domain, 32)) + ', ' + agentName(rec.agent);
      evidence.push('On ' + nat(rec.n) + ' outcomes neither brain had seen: AUC ' + (nat(rec.currentAuc) / 1000).toFixed(3) + ' now → ' + (nat(rec.localAuc) / 1000).toFixed(3) + ' regrown.');
      if (str(rec.diff)) evidence.push('What changes: ' + str(rec.diff, 1500));
      actions = [{ act: 'promote', value: '', label: 'Approve: the regrown brain replaces the current one' }, { act: 'refuse', value: '', label: 'Refuse: keep the current brain' }];
    } else {
      title = 'Roll back to an earlier brain — ' + (jobWords(rec.domain) || str(rec.domain, 32)) + ', ' + agentName(rec.agent);
      evidence.push('A person asked for brain ' + str(rec.patternId, 32) + ' to be put back.');
    }
    if (customer) evidence.push('Customer: ' + customer + (m ? ' · ' + m + ' at stake' : ''));
    else if (m) evidence.push(m + ' at stake');
    const writer = raised ? { ok: true, words: 'raised by ' + (ck.role === 'agent' ? 'the ' + ck.name + '’s own key' : ck.role === 'hub' ? 'the door (the office hub)' : ck.name) }
      : { ok: false, words: creator ? 'raised by another device (' + (ck.role === 'agent' ? 'the ' : '') + ck.name + ') — not ' + agentWords + '’s; treat it with care' : 'written over by more than one device' };
    const decider = chosen || carried ? keyIs(actionBy, who).name : '';
    let seenAt = -1;
    try { const t = opts.seen.get(rec.id); if (Number.isFinite(t)) seenAt = t; } catch { seenAt = -1; }
    const now = opts && Number.isFinite(opts.now) ? opts.now : -1;
    const age = seenAt >= 0 && now >= seenAt ? now - seenAt : -1;
    // a choice is offered only on an item its own agent (or the door) raised: a person is never asked to carry out a
    // proposal another device wrote in an agent's name
    const notes = [forged ? 'Marked “' + status + '” by a device that is not a person — ignored: it still waits for a person.' : '',
      raised ? '' : 'No choice is offered on it: an agent carries out only what it raised itself.'].filter(Boolean);
    return { ok: true, id: rec.id, kind, open: open && kind !== 'rollback', status, forged, chosenBy: decider, customer, amount, money: m, channel,
      risk: riskOf(kind, channel), title, proposal, evidence, actions: open && raised ? actions : [], writer,
      note: notes.join(' '),
      age, ageWords: age >= 0 ? ageWords(age) : '', at: seenAt, executedBy: str(rec.executedBy, 40), resolvedBy: str(rec.resolvedBy, 60), record: rec };
  } catch {
    return { ok: false, id: '', kind: 'call', open: false, status: '', forged: false, chosenBy: '', customer: '', amount: 0, money: '', channel: '', risk: 1, title: 'An unreadable item',
      proposal: '', evidence: [], actions: [], writer: { ok: false, words: 'unreadable' }, note: '', age: -1, ageWords: '', at: -1, executedBy: '', resolvedBy: '', record: null };
  }
}

const isCustomer = (i) => i.kind === 'waiting' || i.kind === 'draft' || i.kind === 'review';
const FILTER_OF = Object.freeze({
  all: () => true,
  customers: isCustomer,
  money: (i) => i.kind === 'call' && MONEY_JOBS.includes(i.channel),
  security: (i) => i.kind === 'call' && SECURITY_JOBS.includes(i.channel),
  brains: (i) => i.kind === 'promote',
  other: (i) => i.kind === 'call' && !MONEY_JOBS.includes(i.channel) && !SECURITY_JOBS.includes(i.channel),
});
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const SORT_OF = Object.freeze({
  risk: (a, b) => b.risk - a.risk || b.amount - a.amount || byId(a, b),
  money: (a, b) => b.amount - a.amount || b.risk - a.risk || byId(a, b),
  // oldest first; an item this device has no time for sorts by its id, which is write order
  age: (a, b) => (a.at < 0 ? Infinity : a.at) - (b.at < 0 ? Infinity : b.at) || byId(a, b),
});

/**
 * C4 — the queue: the OPEN items, filtered and sorted, with a count of everything waiting.
 * → { items, shown, waiting, counts: { customers, drafts, reviews, brains, calls, money, security } }
 */
export function queue(items, opts) {
  try {
    const all = (Array.isArray(items) ? items : []).filter((i) => i && i.ok === true && i.open === true);
    const f = opts && own(FILTER_OF, opts.filter) ? FILTER_OF[opts.filter] : FILTER_OF.all;
    const s = opts && own(SORT_OF, opts.sort) ? SORT_OF[opts.sort] : SORT_OF.risk;
    const shown = all.filter(f).sort(s);
    const counts = { customers: all.filter((i) => i.kind === 'waiting').length, drafts: all.filter((i) => i.kind === 'draft').length, reviews: all.filter((i) => i.kind === 'review').length,
      brains: all.filter((i) => i.kind === 'promote').length, calls: all.filter((i) => i.kind === 'call').length, money: all.filter(FILTER_OF.money).length, security: all.filter(FILTER_OF.security).length };
    return { items: shown, shown: shown.length, waiting: all.length, counts };
  } catch { return { items: [], shown: 0, waiting: 0, counts: { customers: 0, drafts: 0, reviews: 0, brains: 0, calls: 0, money: 0, security: 0 } }; }
}

/**
 * Bulk accept under a £ limit: the held calls whose agent's proposal a person may accept in one go — a proposal there,
 * raised by the agent's own key, at most `limit` pence at stake, and never a security call (each of those is read on its
 * own). → { ids, n, total (pence), words }
 */
export function bulkPlan(items, limit) {
  try {
    const cap = Number.isSafeInteger(limit) && limit >= 0 ? limit : -1;
    const take = (Array.isArray(items) ? items : []).filter((i) => i && i.ok === true && i.open === true && i.kind === 'call' && i.proposal !== '' && i.writer.ok === true
      && !SECURITY_JOBS.includes(i.channel) && i.amount <= cap);
    const total = take.reduce((s, i) => s + i.amount, 0);
    return { ids: take.map((i) => i.id), n: take.length, total, words: take.length ? 'Accept ' + take.length + ' proposal' + (take.length === 1 ? '' : 's') + ' of ' + pounds(cap) + ' or less (' + pounds(total) + ' in all)' : 'Nothing held is at or under ' + pounds(Math.max(0, cap)) };
  } catch { return { ids: [], n: 0, total: 0, words: 'Nothing to accept' }; }
}

/**
 * C5 — quarantine review on the Board: of the customer messages the screen quarantined, how many a person released as
 * genuine (a false positive). → { quarantined, released, permille (null when none) }
 */
export function falsePositives(items) {
  try {
    const q = (Array.isArray(items) ? items : []).filter((i) => i && i.ok === true && i.kind === 'waiting' && i.record && i.record.source === 'quarantined');
    const released = q.filter((i) => i.open === false && i.record.action === 'release').length;
    return { quarantined: q.length, released, permille: q.length ? Math.round((1000 * released) / q.length) : null };
  } catch { return { quarantined: 0, released: 0, permille: null }; }
}

// ── the rules a person sets ───────────────────────────────────────────────────────────────────────────────────────
const MONEY = /^\s*£?\s*(\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.(\d{1,2}))?\s*$/;
const FLOOR = /^\s*(0(?:\.\d{1,3})?|1(?:\.0{1,3})?|\.\d{1,3})\s*$/;
export const POLICY_WHY = Object.freeze({
  limit: 'the money limit is pounds and pence, like 500 or £1,250.50 — 0 means no limit',
  'limit-size': 'the money limit can be at most £1,000,000,000',
  floor: 'the confidence floor is a number from 0 to 1, like 0.10',
  pause: 'the automatic pause is on or off',
});
/** Pounds and pence as a person types them — '500', '5.5', '£1,250.50' — → whole pence; null when it is not that.
 *  A very long figure comes back too large to be a safe integer: each caller sets its own ceiling. */
export function penceOf(text) {
  const m = MONEY.exec(typeof text === 'string' ? text : '');
  return m ? Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '').padEnd(2, '0')) : null;
}
/** The Policies panel's three fields → { ok, fields: { moneyLimit (pence), minConfidence (permille), autoPause } } | { ok:false, why }. */
export function policyForm(input) {
  try {
    const { limit, floor, autoPause } = input;
    const pence = penceOf(limit);
    if (pence === null) return { ok: false, field: 'limit', why: POLICY_WHY.limit };
    if (!Number.isSafeInteger(pence) || pence > MAX_LIMIT) return { ok: false, field: 'limit', why: POLICY_WHY['limit-size'] };
    const f = FLOOR.exec(typeof floor === 'string' ? floor : '');
    if (!f) return { ok: false, field: 'floor', why: POLICY_WHY.floor };
    if (typeof autoPause !== 'boolean') return { ok: false, field: 'pause', why: POLICY_WHY.pause };
    return { ok: true, fields: { moneyLimit: pence, minConfidence: Math.round(Number(f[1]) * 1000), autoPause } };
  } catch { return { ok: false, field: 'limit', why: POLICY_WHY.limit }; }
}
/** The policy record as a person reads it: one plain sentence per rule. */
export function policyWords(p) {
  const r = p !== null && typeof p === 'object' ? p : {};
  const limit = nat(r.moneyLimit);
  const floor = Number.isSafeInteger(r.minConfidence) && r.minConfidence >= 0 ? r.minConfidence : 50;
  return [limit ? 'Money limit ' + pounds(limit) + ': above it, a person decides any act that commits money — letting a payment through, standard credit terms, a purchase order.'
    : 'No money limit: the agents act on money calls a second brain confirms, at any amount.',
  'Confidence floor ' + (floor / 1000).toFixed(3) + ': a normal call with less certainty than this needs a second brain to agree; money and security calls always do.',
  r.autoPause === false ? 'The behaviour watch (automatic) only flags an agent; a person decides whether to pause it.' : 'The behaviour watch (automatic) pauses an agent that stops behaving like itself, until a person clears it.'];
}

// ── a regrown brain, rule by rule ─────────────────────────────────────────────────────────────────────────────────
const ruleKey = (r) => str(r.feat, 40) + ' ' + (r.op === '>' ? '>' : '≤');
const n3 = (x) => +Number(x).toFixed(3);
const ruleText = (r) => (r.w > 0 ? '+' : '') + n3(r.w) + ' if ' + ruleKey(r) + ' ' + n3(r.v);
/** Two brains' rules → { ok, added, removed, changed: [{ key, from, to }], threshold: { from, to } | null, same } (rules matched by
 *  feature and direction; the n-th rule of a key matches the n-th). */
export function ruleDiff(before, after) {
  try {
    const tag = (rules) => { const seen = new Map(); return rules.map((r) => { const k = ruleKey(r); const same = seen.get(k) || []; same.push(r); seen.set(k, same); return [k + '#' + same.length, r]; }); };
    const a = new Map(tag(before.rules)), b = new Map(tag(after.rules));
    const added = [...b].filter(([k]) => !a.has(k)).map(([, r]) => r), removed = [...a].filter(([k]) => !b.has(k)).map(([, r]) => r);
    const changed = [...b].filter(([k, r]) => a.has(k) && (n3(a.get(k).v) !== n3(r.v) || n3(a.get(k).w) !== n3(r.w))).map(([k, r]) => ({ key: k.split('#')[0], from: a.get(k), to: r }));
    const t0 = n3(before.threshold), t1 = n3(after.threshold);
    return { ok: true, added, removed, changed, threshold: t0 === t1 ? null : { from: t0, to: t1 }, same: [...b].filter(([k]) => a.has(k)).length - changed.length };
  } catch { return { ok: false, added: [], removed: [], changed: [], threshold: null, same: 0 }; }
}
/** A rule diff in a line or two of plain text (what goes on the spine with the item). */
export function diffText(d) {
  try {
    if (!d.ok) return 'the two brains could not be compared';
    const parts = [...d.added.map((r) => 'adds ' + ruleText(r)), ...d.removed.map((r) => 'drops ' + ruleText(r)),
      ...d.changed.map((c) => 'changes ' + ruleText(c.from) + ' → ' + ruleText(c.to))];
    if (d.threshold) parts.push('moves the line it acts above from ' + d.threshold.from + ' to ' + d.threshold.to);
    return (parts.length ? parts.join('; ') : 'the same rules') + (d.same ? ' (' + d.same + ' rule' + (d.same === 1 ? '' : 's') + ' unchanged)' : '');
  } catch { return 'the two brains could not be compared'; }
}

// ── after a hijack: what the key decided ──────────────────────────────────────────────────────────────────────────
/** The first decision after a person's clearance (`after`, a decision id, '' for none) that does not fit the work it was
 *  given — the earliest act the behaviour watch can point at. decisions: one agent's own-key records, any order. '' if none. */
export function firstSign(decisions, after) {
  try {
    const recs = decisions.map(readDecision).filter((d) => d && d.id > str(after, 64)).sort(byId);
    const seen = new Set();
    for (const d of recs) { if (offWork(d, seen) !== '') return d.id; seen.add(d.at); }
    return '';
  } catch { return ''; }
}
/**
 * C9 — everything a key decided from `from` (a decision id) on, oldest first, each with what it did and whether it fits
 * the work it was given. → { ok, from, n, fits, offWork, list: [{ id, event, channel, customer, action, state, words, fits, why }] }
 */
export function theftList(decisions, from) {
  try {
    const start = str(from, 64);
    if (!start) return { ok: false, from: '', n: 0, fits: 0, offWork: 0, list: [] };
    const recs = decisions.filter((r) => r && typeof r.id === 'string' && r.id >= start).sort(byId);
    const seen = new Set();
    const list = recs.map((r) => {
      const d = readDecision(r);
      const why = offWork(d, seen);
      seen.add(d.at);
      return { id: r.id, event: str(r.event, 40), channel: d.channel, customer: str(r.customer, 40), action: d.action, state: d.state,
        words: d.state === 'done' ? (actionWords(d.action, 0) || 'did “' + d.action + '”') : 'held it for a person', fits: why === '', why };
    });
    const fits = list.filter((x) => x.fits).length;
    return { ok: true, from: start, n: list.length, fits, offWork: list.length - fits, list };
  } catch { return { ok: false, from: '', n: 0, fits: 0, offWork: 0, list: [] }; }
}

// ── C6 — a customer asks for a person ─────────────────────────────────────────────────────────────────────────────
/** May this decision be put to a person for review? Only a finished decision about a customer. → { ok, why } */
export function reviewable(d) {
  try {
    if (!CUSTOMER_JOBS.includes(d.channel)) return { ok: false, why: 'only a decision about a customer can be reviewed' };
    if (d.state !== 'done') return { ok: false, why: 'it is already waiting for a person' };
    if (!opposite(d.channel, d.action)) return { ok: false, why: 'the decision names no act to review' };
    if (!str(d.customer)) return { ok: false, why: 'no customer is named on it' };
    return { ok: true, why: '' };
  } catch { return { ok: false, why: 'the decision could not be read' }; }
}
/** The item the door writes when a customer asks: { id, fields } (one per decision: asking twice is the same item). */
export function reviewItem(d, amount) {
  const r = reviewable(d);
  if (!r.ok) return null;
  return { id: 'rv-' + str(d.event, 40), fields: { kind: 'review', agent: 'door', decidedBy: str(d.agent, 32), was: d.action, event: str(d.event, 40), domain: d.channel, channel: d.channel,
    action: '', label: -1, customer: str(d.customer, 40), amount: nat(amount), why: 'the customer asked for a person to review this decision', status: 'open' } };
}

/** What a person writes for a choice on an item: { status, action, ...extra } — or null if that choice does not fit it.
 *  value: the act chosen (call, overturn), the desk (release), the text (reply, send). */
export function choiceFields(item, choice, value, by) {
  try {
    if (!item || item.open !== true || item.writer.ok !== true || !CHOICES[item.kind].includes(choice)) return null;
    const who = str(by, 60);
    const f = { status: STATUS_OF[choice], action: choice, resolvedBy: who };
    if (choice === 'choose') {
      const a = jobOf(item.channel);
      if (!a || (value !== a[0] && value !== a[1])) return null;
      return { ...f, action: value };
    }
    if (choice === 'overturn') return opposite(item.channel, str(item.record.was, 40)) === value ? { ...f, action: value } : null;
    if (choice === 'release') return DESKS.includes(value) ? { ...f, releasedTo: value } : null;   // never the item's own desk field: that is its raiser's
    if (choice === 'reply' || choice === 'send') {
      const text = typeof value === 'string' ? value.trim() : '';
      return text && text.length <= MAX_REPLY ? { ...f, reply: text } : null;
    }
    return f;
  } catch { return null; }
}

// ── C12 — the history of a job's brain, and what can be rolled back ───────────────────────────────────────────────
/** The promotions and roll-backs a person approved, newest first, and for each agent and job the one that may be rolled
 *  back: the latest promotion whose brain is still the one in use. current = { 'agent/domain': patternId in use }. */
export function brainHistory(items, current) {
  try {
    const done = (Array.isArray(items) ? items : []).filter((i) => i && i.ok === true && (i.kind === 'promote' || i.kind === 'rollback') && i.open === false && !i.forged
      && (i.kind === 'rollback' || i.record.action === 'promote')).sort(byId).reverse();
    const latest = new Set();
    const rows = done.map((i) => {
      const key = str(i.record.agent, 32) + '/' + str(i.record.domain, 32);
      const inUse = own(current, key) && current[key] === i.record.patternId;
      const can = i.kind === 'promote' && i.status === 'executed' && inUse && !latest.has(key) && str(i.record.fromPattern, 64) !== '';
      if (i.status === 'executed') latest.add(key);   // only a change that was carried out stands between an older one and its roll-back
      return { id: i.id, kind: i.kind, agent: str(i.record.agent, 32), domain: str(i.record.domain, 32), patternId: str(i.record.patternId, 64), fromPattern: str(i.record.fromPattern, 64),
        by: i.chosenBy, carried: i.status === 'executed', rollback: can };
    });
    return rows;
  } catch { return []; }
}
