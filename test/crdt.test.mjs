import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialize, dedupe, authority, lwwBeats, apply, emptyState, rows, liveTags, sequence, text, collections, cmp } from '../src/crdt.mjs';
import { canonical } from '../src/canon.mjs';
import { sha256 } from '../src/sha256.mjs';
import { prng } from '../src/sim.mjs';
import { GENESIS_PREV } from '../src/gate.mjs';

// Synthetic, already-admitted v2 envelopes: materialize trusts the gate, so tests need no real signatures.
// prev defaults to the genesis prev for seq 1 and to a hash nobody holds after that (a link to nothing).
const NOWHERE = 'e'.repeat(64);
const G = '0'.repeat(63) + '1';     // genesis (owner)
const A = 'a'.repeat(64);           // admin
const S = 'b'.repeat(64);           // staff
const T = 'c'.repeat(64);           // another staff
const X = 'd'.repeat(64);           // stranger
function mk(from, seq, op, prev = seq === 1 ? GENESIS_PREV : NOWHERE) {
  const env = { from, op, prev, seq, sig: 'f'.repeat(128), v: 2 };
  return { env, hash: sha256(canonical(env)) };
}
const grant = (from, seq, l, id, to, role, cols = ['*']) => mk(from, seq, { k: 'grant', id, to, role, cols, l });
const put = (from, seq, l, c, id, f) => mk(from, seq, { k: 'put', c, id, f, l });
const del = (from, seq, l, c, id, tags) => mk(from, seq, { k: 'del', c, id, tags, l });
const ins = (from, seq, l, id, at, ch) => mk(from, seq, { k: 'ins', c: 'docs', id, at, ch, l });
const rm = (from, seq, l, id, e) => mk(from, seq, { k: 'rm', c: 'docs', id, e, l });
const tag = (from, seq) => from + '.' + seq;
const base = () => [grant(G, 1, 1, 'ga', A, 'admin'), grant(A, 1, 2, 'gs', S, 'staff', ['tasks', 'docs']), grant(A, 2, 3, 'gt', T, 'staff', ['*'])];

test('lwwBeats: lamport, then writer, then canonical value — a total order', () => {
  assert.equal(lwwBeats([2, A, '"x"'], [1, S, '"z"']), true);
  assert.equal(lwwBeats([1, S, '"x"'], [2, A, '"z"']), false);
  assert.equal(lwwBeats([1, S, '"x"'], [1, A, '"z"']), true);
  assert.equal(lwwBeats([1, A, '"x"'], [1, S, '"z"']), false);
  assert.equal(lwwBeats([1, A, '"z"'], [1, A, '"x"']), true);
  assert.equal(lwwBeats([1, A, '"x"'], [1, A, '"z"']), false);
  assert.equal(lwwBeats([1, A, '"x"'], [1, A, '"x"']), false);
});

test('dedupe: one envelope per (writer, seq); lowest hash wins; equivocator flagged; junk dropped', () => {
  const a = put(S, 5, 9, 'tasks', 't', { title: 'one' });
  const b = put(S, 5, 9, 'tasks', 't', { title: 'two' });
  const lo = a.hash < b.hash ? a : b;
  const r1 = dedupe([a, b]);
  const r2 = dedupe([b, a]);
  assert.equal(r1.ops.length, 1);
  assert.equal(r1.ops[0].hash, lo.hash);
  assert.equal(r2.ops[0].hash, lo.hash);
  assert.deepEqual(r1.equivocators, [S]);
  // nobody continued either: a fork at the tip — lowest hash, reported with both hashes and no continuation
  assert.deepEqual(r1.forks, [{ writer: S, seq: 5, rule: 'lowest-hash', kept: lo.hash, hashes: [a.hash, b.hash].sort(), next: [] }]);
  assert.deepEqual(r2.forks, r1.forks);
  assert.equal(r1.burned.size, 0);
  assert.deepEqual(dedupe([a, a]).equivocators, []);
  assert.deepEqual(dedupe([a, a]).forks, []);
  assert.equal(dedupe([a, a]).ops.length, 1);
  assert.equal(dedupe([null, {}, { hash: 'h' }, { hash: 1, env: { op: {} } }, a]).dropped, 4);
  assert.equal(dedupe('nope').ops.length, 0);
});

