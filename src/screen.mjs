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

/** Screen one inbound text. → { ok, flags:[…], clean, hidden } — ok:false means quarantine. */
export function screen(text) {
  if (typeof text !== 'string') return { ok: false, flags: ['not-text'], clean: '', hidden: '' };
  const flags = [];
  if (text.length > MAX_CHARS) flags.push('too-long');
  if (text.match(ZERO_WIDTH)) flags.push('zero-width');
  if (text.match(BIDI)) flags.push('bidi');
  const hidden = revealTags(text);
  if (text.match(TAGS)) flags.push('tag-smuggling');
  if (text.match(CONTROL)) flags.push('control');
  const clean = text.replace(ZERO_WIDTH, '').replace(BIDI, '').replace(TAGS, '').replace(CONTROL, '').slice(0, MAX_CHARS);
  if (INJECTION.some((re) => re.test(clean)) || (hidden && INJECTION.some((re) => re.test(hidden)))) flags.push('injection');
  return { ok: flags.length === 0, flags, clean, hidden };
}
