// store.mjs — the device's secrets at rest: its signing key, its replica key, and its copy of the company.
//
// WHAT IT REPLACES. The page kept the device's Ed25519 private key as a PKCS#8 hex string in localStorage ('se.priv')
// and the last 20,000 envelopes as plain hex ('se.env'). Any script on the origin could read the key and take it away.
//
// WHAT IT DOES.
//   · THE DEVICE KEY is an Ed25519 key made NON-EXTRACTABLE by WebCrypto (generateKey / importKey with extractable
//     false). The CryptoKey object itself is kept in IndexedDB (structured clone keeps it non-extractable): the browser
//     will sign with it, and will not hand its bytes to any script — not to this page, not to anything else on the origin.
//     device()/found()/restore() return { pub, priv, sign } — pub and priv exactly as keys.mjs gives them, so
//     createNode({ keys }), signEnvelope and the rtc proof of key work unchanged; sign(bytes) → Promise<Uint8Array>.
//   · FOUNDING (found) is the one moment a key is extractable: generated extractable, its PKCS#8 exported ONCE so its
//     32-byte seed can be split into recovery cards (recovery.mjs), then re-imported non-extractable and stored. The
//     extractable copy is dropped; nothing can export the stored key again. restore() takes the seed back from the
//     cards and stores it non-extractable the same way (the public key is read off a transient extractable import).
//   · THE REPLICA KEY is an AES-GCM-256 key, also non-extractable, one per device namespace. Every envelope this
//     device persists is sealed under it (sealRecord: a fresh 96-bit IV, the namespace bound in as associated data) —
//     what sits in IndexedDB is ciphertext. wipe() deletes the replica key with the log: crypto-shredding, so any copy
//     of a record the browser's storage engine left behind on disk is unreadable too.
//   · THE LOG is append-only and bounded. RETENTION RULE: per device, the newest LOG_MAX (20,000) envelopes are kept,
//     oldest dropped first — except grants and revokes (the role tree), which go to a lane of their own and are kept
//     regardless of age, up to PIN_MAX (5,000; past that they share the bounded lane). A dropped envelope is not lost to
//     the company: every other device still holds it and sends it back on the next sync (held in memory then, and
//     appended again — a company past the bound re-syncs its oldest writes on each start).
//   · TAB DEVICES. A device kept for one browser tab has its key and log here too, so a closed tab would leave them behind.
//     RETENTION RULE: every device record carries when it was last opened (touch); a tab device not opened for TAB_TTL
//     (7 days) whose tab is not open is deleted by the next tab that opens the page (staleDevices picks them; the page
//     checks no tab holds them before it wipes).
//   · MIGRATION (migrate) moves a device from before: its PKCS#8 'se.priv' is imported ONCE as non-extractable, its
//     'se.env' re-sealed into the log, both in ONE IndexedDB transaction — and only after that transaction commits are
//     the plaintext copies deleted. A failure leaves the old copies in place (nothing is lost); a crash between the
//     commit and the delete re-runs harmlessly (same key, log already there → only the delete runs).
//
// HONEST LIMITS.
//   · Non-extractable means the key cannot be COPIED OFF the device by any script. Code running on the same origin
//     can still ask the browser to USE it — sign as this device, decrypt this log — while it runs in this browser.
//     On GitHub Pages every project page shares the origin sjgant80-hub.github.io; a company runs this from its own
//     hub on its own domain, where the only code on the origin is its own.
//   · The browser keeps even a non-extractable key's material in its profile on disk. Full-disk encryption
//     (BitLocker, FileVault) and a locked screen are what protect a stolen laptop's disk; without them someone who
//     reads the profile files directly can recover the device key and the replica key. The answer to a lost device is
//     revoking its grant from another admin device — every device then refuses its writes.
//   · The replica key lives beside the log in the same browser profile: sealing keeps the stored company out of any
//     plain-text dump of the browser's storage and makes wipe() a crypto-shred; it is not a second factor.
//
// Every method is total: hostile or missing arguments, a missing or failing IndexedDB, a refused crypto call → a
// refusal { ok: false, reason }, never a throw. Calls are serialised per store, so one tab never races itself.
import { toHex, fromHex, utf8 } from './canon.mjs';
import { MAX_BYTES } from './gate.mjs';

