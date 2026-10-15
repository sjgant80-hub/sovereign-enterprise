// audit.mjs — what someone OUTSIDE the company can check without trusting it: a signed checkpoint of the books, a proof
// that one entry is in them, a proof that they only grew since a checkpoint the outsider already holds — and a signed
// brain file. Pure and total: junk in, a refusal in plain words out, never a throw.
//
// Verification uses only the vault's RFC 9162 proofs (vault.mjs), Ed25519 (keys.mjs), the one canonical byte form
// (canon.mjs) and the gate's envelope grammar (gate.mjs, the same grammar every device reads a write with). Nothing
// from the company is taken on its word:
//   · a tree head is a write the Finance agent's key signed; a checkpoint carries those signed writes byte for byte,
//     with the Audit agent's signed co-signatures, wrapped and signed by the device that sends it;
//   · the auditor keeps every checkpoint. A later one must come with a consistency proof from the one they hold, so a
//     rewrite of anything they have already seen cannot pass — and two signed heads of one size with different roots
//     are themselves the proof that the company signed two versions of its books;
//   · the first checkpoint tells the auditor the company's signing keys (trust on first use, as with any signing key):
//     they confirm those keys with the company once, by a channel of their own, and every later file must carry them.
import { canonical, utf8, toHex, fromHex } from './canon.mjs';
import { sign, verify } from './keys.mjs';
import { inspect } from './gate.mjs';
import { leafHash, prefixRoots, inclusionProof, verifyInclusion, consistencyProof, verifyConsistency, audit } from './vault.mjs';
import { validEntry, CHART } from './books.mjs';
import { toRecord, fromRecord, validPattern, passesGate } from './brain.mjs';

export const FILE_V = 1;
export const MAX_FILE = 16 * 1024 * 1024;     // the largest file the checker reads
export const MIN_SUMMARY_ROWS = 50;            // rows of your own needed to rebuild a brain's data summary
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_HEADS = 16, MAX_COSIGS = 64, MAX_PROOF = 64;

const no = (why) => ({ ok: false, why });
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const str = (x, re) => typeof x === 'string' && re.test(x);
const short = (h) => String(h).slice(0, 16) + '…';
function exactKeys(o, keys) {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
}

/** A signed write (hex) → its envelope, only if it reads under the gate's grammar AND its signature verifies; else null. */
async function signedEnv(hex) {
  let bytes;
  try { bytes = fromHex(hex); } catch { return null; }
  const r = inspect(bytes);
  if (!r.ok) return null;
  return (await verify(r.env.from, r.env.sig, utf8(r.body))) ? r.env : null;
}

// ── the vault as one device holds it ────────────────────────────────────────────────────────────────────────────────
/**
 * Everything a device holds that an auditor's files are built from: the sealed leaves (rebuilt by vault.audit), every
 * prefix root, the entry id at each index, and — byte for byte — the signed writes behind each tree head, co-signature
 * and journal entry, from keys the company's own role tree authorises for them. A head or co-signature for a size this
 * device holds whose root does not match the rebuilt log is `bad`: the books do not audit here.
 */
export function vaultOf(node) {
  try {
    const auth = node.auth();
    const recs = node.list('vault');
    const a = audit(recs, []);
    const entryAt = new Map();
    for (const r of recs) if (!entryAt.has(r.index)) entryAt.set(r.index, String(r.entry ?? ''));
    const roots = prefixRoots(a.leaves);
    const heads = [], cosigs = [], bad = [], journal = new Map();
    const dec = new TextDecoder();
    for (const h of node.hashes()) {
      const bytes = node.bytes(h);
      const text = dec.decode(bytes);
      if (!text.includes('"c":"vault_head"') && !text.includes('"c":"vault_cosig"') && !text.includes('"c":"journal"')) continue;
      const r = inspect(bytes);
      if (!r.ok || r.env.op.k !== 'put') continue;
      const { from, seq, op } = r.env;
      if (!auth.can(from, op.c, op.l, seq)) continue;
      const hex = toHex(bytes);
      if (op.c === 'journal') {
        if (!journal.has(op.id)) journal.set(op.id, []);
        journal.get(op.id).push({ f: op.f, hex, from });
        continue;
      }
      const { size, root } = op.f;
      if (!Number.isSafeInteger(size) || size < 1 || size >= roots.length) continue;   // a head for leaves not held here yet
      const item = { size, root, hex, from };
      if (roots[size] !== root) bad.push(item);
      else if (op.c === 'vault_head') heads.push(item);
      else cosigs.push(item);
    }
    return { ok: true, genesis: node.genesis, size: a.leaves.length, leaves: a.leaves, roots, entryAt, heads, cosigs, journal, bad, gaps: a.gaps, dupes: a.dupes };
  } catch {
    return no('this device could not read its vault');
  }
}

