// node.mjs — one employee's device: its identity, its signed writes, its gated inbox, its view of the company.
// Transport-agnostic: anything that can move bytes (BroadcastChannel, WebRTC, a relay, a simulator) can sync two
// nodes with have()/want() — each side sends what the other lacks, and the gate checks every byte that arrives.
import { canonical, utf8, toHex } from './canon.mjs';
import { admit } from './gate.mjs';
import { sign } from './keys.mjs';
import { sha256Bytes } from './sha256.mjs';
import { materialize, rows, text, sequence, liveTags } from './crdt.mjs';

export const SKEW = 1 << 20;   // one envelope can move this node's clock forward by at most ~1M ticks

export function createNode({ keys, genesis, name = '' }) {
  const store = new Map();     // hash -> { env, hash, bytes }
  let seq = 0;
  let lamport = 0;
  let cached = null;
  const listeners = new Set();

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
      const r = await admit(bytes, store);
      if (!r.ok) return r;
      store.set(r.hash, { env: r.env, hash: r.hash, bytes });
      const l = r.env.op.l;
      if (l > lamport) lamport = Math.min(l, lamport + SKEW);
      if (r.env.from === keys.pub && r.env.seq > seq) seq = r.env.seq;
      cached = null;
      for (const fn of listeners) { try { fn(r); } catch { /* a view never breaks the node */ } }
      return r;
    },

    /** May this device write to collection c (or grant/revoke, if c is null) right now, by its own view? */
    canWrite(c) {
      const { auth } = self.view();
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

    view() {
      if (!cached) cached = materialize([...store.values()], genesis);
      return cached;
    },
    list: (c) => rows(self.view().state, c),
    text: (c, id) => text(self.view().state, c, id),
    digest() { return toHex(sha256Bytes(utf8(canonical(self.view().state)))); },

    // ── anti-entropy: transport-agnostic set reconciliation ──
    have: () => self.hashes(),
    want: (theirs) => theirs.filter((h) => !store.has(h)),
    give: (hashes) => hashes.map((h) => self.bytes(h)).filter(Boolean),
    async take(list) {
      let added = 0;
      for (const b of list) { const r = await self.receive(b); if (r.ok) added++; }
      return added;
    },
  };
  return self;
}

/** a pulls everything b holds that a lacks. Returns how many envelopes a admitted. */
export async function pull(a, b) {
  return a.take(b.give(a.want(b.have())));
}