export const DB_VERSION = 1;
export const LOG_MAX = 20000;
export const PIN_MAX = 5000;
export const TAB_TTL = 7 * 24 * 60 * 60 * 1000;   // a tab-only device not opened for this long, its tab closed, is deleted
export const LEGACY = Object.freeze({ priv: 'se.priv', env: 'se.env' });
const KV = 'kv';
const ED = { name: 'Ed25519' };
const AES = { name: 'AES-GCM', length: 256 };
const IV = 12, TAG = 16;
const PKCS8_ED25519 = fromHex('302e020100300506032b657004220420');
const NS = /^[A-Za-z0-9._:-]{1,80}$/;
const HEXB = /^(?:[0-9a-f]{2})+$/;
const DEC = new TextDecoder();
const EMPTY = new Uint8Array(0);

const refuse = (reason, more) => ({ ok: false, reason, ...more });
const defaultRandom = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64urlToBytes = (s) => { const b = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(b + '==='.slice((b.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const okNs = (ns) => typeof ns === 'string' && NS.test(ns);
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, j) => a + j);
const aadOf = (ns) => utf8('se-log-v1|' + ns);
const K = { dev: (ns) => 'dev|' + ns, aes: (ns) => 'aes|' + ns, meta: (ns) => 'log|' + ns, rec: (ns, i) => 'rec|' + ns + '|' + i, pin: (ns, i) => 'pin|' + ns + '|' + i };

/** Is this envelope a grant or a revoke (a write of the role tree)? Total: anything unreadable is not. */
export function isRoleWrite(bytes) {
  try {
    const k = JSON.parse(DEC.decode(bytes)).op.k;
    return k === 'grant' || k === 'revoke';
  } catch {
    return false;
  }
}

/** The tab-only devices due for deletion under the retention rule: namespaces under `prefix` other than `mine`, last opened
 *  more than `ttl` ms before `now` (a record with no stamp counts as never opened). Total: junk → []. */
export function staleDevices(devices, o) {
  try {
    const { now, ttl = TAB_TTL, prefix = 'tab.', mine = '' } = o ?? {};
    if (!Array.isArray(devices) || !Number.isSafeInteger(now)) return [];
    return devices.filter((d) => d && typeof d.ns === 'string' && d.ns.startsWith(prefix) && d.ns !== mine && now - (Number.isSafeInteger(d.seen) ? d.seen : 0) > ttl).map((d) => d.ns);
  } catch {
    return [];
  }
}

/** Seal one record: AES-GCM under `key`, a fresh IV, `aad` bound in. → { ok, sealed: iv ‖ ciphertext } | refusal. */
export async function sealRecord(o) {
  try {
    const { subtle, key, bytes, aad = EMPTY, random = defaultRandom } = o;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) return refuse('record');
    const iv = random(IV);
    if (!(iv instanceof Uint8Array) || iv.length !== IV) return refuse('random');
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes));
    const sealed = new Uint8Array(IV + ct.length);
    sealed.set(iv);
    sealed.set(ct, IV);
    return { ok: true, sealed };
  } catch {
    return refuse('seal');
  }
}

/** Open one sealed record. A wrong key, a wrong aad or one changed bit → { ok: false, reason: 'open' }. */
export async function openRecord(o) {
  try {
    const { subtle, key, sealed, aad = EMPTY } = o;
    if (!(sealed instanceof Uint8Array) || sealed.length < IV + TAG) return refuse('record');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, IV), additionalData: aad }, key, sealed.slice(IV));
    return { ok: true, bytes: new Uint8Array(pt) };
  } catch {
    return refuse('open');
  }
}

/**
 * The key store over one IndexedDB database. createKeyStore({ idb: indexedDB, subtle: crypto.subtle, name }) — both
 * injected, so the same code runs in the browser and in Node tests over an in-memory IndexedDB. `limits`
 * ({ log, pins }) exists for tests; the page uses the defaults (LOG_MAX, PIN_MAX). Namespaces ('owner', 'join.<id>',
 * 'tab.<id>') keep each device's key and log apart in one database.
 */
