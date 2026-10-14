// gate.mjs — verify-before-parse for every envelope that reaches a node, from any peer or relay.
//
// On the RAW bytes, in order: SIZE → UTF-8 → MAGIC → guarded parse → exact SCHEMA → CANONICAL round-trip
// (the bytes must BE the canonical form, so a signature can't be re-wrapped) → REPLAY (content hash already
// held) → SIGNATURE (Ed25519 against the sender's key). Only then is the envelope stored; nothing unverified
// ever reaches the company state.
//
// The envelope (v2 — per-writer hash chains): { from, op, prev, seq, sig, v: 2 }. `prev` is the hash (SHA-256 of
// the canonical envelope bytes — the same hash the store, replay and dedupe use) of the SAME writer's envelope at
// seq-1; a writer's first envelope (seq 1) names GENESIS_PREV, and no later one may. The signature covers prev, so
// every write commits to the history its writer had built when it signed — which is what lets the materialiser
// tell the chain a device actually continued from a slot a stolen key forged afterwards (crdt.mjs dedupe).
// v1 (no prev) is refused: a clean switch, because the company re-creates its spine on load and an unchained
// envelope could not be placed in any writer's history.
//
// One deliberate difference from a point-to-point gate: on a gossip mesh ops arrive OUT OF ORDER, so the gate
// never drops for ordering — nor for a prev it has not seen yet. Replay = "these exact bytes are already held".
// The materialiser (crdt.mjs) is order-independent, so out-of-order delivery is harmless and needs no causal buffer.
import { canonical, fromUtf8, utf8 } from './canon.mjs';
import { sha256 } from './sha256.mjs';
import { verify } from './keys.mjs';

export const MAX_BYTES = 4096;
export const L_MAX = 2 ** 48;              // lamport ceiling — a hostile clock can't exhaust the safe-integer range
export const VERSION = 2;
export const GENESIS_PREV = '0'.repeat(64);  // the prev of every writer's first envelope: nothing before it
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const NAME = /^[a-z][a-z0-9_]{0,31}$/;       // collection names start with a letter (no __proto__ & co)
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const FIELD = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const ROLE = /^[a-z][a-z0-9_-]{0,23}$/;
const TAG = /^[0-9a-f]{64}\.[1-9][0-9]{0,15}$/;

const no = (reason) => ({ ok: false, reason });
const isInt = (x) => Number.isSafeInteger(x);
const lamport = (x) => isInt(x) && x >= 1 && x <= L_MAX;
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
function exactKeys(o, keys) {
  const k = Object.keys(o);
  if (k.length !== keys.length) return false;
  for (const x of keys) if (!Object.prototype.hasOwnProperty.call(o, x)) return false;
  return true;
}
function scalar(v) {
  if (v === null || typeof v === 'boolean') return true;
  if (isInt(v)) return true;
  return typeof v === 'string' && v.length <= 2000;
}
function fields(f) {
  if (!plain(f)) return false;
  const k = Object.keys(f);
  if (k.length < 1 || k.length > 32) return false;
  for (const x of k) {
    if (x === 'id' || !FIELD.test(x)) return false;
    if (!scalar(f[x])) return false;
  }
  return true;
}
function names(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 32) return false;
  for (const c of list) if (typeof c !== 'string' || (c !== '*' && !NAME.test(c))) return false;
  return true;
}
const str = (x, re) => typeof x === 'string' && re.test(x);

/** The op grammar. Total: anything else is false. */
export function validOp(op) {
  try { return grammar(op); } catch { return false; }
}
function grammar(op) {
  if (!plain(op)) return false;
  switch (op.k) {
    case 'put':
      return exactKeys(op, ['c', 'f', 'id', 'k', 'l']) && str(op.c, NAME) && str(op.id, ID) && lamport(op.l) && fields(op.f);
    case 'del':
      return exactKeys(op, ['c', 'id', 'k', 'l', 'tags']) && str(op.c, NAME) && str(op.id, ID) && lamport(op.l) &&
        Array.isArray(op.tags) && op.tags.length >= 1 && op.tags.length <= 256 && op.tags.every((t) => str(t, TAG));
    case 'grant':
      return exactKeys(op, ['cols', 'id', 'k', 'l', 'role', 'to']) && str(op.id, ID) && lamport(op.l) &&
        str(op.to, HEX64) && str(op.role, ROLE) && names(op.cols);
    case 'revoke':
      return exactKeys(op, ['cut', 'id', 'k', 'l']) && str(op.id, ID) && lamport(op.l) && isInt(op.cut) && op.cut >= 0;
    case 'ins':
      return exactKeys(op, ['at', 'c', 'ch', 'id', 'k', 'l']) && str(op.c, NAME) && str(op.id, ID) && lamport(op.l) &&
        typeof op.at === 'string' && (op.at === '^' || TAG.test(op.at)) &&
        typeof op.ch === 'string' && op.ch.length >= 1 && op.ch.length <= 64;
    case 'rm':
      return exactKeys(op, ['c', 'e', 'id', 'k', 'l']) && str(op.c, NAME) && str(op.id, ID) && lamport(op.l) && str(op.e, TAG);
    default:
      return false;
  }
}