test('cmp is a three-way compare', () => {
  assert.equal(cmp('a', 'b'), -1);
  assert.equal(cmp('b', 'a'), 1);
  assert.equal(cmp('a', 'a'), 0);
  assert.equal(cmp(2, 2), 0);
});

test('dedupe drops items that are malformed in ways that would not throw', () => {
  const noOp = { hash: 'h1', env: { from: A, seq: 1 } };
  const numHash = { hash: 5, env: { from: A, seq: 2, op: { l: 1 } } };
  const noEnv = { hash: 'h2' };
  for (const bad of [noOp, numHash, noEnv]) {
    const r = dedupe([bad]);
    assert.equal(r.ops.length, 0);
    assert.equal(r.dropped, 1);
  }
});

test('the owner granting staff directly does NOT make them an admin', () => {
  const ops = dedupe([grant(G, 1, 1, 'gs', S, 'staff', ['tasks'])]).ops;
  const au = authority(ops, G);
  assert.equal(au.admins, 0);
  assert.equal(au.staff, 1);
  assert.equal(au.isAdmin(S, 9, 1), false);
  assert.equal(au.can(S, 'tasks', 9, 1), true);
  assert.equal(au.can(S, 'crm', 9, 1), false);
});

test('dedupe sorts by lamport, then writer, then seq', () => {
  const o = dedupe([put(S, 2, 5, 'tasks', 'a', { n: 1 }), put(A, 9, 5, 'tasks', 'b', { n: 1 }), put(A, 3, 5, 'tasks', 'c', { n: 1 }), put(T, 1, 4, 'tasks', 'd', { n: 1 })]).ops;
  assert.deepEqual(o.map((x) => x.env.op.id), ['d', 'c', 'b', 'a']);
});

test('authority: owner makes admins; admins make staff; scopes hold', () => {
  const { ops } = dedupe(base());
  const au = authority(ops, G);
  assert.equal(au.admins, 1);
  assert.equal(au.staff, 2);
  assert.equal(au.isAdmin(G, 1, 1), true);
  assert.equal(au.isAdmin(A, 5, 1), true);
  assert.equal(au.isAdmin(A, 1, 1), false);         // grant at l=1 must strictly precede
  assert.equal(au.isAdmin(S, 9, 1), false);
  assert.equal(au.can(S, 'tasks', 9, 1), true);
  assert.equal(au.can(S, 'docs', 9, 1), true);
  assert.equal(au.can(S, 'crm', 9, 1), false);
  assert.equal(au.can(S, 'tasks', 2, 1), false);    // not before the grant (gs at l=2)
  assert.equal(au.can(S, 'tasks', 3, 1), true);
  assert.equal(au.can(T, 'crm', 9, 1), true);       // '*'
  assert.equal(au.can(X, 'tasks', 9, 1), false);
  assert.equal(au.can(A, 'anything', 9, 1), true);  // admins write everything
  assert.deepEqual(au.roster.map((r) => [r.grant, r.role, r.revoked]), [['ga', 'admin', false], ['gs', 'staff', false], ['gt', 'staff', false]]);
});

test('authority: only the owner makes admins; staff cannot grant; first grant id wins', () => {
  const ops = dedupe([...base(),
    grant(A, 3, 4, 'g-sneak', X, 'admin'),          // admin tries to mint an admin → ignored
    grant(S, 1, 5, 'g-staff', X, 'staff'),          // staff tries to grant → ignored
    grant(A, 4, 6, 'gs', X, 'staff', ['*']),        // reuses an existing id → ignored
  ]).ops;
  const au = authority(ops, G);
  assert.equal(au.isAdmin(X, 99, 1), false);
  assert.equal(au.can(X, 'tasks', 99, 1), false);
  assert.equal(au.staff, 2);
});

