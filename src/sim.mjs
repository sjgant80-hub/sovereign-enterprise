// sim.mjs — the deterministic company-network simulator (proof organ).
//
// A seeded fleet of employee nodes runs the real spine (real Ed25519, real gate, real materialiser) through a
// hostile network: random partitions, dropped and duplicated gossip, and a live attacker sending forged
// signatures, bit-flipped envelopes, replays, non-canonical re-wraps, oversize junk, unauthorised writes, and an
// insider who EQUIVOCATES (two different validly-signed envelopes for one sequence number). Then it heals the
// network and checks that every node holds byte-identical company state — equal to the state materialised from
// the union of everything anyone admitted. Seeded keys + deterministic Ed25519 => the receipt is byte-reproducible.
import { createNode, pull } from './node.mjs';
import { fromSeed, sign } from './keys.mjs';
import { sha256Bytes } from './sha256.mjs';
import { canonical, utf8, toHex } from './canon.mjs';
import { materialize } from './crdt.mjs';

/** mulberry32 — a tiny seeded PRNG. */
export function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = ['tasks', 'crm', 'msg'];

async function randomOp(node, rnd, ids) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const x = rnd();
  if (x < 0.45) {
    const c = pick(COLS);
    const id = c[0] + Math.floor(rnd() * 12);
    ids.add(c + '/' + id);
    return node.put(c, id, { title: 'v' + Math.floor(rnd() * 1000), done: rnd() < 0.5 });
  }
  if (x < 0.6) {
    if (!ids.size) return null;
    const [c, id] = pick([...ids].sort()).split('/');
    return node.del(c, id);
  }
  const len = node.text('docs', 'd0').length;
  if (x < 0.88 || !len) return node.typeAt('docs', 'd0', Math.floor(rnd() * (len + 1)), String.fromCharCode(97 + Math.floor(rnd() * 26)));
  return node.eraseAt('docs', 'd0', Math.floor(rnd() * len), 1);
}

async function signed(keys, op, seq) {
  const body = { from: keys.pub, op, seq, v: 1 };
  const sig = await sign(keys, utf8(canonical(body)));
  return utf8(canonical({ ...body, sig }));
}

async function attack(nodes, keys, evil, insider, rnd, stats) {
  const target = nodes[Math.floor(rnd() * nodes.length)];
  const own = target.hashes();
  const kind = Math.floor(rnd() * 8);
  let bytes = null;
  let label = '';
  if (kind === 0) {
    label = 'forged-signature';
    const body = { from: keys[insider].pub, op: { k: 'put', c: 'tasks', id: 'forged', f: { title: 'pwned' }, l: 3 }, seq: 900000 + stats.attacks, v: 1 };
    bytes = utf8(canonical({ ...body, sig: 'ab'.repeat(64) }));
  } else if (kind === 1 && own.length) {
    label = 'bit-flip';
    bytes = target.bytes(own[Math.floor(rnd() * own.length)]).slice();
    bytes[Math.floor(rnd() * bytes.length)] ^= 1 << Math.floor(rnd() * 8);
  } else if (kind === 2 && own.length) {
    label = 'replay';
    bytes = target.bytes(own[Math.floor(rnd() * own.length)]);
  } else if (kind === 3 && own.length) {
    label = 'non-canonical';
    const t = new TextDecoder().decode(target.bytes(own[Math.floor(rnd() * own.length)]));
    bytes = utf8('{ ' + t.slice(1));
  } else if (kind === 4) {
    label = 'oversize';
    bytes = utf8('{' + 'x'.repeat(5000));
  } else if (kind === 5) {
    label = 'unauthorised-write';
    bytes = await signed(evil, { k: 'put', c: 'crm', id: 'e' + stats.attacks, f: { name: 'fake lead' }, l: 7 }, stats.attacks + 1);
  } else if (kind === 6) {
    label = 'equivocation';
    bytes = await signed(keys[insider], { k: 'put', c: 'tasks', id: 'eq', f: { title: 'fork-' + stats.attacks }, l: 2 }, 1);
  } else {
    label = 'junk';
    bytes = new Uint8Array(1 + Math.floor(rnd() * 64)).map(() => Math.floor(rnd() * 256));
  }
  stats.attacks++;
  const r = await target.receive(bytes);
  const key = label + (r.ok ? ':admitted' : ':' + r.reason);
  stats.attack[key] = (stats.attack[key] || 0) + 1;
}