/** The latest tree head the books on this device support, with every signed head and co-signature for it. */
export function treeHead(vs) {
  try {
    if (!vs || vs.ok !== true) return no('this device could not read its vault');
    if (vs.gaps + vs.dupes > 0) return no('this device’s copy of the vault is incomplete — let it finish syncing, then try again');
    if (vs.bad.length) return no('a signed tree head does not match the books rebuilt on this device — they do not audit, so no checkpoint is signed');
    const size = vs.heads.reduce((m, h) => Math.max(m, h.size), 0);
    if (size < 1) return no('nothing has been sealed into the books yet');
    const pick = (list) => [...new Set(list.filter((x) => x.size === size).map((x) => x.hex))].sort();
    return { ok: true, size, root: vs.roots[size], heads: pick(vs.heads), cosigs: pick(vs.cosigs) };
  } catch {
    return no('this device could not read its vault');
  }
}

// ── a signed checkpoint ─────────────────────────────────────────────────────────────────────────────────────────────
const CP_KEYS = ['at', 'by', 'cosigs', 'genesis', 'heads', 'kind', 'root', 'sig', 'size', 'v'];

/** Sign a checkpoint of the books: the latest tree head, its signed writes, when, and which device sends it. */
export async function checkpoint(vs, signer, opts) {
  try {
    const th = treeHead(vs);
    if (!th.ok) return th;
    const at = opts && opts.at !== undefined ? opts.at : new Date().toISOString();
    if (!str(at, ISO)) return no('the time of the checkpoint is not a valid date');
    if (!signer || !str(signer.pub, HEX64)) return no('there is no device key to sign with');
    const body = { kind: 'se-checkpoint', v: FILE_V, genesis: vs.genesis, size: th.size, root: th.root, heads: th.heads, cosigs: th.cosigs, at, by: signer.pub };
    return { ok: true, bundle: { ...body, sig: await sign(signer, utf8(canonical(body))) } };
  } catch {
    return no('the checkpoint could not be signed on this device');
  }
}

function pinSet(expected) {
  if (expected === undefined || expected === null) return null;
  if (!Array.isArray(expected)) return false;
  return new Set(expected.filter((k) => str(k, HEX64)));
}

/**
 * Check a checkpoint: its own signature, then every tree head and co-signature inside it (each a signed write that
 * must say exactly this size and root). expected — the sequencer keys from a checkpoint you already hold: every tree
 * head must then be signed by one of them. → { ok, why, genesis, size, root, at, by, sequencers, witnesses }
 */