test('authority: revocation is a sequence cut, from the owner or an admin', () => {
  const ops = dedupe([...base(), mk(A, 3, { k: 'revoke', id: 'gs', cut: 4, l: 10 })]).ops;
  const au = authority(ops, G);
  assert.equal(au.can(S, 'tasks', 20, 4), true);    // seq ≤ cut still counts
  assert.equal(au.can(S, 'tasks', 20, 5), false);   // after the cut, gone
  assert.equal(au.roster.find((r) => r.grant === 'gs').revoked, true);
  const ops2 = dedupe([...base(), mk(G, 2, { k: 'revoke', id: 'ga', cut: 1, l: 10 })]).ops;
  const au2 = authority(ops2, G);
  assert.equal(au2.isAdmin(A, 20, 1), true);
  assert.equal(au2.isAdmin(A, 20, 2), false);
  // an admin cannot revoke an admin grant; a stranger cannot revoke at all; two cuts → the lower wins
  const ops3 = dedupe([...base(), grant(G, 2, 2, 'gb', T, 'admin'), mk(A, 3, { k: 'revoke', id: 'gb', cut: 0, l: 10 }),
    mk(X, 1, { k: 'revoke', id: 'gs', cut: 0, l: 11 }), mk(A, 4, { k: 'revoke', id: 'gt', cut: 7, l: 12 }), mk(G, 3, { k: 'revoke', id: 'gt', cut: 3, l: 13 })]).ops;
  const au3 = authority(ops3, G);
  assert.equal(au3.isAdmin(T, 50, 9), true);
  assert.equal(au3.can(S, 'tasks', 50, 9), true);
  assert.equal(au3.can(T, 'crm', 50, 3), true);
  assert.equal(au3.can(T, 'crm', 50, 4), true);     // T is also admin (gb) — admin path still live
});

test('apply/materialize: concurrent edit beats delete (observed-remove); LWW fields merge', () => {
  const p1 = put(S, 1, 4, 'tasks', 't', { title: 'a', done: false });
  const d1 = del(T, 1, 5, 'tasks', 't', [tag(S, 1)]);
  const p2 = put(T, 2, 5, 'tasks', 't', { done: true });   // concurrent with the delete
  const m = materialize([...base(), p1, d1, p2], G);
  assert.deepEqual(rows(m.state, 'tasks'), [{ id: 't', done: true, title: 'a' }]);
  assert.deepEqual(liveTags(m.state, 'tasks', 't'), [tag(T, 2)]);
  const gone = materialize([...base(), p1, del(T, 1, 5, 'tasks', 't', [tag(S, 1)])], G);
  assert.deepEqual(rows(gone.state, 'tasks'), []);
  assert.deepEqual(liveTags(gone.state, 'tasks', 'nope'), []);
  assert.equal(m.report.applied, 3);
});

test('materialize: unauthorised writes are counted, never applied', () => {
  const m = materialize([...base(), put(X, 1, 9, 'tasks', 'evil', { title: 'x' }), put(S, 1, 9, 'crm', 'c', { n: 1 })], G);
  assert.equal(m.report.unauthorized, 2);
  assert.deepEqual(rows(m.state, 'tasks'), []);
  assert.deepEqual(rows(m.state, 'crm'), []);
  assert.deepEqual(collections(m.state), []);
});

test('ORDER-INDEPENDENCE: 200 random shuffles + duplicates of a mixed op-set → one identical company', () => {
  const items = [...base(),
    put(S, 1, 4, 'tasks', 't1', { title: 'a' }), put(T, 1, 4, 'tasks', 't1', { title: 'b' }),
    put(T, 2, 5, 'tasks', 't2', { title: 'c', done: false }), del(S, 2, 6, 'tasks', 't2', [tag(T, 2)]),
    put(A, 3, 6, 'crm', 'c1', { name: 'Acme' }), put(T, 3, 7, 'crm', 'c1', { name: 'Acme Ltd' }),
    put(T, 4, 7, 'msg', 'm1', { body: 'hi' }), put(S, 3, 8, 'tasks', 't2', { done: true }),
    ins(S, 4, 9, 'd', '^', 'h'), ins(S, 5, 10, 'd', tag(S, 4), 'i'), ins(T, 5, 10, 'd', tag(S, 4), 'o'),
    rm(T, 6, 11, 'd', tag(S, 5)), put(X, 1, 3, 'tasks', 'evil', { title: 'no' }),
    put(S, 6, 12, 'tasks', 'eq', { title: 'one' }), put(S, 6, 12, 'tasks', 'eq', { title: 'two' }),
  ];
  const ref = canonical(materialize(items, G).state);
  const rnd = prng(42);
  for (let i = 0; i < 200; i++) {
    const shuffled = items.slice();
    for (let j = shuffled.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]; }
    if (i % 3 === 0) shuffled.push(shuffled[Math.floor(rnd() * shuffled.length)]);
    assert.equal(canonical(materialize(shuffled, G).state), ref, 'shuffle ' + i);
  }
});

