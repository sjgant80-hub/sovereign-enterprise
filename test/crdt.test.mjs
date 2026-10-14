import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialize, dedupe, authority, lwwBeats, apply, emptyState, rows, liveTags, sequence, text, collections, cmp } from '../src/crdt.mjs';
import { canonical } from '../src/canon.mjs';
import { sha256 } from '../src/sha256.mjs';
import { prng } from '../src/sim.mjs';

// Synthetic, already-admitted envelopes: materialize trusts the gate, so tests need no real signatures.
const G = '0'.repeat(63) + '1';     // genesis (owner)
const A = 'a'.repeat(64);           // admin
const S = 'b'.repeat(64);           // staff
const T = 'c'.repeat(64);           // another staff
const X = 'd'.repeat(64);           // stranger
function mk(from, seq, op) {
  const env = { from, op, seq, sig: 'f'.repeat(128), v: 1 };
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
  assert.deepEqual(dedupe([a, a]).equivocators, []);
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
