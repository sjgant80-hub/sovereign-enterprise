// node.mjs — one employee's device: its identity, its signed writes, its gated inbox, its view of the company.
// Transport-agnostic: anything that can move bytes (BroadcastChannel, WebRTC, a relay, a simulator) can sync two
// nodes with have()/want() — each side sends what the other lacks, and the gate checks every byte that arrives.
// Every write the device signs names its own previous write (prev — the per-writer hash chain, gate.mjs), so the
// history it builds is the history every device keeps, even against a thief holding the same key (crdt.mjs dedupe).
import { canonical, utf8, toHex, fromHex } from './canon.mjs';
import { admit, proveFork, proveLink, GENESIS_PREV, VERSION } from './gate.mjs';
import { sign } from './keys.mjs';
import { sha256Bytes } from './sha256.mjs';
import { materialize, rows, text, sequence, liveTags, dedupe, authority, apply } from './crdt.mjs';

export const SKEW = 1 << 20;   // one envelope can move this node's clock forward by at most ~1M ticks

/** Sign one envelope — { from, op, prev, seq, v: 2 } signed by `keys` — into its canonical bytes. The one way an
 *  envelope is built (devices, the simulator, the page's attack bench); the gate is the one way one is read. */
export async function signEnvelope(keys, op, seq, prev) {
  const body = { from: keys.pub, op, prev, seq, v: VERSION };
  const sig = await sign(keys, utf8(canonical(body)));
  return utf8(canonical({ ...body, sig }));
}

export function createNode({ keys, genesis, name = '' }) {
  const store = new Map();     // hash -> { env, hash, bytes }
  let seq = 0;
  let head = GENESIS_PREV;     // the hash of this device's own latest write: what its next write names as prev
  let lamport = 0;
  let cached = null;
  let cachedDigest = null;
  let authCache = null;           // the role tree changes only on a grant, a revoke, or a change of a slot's winner
  const slots = new Map();        // 'writer:seq' -> how many distinct envelopes are held for that slot
  let queue = Promise.resolve();  // this device's writes are signed one at a time, each naming the one before
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
    // the highest write this key has signed is the chain head — replaying a device's own stored envelopes restores it
    if (r.env.from === keys.pub && r.env.seq > seq) { seq = r.env.seq; head = r.hash; }
    cachedDigest = null;
    const slot = r.env.from + ':' + r.env.seq;
    const parent = r.env.from + ':' + (r.env.seq - 1);
    const k = r.env.op.k;
    // the role tree or a slot's winner may change: a grant, a revoke, a second envelope for one slot — or a write that
    // continues a CONTESTED slot (its chain can now decide that slot, or burn the key). Everything else folds in.
    if (k === 'grant' || k === 'revoke' || slots.has(slot) || (slots.get(parent) || 0) > 1) { authCache = null; cached = null; }
    else if (cached) {
      // a data op on a fresh (writer, seq) slot: the role tree is unchanged and every join is order-independent,
      // so folding it into the cached company gives exactly what a full rebuild would
      try {
        if (cached.report.fault) cached = null;
        else if (cached.auth.can(r.env.from, r.env.op.c, r.env.op.l, r.env.seq)) { apply(cached.state, r.env); cached.report.applied++; }
        else cached.report.unauthorized++;
      } catch { cached = null; }
    }
    slots.set(slot, (slots.get(slot) || 0) + 1);
    for (const fn of listeners) { try { fn(r); } catch { /* a view never breaks the node */ } }
    return r;
  }

  /** The slot this device's own key is burned from (a thief signed a second, continued history), or null. */
  function forkedAt() {
    const b = self.view().report.burned.find((x) => x.writer === keys.pub);
    return b ? b.from : null;
  }

  /** Sign the next write on this device's own chain and feed it through its own gate (eat your own dog food). The
   *  clock and seq advance only when the gate admits it — a refused write leaves no gap in the chain. */
  async function write(op) {
    const scope = op.k === 'grant' || op.k === 'revoke' ? null : op.c;
    if (!self.canWrite(scope)) return { ok: false, reason: forkedAt() === null ? 'not-authorised' : 'key-forked' };
    const bytes = await signEnvelope(keys, { ...op, l: lamport + 1 }, seq + 1, head);
    const r = await self.receive(bytes);
    // what this device signed IS its chain — even if a thief's envelope for the same slot reached it first
    if (r.ok && r.env.seq >= seq) head = r.hash;
    return { ...r, bytes };
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
    /** This device's own chain head: its latest seq and that write's hash (GENESIS_PREV before its first write). */
    tip: () => ({ seq, hash: head }),
    forkedAt,
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

    /** Sign a new op on this device's chain. A device never signs a write its own view says it isn't authorised for
     *  (no doomed envelopes — and none at all once its key is burned). Writes are queued: each names the one before. */
    emit(op) {
      const run = queue.then(() => write(op));
      queue = run.then(() => {}, () => {});
      return run;
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
      if (!authCache) {
        try { const d = dedupe([...store.values()]); authCache = d.fault ? DENY : authority(d.ops, genesis, d.burned); } catch { authCache = DENY; }
      }
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
    /** Every fork in this device's view, re-proven from the bytes it holds: the two signed envelopes for the slot
     *  (proveFork) and each later write that continued one of them (proveLink). → [{ ...fork, proven, links }] */
    async forkProofs() {
      const out = [];
      for (const f of self.view().report.forks) {
        const pf = await proveFork(self.bytes(f.hashes[0]), self.bytes(f.hashes[1]));
        const links = [];
        for (const n of f.next) {
          const child = store.get(n);
          links.push(await proveLink(self.bytes(child.env.prev), child.bytes));
        }
        out.push({ ...f, proven: pf.ok && links.every((l) => l.ok), links });
      }
      return out;
    },

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
