// node.mjs — one employee's device: its identity, its signed writes, its gated inbox, its view of the company.
// Transport-agnostic: anything that can move bytes (BroadcastChannel, WebRTC, a relay, a simulator) can sync two
// nodes with have()/want() — each side sends what the other lacks, and the gate checks every byte that arrives.
import { canonical, utf8, toHex, fromHex } from './canon.mjs';
import { admit } from './gate.mjs';
import { sign } from './keys.mjs';
import { sha256Bytes } from './sha256.mjs';
import { materialize, rows, text, sequence, liveTags, dedupe, authority, apply } from './crdt.mjs';

export const SKEW = 1 << 20;   // one envelope can move this node's clock forward by at most ~1M ticks

export function createNode({ keys, genesis, name = '' }) {
  const store = new Map();     // hash -> { env, hash, bytes }
  let seq = 0;
  let lamport = 0;
  let cached = null;
  let cachedDigest = null;
  let authCache = null;           // the role tree changes only on a grant, a revoke, or an equivocation at a (writer, seq) slot
  const slots = new Set();
  const DENY = { can: () => false, isAdmin: () => false };
  const fp = new Uint8Array(32);   // XOR of every held envelope hash: equal sets → equal fingerprint, in O(1) per write
  const listeners = new Set();

  /** Commit an envelope the gate admitted: store it, advance the clock, fold it into the cached company. */
  function commit(r, bytes) {
    if (!r.ok) return r;
    if (store.has(r.hash)) return { ok: false, reason: 'replay', hash: r.hash };   // admitted in parallel, already committed
    store.set(r.hash, { env: r.env, hash: r.hash, bytes });
    const h = fromHex(r.hash);
    for (let i = 0; i < 32; i++) fp[i] ^= h[i];
    const l = r.env.op.l;
    if (l > lamport) lamport = Math.min(l, lamport + SKEW);
    if (r.env.from === keys.pub && r.env.seq > seq) seq = r.env.seq;
    cachedDigest = null;
    const slot = r.env.from + ':' + r.env.seq;
    const k = r.env.op.k;
    if (k === 'grant' || k === 'revoke' || slots.has(slot)) { authCache = null; cached = null; }
    else if (cached) {
      // a data op on a fresh (writer, seq) slot: the role tree is unchanged and every join is order-independent,
      // so folding it into the cached company gives exactly what a full rebuild would
      try {
        if (cached.report.fault) cached = null;
        else if (cached.auth.can(r.env.from, r.env.op.c, r.env.op.l, r.env.seq)) { apply(cached.state, r.env); cached.report.applied++; }
        else cached.report.unauthorized++;
      } catch { cached = null; }
    }
    slots.add(slot);
    for (const fn of listeners) { try { fn(r); } catch { /* a view never breaks the node */ } }
    return r;
  }

  const self = {
    name,
    pub: keys.pub,
    genesis,
    has: (h) => store.has(h),
    hashes: () => [...store.keys()],
    bytes: (h) => (store.has(h) ? store.get(h).bytes : undefined),
    size: () => store.size,
    clock: () => lamport,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Every byte from anywhere goes through the gate. */
    async receive(bytes) {
      return commit(await admit(bytes, store), bytes);
    },


    /** May this device write to collection c (or grant/revoke, if c is null) right now, by its own view? */
    canWrite(c) {
      const auth = self.auth();
      return c === null ? auth.isAdmin(keys.pub, lamport + 1, seq + 1) : auth.can(keys.pub, c, lamport + 1, seq + 1);
    },

    /** Sign a new op and feed it through this node's own gate (eat your own dog food). A device never signs a
     *  write its own view says it isn't authorised for — no doomed envelopes. */
    async emit(op) {
      const scope = op.k === 'grant' || op.k === 'revoke' ? null : op.c;
      if (!self.canWrite(scope)) return { ok: false, reason: 'not-authorised' };
      lamport += 1;
      seq += 1;
      const body = { from: keys.pub, op: { ...op, l: lamport }, seq, v: 1 };
      const sig = await sign(keys, utf8(canonical(body)));
      const bytes = utf8(canonical({ ...body, sig }));
      const r = await self.receive(bytes);
      return { ...r, bytes };
    },

    put: (c, id, f) => self.emit({ k: 'put', c, id, f }),
    async del(c, id) {
      const tags = liveTags(self.view().state, c, id);
      if (!tags.length) return { ok: false, reason: 'nothing-to-delete' };
      return self.emit({ k: 'del', c, id, tags });
    },
    grant: (id, to, role, cols) => self.emit({ k: 'grant', id, to, role, cols }),
    revoke: (id, cut) => self.emit({ k: 'revoke', id, cut }),
    ins: (c, id, at, ch) => self.emit({ k: 'ins', c, id, at, ch }),
    rm: (c, id, e) => self.emit({ k: 'rm', c, id, e }),

    /** Type `str` into a document at visible position `pos` (one op per character, RGA). */
    async typeAt(c, id, pos, str) {
      const seq0 = sequence(self.view().state, c, id);
      let at = pos <= 0 ? '^' : seq0[Math.min(pos, seq0.length) - 1].tag;
      for (const ch of str) {
        const r = await self.ins(c, id, at, ch);
        if (!r.ok) return r;
        at = r.env.from + '.' + r.env.seq;
      }
      return { ok: true };
    },
    async eraseAt(c, id, pos, n = 1) {
      const seq0 = sequence(self.view().state, c, id);
      for (const x of seq0.slice(pos, pos + n)) await self.rm(c, id, x.tag);
      return { ok: true };
    },

    /** The role tree alone — exactly materialize()'s, without re-joining every data op on each write. */
    auth() {
      if (cached) return cached.auth;
      if (!authCache) { try { authCache = authority(dedupe([...store.values()]).ops, genesis); } catch { authCache = DENY; } }
      return authCache;
    },
    view() {
      if (!cached) cached = materialize([...store.values()], genesis);
      return cached;
    },
    list: (c) => rows(self.view().state, c),
    text: (c, id) => text(self.view().state, c, id),
    digest() {
      if (!cachedDigest) cachedDigest = toHex(sha256Bytes(utf8(canonical(self.view().state))));
      return cachedDigest;
    },
    /** Order-independent fingerprint of the envelope SET this device holds (the company is a function of that set). */
    fingerprint: () => toHex(fp),

    // ── anti-entropy: transport-agnostic set reconciliation ──
    have: () => self.hashes(),
    want: (theirs) => theirs.filter((h) => !store.has(h)),
    give: (hashes) => hashes.map((h) => self.bytes(h)).filter(Boolean),
    async take(list) {
      // check every signature in the batch at once, then commit in order (a duplicate inside the batch is a replay)
      const checked = await Promise.all(list.map((b) => admit(b, store)));
      let added = 0;
      for (let i = 0; i < list.length; i++) if (commit(checked[i], list[i]).ok) added++;
      return added;
    },
  };
  return self;
}

/** a pulls everything b holds that a lacks. Returns how many envelopes a admitted. */
export async function pull(a, b) {
  return a.take(b.give(a.want(b.have())));
}