test('RGA text: sequential typing, concurrent inserts newest-first, deletes hidden', () => {
  const items = [...base(), ins(S, 1, 4, 'd', '^', 'a'), ins(S, 2, 5, 'd', tag(S, 1), 'b'), ins(S, 3, 6, 'd', tag(S, 2), 'c')];
  assert.equal(text(materialize(items, G).state, 'docs', 'd'), 'abc');
  // two writers insert after 'a' concurrently: the higher lamport sits closer to 'a'
  const c2 = [...items, ins(T, 1, 9, 'd', tag(S, 1), 'X'), ins(A, 3, 8, 'd', tag(S, 1), 'Y')];
  assert.equal(text(materialize(c2, G).state, 'docs', 'd'), 'aXYbc');
  // equal lamport: the higher writer sits closer
  const c3 = [...items, ins(T, 1, 9, 'd', tag(S, 1), 'X'), ins(S, 4, 9, 'd', tag(S, 1), 'Y')];
  assert.equal(text(materialize(c3, G).state, 'docs', 'd'), 'aXYbc');
  const c4 = [...items, rm(T, 1, 9, 'd', tag(S, 2))];
  const m4 = materialize(c4, G);
  assert.equal(text(m4.state, 'docs', 'd'), 'ac');
  assert.deepEqual(sequence(m4.state, 'docs', 'd').map((x) => x.tag), [tag(S, 1), tag(S, 3)]);
  assert.equal(text(m4.state, 'docs', 'missing'), '');
  // two inserts at the head: newest first
  const c5 = [...base(), ins(S, 1, 4, 'd', '^', 'a'), ins(T, 1, 5, 'd', '^', 'b')];
  assert.equal(text(materialize(c5, G).state, 'docs', 'd'), 'ba');
  // higher lamport wins even with the LOWER writer
  const c6 = [...items, ins(A, 3, 9, 'd', tag(S, 1), 'X'), ins(T, 1, 8, 'd', tag(S, 1), 'Y')];
  assert.equal(text(materialize(c6, G).state, 'docs', 'd'), 'aXYbc');
  // same writer, same lamport (a byzantine pattern): the higher tag sits closer — still one answer everywhere
  const c7 = [...items, ins(S, 7, 9, 'd', tag(S, 1), 'X'), ins(S, 8, 9, 'd', tag(S, 1), 'Y')];
  assert.equal(text(materialize(c7, G).state, 'docs', 'd'), 'aYXbc');
});

test('RGA: orphans and cycles stay hidden (deterministically)', () => {
  const items = [...base(), ins(S, 1, 4, 'd', '^', 'a'), ins(S, 2, 5, 'd', 'f'.repeat(64) + '.9', 'z'),
    ins(T, 1, 6, 'd', tag(T, 2), 'p'), ins(T, 2, 7, 'd', tag(T, 1), 'q')];
  assert.equal(text(materialize(items, G).state, 'docs', 'd'), 'a');
});

test('rows: dead records skipped, sorted by id, fields resolved', () => {
  const items = [...base(), put(S, 1, 4, 'tasks', 'b', { title: 'B' }), put(S, 2, 5, 'tasks', 'a', { title: 'A' }),
    del(S, 3, 6, 'tasks', 'b', [tag(S, 1)])];
  assert.deepEqual(rows(materialize(items, G).state, 'tasks'), [{ id: 'a', title: 'A' }]);
  assert.deepEqual(rows(emptyState(), 'tasks'), []);
});

test('apply is idempotent per envelope', () => {
  const s = emptyState();
  const p = put(S, 1, 4, 'tasks', 't', { title: 'x' }).env;
  apply(s, p); const once = canonical(s);
  apply(s, p); assert.equal(canonical(s), once);
});