export async function verifyCheckpoint(cp, expected) {
  try { return await checkCp(cp, expected); } catch { return no('this is not a checkpoint this checker can read'); }
}
async function checkCp(cp, expected) {
  if (!plain(cp) || cp.kind !== 'se-checkpoint') return no('this is not a signed checkpoint');
  if (cp.v !== FILE_V || !exactKeys(cp, CP_KEYS)) return no('this checkpoint is not in the form this checker reads');
  if (!Number.isSafeInteger(cp.size) || cp.size < 1) return no('the checkpoint does not say how many entries the books held');
  if (!str(cp.root, HEX64) || !str(cp.genesis, HEX64) || !str(cp.by, HEX64) || !str(cp.sig, HEX128)) return no('the checkpoint is malformed — a root, a key or a signature is not in its proper form');
  if (!str(cp.at, ISO)) return no('the checkpoint’s date is malformed');
  if (!Array.isArray(cp.heads) || !cp.heads.length || cp.heads.length > MAX_HEADS) return no('the checkpoint carries no tree head signed by the company');
  if (!Array.isArray(cp.cosigs) || cp.cosigs.length > MAX_COSIGS) return no('the checkpoint’s co-signatures are malformed');
  const pin = pinSet(expected);
  if (pin === false) return no('the keys to check against are malformed');
  const { sig, ...body } = cp;
  if (!(await verify(cp.by, sig, utf8(canonical(body))))) return no('the checkpoint’s own signature does not match — it was changed after it was signed');
  const sequencers = new Set(), witnesses = new Map();
  for (const hex of cp.heads) {
    const env = await signedEnv(hex);
    if (!env) return no('a tree head inside the checkpoint is not a validly signed write — it was changed or forged');
    if (env.op.k !== 'put' || env.op.c !== 'vault_head') return no('a write inside the checkpoint is not a tree head');
    if (env.op.f.size !== cp.size || env.op.f.root !== cp.root) return no('a signed tree head says a different size or root from the checkpoint');
    if (pin && !pin.has(env.from)) return no('the tree head is signed by a key that is not in the checkpoint you hold (' + short(env.from) + ') — ask the company, by a channel of your own, why its key changed');
    sequencers.add(env.from);
  }
  for (const hex of cp.cosigs) {
    const env = await signedEnv(hex);
    if (!env) return no('a co-signature inside the checkpoint is not a validly signed write — it was changed or forged');
    if (env.op.k !== 'put' || env.op.c !== 'vault_cosig') return no('a write among the co-signatures is not a co-signature');
    if (env.op.f.size !== cp.size || env.op.f.root !== cp.root) return no('a co-signature is for a different size or root from the checkpoint');
    witnesses.set(env.from, String(env.op.f.by ?? '').slice(0, 60));
  }
  return { ok: true, why: 'a genuine signed checkpoint', genesis: cp.genesis, size: cp.size, root: cp.root, at: cp.at, by: cp.by,
    sequencers: [...sequencers].sort(), witnesses: [...witnesses.keys()].sort().map((pub) => ({ pub, name: witnesses.get(pub) })) };
}

// ── one entry is in the books ───────────────────────────────────────────────────────────────────────────────────────
const PROOF_KEYS = ['checkpoint', 'entry', 'index', 'journal', 'kind', 'proof', 'v'];

/** The entry sealed at `index`, its signed journal write, its inclusion proof — checked against the checkpoint `cp`. */
export function proofBundle(vs, index, cp) {
  try {
    if (!vs || vs.ok !== true) return no('this device could not read its vault');
    if (!plain(cp) || cp.kind !== 'se-checkpoint') return no('make a checkpoint first — a proof is checked against a signed checkpoint');
    if (vs.roots[cp.size] !== cp.root) return no('that checkpoint is not of the books on this device');
    if (!Number.isSafeInteger(index) || index < 0 || index >= cp.size) return no('there is no entry #' + String(index) + ' in that checkpoint — it holds #0 to #' + (cp.size - 1));
    const id = vs.entryAt.get(index);
    const leaf = vs.leaves[index];
    const found = (vs.journal.get(id) || []).find((j) => leafHash(canonical({ id, ...j.f })) === leaf);
    if (!found) return no('the journal entry sealed at #' + index + ' is not held on this device');
    return { ok: true, bundle: { kind: 'se-proof', v: FILE_V, index, entry: { id, ...found.f }, journal: found.hex,
      proof: inclusionProof(index, vs.leaves.slice(0, cp.size)), checkpoint: cp } };
  } catch {
    return no('the proof could not be made on this device');
  }
}

