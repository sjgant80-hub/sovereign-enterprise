// keys.mjs — Ed25519 identity via WebCrypto: the same code in Node (>=20) and every modern browser.
// Each employee device mints its own keypair; the private key never leaves the device.
import { toHex, fromHex } from './canon.mjs';

const subtle = () => globalThis.crypto.subtle;
const ALG = { name: 'Ed25519' };

function b64urlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A fresh random identity: { pub (64-hex), priv (CryptoKey) }. */
export async function generate() {
  const kp = await subtle().generateKey(ALG, true, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  return { pub: toHex(raw), priv: kp.privateKey };
}

/** A deterministic identity from a 32-byte seed (simulations + reproducible receipts). Ed25519 signing is
 *  deterministic (RFC 8032), so seeded keys make every signed envelope — and every receipt — byte-reproducible. */
export async function fromSeed(seed32) {
  const prefix = fromHex('302e020100300506032b657004220420');
  const pkcs8 = new Uint8Array(prefix.length + 32);
  pkcs8.set(prefix);
  pkcs8.set(seed32.subarray(0, 32), prefix.length);
  const priv = await subtle().importKey('pkcs8', pkcs8, ALG, true, ['sign']);
  const jwk = await subtle().exportKey('jwk', priv);
  return { pub: toHex(b64urlToBytes(jwk.x)), priv };
}

/** Export / import a private key as PKCS8 hex, so a device can persist its own identity locally. */
export async function exportPriv(keys) {
  return toHex(new Uint8Array(await subtle().exportKey('pkcs8', keys.priv)));
}
export async function importPriv(pkcs8Hex) {
  const priv = await subtle().importKey('pkcs8', fromHex(pkcs8Hex), ALG, true, ['sign']);
  const jwk = await subtle().exportKey('jwk', priv);
  return { pub: toHex(b64urlToBytes(jwk.x)), priv };
}

export async function sign(keys, bytes) {
  return toHex(new Uint8Array(await subtle().sign(ALG, keys.priv, bytes)));
}

const cache = new Map();
/** Verify; never throws — any malformed key or signature is simply false. */
export async function verify(pubHex, sigHex, bytes) {
  try {
    let k = cache.get(pubHex);
    if (!k) {
      k = await subtle().importKey('raw', fromHex(pubHex), ALG, false, ['verify']);
      if (cache.size > 4096) cache.clear();
      cache.set(pubHex, k);
    }
    return await subtle().verify(ALG, k, fromHex(sigHex), bytes);
  } catch {
    return false;
  }
}
