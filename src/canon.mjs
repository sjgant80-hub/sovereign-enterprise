// canon.mjs — the one canonical byte form. A signed envelope is valid only if its raw bytes ARE this form
// (sorted keys, no whitespace, safe integers only), so a signature can never be re-wrapped in different bytes.

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/** Canonical JSON: sorted keys, no whitespace, safe integers only, plain objects/arrays only. Throws otherwise. */
export function canonical(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError('canon: number is not a safe integer');
    return String(v);
  }
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canon: not a plain object');
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  throw new TypeError('canon: unsupported ' + t);
}

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(h) {
  if (typeof h !== 'string' || h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new TypeError('hex: malformed');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