/** Is this entry in the books the checkpoint inside signs? → { ok, why, entry, index, size, at, total, lines, checkpoint } */
export async function verifyProofBundle(b, expected) {
  try { return await checkProof(b, expected); } catch { return no('this is not a proof this checker can read'); }
}
async function checkProof(b, expected) {
  if (!plain(b) || b.kind !== 'se-proof') return no('this is not a proof of an entry');
  if (b.v !== FILE_V || !exactKeys(b, PROOF_KEYS)) return no('this proof is not in the form this checker reads');
  const cp = await verifyCheckpoint(b.checkpoint, expected);
  if (!cp.ok) return no('the checkpoint inside the proof does not verify: ' + cp.why);
  const e = b.entry;
  if (!plain(e) || !exactKeys(e, ['date', 'id', 'lines', 'memo']) || ![e.id, e.date, e.memo, e.lines].every((x) => typeof x === 'string')) return no('the entry is not in the form the books seal');
  if (!Array.isArray(b.proof) || b.proof.length > MAX_PROOF) return no('the inclusion proof is malformed');
  if (!verifyInclusion(leafHash(canonical(e)), b.index, cp.size, b.proof, cp.root)) return no('this entry is NOT proven to be in the books — its proof does not lead to the signed root: the entry, its position or the proof was changed');
  const env = await signedEnv(b.journal);
  if (!env) return no('the entry’s own signed write is missing or was changed');
  if (env.op.k !== 'put' || env.op.c !== 'journal' || env.op.id !== e.id) return no('the signed write in the proof is not this entry');
  if (canonical({ id: env.op.id, ...env.op.f }) !== canonical(e)) return no('the signed write says something different from the entry');
  if (!cp.sequencers.includes(env.from)) return no('the entry was written by a different key from the one that signs the books');
  const v = validEntry(e);
  return { ok: true, why: 'in the books', entry: e, index: b.index, size: cp.size, at: cp.at, total: v.ok ? v.total : 0,
    lines: v.ok ? v.lines.map(([code, debit, credit]) => ({ code, name: CHART[code][0], debit, credit })) : [], checkpoint: cp, signed: b.checkpoint };
}

// ── the books only grew ─────────────────────────────────────────────────────────────────────────────────────────────
const CONS_KEYS = ['checkpoint', 'from', 'kind', 'proof', 'v'];

/** Prove the books in checkpoint `cp` extend the ones in `old` (a checkpoint the auditor holds): nothing sealed was changed. */
export function consistencyBundle(old, vs, cp) {
  try {
    if (!vs || vs.ok !== true) return no('this device could not read its vault');
    if (!plain(old) || old.kind !== 'se-checkpoint' || !Number.isSafeInteger(old.size) || old.size < 1) return no('that is not a checkpoint');
    if (!plain(cp) || vs.roots[cp.size] !== cp.root) return no('make a checkpoint of these books first');
    if (old.genesis !== vs.genesis) return no('that checkpoint is of a different company');
    if (old.size > cp.size) return no('that checkpoint is newer than the books on this device — let it finish syncing, then try again');
    if (vs.roots[old.size] !== old.root) return no('that checkpoint is NOT a past state of these books — this device cannot prove they only grew since it');
    return { ok: true, bundle: { kind: 'se-consistency', v: FILE_V, from: { size: old.size, root: old.root, at: str(old.at, ISO) ? old.at : '' },
      proof: consistencyProof(old.size, vs.leaves.slice(0, cp.size)), checkpoint: cp } };
  } catch {
    return no('the proof could not be made on this device');
  }
}

/**
 * Did the books only grow since the checkpoint this bundle starts from? held — the auditor's own copy of that checkpoint:
 * it must verify, it must be the one the bundle names, and the new tree head must be signed by its keys.
 */