test('materialize never throws; a fault yields an empty company and a deny-all authority', () => {
  const bad = [{ hash: 'h', env: { from: G, seq: 1, op: { k: 'put', l: 1, c: 'tasks', id: 't', f: null } } }];
  const m = materialize(bad, G);
  assert.equal(m.report.fault, true);
  assert.equal(m.auth.can(G, 'tasks', 9, 9), false);
  assert.equal(m.auth.isAdmin(G, 9, 9), false);
  assert.deepEqual(m.roster, []);
});

// ───────────────────────── per-writer hash chains ─────────────────────────
const items = (xs) => xs.flat();
/** A writer's own chain from seq `start`: each envelope names the one before it (the genesis prev for seq 1). */
function chain(from, ops, start = 1, prev = start === 1 ? GENESIS_PREV : NOWHERE) {
  const out = [];
  let p = prev;
  ops.forEach((op, i) => { const it = mk(from, start + i, op, p); out.push(it); p = it.hash; });
  return out;
}
const tput = (l, id, f) => ({ k: 'put', c: 'tasks', id, f, l });
/** A forgery for (from, seq) naming prev, ground until its hash is LOWER than `beat` — so lowest-hash alone would pick it. */
function forge(from, seq, prev, beat, f = (v) => tput(4, 'pay', { status: 'released', v })) {
  for (let v = 0; v < 500; v++) { const it = mk(from, seq, f(v), prev); if (it.hash < beat.hash) return it; }
  throw new Error('could not grind a lower hash');
}
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; } return a; };
const fingerprint = (m) => canonical({ state: m.state, report: m.report });
// S writes a payment hold at seq 3, then builds five more writes on top of it
const sChain = () => chain(S, [tput(4, 'r1', { n: 1 }), tput(5, 'r2', { n: 2 }), tput(6, 'pay', { status: 'held' }),
  tput(7, 'r4', { n: 4 }), tput(8, 'r5', { n: 5 }), tput(9, 'r6', { n: 6 }), tput(10, 'r7', { n: 7 }), tput(11, 'r8', { n: 8 })]);

test('CHAIN: a stolen key forks seq k after the real device wrote k+1..k+5 → every device keeps the real k, in any order', () => {
  const real = sChain();
  const fake = forge(S, 3, real[1].hash, real[2]);                 // prev = the real k-1, as a careful thief would
  assert.ok(fake.hash < real[2].hash, 'the forgery out-ranks the real write on hash alone');
  const set = items([base(), real, fake]);
  const ref = materialize(set, G);
  assert.deepEqual(rows(ref.state, 'tasks').find((r) => r.id === 'pay'), { id: 'pay', status: 'held' });
  assert.deepEqual(ref.report.equivocators, [S]);
  assert.deepEqual(ref.report.forks, [{ writer: S, seq: 3, rule: 'chain', kept: real[2].hash, hashes: [real[2].hash, fake.hash].sort(), next: [real[3].hash] }]);
  assert.deepEqual(ref.report.burned, []);
  assert.equal(ref.report.applied, 8);
  const rnd = prng(7);
  for (let i = 0; i < 300; i++) {
    const order = shuffle(set, rnd);
    if (i % 4 === 0) order.push(order[Math.floor(rnd() * order.length)], fake);   // duplicate deliveries
    assert.equal(fingerprint(materialize(order, G)), fingerprint(ref), 'shuffle ' + i);
  }
});

test('TIP: a fork nobody continued goes to the lowest hash (flagged) — until the real device builds on its own', () => {
  const real = sChain().slice(0, 3);                                // the real k = 3 is the tip
  const fake = forge(S, 3, real[1].hash, real[2]);
  const tip = materialize(items([base(), real, fake]), G);
  assert.deepEqual(tip.report.forks, [{ writer: S, seq: 3, rule: 'lowest-hash', kept: fake.hash, hashes: [real[2].hash, fake.hash].sort(), next: [] }]);
  assert.equal(rows(tip.state, 'tasks').find((r) => r.id === 'pay').status, 'released');
  assert.deepEqual(tip.report.equivocators, [S]);
  const next = mk(S, 4, tput(12, 'r4', { n: 4 }), real[2].hash);   // the real device writes again, naming its own k
  const after = materialize(items([base(), real, fake, next]), G);
  assert.equal(after.report.forks[0].rule, 'chain');
  assert.equal(after.report.forks[0].kept, real[2].hash);
  assert.deepEqual(after.report.forks[0].next, [next.hash]);
  assert.equal(rows(after.state, 'tasks').find((r) => r.id === 'pay').status, 'held');
});

