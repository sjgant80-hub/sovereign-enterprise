// crdt.mjs — THE SPINE. One order-independent materialisation of a company's signed op-set.
//
// Every write in the company is a gate-admitted, signed envelope. The company's state is a PURE FUNCTION of the
// SET of envelopes a node holds — never of the order they arrived in. So convergence reduces to one thing:
// two nodes holding the same verified envelopes hold the same company, byte for byte. Partitions, delays,
// duplicates and reordering cannot make them disagree; anti-entropy (swap what the other lacks) closes the gap.
//
//   records  — OR-set existence (add tags, tombstoned tags; concurrent edit beats delete) + LWW fields under a
//              TOTAL order (lamport, writer, canonical value), so even an insider who reuses a clock can't split it.
//   text     — RGA (each character a child of the one it was typed after; siblings newest-first).
//   authority— the role tree: the owner (genesis key) makes admins; admins make staff with collection scopes.
//              Revocation is a SEQUENCE CUT on the grantee (ops after the cut stop counting) — no clock trust.
//   equivocation — two different envelopes for one (writer, seq): the lowest hash is kept on every node and the
//              writer is flagged. Deterministic, so it cannot split the company either.
// Pure, total, deterministic. Every map is null-prototype.
import { canonical } from './canon.mjs';

const obj = () => Object.create(null);
export const emptyState = () => ({ cols: obj(), docs: obj() });
const tagOf = (env) => env.from + '.' + env.seq;
/** Three-way string/number compare. */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** LWW total order over [lamport, writer, canonicalValue, value]: higher lamport, then writer, then value. */
export function lwwBeats(a, b) {
  if (a[0] > b[0]) return true;
  if (a[0] < b[0]) return false;
  if (a[1] > b[1]) return true;
  if (a[1] < b[1]) return false;
  return a[2] > b[2];
}

/** One envelope per (writer, seq). A second, different envelope = equivocation: keep the lowest hash, flag the writer. */
export function dedupe(items) {
  const slot = new Map();
  const eq = new Set();
  let dropped = 0;
  for (const it of Array.isArray(items) ? items : []) {
    try {
      if (!it || typeof it.hash !== 'string' || !it.env || !it.env.op) { dropped++; continue; }
      const key = it.env.from + ':' + it.env.seq;
      const cur = slot.get(key);
      if (cur === undefined) slot.set(key, it);
      else if (cur.hash !== it.hash) {
        eq.add(it.env.from);
        if (it.hash < cur.hash) slot.set(key, it);
      }
    } catch { dropped++; }
  }
  const ops = [...slot.values()].sort((a, b) =>
    a.env.op.l - b.env.op.l || cmp(a.env.from, b.env.from) || a.env.seq - b.env.seq);
  return { ops, equivocators: [...eq].sort(), dropped };
}

/** The role tree, evaluated over the whole (sorted) op set — deterministic, order-independent. */
export function authority(ops, genesis) {
  const admins = new Map();
  const cut = new Map();
  const setCut = (id, c) => { const k = cut.get(id); cut.set(id, k === undefined ? c : Math.min(k, c)); };
  for (const { env } of ops) {
    if (env.from !== genesis) continue;
    const op = env.op;
    if (op.k === 'grant' && op.role === 'admin' && !admins.has(op.id)) admins.set(op.id, { to: op.to, l: op.l });
    else if (op.k === 'revoke') setCut(op.id, op.cut);
  }
  const live = (gid, g, l, seq) => {
    if (g.l >= l) return false;
    const k = cut.get(gid);
    return k === undefined || seq <= k;
  };
  const isAdmin = (who, l, seq) => {
    if (who === genesis) return true;
    for (const [gid, g] of admins) if (g.to === who && live(gid, g, l, seq)) return true;
    return false;
  };
  const staff = new Map();
  for (const { env } of ops) {
    const op = env.op;
    if (op.k === 'grant' && op.role !== 'admin') {
      if (!staff.has(op.id) && !admins.has(op.id) && isAdmin(env.from, op.l, env.seq)) {
        staff.set(op.id, { to: op.to, role: op.role, cols: op.cols, l: op.l });
      }
    } else if (op.k === 'revoke' && env.from !== genesis && !admins.has(op.id) && isAdmin(env.from, op.l, env.seq)) {
      setCut(op.id, op.cut);
    }
  }
  const can = (who, c, l, seq) => {
    if (isAdmin(who, l, seq)) return true;
    for (const [gid, g] of staff) {
      if (g.to === who && (g.cols.includes('*') || g.cols.includes(c)) && live(gid, g, l, seq)) return true;
    }
    return false;
  };
  const roster = [];
  for (const [gid, g] of admins) roster.push({ grant: gid, to: g.to, role: 'admin', cols: ['*'], revoked: cut.has(gid) });
  for (const [gid, g] of staff) roster.push({ grant: gid, to: g.to, role: g.role, cols: g.cols.slice(), revoked: cut.has(gid) });
  roster.sort((a, b) => cmp(a.grant, b.grant));
  return { isAdmin, can, roster, admins: admins.size, staff: staff.size };
}