export async function verifyConsistencyBundle(b, held) {
  try { return await checkCons(b, held); } catch { return no('this is not a proof this checker can read'); }
}
async function checkCons(b, held) {
  if (!plain(b) || b.kind !== 'se-consistency') return no('this is not a proof that the books only grew');
  if (b.v !== FILE_V || !exactKeys(b, CONS_KEYS)) return no('this proof is not in the form this checker reads');
  const f = b.from;
  if (!plain(f) || !exactKeys(f, ['at', 'root', 'size']) || !Number.isSafeInteger(f.size) || !str(f.root, HEX64) || typeof f.at !== 'string') return no('the proof does not say which checkpoint it starts from');
  let h = null;
  if (held !== undefined) {
    h = await verifyCheckpoint(held);
    if (!h.ok) return no('the checkpoint you hold does not verify: ' + h.why);
    if (h.size !== f.size || h.root !== f.root) return no('this proof starts from a different checkpoint from the one you hold');
  }
  const cp = await verifyCheckpoint(b.checkpoint, h ? h.sequencers : undefined);
  if (!cp.ok) return no('the new checkpoint does not verify: ' + cp.why);
  if (h && h.genesis !== cp.genesis) return no('the new checkpoint is of a different company from the one you hold');
  if (!Array.isArray(b.proof) || b.proof.length > MAX_PROOF) return no('the consistency proof is malformed');
  if (!verifyConsistency(f.size, cp.size, f.root, cp.root, b.proof)) return no('the books did NOT only grow — the proof does not connect the old root to the new one: something sealed before was changed, or the proof was');
  return { ok: true, why: 'only grew', from: { size: f.size, root: f.root, at: h ? h.at : f.at, confirmed: !!h }, checkpoint: cp, signed: b.checkpoint };
}

// ── a signed brain file ─────────────────────────────────────────────────────────────────────────────────────────────
const REC_KEYS = ['base', 'dist', 'domain', 'features', 'held', 'heldAcc', 'heldAuc', 'patternId', 'real', 'role', 'rules', 'spread', 'threshold', 'title'];
const PROV_KEYS = ['app', 'at', 'features', 'grownOn', 'predicts', 'rows', 'summary'];
const BRAIN_KEYS = ['kind', 'pattern', 'provenance', 'sig', 'signedBy', 'v'];

/**
 * A verified brain from "Teach it your own work" (src/train.mjs's result) → the body of a brain file: the pattern in the
 * form brains travel in on the spine (toRecord: every number a string, so the canonical bytes are exact) and where it
 * came from. opts.summary false strips the per-column summary of the training data (min, quartiles, max).
 */
export function brainBody(result, opts) {
  try {
    const o = plain(opts) ? opts : {};
    if (!result || result.ok !== true || !validPattern(result.pattern) || !passesGate(result.pattern.heldAuc)) return no('there is no verified brain to save');
    const at = o.at !== undefined ? o.at : new Date().toISOString();
    if (!str(at, ISO)) return no('the date is not valid');
    const summary = o.summary !== false;
    const pattern = toRecord(result.pattern);
    if (!summary) pattern.dist = '';
    const features = result.features.map((x) => ({ name: String(x.name), from: String(x.from).slice(0, 120), relevance: Math.round(Number(x.relevance) * 1000) | 0 }));
    const provenance = { app: 'Sovereign Enterprise', at, features, grownOn: String(o.label ?? '').slice(0, 200),
      predicts: (String(result.target) + ' = ' + String(result.positive)).slice(0, 200), rows: Number.isSafeInteger(result.rows) ? result.rows : 0, summary };
    return { ok: true, body: { kind: 'se-brain', v: FILE_V, pattern, provenance } };
  } catch {
    return no('the brain could not be prepared');
  }
}

