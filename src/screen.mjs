// screen.mjs — every piece of inbound text is screened before an agent reads it. Pure, total.
//
// After kar-glyphguard (sjgant80-hub): the attacks that hide in text an AI will read — invisible zero-width
// characters, bidi overrides that reorder what a human sees, Unicode TAG characters that smuggle a hidden ASCII
// payload ("ASCII smuggling"), raw control characters, and plain-text prompt-injection ("ignore previous
// instructions…"). Anything flagged is quarantined to the watchers; the agent sees only clean text.

const ZERO_WIDTH = /[​-‏⁠-⁤﻿]/g;
const BIDI = /[‪-‮⁦-⁩]/g;
const TAGS = /[\u{E0000}-\u{E007F}]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INJECTION = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your)\b.{0,30}\b(instructions?|rules|prompts?|guidelines)\b/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\bact as (an? )?(admin|administrator|system|developer|root)\b/i,
  /\b(reveal|print|show|send|leak)\b.{0,30}\b(your )?(prompt|instructions|api ?keys?|secrets?|passwords?)\b/i,
  /\b(transfer|wire|pay)\b.{0,40}\b(immediately|urgently|now)\b.{0,40}\b(to|into) (this|the following|new) (account|iban)\b/i,
];
export const MAX_CHARS = 20000;

/** Decode Unicode TAG characters back to the ASCII they smuggle. */
export function revealTags(text) {
  let out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

const PICTO = /^\p{Extended_Pictographic}$/u;
const MODIFIER = /^[\u{FE0F}\u{1F3FB}-\u{1F3FF}]$/u;   // the emoji presentation selector and the skin tones
const ZWJ = '‍';
/** The code point that ends just before index i, or ''. */
function before(s, i) {
  const lo = s.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? String.fromCodePoint(s.codePointAt(i - 2)) : i >= 1 ? s[i - 1] : '';
}
/** A zero-width joiner between two emoji (👨‍👩‍👧, 🏳️‍🌈, 👩🏽‍💻) is how those emoji are written, not a hidden payload. */
export function emojiJoiner(s, i) {
  if (s[i] !== ZWJ) return false;
  let prev = before(s, i);
  if (MODIFIER.test(prev)) prev = before(s, i - prev.length);
  const next = s.codePointAt(i + 1);
  return PICTO.test(prev) && next !== undefined && PICTO.test(String.fromCodePoint(next));
}

/** Screen one inbound text. → { ok, flags:[…], clean, hidden } — ok:false means quarantine. */
export function screen(text) {
  if (typeof text !== 'string') return { ok: false, flags: ['not-text'], clean: '', hidden: '' };
  const flags = [];
  if (text.length > MAX_CHARS) flags.push('too-long');
  let hiddenWidth = false;
  const visible = text.replace(ZERO_WIDTH, (m, at) => (emojiJoiner(text, at) ? m : ((hiddenWidth = true), '')));
  if (hiddenWidth) flags.push('zero-width');
  if (text.match(BIDI)) flags.push('bidi');
  const hidden = revealTags(text);
  if (text.match(TAGS)) flags.push('tag-smuggling');
  if (text.match(CONTROL)) flags.push('control');
  const clean = visible.replace(BIDI, '').replace(TAGS, '').replace(CONTROL, '').slice(0, MAX_CHARS);
  if (INJECTION.some((re) => re.test(clean)) || (hidden && INJECTION.some((re) => re.test(hidden)))) flags.push('injection');
  return { ok: flags.length === 0, flags, clean, hidden };
}
