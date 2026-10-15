// recovery.mjs — owner recovery cards: the owner's key split into printed cards, any K of which rebuild it.
//
// THE PROBLEM. The whole role tree hangs off one key: the owner's (the genesis). If the owner's device is lost — broken,
// wiped, gone — there is no one left who can grant an admin. A backup copy of the key is a single thing to steal.
//
// THE ANSWER. Shamir's secret sharing over GF(256): the secret is the constant term of a random polynomial of degree K−1,
// one polynomial per byte; card x carries the polynomial's value at x. Any K cards fix the polynomial (Lagrange
// interpolation at 0 gives the secret back); K−1 cards are consistent with EVERY possible secret, equally — one card
// alone says nothing about the key (test/recovery.test.mjs proves it by enumeration). The default is 2 of 3.
//
// THE SECRET. The page splits the 32-byte private seed of the owner's Ed25519 key — what PKCS#8 wraps after a fixed
// 16-byte header that is the same for every Ed25519 key, so the header is left off the cards. It is exported ONCE, at
// founding, before the key is re-imported non-extractable (store.mjs found()); after that no code can export it again.
//
// THE CARD. Text a person can copy by hand or read aloud: the version prefix, then Crockford base32 in groups of four —
//   SE1 ABCD EFGH …           (69 characters of base32 for a 32-byte key)
// carrying the bytes [K, N, x, mark(4), share(len), check(4)]:
//   mark  — the first 4 bytes of SHA-256 over the SECRET (domain-separated). Every card of one set carries the same
//           mark, so cards from two different keys are refused as mixed, and the rebuilt secret is checked against it:
//           cards from two printings of the same key (different random polynomials) are refused, not mis-combined.
//           It lets a guessed key be checked — which the company's public key already allows — so it tells a thief nothing new.
//   check — the first 4 bytes of SHA-256 over the version and every byte before it: a typo is caught on the card it is
//           on, before anything is combined. Crockford base32 also reads O as 0 and I/L as 1, ignores case, spaces, dashes.
//
// combine(cards) refuses — never throws: fewer than K cards, a card that does not read (format / version / checksum, with
// the card's position), cards from different sets (mixed), the same card twice (duplicate), and cards that do not
// rebuild the marked secret (mismatch) — including any card beyond the K it uses that does not lie on the same polynomial.
//
// HONEST LIMITS. The cards ARE the owner key, two at a time: whoever holds K of them can become the owner. Keep them
// apart (a safe, a bank box, a director's drawer); never photograph them or store them on the computer they protect.
// A restored owner must catch up with the company BEFORE it writes: its next write must name its last one (the hash
// chain), or the two histories fork and the owner key is cut off on every device (crdt.mjs) — the page holds a restored
// owner's writes until its own earlier writes have come back to it.
import { sha256Bytes } from './sha256.mjs';
import { utf8 } from './canon.mjs';

export const VERSION = 'SE1';          // printed first on every card; a card of another version is refused, not misread
export const MAX_CARDS = 16;
export const MAX_SECRET = 64;
const HEAD = 3, MARK = 4, CHECK = 4;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O, U
const DECODE = new Map([...ALPHABET].map((c, i) => [c, i]).concat([['O', 0], ['I', 1], ['L', 1]]));
const MARK_TAG = utf8('se-recovery-v1:');

const refuse = (reason, more) => ({ ok: false, reason, ...more });
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const markOf = (secret) => sha256Bytes(concat(MARK_TAG, secret)).slice(0, MARK);
const checkOf = (body) => sha256Bytes(concat(utf8(VERSION), body)).slice(0, CHECK);
const defaultRandom = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ── GF(2^8), the AES field (x^8 + x^4 + x^3 + x + 1) ────────────────────────────────────────────────────────────────
/** a · b in GF(256): shift-and-add, reducing by the AES polynomial. */
export function gfMul(a, b) {
  let p = 0;
  while (b) {
    if (b & 1) p ^= a;
    a = ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
    b >>= 1;
  }
  return p;
}
/** a⁻¹ in GF(256): a^254, since a^255 = 1 for every a ≠ 0 (and 0 maps to 0). */
export function gfInv(a) {
  let r = 1;
  for (let e = 254; e; e >>= 1) { if (e & 1) r = gfMul(r, a); a = gfMul(a, a); }
  return r;
}
/** The polynomial through `points` ({ x, y: bytes }), evaluated at t, byte by byte (Lagrange). */
function interpolate(points, t) {
  let out = new Uint8Array(points[0].y.length);
  for (const p of points) {
    let num = 1, den = 1;
    for (const q of points) if (q !== p) { num = gfMul(num, t ^ q.x); den = gfMul(den, p.x ^ q.x); }
    const w = gfMul(num, gfInv(den));
    out = out.map((v, i) => v ^ gfMul(p.y[i], w));
  }
  return out;
}

