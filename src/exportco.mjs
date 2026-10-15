// exportco.mjs — the company leaves with you. Every signed write a device holds goes into one file, under a manifest the
// exporting device signs: how many writes, a digest over the whole set, and the digest of the company they make. A
// restore feeds every write back through the gate (node.receive), exactly as if a peer had sent it — so a restored
// device trusts nothing it could not have received from anyone — and then checks it rebuilt the same company. Plus the
// four records a person opens in a spreadsheet (tasks, CRM, the journal line by line, people without sealed details).
//
// WHAT THE FILE HOLDS, AND WHAT IT DOES NOT. It holds the company's records — every signed write — so it can be locked
// under a passphrase (lockFile: PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM over the whole file). It holds NO key:
// a device key never leaves its device (store.mjs keeps it non-extractable). The owner comes back with any two of the
// three recovery cards (recovery.mjs) and then restores this file; a teammate's new device is a fresh key the owner
// grants. A restore that brings back the restored owner's own earlier writes lets it write again, continuing its own
// history — feed() counts them (own), and the device's tip is back where it was.
//
// Pure and total: junk in, a refusal out, never a throw.
import { sha256 } from './sha256.mjs';
import { canonical, utf8, fromUtf8, toHex, fromHex } from './canon.mjs';
import { sign, verify } from './keys.mjs';
import { MAX_BYTES } from './gate.mjs';
import { parseLines, CHART } from './books.mjs';

export const EXPORT_V = 1;
export const MAX_ENVELOPES = 1000000;
export const LOCK_ITER = 600000;                 // PBKDF2-SHA256 rounds for a locked file (OWASP's current floor)
export const MIN_PASS = 10;
export const LOCK_ALG = 'PBKDF2-SHA256/AES-GCM-256';
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HEXSTR = /^[0-9a-f]*$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const no = (why) => ({ ok: false, why });
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
function exactKeys(o, keys) {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
}

/** The digest over a SET of writes: SHA-256 of their hashes (each the SHA-256 of the write's bytes), sorted, one per line. */
export function setDigest(hashes) {
  try { return sha256(hashes.slice().sort().join('\n')); } catch { return ''; }
}

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const FILE_KEYS = ['envelopes', 'kind', 'manifest', 'sig', 'v'];
const MANIFEST_KEYS = ['at', 'by', 'count', 'digest', 'genesis', 'state'];

/**
 * Every signed write the device holds, under a manifest the device signs. signer: the device's keys ({ pub, priv } —
 * the key store's non-extractable key signs as well as any). opts.at — the time.
 * → { ok, file: { kind, v, manifest: { genesis, count, digest, state, at, by }, envelopes: [hex], sig } }
 */
export async function exportCompany(node, signer, opts) {
  try {
    const o = plain(opts) ? opts : {};
    const at = o.at !== undefined ? o.at : new Date().toISOString();
    if (typeof at !== 'string' || !ISO.test(at)) return no('the time of the export is not a valid date');
    if (!signer || typeof signer.pub !== 'string' || !HEX64.test(signer.pub)) return no('there is no device key to sign the export with');
    const hashes = node.hashes().slice().sort();
    const envelopes = hashes.map((h) => toHex(node.bytes(h)));
    const manifest = { genesis: node.genesis, count: envelopes.length, digest: setDigest(hashes), state: node.digest(), at, by: signer.pub };
    const body = { kind: 'se-export', v: EXPORT_V, manifest };
    return { ok: true, file: { ...body, envelopes, sig: await sign(signer, utf8(canonical(body))) } };
  } catch {
    return no('this device could not export its company');
  }
}

/**
 * Read an export: its form, its manifest's signature, the count and the digest over every write in it — before a single
 * write is fed anywhere. → { ok, why, manifest, genesis, envelopes: [Uint8Array], hashes, signedBy }
 */