/**
 * Run the company through a hostile network. → a receipt object (canonical-encodable).
 * cfg: { seed, nodes, rounds, opsPerRound, partitionFrom, partitionTo, drop‰, dup‰, fanout, attacks } (rates in permille — integers, so the receipt is canonical)
 */
export async function simulate(cfg = {}) {
  const c = { seed: 1, nodes: 16, rounds: 30, opsPerRound: 6, partitionFrom: 8, partitionTo: 20, drop: 200, dup: 150, fanout: 2, attacks: 3, ...cfg };
  const rnd = prng(c.seed);
  const keys = [];
  for (let i = 0; i <= c.nodes; i++) keys.push(await fromSeed(sha256Bytes('sovereign-enterprise/sim/' + c.seed + '/' + i)));
  const genesis = keys[0].pub;
  const evil = keys[c.nodes];
  const insider = Math.min(2, c.nodes - 1);
  const nodes = [];
  for (let i = 0; i < c.nodes; i++) nodes.push(createNode({ keys: keys[i], genesis, name: 'n' + i }));

  // the role tree: owner (n0) makes n1 admin; n1 makes everyone else staff with full scope
  await nodes[0].grant('admin-1', keys[1].pub, 'admin', ['*']);
  await pull(nodes[1], nodes[0]);
  for (let i = 2; i < c.nodes; i++) await nodes[1].grant('staff-' + i, keys[i].pub, 'staff', ['*']);

  const stats = { emitted: 0, dropped: 0, duplicated: 0, partitionRounds: 0, attacks: 0, attack: {} };
  const side = new Array(c.nodes).fill(0);
  const ids = new Set();
  for (let round = 0; round < c.rounds; round++) {
    const parted = round >= c.partitionFrom && round < c.partitionTo;
    if (round === c.partitionFrom) for (let i = 0; i < c.nodes; i++) side[i] = rnd() < 0.5 ? 0 : 1;
    if (parted) stats.partitionRounds++;
    for (let k = 0; k < c.opsPerRound; k++) {
      const r = await randomOp(nodes[Math.floor(rnd() * c.nodes)], rnd, ids);
      if (r && r.ok) stats.emitted++;
    }
    for (let k = 0; k < c.attacks; k++) await attack(nodes, keys, evil, insider, rnd, stats);
    for (let i = 0; i < c.nodes; i++) {
      for (let f = 0; f < c.fanout; f++) {
        const j = Math.floor(rnd() * c.nodes);
        if (j === i || (parted && side[i] !== side[j])) continue;
        if (rnd() * 1000 < c.drop) { stats.dropped++; continue; }
        await pull(nodes[i], nodes[j]);
        if (rnd() * 1000 < c.dup) {                       // duplicate delivery: resend what i already holds
          stats.duplicated++;
          const h = nodes[j].hashes();
          if (h.length) await nodes[i].receive(nodes[j].bytes(h[Math.floor(rnd() * h.length)]));
        }
      }
    }
  }

  // heal: all-pairs anti-entropy until nothing moves
  let healRounds = 0;
  for (;;) {
    let moved = 0;
    for (const a of nodes) for (const b of nodes) if (a !== b) moved += await pull(a, b);
    healRounds++;
    if (moved === 0 || healRounds > 6) break;
  }

  const digests = nodes.map((n) => n.digest());
  const union = new Map();
  for (const n of nodes) for (const h of n.hashes()) if (!union.has(h)) union.set(h, n.bytes(h));
  const ref = nodes[0].view();
  const dec = new TextDecoder();
  const refAll = materialize([...union.entries()].map(([hash, b]) => ({ hash, env: JSON.parse(dec.decode(b)) })), genesis);
  const refDigest = toHex(sha256Bytes(utf8(canonical(refAll.state))));
  const count = (col) => Object.keys(ref.state.cols[col] || {}).length;
  return {
    kind: 'sovereign-enterprise-sim',
    v: 1,
    config: c,
    envelopes: union.size,
    emitted: stats.emitted,
    partitionRounds: stats.partitionRounds,
    droppedGossip: stats.dropped,
    duplicateDeliveries: stats.duplicated,
    attacks: stats.attacks,
    attackOutcomes: Object.fromEntries(Object.entries(stats.attack).sort()),
    unauthorised: ref.report.unauthorized,
    equivocators: ref.report.equivocators.length,
    applied: ref.report.applied,
    records: { tasks: count('tasks'), crm: count('crm'), msg: count('msg') },
    docChars: nodes[0].text('docs', 'd0').length,
    healRounds,
    converged: digests.every((d) => d === digests[0]) && digests[0] === refDigest,
    digest: digests[0],
  };
}