/** Sign a brain body with a device key → the file to download: { kind, v, pattern, provenance, signedBy, sig }. */
export async function signBrain(body, keys) {
  try {
    if (!plain(body) || body.kind !== 'se-brain' || !keys || !str(keys.pub, HEX64)) return no('there is nothing to sign, or no key to sign it with');
    const signed = { kind: body.kind, v: body.v, pattern: body.pattern, provenance: body.provenance, signedBy: keys.pub };
    return { ok: true, file: { ...signed, sig: await sign(keys, utf8(canonical(signed))) } };
  } catch {
    return no('the brain could not be signed on this device');
  }
}

/**
 * Check a brain file: its signature (who made it, and not a byte changed since), then the brain inside. → { ok, why,
 * signedBy, summary, pattern (dist is null when the summary was left out), predicts, heldAuc, clears, rules, features }.
 * The signature says who made it; it does not say the brain is any good on your data — a device re-checks that.
 */
export async function verifyBrain(file) {
  try { return await checkBrain(file); } catch { return no('this is not a brain file this checker can read'); }
}
async function checkBrain(file) {
  if (!plain(file) || file.kind !== 'se-brain') return no('this is not a brain file');
  if (file.v !== FILE_V || !exactKeys(file, BRAIN_KEYS) || !str(file.signedBy, HEX64) || !str(file.sig, HEX128)) return no('this brain file is not in the form this checker reads');
  const { sig, ...signed } = file;
  if (!(await verify(file.signedBy, sig, utf8(canonical(signed))))) return no('the brain file’s signature does not match — it was changed after it was signed');
  const rec = file.pattern, pv = file.provenance;
  if (!plain(rec) || !exactKeys(rec, REC_KEYS) || !plain(pv) || !exactKeys(pv, PROV_KEYS) || typeof pv.summary !== 'boolean' || !Number.isSafeInteger(pv.rows)) return no('the brain inside the file is malformed');
  const stripped = rec.dist === '';
  if (stripped === pv.summary) return no('the file says it carries a data summary and does not (or the other way round)');
  const p = fromRecord(stripped ? { ...rec, dist: String(rec.features).split(',').map((f) => f + ':0,0,0,0,0').join(';') } : rec);
  if (!p) return no('the brain inside the file is malformed');
  if (stripped) p.dist = null;
  return { ok: true, why: 'signed', signedBy: file.signedBy, summary: !stripped, pattern: p, predicts: String(pv.predicts), grownOn: String(pv.grownOn),
    at: String(pv.at), rows: pv.rows, heldAuc: p.heldAuc, clears: passesGate(p.heldAuc), rules: p.rules.length,
    features: Array.isArray(pv.features) ? pv.features.map((x) => ({ name: String(x && x.name), from: String(x && x.from) })) : [] };
}

const qtile = (xs, t) => {
  const i = (xs.length - 1) * t, lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round((xs[lo] + (xs[hi] - xs[lo]) * (i - lo)) * 1e6) / 1e6;
};
/** A brain shared without its data summary → rebuild the summary from YOUR OWN rows ({ feature: number, … }), so it routes. */
export function withSummary(p, rows) {
  try {
    if (!p || !Array.isArray(p.features) || !Array.isArray(rows)) return no('a brain and your own rows are needed');
    const dist = {};
    for (const f of p.features) {
      const xs = rows.map((r) => Number(r && r[f])).filter(Number.isFinite).sort((a, b) => a - b);
      if (xs.length < MIN_SUMMARY_ROWS) return no('your rows have too few values for ' + f + ' to rebuild the summary (at least ' + MIN_SUMMARY_ROWS + ' are needed)');
      dist[f] = { min: xs[0], q1: qtile(xs, 0.25), med: qtile(xs, 0.5), q3: qtile(xs, 0.75), max: xs[xs.length - 1] };
    }
    const out = { ...p, dist };
    return validPattern(out) ? { ok: true, pattern: out } : no('the brain is malformed');
  } catch {
    return no('the summary could not be rebuilt');
  }
}