test('LINKS: a prev that points nowhere, to another writer, or to another slot continues nothing — and still stands itself', () => {
  const real = sChain().slice(0, 3);
  const fake = forge(S, 3, real[1].hash, real[2]);
  const other = mk(T, 1, tput(4, 'tz', { n: 0 }));
  const cases = {
    dangling: mk(S, 4, tput(12, 'k4', { n: 4 }), NOWHERE),                 // its parent is not held (yet, or ever)
    otherWriter: mk(S, 4, tput(12, 'k4', { n: 4 }), other.hash),           // names another writer's envelope
    wrongSlot: mk(S, 4, tput(12, 'k4', { n: 4 }), real[0].hash),           // names its own writer's seq 1, not seq 3
    skipsASlot: mk(S, 5, tput(12, 'k4', { n: 4 }), real[2].hash),          // names the real k, but from k+2
    foreignChild: mk(T, 4, tput(12, 'k4', { n: 4 }), real[2].hash),        // another writer names S's real k
  };
  for (const [name, kid] of Object.entries(cases)) {
    const m = materialize(items([base(), real, fake, other, kid]), G);
    const f = m.report.forks.find((x) => x.writer === S && x.seq === 3);
    assert.equal(f.rule, 'lowest-hash', name);
    assert.equal(f.kept, fake.hash, name);
    assert.deepEqual(f.next, [], name);
    assert.equal(rows(m.state, 'tasks').some((r) => r.id === 'k4'), true, name + ': the envelope itself still applies');
  }
});

test('LINKS: a gap in delivery never erases a writer — its later envelopes stand on their own slots', () => {
  const real = sChain();
  const holes = real.filter((_, i) => i !== 1 && i !== 4);           // seq 2 and seq 5 never arrived
  const m = materialize(items([base(), holes]), G);
  assert.equal(m.report.applied, 6);
  assert.deepEqual(rows(m.state, 'tasks').map((r) => r.id), ['pay', 'r1', 'r4', 'r6', 'r7', 'r8']);
  assert.deepEqual(m.report.forks, []);
});

test('BURN: a thief that forges a CONTINUED fork cuts the key from that slot — neither history counts, everywhere', () => {
  const real = sChain();
  const fake = forge(S, 3, real[1].hash, real[2]);
  const fake4 = mk(S, 4, tput(9, 'pay', { status: 'released', note: 'and again' }), fake.hash);   // builds on the forgery
  const set = items([base(), real, fake, fake4]);
  const m = materialize(set, G);
  assert.deepEqual(m.report.burned, [{ writer: S, from: 3 }]);
  assert.deepEqual(m.report.equivocators, [S]);
  assert.deepEqual(m.report.forks, [
    { writer: S, seq: 3, rule: 'burned', kept: null, hashes: [real[2].hash, fake.hash].sort(), next: [real[3].hash, fake4.hash].sort() },
    { writer: S, seq: 4, rule: 'chain', kept: real[3].hash, hashes: [real[3].hash, fake4.hash].sort(), next: [real[4].hash] },
  ]);
  // before the cut: S's writes stand. From the cut on: nothing S signed counts — not the forgery, not the real ones
  assert.deepEqual(rows(m.state, 'tasks').map((r) => r.id), ['r1', 'r2']);
  assert.equal(m.report.applied, 2);
  assert.equal(m.report.unauthorized, 5);                           // slots 4..8 (slot 3 itself keeps no envelope)
  assert.equal(m.auth.can(S, 'tasks', 99, 2), true);
  assert.equal(m.auth.can(S, 'tasks', 99, 3), false);
  assert.equal(m.auth.can(S, 'tasks', 99, 9), false);
  assert.equal(m.auth.can(T, 'tasks', 99, 9), true);                // nobody else is touched
  const rnd = prng(11);
  for (let i = 0; i < 200; i++) assert.equal(fingerprint(materialize(shuffle(set, rnd), G)), fingerprint(m), 'shuffle ' + i);
  // a second burn further up the same chain: the cut is the LOWEST burned slot, whatever order the forks arrive in
  const fake7 = mk(S, 7, tput(13, 'z', { n: 1 }), real[5].hash);
  const fake8 = mk(S, 8, tput(14, 'z', { n: 2 }), fake7.hash);
  const two = items([base(), real, fake7, fake8, fake, fake4]);
  for (let i = 0; i < 50; i++) assert.deepEqual(materialize(shuffle(two, rnd), G).report.burned, [{ writer: S, from: 3 }]);
  assert.deepEqual(materialize(items([base(), real, fake7, fake8]), G).report.burned, [{ writer: S, from: 7 }]);
});