// ── Crockford base32 ─────────────────────────────────────────────────────────────────────────────────────────────
/** Bytes → Crockford base32 (no padding; the last character carries zero bits). */
export function toBase32(bytes) {
  let out = '', acc = 0, bits = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
  }
  return bits ? out + ALPHABET[(acc << (5 - bits)) & 31] : out;
}
/** Crockford base32 → bytes, or null. Case-insensitive; O reads as 0, I and L as 1. The leftover bits must be the zero
 *  padding toBase32 writes, and there must be fewer than five of them — so every byte string has exactly one spelling. */
export function fromBase32(text) {
  try {
    const out = [];
    let acc = 0, bits = 0;
    for (const ch of String(text).toUpperCase()) {
      const v = DECODE.get(ch);
      if (v === undefined) return null;
      acc = ((acc << 5) | v) & 0xfff;
      bits += 5;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    if (bits >= 5 || acc & ((1 << bits) - 1)) return null;
    return Uint8Array.from(out);
  } catch {
    return null;
  }
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Split a secret into N cards, any K of which rebuild it. → { ok: true, cards: [text…] } | { ok: false, reason }
 * opts: { k = 2, n = 3, random } — random(len) → Uint8Array(len) of uniform bytes (default crypto.getRandomValues; a
 * test injects its own for deterministic cards). 2 ≤ K ≤ N ≤ 16; the secret is 1–64 bytes. Never throws.
 */
export function split(secret, opts) {
  try {
    const { k = 2, n = 3, random = defaultRandom } = opts ?? {};
    if (!(secret instanceof Uint8Array) || !secret.length || secret.length > MAX_SECRET) return refuse('secret');
    if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > MAX_CARDS) return refuse('threshold');
    const per = k - 1;
    const coef = random(secret.length * per);
    if (!(coef instanceof Uint8Array) || coef.length !== secret.length * per) return refuse('random');
    const mark = markOf(secret);
    const cards = [];
    for (let x = 1; x <= n; x++) {
      // byte i of card x: s_i + c_i1·x + … + c_i(K−1)·x^(K−1), by Horner from the top coefficient down
      const share = secret.map((s, i) => s ^ gfMul(coef.subarray(i * per, (i + 1) * per).reduceRight((acc, c) => gfMul(acc, x) ^ c, 0), x));
      const body = concat(Uint8Array.of(k, n, x), mark, share);
      const groups = toBase32(concat(body, checkOf(body))).match(/.{1,4}/g);
      cards.push([VERSION, ...groups].join(' '));
    }
    coef.fill(0);
    return { ok: true, cards };
  } catch {
    return refuse('fault');
  }
}

/** Read one card. → { ok: true, k, n, x, mark, share } | { ok: false, reason: card-type|card-size|version|format|checksum } */
export function readCard(text) {
  try {
    if (typeof text !== 'string') return refuse('card-type');
    if (text.length > 400) return refuse('card-size');
    const flat = text.toUpperCase().replace(/[\s-]+/g, '');
    if (!flat.startsWith(VERSION)) return refuse('version');
    const bytes = fromBase32(flat.slice(VERSION.length));
    if (!bytes || bytes.length < HEAD + MARK + CHECK + 1) return refuse('format');
    const body = bytes.subarray(0, bytes.length - CHECK);
    if (!same(checkOf(body), bytes.subarray(body.length))) return refuse('checksum');
    const [k, n, x] = body;
    const share = body.slice(HEAD + MARK);
    if (k < 2 || n < k || n > MAX_CARDS || x < 1 || x > n || share.length > MAX_SECRET) return refuse('format');
    return { ok: true, k, n, x, mark: body.slice(HEAD, HEAD + MARK), share };
  } catch {
    return refuse('format');
  }
}

/**
 * Rebuild the secret from cards. → { ok: true, secret, k, n, used: [x…] } | { ok: false, reason, card?, need?, have? }
 * Refuses (never throws): cards-type, too-many, a card that does not read (its reason, with `card` = its position),
 * mixed (different sets), duplicate (the same card number twice), too-few (with need/have), mismatch.
 */
export function combine(cards) {
  try {
    if (!Array.isArray(cards)) return refuse('cards-type');
    if (cards.length > MAX_CARDS) return refuse('too-many');
    const read = [];
    for (let i = 0; i < cards.length; i++) {
      const r = readCard(cards[i]);
      if (!r.ok) return refuse(r.reason, { card: i });
      read.push(r);
    }
    if (!read.length) return refuse('too-few', { need: null, have: 0 });
    const [a] = read;
    if (read.some((r) => r.k !== a.k || r.n !== a.n || !same(r.mark, a.mark) || r.share.length !== a.share.length)) return refuse('mixed');
    if (new Set(read.map((r) => r.x)).size !== read.length) return refuse('duplicate');
    if (read.length < a.k) return refuse('too-few', { need: a.k, have: read.length });
    const points = read.map((r) => ({ x: r.x, y: r.share }));
    const base = points.slice(0, a.k);
    for (const extra of points.slice(a.k)) if (!same(interpolate(base, extra.x), extra.y)) return refuse('mismatch');
    const secret = interpolate(base, 0);
    if (!same(markOf(secret), a.mark)) return refuse('mismatch');
    return { ok: true, secret, k: a.k, n: a.n, used: base.map((p) => p.x) };
  } catch {
    return refuse('fault');
  }
}