// ── the verdict an auditor reads ────────────────────────────────────────────────────────────────────────────────────
function parse(x) {
  if (typeof x !== 'string') return plain(x) ? x : null;
  if (x.length > MAX_FILE) return null;
  try { const v = JSON.parse(x); return plain(v) ? v : null; } catch { return null; }
}
const day = (iso) => String(iso).slice(0, 10) + ' ' + String(iso).slice(11, 16) + ' UTC';
const pounds = (p) => '£' + Math.floor(p / 100).toLocaleString('en-GB') + '.' + String(p % 100).padStart(2, '0');
function signers(cp) {
  const w = cp.witnesses.map((x) => (x.name ? x.name + ' ' : '') + '(key ' + short(x.pub) + ')');
  return ['The tree head is signed by the company’s sequencer key ' + cp.sequencers.map(short).join(', ') + '.',
    w.length ? 'Co-signed by ' + w.join(', ') + ' — a second device that rebuilt the same books.' : 'Not co-signed yet: the Audit agent co-signs every ten entries.'];
}
const verdict = (tone, title, lines, keep = null, kind = '') => ({ tone, title, lines, keep, kind });
const said = (why) => String(why).charAt(0).toUpperCase() + String(why).slice(1) + '.';   // a refusal, as a sentence

/** Compare the books in a verified checkpoint with the checkpoint the auditor holds. → a verdict, or null if they agree. */
function against(cp, h, what) {
  if (!h) return null;
  if (h.genesis !== cp.genesis) return verdict('bad', 'A different company', ['The file you hold is from a different company (its owner key differs). Nothing here can be compared with it.']);
  if (h.size === cp.size && h.root !== cp.root) {
    return verdict('bad', 'Two different signed versions of the books',
      ['Both files are signed by the company’s keys and both say the books held ' + cp.size + ' entries — with different contents.',
        'Together, these two files prove the company signed a rewrite of its books. Keep both.']);
  }
  if (h.size > cp.size) return verdict('warn', what + ' older than the checkpoint you hold', ['This ' + what.toLowerCase() + ' is of ' + cp.size + ' entries; the checkpoint you hold already has ' + h.size + '. It tells you nothing new.']);
  return null;
}

/**
 * The verdict for the file a company sent (`sent`), optionally against the checkpoint the auditor already holds (`held`).
 * Both may be JSON text or parsed objects. → { tone: ok|warn|bad, title, lines: [plain sentences], keep, kind }.
 * `keep` is the checkpoint to save for next time — given only when it is proven.
 */