export async function restoreCompany(text) {
  try { return await readExport(text); } catch { return no('this file could not be read as a company export'); }
}
async function readExport(text) {
  if (typeof text !== 'string' || !text.length) return no('the file is empty');
  let f;
  try { f = JSON.parse(text); } catch { return no('this is not a company export (it is not JSON)'); }
  if (plain(f) && f.kind === 'se-export-locked') return no('this export is locked — type its passphrase to open it');
  if (!plain(f) || f.kind !== 'se-export') return no('this is not a company export');
  if (f.v !== EXPORT_V || !exactKeys(f, FILE_KEYS)) return no('this export is not in the form this page reads');
  const m = f.manifest;
  if (!plain(m) || !exactKeys(m, MANIFEST_KEYS)) return no('the export’s manifest is malformed');
  if (!HEX64.test(m.genesis) || !HEX64.test(m.digest) || !HEX64.test(m.state) || !HEX64.test(m.by) || typeof m.at !== 'string' || !ISO.test(m.at)) return no('the export’s manifest is malformed');
  if (typeof f.sig !== 'string' || !HEX128.test(f.sig)) return no('the export is not signed');
  if (!Array.isArray(f.envelopes) || f.envelopes.length > MAX_ENVELOPES) return no('the export holds no list of writes');
  if (!Number.isSafeInteger(m.count) || m.count !== f.envelopes.length) return no('the manifest says ' + String(m.count) + ' writes but the file holds ' + f.envelopes.length + ' — writes were added or removed');
  const { envelopes, sig, ...body } = f;
  if (!(await verify(m.by, sig, utf8(canonical(body))))) return no('the manifest’s signature does not match — the export was changed after it was made');
  const bytes = [], hashes = [];
  const seen = new Set();
  for (const hex of envelopes) {
    if (typeof hex !== 'string' || !hex.length || hex.length > MAX_BYTES * 2 || hex.length % 2 || !HEXSTR.test(hex)) return no('a write in the export is malformed');
    const b = fromHex(hex);
    const h = sha256(b);
    if (seen.has(h)) return no('the export holds the same write twice');
    seen.add(h);
    bytes.push(b); hashes.push(h);
  }
  if (setDigest(hashes) !== m.digest) return no('the writes do not match the manifest’s digest — the export was changed or cut short');
  return { ok: true, why: 'intact', manifest: m, genesis: m.genesis, envelopes: bytes, hashes, signedBy: m.by };
}

/**
 * Feed restored writes into a device, every one through its gate. → { restored, held (it had them already), refused,
 * reasons: { reason: count }, own } — own: the restored writes this device's own key signed (a restored owner's earlier
 * writes coming back). onProgress(done, total) is told as it goes.
 */
export async function feed(node, envelopes, onProgress) {
  const out = { restored: 0, held: 0, refused: 0, reasons: {}, own: 0 };
  try {
    const list = Array.isArray(envelopes) ? envelopes : [];
    for (let i = 0; i < list.length; i += 256) {
      const rs = await Promise.all(list.slice(i, i + 256).map((b) => node.receive(b)));
      for (const r of rs) {
        if (r.ok) { out.restored++; if (r.env.from === node.pub) out.own++; }
        else if (r.reason === 'replay') out.held++;
        else { out.refused++; out.reasons[r.reason] = (out.reasons[r.reason] || 0) + 1; }
      }
      if (typeof onProgress === 'function') { try { onProgress(Math.min(i + 256, list.length), list.length); } catch { /* a view never breaks a restore */ } }
    }
  } catch { out.fault = true; }
  return out;
}

// ── the file holds the company's records: it can be locked under a passphrase (PBKDF2-SHA256 → AES-256-GCM) ─────────
const subtle = () => globalThis.crypto.subtle;
const LOCKED_KEYS = ['alg', 'data', 'iter', 'iv', 'kind', 'salt', 'v'];
function toB64(bytes) {
  let s = '', rest = bytes;
  while (rest.length) { s += String.fromCharCode.apply(null, rest.subarray(0, 0x8000)); rest = rest.subarray(0x8000); }
  return btoa(s);
}
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function lockedShape(k) {
  return plain(k) && exactKeys(k, LOCKED_KEYS) && k.kind === 'se-export-locked' && k.v === EXPORT_V && k.alg === LOCK_ALG &&
    Number.isSafeInteger(k.iter) && k.iter >= 100000 && k.iter <= 10000000 &&
    typeof k.salt === 'string' && /^[0-9a-f]{32}$/.test(k.salt) && typeof k.iv === 'string' && /^[0-9a-f]{24}$/.test(k.iv) &&
    typeof k.data === 'string' && k.data.length >= 24 && k.data.length % 4 === 0 && B64.test(k.data);
}
/** The header is bound into the cipher: change the rounds or the salt and the file does not open. */
const aadOf = (k) => utf8('se-export-locked/' + EXPORT_V + '|' + k.iter + '|' + k.salt);
async function aesKey(pass, salt, iter) {
  const base = await subtle().importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Lock an export's text under a passphrase. opts: { iter, salt, iv } (tests only). → { ok, file: { kind: 'se-export-locked', … } } */
export async function lockFile(text, pass, opts) {
  try {
    const o = plain(opts) ? opts : {};
    if (typeof text !== 'string' || !text.length) return no('there is nothing to lock');
    if (typeof pass !== 'string' || pass.length < MIN_PASS) return no('use a passphrase of at least ' + MIN_PASS + ' characters');
    const iter = o.iter === undefined ? LOCK_ITER : o.iter;
    const salt = o.salt === undefined ? toHex(globalThis.crypto.getRandomValues(new Uint8Array(16))) : o.salt;
    const iv = o.iv === undefined ? toHex(globalThis.crypto.getRandomValues(new Uint8Array(12))) : o.iv;
    const head = { kind: 'se-export-locked', v: EXPORT_V, alg: LOCK_ALG, iter, salt, iv, data: 'AAAAAAAAAAAAAAAAAAAAAAAA' };
    if (!lockedShape(head)) return no('the file could not be locked with those settings');
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: fromHex(iv), additionalData: aadOf(head) }, await aesKey(pass, fromHex(salt), iter), utf8(text)));
    return { ok: true, file: { ...head, data: toB64(ct) } };
  } catch {
    return no('the file could not be locked on this device');
  }
}
/** Open a locked export with its passphrase → { ok, text }, or a refusal (a wrong passphrase, or a changed file). */
export async function unlockFile(locked, pass) {
  try {
    if (!lockedShape(locked)) return no('the locked file is malformed');
    if (typeof pass !== 'string' || !pass.length) return no('type the passphrase the file was locked with');
    const pt = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromHex(locked.iv), additionalData: aadOf(locked) }, await aesKey(pass, fromHex(locked.salt), locked.iter), fromB64(locked.data)));
    return { ok: true, text: fromUtf8(pt) };
  } catch {
    return no('that passphrase does not open this file (or the file was changed)');
  }
}
/** Read an export, locked or not: a locked one is opened with `pass` first. → restoreCompany's result, plus locked: bool. */
export async function openExport(text, pass) {
  try {
    let f = null;
    try { f = JSON.parse(text); } catch { f = null; }
    if (!plain(f) || f.kind !== 'se-export-locked') return { ...(await restoreCompany(text)), locked: false };
    const u = await unlockFile(f, pass);
    if (!u.ok) return { ...u, locked: true };
    return { ...(await restoreCompany(u.text)), locked: true };
  } catch {
    return no('this file could not be read as a company export');
  }
}