function record(state, c, id) {
  const col = state.cols[c] || (state.cols[c] = obj());
  return col[id] || (col[id] = { a: obj(), d: obj(), f: obj() });
}
function doc(state, c, id) {
  const k = c + '/' + id;
  return state.docs[k] || (state.docs[k] = { e: obj(), x: obj() });
}

/** Join one authorised data op into the state. Every case is a semilattice join (commutative, idempotent). */
export function apply(state, env) {
  const op = env.op;
  if (op.k === 'put') {
    const r = record(state, op.c, op.id);
    r.a[tagOf(env)] = 1;
    for (const k of Object.keys(op.f)) {
      const cand = [op.l, env.from, canonical(op.f[k]), op.f[k]];
      const cur = r.f[k];
      if (cur === undefined || lwwBeats(cand, cur)) r.f[k] = cand;
    }
  } else if (op.k === 'del') {
    const r = record(state, op.c, op.id);
    for (const t of op.tags) r.d[t] = 1;
  } else if (op.k === 'ins') {
    doc(state, op.c, op.id).e[tagOf(env)] = [op.at, op.ch, op.l, env.from];
  } else if (op.k === 'rm') {
    doc(state, op.c, op.id).x[op.e] = 1;
  }
}

/** The company, materialised from a set of admitted envelopes. → { state, report, roster }. Never throws. */
export function materialize(items, genesis) {
  const report = { applied: 0, unauthorized: 0, equivocators: [], dropped: 0, admins: 0, staff: 0 };
  try {
    const { ops, equivocators, dropped } = dedupe(items);
    report.equivocators = equivocators;
    report.dropped = dropped;
    const auth = authority(ops, genesis);
    report.admins = auth.admins;
    report.staff = auth.staff;
    const state = emptyState();
    for (const { env } of ops) {
      const k = env.op.k;
      if (k === 'grant' || k === 'revoke') continue;
      if (!auth.can(env.from, env.op.c, env.op.l, env.seq)) { report.unauthorized++; continue; }
      apply(state, env);
      report.applied++;
    }
    return { state, report, roster: auth.roster, auth };
  } catch {
    report.fault = true;
    return { state: emptyState(), report, roster: [], auth: { can: () => false, isAdmin: () => false } };
  }
}

const alive = (r) => Object.keys(r.a).some((t) => !r.d[t]);

/** The live records of a collection, fields resolved, sorted by id. */
export function rows(state, c) {
  const col = state.cols[c];
  if (!col) return [];
  const out = [];
  for (const id of Object.keys(col).sort()) {
    const r = col[id];
    if (!alive(r)) continue;
    const rec = { id };
    for (const k of Object.keys(r.f).sort()) rec[k] = r.f[k][3];
    out.push(rec);
  }
  return out;
}

/** The add-tags still alive on a record — what a delete must name (observed-remove). */
export function liveTags(state, c, id) {
  const r = state.cols[c] && state.cols[c][id];
  return r ? Object.keys(r.a).filter((t) => !r.d[t]).sort() : [];
}

/** RGA sequence of visible characters: [{ tag, ch }]. Orphans (missing or cyclic parents) stay hidden on every node. */
export function sequence(state, c, id) {
  const d = state.docs[c + '/' + id];
  if (!d) return [];
  const kids = new Map();
  for (const t of Object.keys(d.e)) {
    const at = d.e[t][0];
    if (!kids.has(at)) kids.set(at, []);
    kids.get(at).push(t);
  }
  for (const list of kids.values()) {
    list.sort((x, y) => d.e[y][2] - d.e[x][2] || cmp(d.e[y][3], d.e[x][3]) || cmp(y, x));
  }
  const out = [];
  const seen = new Set();
  const stack = (kids.get('^') || []).slice().reverse();
  while (stack.length) {
    const t = stack.pop();
    if (seen.has(t)) continue;
    seen.add(t);
    if (!d.x[t]) out.push({ tag: t, ch: d.e[t][1] });
    const ch = kids.get(t);
    if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return out;
}

export function text(state, c, id) {
  return sequence(state, c, id).map((x) => x.ch).join('');
}

/** Every collection that has at least one record. */
export function collections(state) {
  return Object.keys(state.cols).sort();
}
