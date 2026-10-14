// gate.mjs — verify-before-parse for every envelope that reaches a node, from any peer or relay.
//
// On the RAW bytes, in order: SIZE → UTF-8 → MAGIC → guarded parse → exact SCHEMA → CANONICAL round-trip
// (the bytes must BE the canonical form, so a signature can't be re-wrapped) → REPLAY (content hash already
// held) → SIGNATURE (Ed25519 against the sender's key). Only then is the envelope stored; nothing unverified
// ever reaches the company state.
//
// One deliberate difference from a point-to-point gate: on a gossip mesh ops arrive OUT OF ORDER, so the gate
// never drops for ordering. Replay = "these exact bytes are already held". The materialiser (crdt.mjs) is
// order-independent, so out-of-order delivery is harmless and needs no causal buffer.
import { canonical, fromUtf8, utf8 } from './canon.mjs';
import { sha256 } from './sha256.mjs';
import { verify } from './keys.mjs';

export const MAX_BYTES = 4096;
export const L_MAX = 2 ** 48;              // lamport ceiling — a hostile clock can't exhaust the safe-integer range
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

/** The synchronous half of the gate: size → utf8 → magic → parse → schema → canonical. Pure, total. */
export function inspect(bytes) {
  try {
    if (!(bytes instanceof Uint8Array)) return no('not-bytes');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return no('size');
    let text;
    try { text = fromUtf8(bytes); } catch { return no('utf8'); }
    if (text.charCodeAt(0) !== 123) return no('magic');
    let env;
    try { env = JSON.parse(text); } catch { return no('json'); }
    if (!plain(env) || !exactKeys(env, ['from', 'op', 'seq', 'sig', 'v'])) return no('envelope');
    if (env.v !== 1) return no('version');
    if (!str(env.from, HEX64)) return no('from');
    if (!isInt(env.seq) || env.seq < 1) return no('seq');
    if (!str(env.sig, HEX128)) return no('sig-shape');
    if (!validOp(env.op)) return no('schema');
    let canon;
    try { canon = canonical(env); } catch { return no('canon'); }
    if (canon !== text) return no('non-canonical');
    return { ok: true, env, body: canonical({ from: env.from, op: env.op, seq: env.seq, v: 1 }) };
  } catch {
    return no('gate-fault');
  }
}

/** The full gate. `held` is anything with .has(hash) (the node's envelope store). Never throws. */
export async function admit(bytes, held) {
  const r = inspect(bytes);
  if (!r.ok) return r;
  const hash = sha256(bytes);
  if (held && held.has(hash)) return { ok: false, reason: 'replay', hash };
  const good = await verify(r.env.from, r.env.sig, utf8(r.body));
  if (!good) return { ok: false, reason: 'signature', hash };
  return { ok: true, env: r.env, hash };
}
