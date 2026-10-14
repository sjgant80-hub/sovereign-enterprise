// lease.mjs — what a leaver and an erasure leave behind.
//
// CRYPTO-SHREDDING: personal fields are stored only as AES-GCM ciphertext under a per-person key. The ciphertext
// replicates and the history stays verifiable; erasing a person = destroying their key, after which every copy on
// every device is unreadable. Append-only and the right to erasure stop fighting.
//
// DATA LEASES: a device's at-rest key for sensitive collections is a LEASE that must be renewed while its grant
// is live. Revoke the grant and the device can't renew; when the lease runs out the local cache locks itself.
// The decision logic is pure and gated; the AES-GCM is WebCrypto (same in Node and every browser).
import { toHex, fromHex, utf8, fromUtf8 } from './canon.mjs';

/** The lease decision. lease = { issuedAt, ttl } (ms); grantLive: is the device's grant still unrevoked?
 *  → { state: 'active'|'expired', action: 'keep'|'renew'|'lock', until } */
export function decideLease(lease, now, grantLive, renewWindow) {
  try {
    if (!lease || !Number.isSafeInteger(lease.issuedAt) || !Number.isSafeInteger(lease.ttl) || lease.ttl <= 0 || !Number.isSafeInteger(now)) {
      return { state: 'expired', action: 'lock', until: 0 };
    }
    const until = lease.issuedAt + lease.ttl;
    const win = Number.isSafeInteger(renewWindow) && renewWindow >= 0 ? renewWindow : Math.floor(lease.ttl / 4);
    if (now >= until) return { state: 'expired', action: grantLive === true ? 'renew' : 'lock', until };
    if (now >= until - win && grantLive === true) return { state: 'active', action: 'renew', until };
    return { state: 'active', action: 'keep', until };
  } catch {
    return { state: 'expired', action: 'lock', until: 0 };
  }
}

/** Renew a lease: only with a live grant; the new lease starts now. */
export function renew(lease, now, grantLive) {
  if (grantLive !== true || !lease || !Number.isSafeInteger(lease.ttl) || lease.ttl <= 0 || !Number.isSafeInteger(now)) return null;
  return { issuedAt: now, ttl: lease.ttl };
}

// ── AES-GCM sealing (WebCrypto) ──────────────────────────────────────────────────────────────────────────
const subtle = () => globalThis.crypto.subtle;
const AES = { name: 'AES-GCM', length: 256 };

export async function newKey() {
  const k = await subtle().generateKey(AES, true, ['encrypt', 'decrypt']);
  return toHex(new Uint8Array(await subtle().exportKey('raw', k)));
}
async function importKey(hex) {
  return subtle().importKey('raw', fromHex(hex), AES, false, ['encrypt', 'decrypt']);
}
/** Seal a string under a hex key, bound to `aad` (e.g. the record id) → "iv.ciphertext" hex. */
export async function seal(keyHex, plaintext, aad = '') {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, await importKey(keyHex), utf8(plaintext)));
  return toHex(iv) + '.' + toHex(ct);
}
/** Open a sealed string; null if the key is wrong/destroyed, the aad differs, or the box was tampered with. */
export async function open(keyHex, sealed, aad = '') {
  try {
    const [iv, ct] = sealed.split('.');
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromHex(iv), additionalData: utf8(aad) }, await importKey(keyHex), fromHex(ct));
    return fromUtf8(new Uint8Array(pt));
  } catch {
    return null;
  }
}

/** A device's key ring: one key per person. shred() is the erasure: the key is gone, every copy goes dark. */
export function keyRing(initial = {}) {
  const keys = new Map(Object.entries(initial));
  const shredded = new Set();
  return {
    async keyFor(subject) {
      if (shredded.has(subject)) return null;
      if (!keys.has(subject)) keys.set(subject, await newKey());
      return keys.get(subject);
    },
    has: (subject) => keys.has(subject) && !shredded.has(subject),
    shred(subject) { keys.delete(subject); shredded.add(subject); },
    shredded: () => [...shredded].sort(),
    export: () => Object.fromEntries(keys),
  };
}
