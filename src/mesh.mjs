// mesh.mjs — how the brains talk: over the signed spine, never through shared memory. Pure, total, deterministic.
//
// An agent that cannot answer a piece of work from its own brain WRITES an ask — a signed record on the spine with the
// case's features. Every other agent device reads it from its own replica and WRITES a reply from its own brain: a
// verified answer with its receipt, or an abstention. The asker reads the replies and takes the strongest verified one.
// A money or security call asks for a SECOND opinion the same way — and only a reply from another device, from a
// DIFFERENT pattern, counts (a copy of the same brain always agrees; a stable system can stabilise a wrong reference —
// Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, "From GEP Stabilization to Dual-Map
// Ethical Reasoning," Derivation v0.2). The same records carry the conversation whether the devices share a browser tab
// or sit on different machines.
import { answer } from './brain.mjs';

export const KINDS = Object.freeze(['answer', 'second']);
export const MAX_FEATURES_CHARS = 1800;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const permille = (x) => Math.round(Math.max(0, Math.min(1, x)) * 1000);

/** An ask, as spine fields (strings / safe ints only). → fields, or null if it cannot be carried. */
export function askRecord(input) {
  try {
    const { kind, item, from, features, domain = '', pattern = '', exclude = [] } = input || {};
    if (!KINDS.includes(kind) || !NAME.test(from) || typeof item !== 'string' || !item || item.length > 64) return null;
    const f = JSON.stringify(features);
    if (!f.startsWith('{') || f.length > MAX_FEATURES_CHARS) return null;
    if (kind === 'second' && (!NAME.test(domain) || typeof pattern !== 'string' || !pattern)) return null;
    const ex = (Array.isArray(exclude) ? exclude : []).filter((x) => NAME.test(x));
    return { kind, item, from, features: f, domain: kind === 'second' ? domain : '', pattern: kind === 'second' ? pattern : '', exclude: ex.join(',') };
  } catch { return null; }
}

/** Read the features an ask carries. → plain object of finite numbers, or null. */
export function askFeatures(ask) {
  try {
    const f = JSON.parse(ask.features);
    if (typeof f !== 'object' || Array.isArray(f)) return null;          // null falls to the catch below
    const out = {};
    for (const [k, v] of Object.entries(f)) if (NAME.test(k) || /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) { if (Number.isFinite(v)) out[k] = v; }
    return out;
  } catch { return null; }
}

/**
 * This device's reply to a peer's ask, from its own library. → reply fields, or null when it must stay silent
 * (its own ask, or it is excluded). An abstention is still a reply, so the asker knows it was heard.
 */
export function replyFor(ask, library, me) {
  try {
    if (!ask || !NAME.test(me) || ask.from === me) return null;
    if (String(ask.exclude || '').split(',').includes(me)) return null;
    const features = askFeatures(ask);
    const base = { ask: String(ask.id), item: String(ask.item), by: me, kind: String(ask.kind) };
    if (!features) return { ...base, verdict: 'ABSTAIN', why: 'unreadable case' };
    let lib = library;
    if (ask.kind === 'second') {
      const p = library && library[ask.domain];
      if (!p) return { ...base, verdict: 'ABSTAIN', why: 'no brain for ' + ask.domain };
      lib = { [ask.domain]: p };
    } else if (ask.kind !== 'answer') return null;
    const a = answer(lib, features);
    if (a.verdict !== 'VERIFIED') return { ...base, verdict: 'ABSTAIN', why: String(a.why || 'abstained').slice(0, 120) };
    if (ask.kind === 'second' && a.receipt.patternId === ask.pattern) return { ...base, verdict: 'COPY', why: 'the same pattern — not an independent opinion' };
    return { ...base, verdict: 'VERIFIED', domain: a.domain, label: a.label, conf: permille(a.confidence), route: permille(a.routeScore),
      pattern: String(a.receipt.patternId), receipt: a.receipt.receiptHash.slice(0, 16) };
  } catch { return null; }
}

/** The replies to one ask, one per replying device (the first one written wins, by record id). */
export function repliesTo(replies, askId) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(replies) ? replies : []) {
    if (!r || r.ask !== askId || seen.has(r.by)) continue;
    seen.add(r.by);
    out.push(r);
  }
  return out;
}

/** Has every device the asker expects heard and replied? */
export function heardFrom(replies, expected) {
  const by = new Set((Array.isArray(replies) ? replies : []).map((r) => r && r.by));
  return (Array.isArray(expected) ? expected : []).every((n) => by.has(n));
}

const asAnswer = (r) => ({ verdict: 'VERIFIED', domain: r.domain, label: r.label, confidence: r.conf / 1000, routeScore: r.route / 1000,
  receipt: { patternId: r.pattern, receiptHash: r.receipt } });
const usable = (r) => !!r && r.verdict === 'VERIFIED' && (r.label === 0 || r.label === 1) && typeof r.domain === 'string'
  && Number.isSafeInteger(r.conf) && Number.isSafeInteger(r.route);

/** The strongest verified reply (highest route score; a tie goes to the lower device name). → { node, answer } | null */
export function pickAnswer(replies) {
  let best = null;
  for (const r of Array.isArray(replies) ? replies : []) {
    if (!usable(r)) continue;
    if (!best || r.route > best.route || (r.route === best.route && r.by < best.by)) best = r;
  }
  return best ? { node: best.by, answer: asAnswer(best) } : null;
}

/** A second opinion: a verified reply on the same domain, from another device, from a DIFFERENT pattern. */
export function pickSecond(replies, domain, pattern, exclude) {
  const skip = new Set(Array.isArray(exclude) ? exclude : [exclude]);
  return pickAnswer((Array.isArray(replies) ? replies : []).filter((r) => r && r.domain === domain && r.pattern !== pattern && !skip.has(r.by)));
}