export function createKeyStore(opts) {
  let idb, subtle, name, random, now, logMax, pinMax;
  try {
    ({ idb, subtle, name = 'sovereign-enterprise', random = defaultRandom, now = Date.now } = opts ?? {});
    const limits = (opts ?? {}).limits ?? {};
    logMax = Number.isSafeInteger(limits.log) && limits.log > 0 ? limits.log : LOG_MAX;
    pinMax = Number.isSafeInteger(limits.pins) && limits.pins >= 0 ? limits.pins : PIN_MAX;
  } catch {
    idb = null;
  }
  let opened = null;
  let queue = Promise.resolve();

  /** Run fn after every call before it — one call at a time, so two calls never mint two keys for one namespace. */
  function serial(fn) {
    const run = queue.then(fn).catch(() => refuse('store'));
    queue = run.then(() => {}, () => {});
    return run;
  }

  function db() {
    if (!opened) {
      opened = new Promise((res, rej) => {
        const r = idb.open(name, DB_VERSION);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      });
      opened.catch(() => { opened = null; });   // a failed open is retried on the next call
    }
    return opened;
  }

  /** One transaction. fn(store) issues its requests synchronously (or from their callbacks) and returns a getter for the
   *  result, read once the transaction has COMMITTED — a result never reflects a write that was rolled back. */
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(KV, mode);
      let get = () => undefined;
      t.oncomplete = () => res(get());
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);   // any rejection is a refusal ('store'); the reason is not shown
      get = fn(t.objectStore(KV));
    });
  }
  const read = (key) => tx('readonly', (s) => { const r = s.get(key); return () => r.result; });
  const metaOf = (m) => ({
    first: Number.isSafeInteger(m?.first) ? m.first : 0,
    next: Number.isSafeInteger(m?.next) ? m.next : 0,
    pins: Number.isSafeInteger(m?.pins) ? m.pins : 0,
  });

  const keysOf = (rec) => Object.freeze({
    pub: rec.pub,
    priv: rec.priv,
    sign: async (bytes) => new Uint8Array(await subtle.sign(ED, rec.priv, bytes)),
  });
  async function readDev(ns) {
    const rec = await read(K.dev(ns));
    return rec && typeof rec.pub === 'string' && /^[0-9a-f]{64}$/.test(rec.pub) && rec.priv && rec.priv.type === 'private' ? rec : null;
  }
  /** A seed (32 bytes) or an Ed25519 PKCS#8 (48) → { pub, priv } with priv NON-extractable, or null. The public key is
   *  read off a transient extractable import that is dropped at once. */
  async function importSecret(secret) {
    if (!(secret instanceof Uint8Array)) return null;
    let pkcs8 = null;
    if (secret.length === 32) { pkcs8 = new Uint8Array(48); pkcs8.set(PKCS8_ED25519); pkcs8.set(secret, 16); }
    else if (secret.length === 48 && PKCS8_ED25519.every((b, i) => secret[i] === b)) pkcs8 = secret.slice();
    if (!pkcs8) return null;
    try {
      const tmp = await subtle.importKey('pkcs8', pkcs8, ED, true, ['sign']);
      const pub = toHex(b64urlToBytes((await subtle.exportKey('jwk', tmp)).x));
      const priv = await subtle.importKey('pkcs8', pkcs8, ED, false, ['sign']);
      return { pub, priv };
    } finally {
      pkcs8.fill(0);
    }
  }
  /** Every record key of a namespace's log, in order: the role-tree lane, then the bounded lane oldest first. */
  const recordKeys = (ns, m) => [...range(0, m.pins).map((i) => K.pin(ns, i)), ...range(m.first, m.next).map((i) => K.rec(ns, i))];
  /** In ONE transaction: delete the namespace's log (and its keys unless keepKeys), then put `dev` if given — so a
   *  replaced key and its old log go together, or not at all. */
  const drop = (ns, keepKeys, dev) => tx('readwrite', (s) => {
    const g = s.get(K.meta(ns));
    g.onsuccess = () => {
      for (const k of recordKeys(ns, metaOf(g.result))) s.delete(k);
      s.delete(K.meta(ns));
      if (!keepKeys) { s.delete(K.dev(ns)); s.delete(K.aes(ns)); }
      if (dev) s.put(dev, K.dev(ns));
    };
    return () => true;
  });
  async function replicaKey(ns, make) {
    const have = await read(K.aes(ns));
    if (have && have.type === 'secret') return { key: have, fresh: false };
    if (!make) return null;
    return { key: await subtle.generateKey(AES, false, ['encrypt', 'decrypt']), fresh: true };
  }
  /** Seal envelopes for one namespace; → the sealed records, each with its lane. */
  async function sealAll(ns, key, list) {
    const out = [];
    for (const bytes of list) {
      const s = await sealRecord({ subtle, key, bytes, aad: aadOf(ns), random });
      if (!s.ok) throw new Error(s.reason);
      out.push({ sealed: s.sealed, pin: isRoleWrite(bytes) });
    }
    return out;
  }
  /** Inside a readwrite transaction: append sealed records to the namespace's log under the retention rule. */
  function place(s, ns, m, records) {
    for (const r of records) {
      if (r.pin && m.pins < pinMax) { s.put(r.sealed, K.pin(ns, m.pins)); m.pins++; continue; }
      s.put(r.sealed, K.rec(ns, m.next));
      m.next++;
      while (m.next - m.first > logMax) { s.delete(K.rec(ns, m.first)); m.first++; }
    }
    s.put(m, K.meta(ns));
    return m;
  }
  const sizeOf = (m) => m.next - m.first + m.pins;

  const usable = () => !!idb && typeof idb.open === 'function' && !!subtle;
  const guard = (ns, fn) => serial(async () => {
    if (!usable()) return refuse('no-store');
    if (!okNs(ns)) return refuse('ns');
    return fn();
  });

  return {
    name,
    limits: { log: logMax, pins: pinMax },

    /** The device key held for ns, or null. → { ok, keys: { pub, priv, sign } | null } */
    keys: (ns) => guard(ns, async () => {
      const rec = await readDev(ns);
      return { ok: true, keys: rec ? keysOf(rec) : null };
    }),

    /** The device key for ns — made here, non-extractable, if there is none. → { ok, keys, fresh } */
    device: (ns) => guard(ns, async () => {
      const have = await readDev(ns);
      if (have) return { ok: true, keys: keysOf(have), fresh: false };
      const kp = await subtle.generateKey(ED, false, ['sign', 'verify']);
      const pub = toHex(new Uint8Array(await subtle.exportKey('raw', kp.publicKey)));
      const rec = { v: 1, pub, priv: kp.privateKey, how: 'made', seen: now() };
      await tx('readwrite', (s) => { s.put(rec, K.dev(ns)); return () => true; });
      return { ok: true, keys: keysOf(rec), fresh: true };
    }),

    /**
     * Found a company's owner on ns: a new key, its 32-byte seed exported ONCE (for the recovery cards — the caller
     * splits it and zeroes it), then stored non-extractable. Refuses 'exists' if ns holds a key, unless { replace: true }
     * — which deletes that key and its log first. → { ok, keys, seed }
     */
    found: (ns, o) => guard(ns, async () => {
      const replace = (o ?? {}).replace === true;
      if (!replace && (await readDev(ns))) return refuse('exists');
      const kp = await subtle.generateKey(ED, true, ['sign', 'verify']);
      const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
      if (pkcs8.length !== 48 || !PKCS8_ED25519.every((b, i) => pkcs8[i] === b)) return refuse('pkcs8');
      const seed = pkcs8.slice(16);
      const made = await importSecret(pkcs8);
      pkcs8.fill(0);
      const rec = { v: 1, pub: made.pub, priv: made.priv, how: 'founded', seen: now() };
      await drop(ns, false, rec);
      return { ok: true, keys: keysOf(rec), seed };
    }),

    /**
     * Restore a key from its seed (32 bytes, from the recovery cards) or its PKCS#8 (48), non-extractable. If ns holds
     * the same key, nothing changes; a different key is refused 'exists' unless { replace: true } (its log goes with it).
     * → { ok, keys, same }
     */
    restore: (ns, secret, o) => guard(ns, async () => {
      const replace = (o ?? {}).replace === true;
      const made = await importSecret(secret);
      if (!made) return refuse('secret');
      const have = await readDev(ns);
      if (have && have.pub === made.pub) return { ok: true, keys: keysOf(have), same: true };
      if (have && !replace) return refuse('exists');
      const rec = { v: 1, pub: made.pub, priv: made.priv, how: 'restored', seen: now() };
      await drop(ns, false, rec);
      return { ok: true, keys: keysOf(rec), same: false };
    }),

    /**
     * Move a device from before the key store, once. from = { get(key) → string|null, remove(key) } over the storage the
     * page used ('se.priv', 'se.env' — LEGACY). → { ok, moved: false } when there is nothing to move;
     * { ok, moved: true, keys, envelopes, cleared } after; a refusal (legacy-key | conflict | store) leaves it untouched.
     */
    migrate: (ns, from) => guard(ns, async () => {
      const { get, remove } = from ?? {};
      const hex = get(LEGACY.priv);
      if (hex === null || hex === undefined) return { ok: true, moved: false };
      if (typeof hex !== 'string' || !/^[0-9a-f]{96}$/.test(hex)) return refuse('legacy-key');
      const made = await importSecret(fromHex(hex));
      if (!made) return refuse('legacy-key');
      const have = await readDev(ns);
      if (have && have.pub !== made.pub) return refuse('conflict');
      let list = [];
      try { const p = JSON.parse(get(LEGACY.env) || '[]'); if (Array.isArray(p)) list = p; } catch { list = []; }
      const meta0 = metaOf(await read(K.meta(ns)));
      const env = have && sizeOf(meta0) ? [] : list.filter((h) => typeof h === 'string' && h.length <= MAX_BYTES * 2 && HEXB.test(h)).slice(-logMax).map(fromHex);
      const rk = await replicaKey(ns, true);
      const records = await sealAll(ns, rk.key, env);
      const rec = have || { v: 1, pub: made.pub, priv: made.priv, how: 'migrated', seen: now() };
      await tx('readwrite', (s) => {
        if (!have) s.put(rec, K.dev(ns));
        if (rk.fresh) s.put(rk.key, K.aes(ns));
        const g = s.get(K.meta(ns));
        g.onsuccess = () => place(s, ns, metaOf(g.result), records);
        return () => true;
      });
      let cleared = true;
      for (const k of [LEGACY.priv, LEGACY.env]) { try { remove(k); } catch { cleared = false; } }
      return { ok: true, moved: true, keys: keysOf(rec), envelopes: records.length, cleared };
    }),

    /** Persist one admitted envelope for ns, sealed. → { ok, size, pinned } */
    append: (ns, bytes) => guard(ns, async () => {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) return refuse('record');
      const rk = await replicaKey(ns, true);
      const [r] = await sealAll(ns, rk.key, [bytes]);
      const m = await tx('readwrite', (s) => {
        if (rk.fresh) s.put(rk.key, K.aes(ns));
        let out = null;
        const g = s.get(K.meta(ns));
        g.onsuccess = () => { out = place(s, ns, metaOf(g.result), [r]); };
        return () => out;
      });
      return { ok: true, size: sizeOf(m), pinned: r.pin };
    }),

    /** Every envelope persisted for ns, opened: the role-tree lane first, then the rest, oldest first.
     *  → { ok, items: [Uint8Array], unreadable } — a record that does not open is counted, never returned. */
    entries: (ns) => guard(ns, async () => {
      const rk = await replicaKey(ns, false);
      if (!rk) return { ok: true, items: [], unreadable: 0 };
      const sealed = await tx('readonly', (s) => {
        const out = [];
        const g = s.get(K.meta(ns));
        g.onsuccess = () => {
          recordKeys(ns, metaOf(g.result)).forEach((k, j) => { const r = s.get(k); r.onsuccess = () => { out[j] = r.result; }; });
        };
        return () => out;
      });
      const opened = await Promise.all(sealed.map((x) => openRecord({ subtle, key: rk.key, sealed: x, aad: aadOf(ns) })));
      const items = opened.filter((r) => r.ok).map((r) => r.bytes);
      return { ok: true, items, unreadable: opened.length - items.length };
    }),

    /** What is held for ns. → { ok, pub|null, how|null, size, pins, sealed } */
    stat: (ns) => guard(ns, async () => {
      const rec = await readDev(ns);
      const m = metaOf(await read(K.meta(ns)));
      return { ok: true, pub: rec ? rec.pub : null, how: rec ? rec.how : null, size: sizeOf(m), pins: m.pins, sealed: !!(await replicaKey(ns, false)) };
    }),

    /** Drop ns's log, keep its keys (a device joining another company starts its log again). */
    clear: (ns) => guard(ns, async () => { await drop(ns, true); return { ok: true }; }),

    /** Drop everything held for ns: device key, replica key (crypto-shred), log. */
    wipe: (ns) => guard(ns, async () => { await drop(ns, false); return { ok: true }; }),

    /** Mark ns as opened now (the tab-device retention rule counts from here). → { ok, seen } — seen null if ns holds no key */
    touch: (ns) => guard(ns, async () => {
      const rec = await readDev(ns);
      if (!rec) return { ok: true, seen: null };
      const seen = now();
      await tx('readwrite', (s) => { s.put({ ...rec, seen }, K.dev(ns)); return () => true; });
      return { ok: true, seen };
    }),

    /** Every device held in this database. → { ok, devices: [{ ns, pub, how, seen }] } */
    list: () => serial(async () => {
      if (!usable()) return refuse('no-store');
      const keys = await tx('readonly', (s) => { const r = s.getAllKeys(); return () => r.result; });
      const devices = [];
      for (const k of keys.filter((x) => typeof x === 'string' && x.startsWith('dev|'))) {
        const rec = await readDev(k.slice(4));
        if (rec) devices.push({ ns: k.slice(4), pub: rec.pub, how: rec.how, seen: Number.isSafeInteger(rec.seen) ? rec.seen : 0 });
      }
      return { ok: true, devices };
    }),

    /** Close the database (tests; a page never needs to). */
    close: () => serial(async () => {
      if (opened) { const d = await opened; opened = null; d.close(); }
      return { ok: true };
    }),
  };
}