test('BURN: a burned ADMIN key grants and revokes nothing from its cut; a burned OWNER key makes no admins', () => {
  // A (admin) grants S at seq 1 and T at seq 2, writes at seq 3, grants X at seq 4 — and a thief burns A at seq 3
  const aReal = chain(A, [{ k: 'grant', id: 'gs', to: S, role: 'staff', cols: ['tasks'], l: 2 }, { k: 'grant', id: 'gt', to: T, role: 'staff', cols: ['*'], l: 3 },
    tput(4, 'a3', { n: 3 }), { k: 'grant', id: 'gx', to: X, role: 'staff', cols: ['*'], l: 5 }, { k: 'revoke', id: 'gt', cut: 0, l: 6 }]);
  const aFake = mk(A, 3, tput(4, 'a3', { n: 666 }), aReal[1].hash);
  const aFake4 = mk(A, 4, tput(5, 'a4', { n: 666 }), aFake.hash);
  const m = materialize(items([grant(G, 1, 1, 'ga', A, 'admin'), aReal, aFake, aFake4]), G);
  assert.deepEqual(m.report.burned, [{ writer: A, from: 3 }]);
  assert.equal(m.auth.isAdmin(A, 99, 2), true);
  assert.equal(m.auth.isAdmin(A, 99, 3), false);
  assert.equal(m.auth.can(S, 'tasks', 99, 1), true);                // granted before the cut
  assert.equal(m.auth.can(T, 'crm', 99, 1), true);                  // granted before the cut — and the revoke after it never counted
  assert.equal(m.auth.can(X, 'tasks', 99, 1), false);               // granted after the cut
  assert.equal(m.report.staff, 2);
  // the owner's key burned at seq 2: its grant before still makes an admin, its grant after makes none
  const gReal = chain(G, [{ k: 'grant', id: 'ga', to: A, role: 'admin', cols: ['*'], l: 1 }, tput(2, 'g2', { n: 2 }),
    { k: 'grant', id: 'gb', to: T, role: 'admin', cols: ['*'], l: 3 }, { k: 'revoke', id: 'ga', cut: 0, l: 4 }]);
  const gFake = mk(G, 2, tput(2, 'g2', { n: 666 }), gReal[0].hash);
  const gFake3 = mk(G, 3, tput(3, 'g3', { n: 666 }), gFake.hash);
  const o = materialize(items([gReal, gFake, gFake3]), G);
  assert.deepEqual(o.report.burned, [{ writer: G, from: 2 }]);
  assert.equal(o.auth.isAdmin(A, 99, 5), true);                     // ga at seq 1 stands; the revoke at seq 4 never counted
  assert.equal(o.auth.isAdmin(T, 99, 1), false);                    // gb at seq 3 is past the cut
  assert.equal(o.auth.isAdmin(G, 99, 1), true);
  assert.equal(o.auth.isAdmin(G, 99, 2), false);
  assert.equal(o.report.admins, 1);
});

test('three candidates for one slot: one continued → the chain keeps it; two continued → burned', () => {
  const real = sChain().slice(0, 4);
  const f1 = mk(S, 3, tput(6, 'pay', { status: 'x1' }), real[1].hash);
  const f2 = mk(S, 3, tput(6, 'pay', { status: 'x2' }), real[1].hash);
  const one = materialize(items([base(), real, f1, f2]), G).report.forks[0];
  assert.equal(one.rule, 'chain');
  assert.equal(one.kept, real[2].hash);
  assert.deepEqual(one.hashes, [real[2].hash, f1.hash, f2.hash].sort());
  const f2kid = mk(S, 4, tput(7, 'q', { n: 1 }), f2.hash);
  const two = materialize(items([base(), real, f1, f2, f2kid]), G).report;
  assert.equal(two.forks[0].rule, 'burned');
  assert.deepEqual(two.burned, [{ writer: S, from: 3 }]);
});

