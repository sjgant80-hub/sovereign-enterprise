// ════════════════════════════════════════════════════════════════
// bes.mjs — BEHAVIORAL ENTROPY SIGNATURES, turned inward. Pure, total, integer-only, gated.
//
// Gary W. Floyd's BES (Lumiea Systems Research Division / ThunderStruck Service, LLC, "GEP-Based Security", 2025):
// identity is insufficient, BEHAVIOUR is authoritative. Not "who are you?" but "are you behaving like yourself?".
// Here it watches a SINGLE operator — Kar, the running body itself — so a hijacked or prompt-injected run is caught
// by how it BEHAVES, not by any credential it carries.
//
// A window of actions has a signature: the mix of what was done (op distribution, permille) and the RHYTHM of how
// it was done (how variable the gaps between actions are). Gary's key finding, kept exactly: an impostor fails one
// of two ways — it is OVERLY REGULAR (scripted automation: near-constant rhythm) or RANDOMLY UNCORRELATED with the
// operator (a different op-mix: a hijack). So the gate is two-sided: too regular → flag; too far from the baseline
// → flag; otherwise allow.
//
// The baseline is ONE-CLASS — it models the operator, never the attacker — so a hijack it has never seen still
// flags. And it is the +1: the still centre the behaviour wobbles around. It only ever folds in a window that was
// ALLOWED (the runner enforces this), so an impostor cannot drift the baseline toward itself (negative selection).
// Integer-only and deterministic: the same actions give the same verdict on every machine.
// ════════════════════════════════════════════════════════════════

export const DEFAULTS = Object.freeze({ window: 20, minVariability: 120, maxDivergence: 900, calibrate: 3, fold: 8 });

const isInt = (x) => Number.isInteger(x);
const clampNonNeg = (x) => (x > 0 ? x : 0);

/** The op-mix of a window as permille counts per type (integers), plus the window size. */
function opMix(events) {
  const counts = new Map();
  for (const e of events) { const t = e && typeof e.type === 'string' ? e.type : '?'; counts.set(t, (counts.get(t) || 0) + 1); }
  const n = events.length, mix = {};
  for (const [t, c] of counts) mix[t] = Math.floor((c * 1000) / n);
  return mix;
}

/** The rhythm variability of a window: the mean absolute deviation of the inter-action gaps, in permille of the
 *  mean gap. Near 0 ⇒ clockwork (scripted); large ⇒ irregular (human/organic). Integer, total. */
function variability(events) {
  if (events.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < events.length; i++) {
    const a = isInt(events[i].at) ? events[i].at : 0, b = isInt(events[i - 1].at) ? events[i - 1].at : 0;
    gaps.push(clampNonNeg(a - b));
  }
  const sum = gaps.reduce((s, g) => s + g, 0);
  const mean = Math.floor(sum / gaps.length);
  if (mean <= 0) return 0;
  const mad = Math.floor(gaps.reduce((s, g) => s + Math.abs(g - mean), 0) / gaps.length);
  return Math.floor((mad * 1000) / mean);
}

/** The behavioural signature of a window of actions. events: [{ type, at, size? }]. Total on junk. */
export function signature(events) {
  try {
    const w = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : [];
    return { n: w.length, mix: opMix(w), variability: variability(w) };
  } catch { return { n: 0, mix: {}, variability: 0 }; }
}

/** A fresh, empty baseline — the operator's still centre, not yet learned. */
export const emptyBaseline = () => ({ count: 0, mix: {}, variability: 0 });

/** The L1 distance (permille) between a signature's op-mix and the baseline's, over the union of ops. */
export function divergence(sig, baseline) {
  try {
    const a = (sig && sig.mix) || {}, b = (baseline && baseline.mix) || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let d = 0;
    for (const k of keys) d += Math.abs((a[k] || 0) - (b[k] || 0));
    return d;
  } catch { return 2000; }                                           // unreadable → maximally far (flags)
}

/**
 * Fold an ALLOWED window's signature into the baseline (an integer EMA over `fold` windows). The runner only ever
 * calls this for a window the gate allowed, so the baseline tracks the operator's own drift but never an impostor.
 */
export function fold(baseline, sig, foldN = DEFAULTS.fold) {
  const b = baseline && typeof baseline === 'object' && b_ok(baseline) ? baseline : emptyBaseline();
  try {
    const W = isInt(foldN) && foldN >= 2 ? foldN : DEFAULTS.fold;
    const s = sig && typeof sig === 'object' ? sig : signature([]);
    if (b.count === 0) return { count: 1, mix: { ...(s.mix || {}) }, variability: isInt(s.variability) ? s.variability : 0 };
    const mix = {};
    const keys = new Set([...Object.keys(b.mix || {}), ...Object.keys(s.mix || {})]);
    for (const k of keys) mix[k] = Math.floor(((b.mix[k] || 0) * (W - 1) + (s.mix[k] || 0)) / W);
    const variability = Math.floor((b.variability * (W - 1) + (isInt(s.variability) ? s.variability : 0)) / W);
    return { count: b.count + 1, mix, variability };
  } catch { return b; }                                              // an unreadable window never corrupts the baseline
}
const b_ok = (b) => isInt(b.count) && b.mix && typeof b.mix === 'object';

/**
 * Judge a window's signature against the operator's baseline. params override DEFAULTS.
 * → { ok, level, reason, divergence, variability } where level ∈ CALIBRATING | ALLOW | FLAG.
 * Two-sided, one-class: too regular (scripted) OR too far from the operator (hijack) ⇒ FLAG. Total, fail-closed-safe
 * (a malformed signature flags rather than silently passing).
 */
export function judge(sig, baseline, params) {
  try {
    const p = { ...DEFAULTS, ...(params && typeof params === 'object' ? params : {}) };
    const b = baseline && b_ok(baseline) ? baseline : emptyBaseline();
    const s = sig && typeof sig === 'object' && isInt(sig.variability) ? sig : null;
    if (!s || !s.mix) return { ok: false, level: 'FLAG', reason: 'no readable signature', divergence: 1000, variability: 0 };
    if (b.count < p.calibrate) return { ok: true, level: 'CALIBRATING', reason: 'still learning the operator (' + b.count + '/' + p.calibrate + ' windows)', divergence: 0, variability: s.variability };
    const d = divergence(s, b);
    if (s.n >= 2 && s.variability < p.minVariability) return { ok: false, level: 'FLAG', reason: 'too regular — clockwork rhythm, not the operator (scripted/automation)', divergence: d, variability: s.variability };
    if (d > p.maxDivergence) return { ok: false, level: 'FLAG', reason: 'unlike the operator — behavioural drift ' + d + '‰ over ' + p.maxDivergence, divergence: d, variability: s.variability };
    return { ok: true, level: 'ALLOW', reason: 'behaving like the operator', divergence: d, variability: s.variability };
  } catch { return { ok: false, level: 'FLAG', reason: 'the watch failed closed', divergence: 1000, variability: 0 }; }
}
