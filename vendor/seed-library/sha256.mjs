// sha256.mjs — a compact, pure, synchronous SHA-256 + HMAC-SHA256 (no deps, browser-safe, total).
//
// Why hand-rolled: the SENTINEL-style seed guard and the live page both need a SYNCHRONOUS, dependency-free
// digest. Node's crypto is async-free but not in the browser; SubtleCrypto is async and can't sit inside a
// pure witness kernel. This is the standard FIPS-180-4 SHA-256; sha256.test.mjs cross-checks every digest
// against Node's own crypto.createHash so the implementation is proven, not trusted (gate-the-edges).
//
// Lineage: the "defense grows in" idea — verify integrity BEFORE anything parses the seed — is SENTINEL's
// (sjgant80-hub/sentinel, a structural immune system). SENTINEL uses Ed25519 public-key signatures; this
// guard is a shared-secret HMAC (symmetric), which is weaker (anyone with the key can mint) and is stated
// as such. Powered by the Konomi architecture, created by Thomas Frumkin.

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

// SHA-256 over a byte array → 32-byte Uint8Array. Total: coerces non-array input to empty bytes.
export function sha256Bytes(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : Uint8Array.from(Array.isArray(bytes) ? bytes : []);
  const l = msg.length;
  const withOne = l + 1;
  const k = (56 - (withOne % 64) + 64) % 64;   // bytes of zero padding so total ≡ 56 mod 64
  const total = withOne + k + 8;
  const buf = new Uint8Array(total);
  buf.set(msg, 0);
  buf[l] = 0x80;
  const bits = l * 8;
  // 64-bit big-endian length; l*8 fits well within 2^53 for any real seed/key
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff; buf[total - 7] = (hi >>> 16) & 0xff; buf[total - 6] = (hi >>> 8) & 0xff; buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff; buf[total - 3] = (lo >>> 16) & 0xff; buf[total - 2] = (lo >>> 8) & 0xff; buf[total - 1] = lo & 0xff;

  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[i * 4] = (h[i] >>> 24) & 0xff; out[i * 4 + 1] = (h[i] >>> 16) & 0xff; out[i * 4 + 2] = (h[i] >>> 8) & 0xff; out[i * 4 + 3] = h[i] & 0xff; }
  return out;
}

// UTF-8 encode a string to bytes (total: coerces non-strings via String()).
export function utf8(str) {
  const s = String(str == null ? '' : str);
  const out = [];
  for (const ch of s) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export const toHexStr = (bytes) => Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, '0')).join('');

// SHA-256 of a string → lowercase hex (total).
export const sha256Hex = (str) => toHexStr(sha256Bytes(utf8(str)));

// HMAC-SHA256(key, message) → lowercase hex (total). Standard RFC-2104 construction.
export function hmacSha256Hex(key, message) {
  const blockSize = 64;
  let k = utf8(key);
  if (k.length > blockSize) k = sha256Bytes(k);
  const pad = new Uint8Array(blockSize);
  pad.set(k, 0);
  const ipad = new Uint8Array(blockSize), opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) { ipad[i] = pad[i] ^ 0x36; opad[i] = pad[i] ^ 0x5c; }
  const msg = utf8(message);
  const inner = new Uint8Array(blockSize + msg.length);
  inner.set(ipad, 0); inner.set(msg, blockSize);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(blockSize + 32);
  outer.set(opad, 0); outer.set(innerHash, blockSize);
  return toHexStr(sha256Bytes(outer));
}

export default { sha256Bytes, sha256Hex, hmacSha256Hex, utf8, toHexStr };