// ── the spreadsheets ────────────────────────────────────────────────────────────────────────────────────────────────
/** One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula (= + - @ tab CR first) gets a leading apostrophe. */
export function csvCell(v) {
  try {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = '\x27' + s;
    return /[\x22,\r\n]/.test(s) ? '\x22' + s.replace(/\x22/g, '\x22\x22') + '\x22' : s;
  } catch { return ''; }
}
/** Whole pence → pounds with two decimals, exactly ("-12.05"); anything else as it is. */
export function poundsText(p) {
  if (!Number.isSafeInteger(p)) return p;
  const a = Math.abs(p);
  return (p < 0 ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
}
export function toCsv(header, rows) {
  try { return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; } catch { return ''; }
}

const FIRST = { tasks: ['id', 'title', 'status', 'owner'], crm: ['id', 'name', 'contact', 'stage', 'value', 'owner'], people: ['id', 'name', 'title', 'kind', 'device'] };
const SEALED = /sealed/i;
function table(list, first, money) {
  const rest = [...new Set(list.flatMap((r) => Object.keys(r)))].filter((k) => !first.includes(k) && !SEALED.test(k)).sort();
  const cols = [...first, ...rest];
  return { header: cols.map((c) => (money.includes(c) ? c + '_gbp' : c)), rows: list.map((r) => cols.map((c) => (money.includes(c) ? poundsText(r[c]) : r[c]))) };
}

/**
 * The company's records as spreadsheets: tasks, CRM (values in pounds), the journal one line per account (pounds), and
 * people without any sealed field. → { ok, files: [{ name, rows, text }] }
 */
export function companyCsvs(node) {
  try {
    const files = [];
    for (const [c, money] of [['tasks', []], ['crm', ['value']], ['people', []]]) {
      const t = table(node.list(c), FIRST[c], money);
      files.push({ name: c + '.csv', rows: t.rows.length, text: toCsv(t.header, t.rows) });
    }
    const lines = [];
    for (const j of node.list('journal')) {
      const ls = parseLines(j.lines);
      if (!ls) { lines.push([j.id, j.date, j.memo, '', 'unreadable lines', '', '']); continue; }
      for (const [code, dr, cr] of ls) lines.push([j.id, j.date, j.memo, code, CHART[code] ? CHART[code][0] : 'unknown account', dr ? poundsText(dr) : '', cr ? poundsText(cr) : '']);
    }
    files.splice(2, 0, { name: 'journal.csv', rows: lines.length, text: toCsv(['entry', 'date', 'memo', 'account', 'account_name', 'debit_gbp', 'credit_gbp'], lines) });
    return { ok: true, files };
  } catch {
    return no('this device could not write its records as spreadsheets');
  }
}