/** The synchronous half of the gate: size → utf8 → magic → parse → schema → chain grammar → canonical. Pure, total. */
export function inspect(bytes) {
  try {
    if (!(bytes instanceof Uint8Array)) return no('not-bytes');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return no('size');
    let text;
    try { text = fromUtf8(bytes); } catch { return no('utf8'); }
    if (text.charCodeAt(0) !== 123) return no('magic');
    let env;
    try { env = JSON.parse(text); } catch { return no('json'); }
    if (!plain(env)) return no('envelope');
    if (env.v !== VERSION) return no('version');          // a legacy v1 (unchained) envelope is named as such
    if (!exactKeys(env, ['from', 'op', 'prev', 'seq', 'sig', 'v'])) return no('envelope');
    if (!str(env.from, HEX64)) return no('from');
    if (!isInt(env.seq) || env.seq < 1) return no('seq');
    if (!str(env.prev, HEX64)) return no('prev');
    const first = env.seq === 1;
    if (first !== (env.prev === GENESIS_PREV)) return no('prev-genesis');   // seq 1 ⇔ the genesis prev
    if (!str(env.sig, HEX128)) return no('sig-shape');
    if (!validOp(env.op)) return no('schema');
    let canon;
    try { canon = canonical(env); } catch { return no('canon'); }
    if (canon !== text) return no('non-canonical');
    return { ok: true, env, body: canonical({ from: env.from, op: env.op, prev: env.prev, seq: env.seq, v: VERSION }) };
  } catch {
    return no('gate-fault');
  }
}

/** The full gate. `held` is anything with .has(hash) (the node's envelope store). Never throws. */
export async function admit(bytes, held) {
  try {
    const r = inspect(bytes);
    if (!r.ok) return r;
    const hash = sha256(bytes);
    if (held && held.has(hash)) return { ok: false, reason: 'replay', hash };
    const good = await verify(r.env.from, r.env.sig, utf8(r.body));
    if (!good) return { ok: false, reason: 'signature', hash };
    return { ok: true, env: r.env, hash };
  } catch {
    return no('gate-fault');
  }
}

/**
 * A fork proof anyone can check: two DIFFERENT envelopes, each validly signed by one key, for one (writer, seq) slot.
 * The two hashes in a materialize() fork report name exactly these bytes. → { ok, writer, seq, hashes } or a refusal.
 */
export async function proveFork(a, b) {
  try {
    const x = await admit(a, null);
    const y = await admit(b, null);
    if (!x.ok || !y.ok) return no('unverified');
    if (x.hash === y.hash) return no('same-envelope');
    if (x.env.from !== y.env.from || x.env.seq !== y.env.seq) return no('different-slot');
    return { ok: true, writer: x.env.from, seq: x.env.seq, hashes: [x.hash, y.hash].sort() };
  } catch {
    return no('gate-fault');
  }
}

/**
 * A continuation proof: `child` is validly signed by the writer of `parent`, sits at exactly the next sequence slot,
 * and names parent's hash as its prev — the writer built on parent. → { ok, writer, seq (the parent's), parent, child }.
 */
export async function proveLink(parent, child) {
  try {
    const p = await admit(parent, null);
    const c = await admit(child, null);
    if (!p.ok || !c.ok) return no('unverified');
    if (c.env.from !== p.env.from) return no('other-writer');
    if (c.env.seq !== p.env.seq + 1) return no('not-next');
    if (c.env.prev !== p.hash) return no('not-linked');
    return { ok: true, writer: p.env.from, seq: p.env.seq, parent: p.hash, child: c.hash };
  } catch {
    return no('gate-fault');
  }
}