test('authority: the key cut defaults to none and ignores junk', () => {
  const ops = dedupe(base()).ops;
  for (const junk of [undefined, null, {}, [], 'x', new Map()]) {
    const au = authority(ops, G, junk);
    assert.equal(au.isAdmin(A, 9, 99), true);
    assert.equal(au.can(S, 'tasks', 9, 99), true);
  }
});

test('forks are reported sorted by writer, then slot — whatever order they arrived in', () => {
  const sx = chain(S, [tput(4, 'a', { n: 1 }), tput(5, 'b', { n: 1 }), tput(6, 'c', { n: 1 }), tput(7, 'd', { n: 1 }), tput(8, 'e', { n: 1 })]);
  const tx = chain(T, [tput(4, 'f', { n: 1 }), tput(5, 'g', { n: 1 })]);
  const forks = [mk(T, 2, tput(5, 'g', { n: 2 }), tx[0].hash), mk(S, 5, tput(8, 'e', { n: 2 }), sx[3].hash), mk(S, 2, tput(5, 'b', { n: 2 }), sx[0].hash)];
  const want = [[S, 2], [S, 5], [T, 2]];
  for (const order of [[...forks, ...tx, ...sx], [...forks.reverse(), ...sx, ...tx]]) {
    assert.deepEqual(dedupe(order).forks.map((f) => [f.writer, f.seq]), want);
  }
});

test('ORDER-INDEPENDENCE under chains: random histories with random lone, tip and continued forks → one company per SET', () => {
  const writers = [S, T, A];
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = prng(1000 + seed);
    const set = [...base()];
    for (const w of writers) {
      const n = 3 + Math.floor(rnd() * 6);
      const start = w === A ? 3 : 1;                                   // A's seq 1 and 2 are its grants in base()
      const real = chain(w, Array.from({ length: n }, (_, i) => tput(10 + i, 'w' + Math.floor(rnd() * 4), { v: Math.floor(rnd() * 9) })), start, w === A ? base()[2].hash : GENESIS_PREV);
      set.push(...real);
      for (let f = Math.floor(rnd() * 3); f > 0; f--) {                // up to two thieves per writer
        const i = Math.floor(rnd() * real.length);
        const prev = i ? real[i - 1].hash : start === 1 ? GENESIS_PREV : base()[2].hash;
        const fake = mk(w, start + i, tput(10 + i, 'w' + Math.floor(rnd() * 4), { v: 100 + Math.floor(rnd() * 99) }), prev);
        set.push(fake);
        if (rnd() < 0.3) set.push(mk(w, start + i + 1, tput(11 + i, 'w9', { v: 1 }), fake.hash));   // continue the forgery
      }
    }
    const ref = materialize(set, G);
    for (const f of ref.report.forks) seen.add(f.rule);
    for (let i = 0; i < 40; i++) {
      const order = shuffle(set, rnd);
      if (i % 3 === 0) order.push(order[Math.floor(rnd() * order.length)]);
      assert.equal(fingerprint(materialize(order, G)), fingerprint(ref), 'seed ' + seed + ' shuffle ' + i);
    }
  }
  assert.deepEqual([...seen].sort(), ['burned', 'chain', 'lowest-hash'], 'the random histories exercised every rule');
});

test('dedupe is total: a fault resolving a contested slot returns an empty, flagged result; materialize reports the fault', () => {
  const toxicPrev = { get prev() { throw new Error('boom'); } };
  const a = { hash: 'h1', env: { from: S, seq: 1, op: { l: 1 } } };
  const b = { hash: 'h2', env: { from: S, seq: 1, op: { l: 1 } } };
  const kid = { hash: 'h3', env: Object.assign(Object.create(toxicPrev), { from: S, seq: 2, op: { l: 2 } }) };
  let r;
  assert.doesNotThrow(() => { r = dedupe([a, b, kid]); });
  assert.equal(r.fault, true);
  assert.deepEqual(r.ops, []);
  assert.equal(r.burned.size, 0);
  assert.equal(materialize([a, b, kid], G).report.fault, true);
  assert.equal(dedupe([a, kid]).fault, undefined);                 // nothing contested: the toxic prev is never read
});
