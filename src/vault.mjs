// vault.mjs — the company's one-true-record as a TRANSPARENCY LOG (RFC 9162 / Certificate Transparency), not a
// blockchain. One legal entity doesn't need Byzantine consensus between strangers; it needs an append-only log
// that ANY device — or any outsider (auditor, bank, regulator) — can check: "this entry is in the books"
// (inclusion proof) and "the books only ever grew; nothing was rewritten" (consistency proof). The finance node
// sequences; other admins witness by checking consistency before they co-sign. Pure, synchronous, total.
import { sha256Bytes } from './sha256.mjs';
import { toHex, fromHex } from './canon.mjs';

const EMPTY = toHex(sha256Bytes(new Uint8Array(0)));
const HEX64 = /^[0-9a-f]{64}$/;

function h1(prefix, a, b) {
  const buf = new Uint8Array(1 + a.length + (b ? b.length : 0));
  buf[0] = prefix;
  buf.set(a, 1);
  if (b) buf.set(b, 1 + a.length);
  return sha256Bytes(buf);
}
/** RFC 9162 leaf hash: SHA-256(0x00 || data). data: bytes or string. */
export function leafHash(data) {
  const d = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(h1(0, d));
}
/** RFC 9162 interior node: SHA-256(0x01 || left || right). */
export function nodeHash(lHex, rHex) {
  return toHex(h1(1, fromHex(lHex), fromHex(rHex)));
}
/** Largest power of two strictly less than n (n >= 2). */
export function split(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle Tree Hash over leaf hashes (hex). Empty tree = SHA-256(""). */
export function root(leaves) {
  const n = leaves.length;
  if (n === 0) return EMPTY;
  if (n === 1) return leaves[0];
  const k = split(n);
  return nodeHash(root(leaves.slice(0, k)), root(leaves.slice(k)));
}

/**
 * The Merkle Tree Hash of EVERY prefix, in one O(n log n) pass: out[k] = root(leaves.slice(0, k)).
 * A prefix of size k splits into perfect subtrees by the binary digits of k, largest first; RFC 9162's tree hash of
 * the prefix is those subtree roots folded from the right. A stack of perfect subtrees gives them as leaves arrive.
 */
export function prefixRoots(leaves) {
  const out = [EMPTY];
  const stack = [];
  for (const leaf of leaves) {
    let node = { size: 1, hash: leaf };
    while (stack.length && stack[stack.length - 1].size === node.size) {
      const left = stack.pop();
      node = { size: left.size * 2, hash: nodeHash(left.hash, node.hash) };
    }
    stack.push(node);
    let h = node.hash;
    for (let j = stack.length - 2; j >= 0; j--) h = nodeHash(stack[j].hash, h);
    out.push(h);
  }
  return out;
}

/** Inclusion proof for leaf m in a tree of the given leaves. */
export function inclusionProof(m, leaves) {
  const n = leaves.length;
  if (!Number.isInteger(m) || m < 0 || m >= n) return null;
  if (n === 1) return [];
  const k = split(n);
  if (m < k) return [...inclusionProof(m, leaves.slice(0, k)), root(leaves.slice(k))];
  return [...inclusionProof(m - k, leaves.slice(k)), root(leaves.slice(0, k))];
}

/** Verify an inclusion proof (RFC 9162 §2.1.3.2). Never throws. */
export function verifyInclusion(leaf, index, size, proof, rootHex) {
  try {
    if (!Number.isInteger(index)) return false;
    if (!Number.isInteger(size)) return false;
    if (index < 0) return false;
    if (index >= size) return false;
    if (!Array.isArray(proof)) return false;
    if (!HEX64.test(leaf)) return false;           // (a non-hex root can never equal a computed hash — no guard needed)
    let fn = index, sn = size - 1, r = leaf;
    for (const p of proof) {
      if (!HEX64.test(p)) return false;
      if (sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        r = nodeHash(p, r);
        if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
      } else {
        r = nodeHash(r, p);
      }
      fn >>= 1; sn >>= 1;
    }
    return sn === 0 && r === rootHex;
  } catch { return false; }
}

function subproof(m, leaves, complete) {
  const n = leaves.length;
  if (m === n) return complete ? [] : [root(leaves)];
  const k = split(n);
  if (m <= k) return [...subproof(m, leaves.slice(0, k), complete), root(leaves.slice(k))];
  return [...subproof(m - k, leaves.slice(k), false), root(leaves.slice(0, k))];
}
/** Consistency proof that the first m leaves are a prefix of the tree (RFC 9162 §2.1.4). */
export function consistencyProof(m, leaves) {
  const n = leaves.length;
  if (!Number.isInteger(m) || m < 0 || m > n) return null;
  if (m === 0 || m === n) return [];
  return subproof(m, leaves, true);
}

/** Verify a consistency proof (RFC 9162 §2.1.4.2): the size-m log is a prefix of the size-n log. Never throws. */
export function verifyConsistency(m, n, firstRoot, secondRoot, proof) {
  try {
    if (!Number.isInteger(m)) return false;
    if (!Number.isInteger(n)) return false;
    if (m < 0) return false;
    if (m > n) return false;
    if (!Array.isArray(proof)) return false;
    if (!HEX64.test(firstRoot)) return false;
    if (!HEX64.test(secondRoot)) return false;
    if (m === 0) return proof.length === 0;
    if (m === n) return proof.length === 0 && firstRoot === secondRoot;
    if (proof.length === 0) return false;
    for (const c of proof) if (!HEX64.test(c)) return false;
    const path = (m & (m - 1)) === 0 ? [firstRoot, ...proof] : proof.slice();
    let fn = m - 1, sn = n - 1;
    while ((fn & 1) === 1) { fn >>= 1; sn >>= 1; }
    let fr = path[0], sr = path[0];
    for (const c of path.slice(1)) {
      if (sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        fr = nodeHash(c, fr);
        sr = nodeHash(c, sr);
        if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
      } else {
        sr = nodeHash(sr, c);
      }
      fn >>= 1; sn >>= 1;
    }
    return fr === firstRoot && sr === secondRoot && sn === 0;
  } catch { return false; }
}

function validRecord(r) {
  if (!r) return false;
  if (!Number.isInteger(r.index)) return false;
  if (r.index < 0) return false;
  if (typeof r.leaf !== 'string') return false;
  return HEX64.test(r.leaf);
}
function headMatches(h, roots) {
  if (!h) return false;
  if (!Number.isInteger(h.size)) return false;
  if (h.size < 0) return false;
  if (h.size >= roots.length) return false;           // roots has one entry per prefix, 0..n
  return roots[h.size] === h.root;
}

/**
 * Rebuild the log from the sequencer's ordered leaf records and check every signed tree head against it.
 * records: [{ index, leaf }]  (index 0..n-1, exactly once each — gaps or duplicates mean the log is incomplete)
 * heads:   [{ size, root }]   (the sequencer's tree heads, any order)
 * → { ok, size, root, leaves, bad: [heads that do not match], gaps }
 */
export function audit(records, heads) {
  try {
    const byIndex = new Map();
    let dupes = 0;
    for (const r of Array.isArray(records) ? records : []) {
      if (!validRecord(r)) continue;
      if (byIndex.has(r.index)) dupes++;
      else byIndex.set(r.index, r.leaf);
    }
    const leaves = [];
    while (byIndex.has(leaves.length)) leaves.push(byIndex.get(leaves.length));
    const gaps = byIndex.size - leaves.length;
    const roots = prefixRoots(leaves);                    // every prefix root once — not one rebuild per tree head
    const bad = [];
    for (const h of Array.isArray(heads) ? heads : []) {
      if (!headMatches(h, roots)) bad.push(h);
    }
    return { ok: bad.length === 0 && gaps === 0 && dupes === 0, size: leaves.length, root: roots[leaves.length], leaves, bad, gaps, dupes };
  } catch {
    return { ok: false, size: 0, root: EMPTY, leaves: [], bad: [], gaps: 0, dupes: 0 };
  }
}