export async function judge(sent, held) {
  try { return await judgeIn(sent, held); } catch { return verdict('bad', 'This file could not be checked', ['It is not a file this checker reads.']); }
}
async function judgeIn(sent, held) {
  const s = parse(sent);
  if (!s) return verdict('bad', 'Not a file this checker reads', ['Drop the JSON file the company sent you: a checkpoint, a proof of an entry, a proof that the books only grew, or a brain file.']);
  let h = null, hp = null;
  if (held !== undefined && held !== null && held !== '') {
    hp = parse(held);
    h = await verifyCheckpoint(hp);
    if (!h.ok) return verdict('bad', 'The checkpoint you hold does not verify', [said(h.why), 'Check that you dropped your own saved checkpoint in the second box.']);
  }
  const pins = h ? h.sequencers : undefined;
  if (s.kind === 'se-checkpoint') {
    const cp = await verifyCheckpoint(s, pins);
    if (!cp.ok) return verdict('bad', 'This checkpoint does not verify', [said(cp.why)], null, 'checkpoint');
    const clash = against(cp, h, 'Checkpoint');
    if (clash) return { ...clash, kind: 'checkpoint' };
    const lines = ['The company’s books held ' + cp.size + ' entries on ' + day(cp.at) + '.', ...signers(cp), 'Sent and signed by the device with key ' + short(cp.by) + '.'];
    if (h && h.size === cp.size) return verdict('ok', 'The same books as the checkpoint you hold', lines, null, 'checkpoint');
    if (h) return verdict('warn', 'Newer than yours — not yet proven to extend it', [...lines, 'On its own it does not prove the books only grew since yours (' + h.size + ' entries). Ask the company for a consistency proof from your checkpoint.'], null, 'checkpoint');
    return verdict('ok', 'A genuine signed checkpoint', [...lines, 'Keep this file. Next time, ask for a proof that the books only grew since it — and confirm the sequencer key above with the company once, by a channel of your own.'], s, 'checkpoint');
  }
  if (s.kind === 'se-proof') {
    const r = await verifyProofBundle(s, pins);
    if (!r.ok) return verdict('bad', 'This entry is not proven', [said(r.why)], null, 'proof');
    const clash = against(r.checkpoint, h, 'The proof is against a checkpoint');
    if (clash) return { ...clash, kind: 'proof' };
    const lines = ['“' + r.entry.memo + '” · ' + r.entry.date + ' · ' + pounds(r.total) + ' debited and credited — entry #' + r.index + ' of the ' + r.size + ' in the books signed on ' + day(r.at) + '.',
      ...r.lines.map((l) => l.code + ' ' + l.name + ': ' + (l.debit ? 'debit ' + pounds(l.debit) : 'credit ' + pounds(l.credit))),
      ...signers(r.checkpoint)];
    if (h && h.size === r.size) lines.push('Proven against the very checkpoint you hold.');
    else if (h) lines.push('Your checkpoint holds ' + h.size + ' entries; to tie this proof to it, ask for a proof that the books only grew since yours.');
    return verdict('ok', 'This entry is in the books', lines, h ? null : s.checkpoint, 'proof');
  }
  if (s.kind === 'se-consistency') {
    const r = await verifyConsistencyBundle(s, h ? hp : undefined);
    if (!r.ok) return verdict('bad', 'Not proven: the books may have been rewritten', [said(r.why)], null, 'consistency');
    const since = r.from.at ? day(r.from.at) : 'the checkpoint of ' + r.from.size + ' entries';
    const lines = ['Then: ' + r.from.size + ' entries. Now: ' + r.checkpoint.size + ' entries, signed on ' + day(r.checkpoint.at) + '.',
      'Every entry sealed by ' + since + ' is still there, unchanged and in the same order.', ...signers(r.checkpoint)];
    if (!r.from.confirmed) lines.push('Drop your own copy of the earlier checkpoint in the second box to confirm it is the one this proof starts from.');
    return verdict(r.from.confirmed ? 'ok' : 'warn', 'The books only grew since ' + since, lines, r.from.confirmed ? s.checkpoint : null, 'consistency');
  }
  if (s.kind === 'se-brain') {
    const r = await verifyBrain(s);
    if (!r.ok) return verdict('bad', 'This brain file does not verify', [said(r.why)], null, 'brain');
    return verdict('ok', 'A signed brain file', ['It predicts “' + r.predicts + '”, from ' + r.features.length + ' columns, with ' + r.rules + ' readable rules.',
      'Grown on ' + r.rows + ' rows (' + r.grownOn + ') on ' + day(r.at) + '; its grower’s own held-out score: AUC ' + r.heldAuc.toFixed(3) + (r.clears ? ' (clears the 0.6 gate).' : ' (below the 0.6 gate).'),
      'Signed by the device with key ' + short(r.signedBy) + '. Not a byte has changed since it signed it.',
      r.summary ? 'It carries a summary of the data it was grown on (each column’s minimum, quartiles and maximum).' : 'It was shared without the summary of its training data; the device that loads it rebuilds one from its own records.',
      'The signature proves who made it — not that it works on your data. A device re-checks it on its own records before it answers anything.'], null, 'brain');
  }
  if (s.kind === 'se-export') return verdict('warn', 'A full company export', ['This file is a whole company’s signed writes, for restoring it (Run your own → Restore from an export). It is not something to check here.', 'To check the books, ask the company for a checkpoint or a proof of an entry.'], null, 'export');
  return verdict('bad', 'Not a file this checker reads', ['Drop a checkpoint, a proof of an entry, a proof that the books only grew, or a brain file.']);
}
