// explain.mjs — the page that explains itself. Pure, total, deterministic.
//
// Everything a visitor needs to understand the company — what it is, how one piece of work moves through it, how it
// is built organ by organ, and how a business would adopt it — as plain data and as SVG / HTML strings the live page
// drops in. No DOM, no I/O, no randomness; hostile input gives a plain fallback, never a throw.
//   · Six diagrams — bigPicture, workPath, spine, brain, mycelium, trust. Colours come only from the page's CSS
//     custom properties, so they follow the light and dark themes; every SVG has a viewBox, role="img", an
//     aria-label and a <title>; every piece of text is escaped. Each has a 720-wide layout and a 360-wide one that
//     stacks for a phone (text never below 13 units, so at 315px on screen it is still 11px or more).
//   · traceDecision — a signed 'decisions' record (plus the page's ledger entry, when there is one) → the exact steps
//     that decision took, and plain sentences that say only what the record shows.
//   · START_HERE, TABS_GUIDE, TRY, BLUEPRINT, ROLLOUT, ADOPTION — the instructions, the blueprint and the adoption
//     guide, as data; and HTML builders that lay them out with the page's own classes.
// Names, numbers and rules are read from the kernels that run (company, agent, brain, gate), so the explanation
// cannot drift from the company it explains. Konomi architecture — Thomas Frumkin. The second brain and the
// held-for-a-person verdict draw on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC,
// "From GEP Stabilization to Dual-Map Ethical Reasoning," Derivation v0.2.
import { AGENTS, HUMANS, HUB, OWNER_OF, LEARN_AFTER, REGROW_EVERY, PROMOTE_BY, MISROUTE, effects, splitEffects } from './company.mjs';
import { REAL } from './streams.mjs';
import { GATE_AUC, ROUTE_MIN, validPattern } from './brain.mjs';
import { MAX_BYTES } from './gate.mjs';
import { gbp0 } from './office.mjs';
import { fitPlan, fitInput, formFields, sensitivity, breakEven, MAX_HEADS } from './adopt.mjs';

// ── text ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Escape for HTML / SVG text and attribute values (control characters dropped). Total. */
export function esc(s) {
  try { return String(s ?? '').replace(CTRL, '').replace(/[&<>\x22\x27]/g, (c) => ENT[c]); } catch { return ''; }
}

/** Word-wrap to at most `max` characters a line (a word longer than a line is split). Total. */
export function wrap(text, max) {
  try {
    const m = Math.max(4, Math.floor(Number(max)) || 4);
    const words = String(text ?? '').replace(CTRL, ' ').split(/\s+/).filter(Boolean)
      .flatMap((w) => w.match(new RegExp('.{1,' + m + '}', 'gu')));
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (line && next.length > m) { lines.push(line); line = w; } else line = next;
    }
    return line ? [...lines, line] : lines;
  } catch { return []; }
}

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── drawing primitives (viewBox units) ───────────────────────────────────────────────────────────────────────────
const WIDE = 720, NARROW = 360;
const FS = 13, TS = 14, LH = 18, PX = 12, PY = 11, NUMW = 30;
const CH = 0.54, CHB = 0.6, CHU = 0.7;        // average glyph widths in ems (body, bold titles, upper-case tags) — wide enough for SF / Roboto / Segoe
const n1 = (v) => Math.round(v * 10) / 10;
const V = (k) => 'var(--' + k + ')';
const STROKE = new Map([['accent', 'accent'], ['accent2', 'accent2'], ['gold', 'gold'], ['violet', 'violet'], ['bad', 'bad'], ['warn', 'warn']]);
const stroke = (tone) => V(STROKE.get(tone) ?? 'line');
const tagFill = (tone) => V(STROKE.get(tone) ?? 'dim');
const LOOK = {
  plain: { fill: V('panel'), op: 1, sw: 1.4, dash: '', badge: V('panel2'), badgeText: V('ink') },
  hi: { fill: V('panel'), op: 1, sw: 2.6, dash: '', stroke: V('accent'), badge: V('accent'), badgeText: V('bg') },
  dim: { fill: V('panel2'), op: 0.45, sw: 1.2, dash: '5 4', badge: V('panel2'), badgeText: V('dim') },
};
const ROWS = { tag: [FS, 700], title: [TS, 700], body: [FS, 400], detail: [FS, 600], exit: [FS, 400] };

function tx(x, y, s, fs, fill, weight, anchor) {
  return `<text x="${n1(x)}" y="${n1(y)}" font-size="${fs}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`;
}

/** Lay out one card's text for width w → { rows: [[kind, line]], h }. */
function lay(spec, w) {
  const inner = w - PX * 2 - (spec.num ? NUMW : 0);
  const per = (fs, ch) => Math.max(6, Math.floor(inner / (fs * ch)));
  const rows = [
    ...wrap(spec.tag, per(FS, CHU)).map((l) => ['tag', l]),
    ...wrap(spec.title, per(TS, CHB)).map((l) => ['title', l]),
    ...(spec.body ?? []).flatMap((p) => wrap(p, per(FS, CH)).map((l) => ['body', l])),
    ...(spec.detail ?? []).flatMap((p) => wrap(p, per(FS, CH)).map((l) => ['detail', l])),
    ...(spec.exits ?? []).flatMap((p) => wrap('→ ' + p, per(FS, CH)).map((l) => ['exit', l])),
  ];
  return { rows, h: (spec.bare ? 0 : PY * 2) + rows.length * LH };
}

function drawCard(b, spec) {
  const look = LOOK[spec.state] ?? LOOK.plain;
  const line = look.stroke ?? stroke(spec.tone);
  const fills = { tag: tagFill(spec.tone), title: V('ink'), body: V('dim'), detail: V('ink'), exit: V('accent2') };
  const x = b.x + (spec.bare ? 0 : PX) + (spec.num ? NUMW : 0);
  const top = b.y + (spec.bare ? 0 : PY) + 13;
  const rect = spec.bare ? '' : `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10" fill="${look.fill}" stroke="${line}" stroke-width="${look.sw}" stroke-dasharray="${look.dash || (spec.dashed ? '6 4' : 'none')}"/>`;
  const badge = spec.num ? `<circle cx="${n1(b.x + PX + 11)}" cy="${n1(b.y + PY + 9)}" r="11" fill="${look.badge}" stroke="${line}" stroke-width="1.4"/>${tx(b.x + PX + 11, b.y + PY + 13.5, String(spec.num), FS, look.badgeText, 700, 'middle')}` : '';
  const text = b.rows.map(([k, s], i) => tx(x, top + i * LH, s, ROWS[k][0], fills[k], ROWS[k][1], 'start')).join('');
  return `<g data-id="${esc(spec.id ?? '')}" data-state="${spec.state ?? 'plain'}" opacity="${look.op}">${rect}${badge}${text}</g>`;
}

/** Place cards on a grid. items = [{ id, spec, c, r, span }] → { box: {id: {x,y,w,h,rows}}, H, svg } */
function grid(items, { W, cols, x0 = 16, xr = x0, y0 = 16, gx = 36, gy = 34 }) {
  const colW = (W - x0 - xr - gx * cols + gx) / cols;
  const laid = items.map((it) => {
    const w = (colW + gx) * (it.span ?? 1) - gx;
    return { ...it, w, x: x0 + (colW + gx) * it.c, ...lay(it.spec, w) };
  });
  const nRows = Math.max(...laid.map((it) => it.r)) + 1;
  const heights = Array.from({ length: nRows }, (_, r) => Math.max(0, ...laid.filter((it) => it.r === r).map((it) => it.h)));
  let y = y0;
  const rowY = heights.map((h) => { const at = y; y += h + gy; return at; });
  const box = {};   // a card fills its row's height (a bare label keeps its own), so row-mates line up
  for (const it of laid) box[it.id] = { x: it.x, y: rowY[it.r], w: it.w, h: it.spec.bare ? it.h : heights[it.r], rows: it.rows };
  return { box, H: y - gy, svg: laid.map((it) => drawCard(box[it.id], it.spec)).join('') };
}

const cx = (b) => b.x + b.w / 2;
const cy = (b) => b.y + b.h / 2;
/** From the bottom of a to the top of b (an elbow when they are not in line). */
const down = (a, b) => { const my = (a.y + a.h + b.y) / 2; return [[cx(a), a.y + a.h], [cx(a), my], [cx(b), my], [cx(b), b.y]]; };
/** From the side of a facing b to the side of b facing a. */
const across = (a, b) => {
  const d = Math.sign(cx(b) - cx(a));
  const x1 = cx(a) + d * a.w / 2, x2 = cx(b) - d * b.w / 2, mx = (x1 + x2) / 2;
  return [[x1, cy(a)], [mx, cy(a)], [mx, cy(b)], [x2, cy(b)]];
};
/** Down the right-hand rail, from the right of a to the right of b. */
const rail = (a, b, x) => [[a.x + a.w, cy(a)], [x, cy(a)], [x, cy(b)], [b.x + b.w, cy(b)]];
const chain = (boxes) => boxes.slice(1).map((b, i) => down(boxes[i], b));

function arrow(pts, tone = 'faint', dashed = false) {
  const a = pts.at(-2), b = pts.at(-1);
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = [b, [b[0] - 8 * ux + 4.5 * uy, b[1] - 8 * uy - 4.5 * ux], [b[0] - 8 * ux - 4.5 * uy, b[1] - 8 * uy + 4.5 * ux]];
  const pt = (p) => n1(p[0]) + ',' + n1(p[1]);
  return `<polyline points="${pts.map(pt).join(' ')}" fill="none" stroke="${V(tone)}" stroke-width="1.6" stroke-dasharray="${dashed ? '5 4' : 'none'}" stroke-linejoin="round"/><polygon points="${head.map(pt).join(' ')}" fill="${V(tone)}"/>`;
}
const link = (x1, y1, x2, y2, tone = 'accent', w = 2, dash = 'none') =>
  `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="${V(tone)}" stroke-width="${w}" stroke-dasharray="${dash}"/>`;

function svgDoc(W, H, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${n1(H)}" role="img" aria-label="${esc(label)}" style="font-family:var(--sans)"><title>${esc(label)}</title>${body}</svg>`;
}
/** Run a diagram builder; any fault becomes a small, well-formed placeholder — never a throw. */
function render(label, build, opts) {
  try {
    const d = build(opts?.narrow === true, opts);
    return svgDoc(d.W, d.H, d.label ?? label, d.body);
  } catch {
    return svgDoc(NARROW, 44, label + ' (unavailable)', tx(12, 27, label + ' — unavailable', FS, V('dim'), 400, 'start'));
  }
}

// ── who's who, in plain words ────────────────────────────────────────────────────────────────────────────────────
const DOMAIN_WORDS = new Map([['shopper', 'who will buy'], ['churn', 'who will leave'], ['fraud', 'card fraud'], ['credit', 'who will default'],
  ['inventory', 'stock-outs'], ['maintenance', 'machine failures'], ['energy', 'power overloads'], ['intrusion', 'intrusions']]);
const words = (ds) => ds.map((d) => DOMAIN_WORDS.get(d) ?? d).join(', ');
const brainLine = (a) => (a.domains.length ? 'Its brain: ' + words(a.domains) : 'Grows the second brains: ' + words(a.grows ?? []));
const COL_WORDS = new Map([['crm', 'the CRM'], ['tasks', 'tasks'], ['journal', 'the books'], ['vault', 'the vault'], ['payments', 'payments'],
  ['terms', 'credit terms'], ['po', 'purchase orders'], ['security', 'security records'], ['vault_cosig', 'vault co-signatures'], ['alert', 'alerts']]);
const scope = (a) => a.cols.map((c) => COL_WORDS.get(c)).filter(Boolean).join(', ');
const NAME = new Map([...AGENTS, ...HUMANS].map((x) => [x.id, x.name]));
const COLS = new Map(AGENTS.map((a) => [a.id, a.cols]));
/** 'the Sales agent' · 'a device named “x”' · 'an unnamed device' */
const who = (id) => (NAME.has(id) ? 'the ' + NAME.get(id) : id ? 'a device named “' + id + '”' : 'an unnamed device');
const ownerOf = (d) => (Object.hasOwn(OWNER_OF, d) ? OWNER_OF[d] : '');
const pct = (x) => Math.round(x * 100) + '%';

// ── (a) the big picture ──────────────────────────────────────────────────────────────────────────────────────────
const SPINE_CARD = { id: 'spine', tag: 'THE SIGNED SPINE', tone: 'accent', title: 'Every write is signed by the device that made it and checked by every device that receives it' };
const MODEL_CARD = { id: 'model', tag: 'THE MODEL TIER · OPTIONAL', tone: 'accent2', dashed: true, title: 'A language model, for the work no brain covers',
  body: ['On the company’s own machine or in the browser. Called within a spending limit, every call audited on the spine — and never alone on money or security.'] };
const LIMBS_CARD = { id: 'limbs', tag: 'OUTSIDE · OPTIONAL', tone: 'warn', dashed: true, title: 'Per-use limbs', body: ['A frontier model for the hardest few per cent of the thinking; a voice service for phone calls. Each call carries only what that one call needs.'] };
const BOUNDARY = 'THE COMPANY’S OWN DEVICES — NOTHING LEAVES THE BUILDING';
const BIG_LABEL = 'The company on its own devices: the office hub, two people and six AI agents on one signed spine; an optional model tier inside the building and optional per-use limbs outside it';

/** Every device on the spine, as company.mjs names them: the two people, the office hub (the door), the six agents. */
function devices() {
  return [
    ...HUMANS.map((h) => ({ id: h.id, spec: { id: h.id, tag: 'HUMAN', tone: 'gold', title: h.name, body: [cap(h.title.split(' · ').at(-1))] } })),
    { id: HUB.id, spec: { id: HUB.id, tag: 'THE DOOR', tone: 'accent2', title: HUB.name, body: [cap(HUB.title.split(': ').at(-1))] } },
    ...AGENTS.map((a) => ({ id: a.id, spec: { id: a.id, tag: 'AI AGENT', tone: 'violet', title: a.name, body: [brainLine(a)] } })),
  ];
}
function limbs(W, top, from) {
  const w = Math.min(W - 60, 340);
  const L = lay(LIMBS_CARD, w);
  const b = { x: (W - w) / 2, y: top + 34, w, h: L.h, rows: L.rows };
  return { svg: link(cx(from), from.y + from.h, cx(from), b.y, 'warn', 1.6, '5 4') + tx(cx(from) + 8, top + 22, 'only what one call needs', FS, V('dim'), 400, 'start') + drawCard(b, LIMBS_CARD), bottom: b.y + b.h };
}
function bigPictureOf(narrow) {
  const devs = devices();
  const top = devs.length - 4;                       // wide: the people, the hub and two agents above the spine; four agents below it
  if (narrow) {
    const items = [
      { id: 'label', spec: { id: 'label', bare: true, tag: BOUNDARY }, c: 0, r: 0, span: 2 },
      { id: 'spine', spec: SPINE_CARD, c: 0, r: 1, span: 2 },
      ...devs.map((d, i) => ({ ...d, c: i % 2, r: 2 + Math.floor(i / 2) })),
      { id: 'model', spec: MODEL_CARD, c: 0, r: 2 + Math.ceil(devs.length / 2), span: 2 },
    ];
    const g = grid(items, { W: NARROW, cols: 2, x0: 18, y0: 18, gx: 30, gy: 22 });
    const mid = NARROW / 2, sp = g.box.spine, model = g.box.model;
    const ties = devs.map((d, i) => { const b = g.box[d.id]; return link(b.x + b.w * (1 - (i % 2)), cy(b), mid, cy(b)); }).join('');
    const bottom = model.y + model.h + 12;
    const out = limbs(NARROW, bottom, model);
    return { W: NARROW, H: out.bottom + 12, label: BIG_LABEL,
      body: `<rect x="6" y="6" width="${NARROW - 12}" height="${n1(bottom - 6)}" rx="14" fill="none" stroke="${V('faint')}" stroke-width="1.4" stroke-dasharray="7 5"/>` +
        link(mid, sp.y + sp.h, mid, model.y, 'accent', 4) + ties + g.svg + out.svg };
  }
  const items = [
    ...devs.slice(0, top).map((d, i) => ({ ...d, c: i * 2, r: 0, span: 2 })),
    { id: 'spine', spec: SPINE_CARD, c: 0, r: 1, span: top * 2 },
    ...devs.slice(top).map((d, i) => ({ ...d, c: i * 2 + 1, r: 2, span: 2 })),
    { id: 'model', spec: MODEL_CARD, c: 2, r: 3, span: top * 2 - 4 },
  ];
  const g = grid(items, { W: WIDE, cols: top * 2, x0: 24, y0: 50, gx: 10, gy: 30 });
  const sp = g.box.spine, model = g.box.model;
  const ties = devs.map((d, i) => { const b = g.box[d.id]; return i < top ? link(cx(b), b.y + b.h, cx(b), sp.y) : link(cx(b), sp.y + sp.h, cx(b), b.y); }).join('');
  const bottom = model.y + model.h + 14;
  const out = limbs(WIDE, bottom, model);
  return { W: WIDE, H: out.bottom + 12, label: BIG_LABEL,
    body: `<rect x="10" y="10" width="${WIDE - 20}" height="${n1(bottom - 10)}" rx="14" fill="none" stroke="${V('faint')}" stroke-width="1.4" stroke-dasharray="7 5"/>` +
      tx(24, 35, BOUNDARY, FS, V('dim'), 700, 'start') + ties + link(WIDE / 2, sp.y + sp.h, WIDE / 2, model.y, 'accent2', 1.6, '5 4') + g.svg + out.svg };
}
/** (a) The company on its own devices. opts = { narrow } */
export const bigPicture = (opts) => render('The company on its own devices', bigPictureOf, opts);

// ── (b) the path of one piece of work ────────────────────────────────────────────────────────────────────────────
export const WORK_STEPS = Object.freeze([
  { id: 'door', title: 'The door', what: `Work arrives at the office hub: a web session, a customer message, a card payment, a stock reading, a machine reading, a network connection. The hub writes it on the spine for an agent — but about ${pct(MISROUTE)} of the work is sent to an agent at random, so some lands at the wrong one.`, exits: ['next: the screen'] },
  { id: 'screen', title: 'The screen', what: 'Any text a customer wrote is checked before any brain reads it: invisible characters, direction tricks, smuggled hidden text, instruction-like phrasing.', exits: ['passed: step 3', 'flagged: quarantined unread, step 7'] },
  { id: 'own', title: 'Its own brain', what: 'The agent asks its own brain. Inside what that brain was verified on, it answers, with a receipt. Outside, it abstains — it never guesses.', exits: ['answered: step 6', 'abstained: step 4'] },
  { id: 'mesh', title: 'Ask the mesh', what: 'The agent writes a signed ask on the spine. Every other device replies from its own brain — a verified answer with its receipt, or an abstention — and the agent takes the strongest verified reply.', exits: ['a device answered: step 6', 'none could: step 5'] },
  { id: 'model', title: 'The model tier', what: 'When no brain anywhere covers it, a language model may answer — if the company has connected one (none is, by default). It is called within a spending limit, every call is audited on the spine, and it never acts alone on money or security.', exits: ['answered, normal stakes: step 8', 'money or security, or no model: step 7'] },
  { id: 'second', title: 'A second, independent brain', what: 'A money or security call — or any unsure call — needs a second opinion, asked on the spine the same way. Only a different brain on another device counts: a copy of the same brain is not a check.', exits: ['agreed, or not needed: step 8', 'disagreed, or none could: step 7'] },
  { id: 'watch', title: 'Held for a person', what: 'Nothing is done. The work waits on the Watch list with what the agent proposes, until a person — the owner or the overseer — chooses.', exits: ['a person chooses: the agent carries it out'] },
  { id: 'act', title: 'Act, and write it down', what: 'The agent acts and signs what it did into the company: a CRM lead, a task, a payment, a journal posting sequenced into the vault, a security record — handing to the right agent anything its own grant does not cover.', exits: ['next: step 9'] },
  { id: 'outcome', title: 'The outcome comes back', what: 'Later the real outcome arrives — did they buy, was it fraud, did the machine fail. The agent never saw it when it decided; the board scores every finished call against it.', exits: ['next: step 10'] },
  { id: 'regrow', title: 'The regrowth gate', what: `Every ${REGROW_EVERY} outcomes on a job, the agent grows a challenger brain. It replaces the current one only if it beats it on outcomes neither brain grew on.`, exits: ['a better brain: back to step 3'] },
]);

function workPathOf(narrow, trace) {
  const marks = new Map((Array.isArray(trace?.steps) ? trace.steps : []).filter((s) => s && typeof s === 'object').map((s) => [s.id, s]));
  const traced = marks.size > 0;
  const specs = WORK_STEPS.map((s, i) => {
    const m = marks.get(s.id);
    const taken = m?.taken === true;
    const detail = typeof m?.detail === 'string' && m.detail ? ['This one: ' + m.detail.slice(0, 240)] : [];
    return { id: s.id, num: i + 1, tone: 'ink', tag: 'STEP ' + (i + 1) + (traced ? (taken ? ' · TAKEN' : ' · NOT TAKEN') : ''), title: s.title,
      body: [s.what], detail, exits: s.exits, state: traced ? (taken ? 'hi' : 'dim') : 'plain' };
  });
  const takenNums = specs.filter((s) => s.state === 'hi').map((s) => s.num);
  const label = traced ? 'The path one decision took: step' + (takenNums.length === 1 ? ' ' : 's ') + (takenNums.join(', ') || 'none') + ' taken, the rest not'
    : 'One piece of work, step by step: the door, the screen, its own brain, the mesh, the model tier, a second brain, held for a person or acted on, the outcome, the regrowth gate';
  if (narrow) {
    const g = grid(specs.map((spec, r) => ({ id: spec.id, spec, c: 0, r })), { W: NARROW, cols: 1, x0: 14, y0: 14, gx: 0, gy: 26 });
    const boxes = specs.map((s) => g.box[s.id]);
    return { W: NARROW, H: g.H + 14, label, body: chain(boxes).map((p) => arrow(p)).join('') + g.svg };
  }
  const g = grid(specs.map((spec, i) => ({ id: spec.id, spec, c: Math.floor(i / 5), r: i % 5 })), { W: WIDE, cols: 2, x0: 16, y0: 34, gx: 44, gy: 30 });
  const boxes = specs.map((s) => g.box[s.id]);
  const [s5, s6] = [boxes[4], boxes[5]];
  const low = s5.y + s5.h + 15, gut = s5.x + s5.w + 22;
  const turn = [[cx(s5), s5.y + s5.h], [cx(s5), low], [gut, low], [gut, s6.y - 17], [cx(s6), s6.y - 17], [cx(s6), s6.y]];
  return { W: WIDE, H: low + 14, label, body: [...chain(boxes.slice(0, 5)), ...chain(boxes.slice(5)), turn].map((p) => arrow(p)).join('') + g.svg };
}
/** (b) One piece of work, step by step. Pass a traceDecision() result to light the steps that decision took. */
export const workPath = (trace, opts) => render('One piece of work, step by step', (narrow) => workPathOf(narrow, trace), opts);

// ── (c) the spine ────────────────────────────────────────────────────────────────────────────────────────────────
const SP = {
  sign: { id: 'sign', tag: '1 · SIGN', title: 'A device makes a write', body: ['A task, a sale, a decision, a brain — signed with that device’s own Ed25519 key, and naming the hash of that device’s previous write, so each device’s writes form a chain. The key never leaves the device.'] },
  gate: { id: 'gate', tag: '2 · THE GATE', tone: 'accent', title: 'Checked on the raw bytes, before anything reads them', body: [`Size (at most ${thousands(MAX_BYTES)} bytes) → valid UTF-8 → exact grammar, with the link to the writer’s previous write → the one canonical form → not a replay → the sender’s signature.`] },
  refused: { id: 'refused', tag: 'REFUSED AT THE GATE', tone: 'bad', title: 'Forged, altered, replayed, re-wrapped, oversize or junk', body: ['Never stored, never read. A properly signed write from a device with no grant is stored but never applied.'] },
  set: { id: 'set', tag: '3 · THE SET', title: 'Added to the set of signed writes', body: ['Each write is held once, by its hash. The order writes arrive in does not matter.'] },
  materialise: { id: 'materialise', tag: '4 · MATERIALISE', title: 'The company is computed from the set', body: ['Records, documents and the role tree are rebuilt from the set alone, the same way on every device.'] },
  company: { id: 'company', tag: '5 · THE COMPANY', tone: 'accent', title: 'Tasks, chat, CRM, books, vault, people, decisions', body: ['Everything the tabs on this page show.'] },
  same: { id: 'same', bare: true, tag: 'SAME SET → SAME COMPANY, BYTE FOR BYTE' },
  devA: { id: 'devA', tag: 'ANY DEVICE', title: 'Holds the set', body: ['…in whatever order the network delivered it.'] },
  devB: { id: 'devB', tag: 'ANY OTHER DEVICE', title: 'Holds the same set', body: ['…in a different order: the same company, the same fingerprint.'] },
  fork: { id: 'fork', tag: 'A STOLEN KEY', tone: 'bad', title: 'Two versions of one write are a fork — and a fork is caught', body: ['Every device flags the writer, with a proof anyone can check. The version the real device went on building from is the one that counts.'] },
  split: { id: 'split', tag: 'A SPLIT NETWORK', tone: 'warn', title: 'Both halves keep working', body: ['On reconnecting, each device sends what the other lacks. The sets become equal, so the companies do — nothing to merge by hand.'] },
};
function spineOf(narrow) {
  const label = 'The spine: a device signs a write; every device’s gate checks it on the raw bytes; admitted writes join a set; the company is computed from that set, so every device with the same set holds the same company';
  if (narrow) {
    const order = ['sign', 'gate', 'refused', 'set', 'materialise', 'company', 'same', 'devA', 'devB', 'split', 'fork'];
    const g = grid(order.map((id, r) => ({ id, spec: SP[id], c: 0, r })), { W: NARROW, cols: 1, x0: 14, xr: 40, y0: 14, gx: 0, gy: 26 });
    const B = g.box;
    return { W: NARROW, H: g.H + 14, label, body: arrow(down(B.sign, B.gate)) + arrow(down(B.gate, B.refused), 'bad', true) + arrow(rail(B.gate, B.set, NARROW - 18), 'accent') +
      arrow(down(B.set, B.materialise)) + arrow(down(B.materialise, B.company)) + g.svg };
  }
  const at = [['sign', 0, 0], ['gate', 1, 0], ['set', 2, 0], ['refused', 0, 1], ['company', 1, 1], ['materialise', 2, 1], ['same', 0, 2, 3], ['devA', 0, 3], ['devB', 1, 3], ['split', 2, 3], ['fork', 0, 4, 3]];
  const g = grid(at.map(([id, c, r, span]) => ({ id, spec: SP[id], c, r, span })), { W: WIDE, cols: 3, x0: 16, y0: 16, gx: 36, gy: 34 });
  const B = g.box;
  return { W: WIDE, H: g.H + 16, label, body: arrow(across(B.sign, B.gate)) + arrow(across(B.gate, B.set), 'accent') + arrow(down(B.set, B.materialise)) +
    arrow(across(B.materialise, B.company)) + arrow(down(B.gate, B.refused), 'bad', true) + g.svg };
}
/** (c) The spine: signed write → gate → the set → materialise → the company. opts = { narrow } */
export const spine = (opts) => render('The signed spine', spineOf, opts);

// ── (d) the brain ────────────────────────────────────────────────────────────────────────────────────────────────
const SIGN = new Map([[1, '+'], [-1, '−'], [0, '±']]);
const r3 = (v) => String(Math.round(v * 1000) / 1000);
/** One rule, in words: "+0.5 if amount > 74.195". */
export function ruleWords(rule) {
  try { return `${SIGN.get(Math.sign(rule.w)) ?? '±'}${r3(Math.abs(rule.w))} if ${rule.feat} ${rule.op === '>' ? '>' : '≤'} ${r3(rule.v)}`; } catch { return ''; }
}
function patternCard(p) {
  if (!validPattern(p)) return { id: 'pattern', tag: 'A VERIFIED PATTERN', tone: 'violet', title: 'A few readable rules', body: ['+ a weight if a feature crosses a cut — a handful of rules like that', 'Kept only if it predicts cases it never saw'] };
  const more = Math.max(0, p.rules.length - 4);
  return { id: 'pattern', tag: 'A VERIFIED PATTERN', tone: 'violet', title: String(p.title || p.domain).slice(0, 60),
    body: [...p.rules.slice(0, 4).map(ruleWords), ...(more ? ['…and ' + more + ' more'] : []), 'Acts when the score is above ' + r3(p.threshold),
      'Held-out AUC ' + p.heldAuc.toFixed(3) + (Number.isSafeInteger(p.held) ? ' on ' + thousands(p.held) + ' cases it never saw' : '')] };
}
const BR = {
  route: { id: 'route', tag: 'ROUTE', title: 'Is this case inside what I was verified on?', body: [`Each value is compared with the range the pattern was verified on. A fit below ${ROUTE_MIN} means outside.`], exits: ['inside: the gate', 'outside: abstain'] },
  gate: { id: 'gate', tag: 'GATE', title: 'Has the pattern earned the right to answer?', body: [`Only a pattern that scored at least ${GATE_AUC.toFixed(2)} AUC on cases it never saw may answer.`], exits: ['cleared: answer', 'below: abstain'] },
  answer: { id: 'answer', tag: 'ANSWER + RECEIPT', tone: 'accent', title: 'A verified answer, with a receipt', body: ['The call, how confident it is, and a receipt: a hash over the pattern, its held-out score, the fit, the score and the answer. Change any of them and the receipt no longer matches.'] },
  abstain: { id: 'abstain', tag: 'ABSTAIN', tone: 'warn', title: 'No answer — it never guesses', body: ['The agent asks the other devices instead; if none can answer, a language model may (if one is connected) — or a person decides.'] },
  adopt: { id: 'adopt', tag: 'ADOPT ONLY WHAT RE-VERIFIES HERE', tone: 'accent2', title: 'A brain from anywhere is tried on this device’s own cases first', body: [`Even the agent’s own job file. At least 50 of its own cases and at least ${GATE_AUC.toFixed(2)} AUC there — or it is refused, whatever it claims about itself.`] },
};
function brainOf(narrow, opts) {
  const S = { ...BR, pattern: patternCard(opts?.pattern) };
  const label = 'A brain: a verified pattern of readable rules; route — is this case inside what it was verified on; gate — did it earn the right to answer; then an answer with a receipt, or abstain; and a brain is adopted only if it re-verifies on this device’s own data';
  if (narrow) {
    const order = ['pattern', 'route', 'gate', 'answer', 'abstain', 'adopt'];
    const g = grid(order.map((id, r) => ({ id, spec: S[id], c: 0, r })), { W: NARROW, cols: 1, x0: 14, xr: 40, y0: 14, gx: 0, gy: 26 });
    const B = g.box;
    return { W: NARROW, H: g.H + 14, label, body: chain([B.pattern, B.route, B.gate, B.answer]).map((p) => arrow(p)).join('') +
      arrow(rail(B.route, B.abstain, NARROW - 18), 'warn', true) + arrow(rail(B.gate, B.abstain, NARROW - 18), 'warn', true) + g.svg };
  }
  const at = [['pattern', 0, 0], ['route', 1, 0], ['gate', 2, 0], ['abstain', 1, 1], ['answer', 2, 1], ['adopt', 0, 2, 3]];
  const g = grid(at.map(([id, c, r, span]) => ({ id, spec: S[id], c, r, span })), { W: WIDE, cols: 3, x0: 16, y0: 16, gx: 36, gy: 34 });
  const B = g.box;
  const my = (B.gate.y + B.gate.h + B.answer.y) / 2;
  const below = [[B.gate.x + 24, B.gate.y + B.gate.h], [B.gate.x + 24, my], [B.abstain.x + B.abstain.w - 24, my], [B.abstain.x + B.abstain.w - 24, B.abstain.y]];
  return { W: WIDE, H: g.H + 16, label, body: arrow(across(B.pattern, B.route)) + arrow(across(B.route, B.gate)) + arrow(down(B.gate, B.answer), 'accent') +
    arrow(down(B.route, B.abstain), 'warn', true) + arrow(below, 'warn', true) + g.svg };
}
/** (d) The brain on every device. opts = { narrow, pattern } — pass a real pattern (a brain file) to show its rules. */
export const brain = (opts) => render('The brain on every device', brainOf, opts);

// ── (e) the mycelium ─────────────────────────────────────────────────────────────────────────────────────────────
const MY = [
  [{ id: 'h1', bare: true, tag: 'LEARN BY BEING ASKED', tone: 'accent' },
    { id: 'm1', title: 'Work arrives that its brain does not cover', body: ['Its own brain abstains.'] },
    { id: 'm2', title: 'It asks the mesh', body: ['The device whose brain covers the case answers, with a receipt.'] },
    { id: 'm3', tone: 'accent', title: `Asked ${LEARN_AFTER} times about the same job, it learns it`, body: ['It takes that device’s published brain — and keeps it only if it re-verifies on its own cases.'] }],
  [{ id: 'h2', bare: true, tag: 'A POISONED BRAIN DIES AT THE FIRST CHECK', tone: 'bad' },
    { id: 'p1', title: 'A compromised device publishes a “better” brain', body: ['It claims a high score. The claim travels with it.'] },
    { id: 'p2', title: 'Every device tries it on its own cases', body: ['The publisher’s word is never taken.'] },
    { id: 'p3', tone: 'bad', title: 'It fails there — refused wherever it is checked', body: ['A sabotaged brain cannot spread: each device measures it for itself.'] }],
  [{ id: 'h3', bare: true, tag: 'REGROW ON OUTCOMES', tone: 'accent2' },
    { id: 'g1', title: 'Real outcomes come back', body: ['Did they buy, was it fraud, did the machine fail.'] },
    { id: 'g2', title: `Every ${REGROW_EVERY} outcomes, it grows a challenger`, body: ['The newest third of the outcomes is kept out of growth, to judge on.'] },
    { id: 'g3', tone: 'accent', title: 'The challenger replaces the brain only if it wins', body: [`It must beat the current brain by ${PROMOTE_BY} AUC on outcomes neither brain grew on.`] }],
];
function myceliumOf(narrow) {
  const label = 'The mycelium: an agent learns the work it keeps being asked about; a poisoned brain is refused at every device that checks it; brains regrow on real outcomes and are replaced only by a winner';
  const items = narrow ? MY.flat().map((spec, r) => ({ id: spec.id, spec, c: 0, r })) : MY.flatMap((col, c) => col.map((spec, r) => ({ id: spec.id, spec, c, r })));
  const g = narrow ? grid(items, { W: NARROW, cols: 1, x0: 14, y0: 14, gx: 0, gy: 22 }) : grid(items, { W: WIDE, cols: 3, x0: 16, y0: 16, gx: 30, gy: 30 });
  const flows = MY.flatMap((col) => chain(col.slice(1).map((s) => g.box[s.id])));
  return { W: narrow ? NARROW : WIDE, H: g.H + 16, label, body: flows.map((p) => arrow(p)).join('') + g.svg };
}
/** (e) The mycelium: learning by being asked, a poisoned brain refused, regrowth on outcomes. opts = { narrow } */
export const mycelium = (opts) => render('The mycelium', myceliumOf, opts);

// ── (f) who is in charge ─────────────────────────────────────────────────────────────────────────────────────────
const TR = {
  owner: { id: 'owner', tag: 'HUMAN · OWNER', tone: 'gold', title: 'Owner — holds the company’s genesis key', body: ['Makes the admins. Every grant traces back to this key.'] },
  overseer: { id: 'overseer', tag: 'HUMAN · ADMIN', tone: 'gold', title: 'Overseer (a person) — granted everything by the owner', body: ['Grants the office hub and each agent its part of the company, clears the Watch list, pauses and fires agents.'] },
  grant: { id: 'grant', tag: 'A GRANT', tone: 'violet', title: 'A signed write: which device, what role, which parts of the company', body: ['Every device checks each write against the grants it holds. A write outside its grant is never applied.'] },
  agents: { id: 'agents', bare: true, tag: 'SIX AGENTS — EACH GRANTED ONLY ITS OWN PART OF THE COMPANY', tone: 'violet' },
  controls: { id: 'controls', bare: true, tag: 'WHAT THE PEOPLE CONTROL', tone: 'gold' },
  pause: { id: 'pause', tag: 'PAUSE', title: 'Stop an agent acting', body: ['Its work is routed to the other agents — and to a person if none is available.'] },
  fire: { id: 'fire', tag: 'FIRE', tone: 'bad', title: 'Revoke an agent’s grant', body: ['A cut at its last write: every device refuses anything it signs afterwards.'] },
  leases: { id: 'leases', tag: 'DATA LEASES', title: 'A fired device’s copy locks itself', body: ['Each device renews its lease while its grant is live. Fired, it cannot — and when the lease runs out its sensitive data seals itself.'] },
  vault: { id: 'vault', tag: 'THE VAULT’S PROOFS', tone: 'accent', title: 'Anyone can check the books', body: ['An inclusion proof shows an entry is in the record; a consistency proof shows the record only ever grew. The Audit agent co-signs every ten entries.'] },
  watch: { id: 'watch', tag: 'THE WATCH LIST', tone: 'warn', title: 'What no brain could confirm waits for a person', body: ['The owner or the overseer (a person) chooses; the agent carries the choice out.'] },
  erase: { id: 'erase', tag: 'ERASE A PERSON', title: 'Destroy one key; every copy goes dark', body: ['Personal details are sealed per person. Erasing them leaves the history and the vault still verifiable.'] },
};
const agentCard = (a) => ({ id: a.id, tag: 'AI AGENT', tone: 'violet', title: a.name, body: ['May write: ' + scope(a)] });
function trustOf(narrow) {
  const label = 'Who is in charge: the owner’s key makes the overseer (a person); the overseer grants each agent only its own part of the company; the people can pause and fire agents, data leases lock a fired device, the vault proves the books, the Watch list waits for a person, and a person’s details can be erased';
  const controls = ['pause', 'fire', 'leases', 'vault', 'watch', 'erase'];
  const items = narrow ? [
    { id: 'owner', spec: TR.owner, c: 0, r: 0, span: 2 }, { id: 'overseer', spec: TR.overseer, c: 0, r: 1, span: 2 }, { id: 'grant', spec: TR.grant, c: 0, r: 2, span: 2 },
    { id: 'agents', spec: TR.agents, c: 0, r: 3, span: 2 },
    ...AGENTS.map((a, i) => ({ id: a.id, spec: agentCard(a), c: i % 2, r: 4 + Math.floor(i / 2) })),
    { id: 'controls', spec: TR.controls, c: 0, r: 7, span: 2 },
    ...controls.map((id, i) => ({ id, spec: TR[id], c: 0, r: 8 + i, span: 2 })),
  ] : [
    { id: 'owner', spec: TR.owner, c: 0, r: 0 }, { id: 'overseer', spec: TR.overseer, c: 1, r: 0 }, { id: 'grant', spec: TR.grant, c: 2, r: 0 },
    { id: 'agents', spec: TR.agents, c: 0, r: 1, span: 3 },
    ...AGENTS.map((a, i) => ({ id: a.id, spec: agentCard(a), c: i % 3, r: 2 + Math.floor(i / 3) })),
    { id: 'controls', spec: TR.controls, c: 0, r: 4, span: 3 },
    ...controls.map((id, i) => ({ id, spec: TR[id], c: i % 3, r: 5 + Math.floor(i / 3) })),
  ];
  const g = narrow ? grid(items, { W: NARROW, cols: 2, x0: 14, y0: 14, gx: 12, gy: 24 }) : grid(items, { W: WIDE, cols: 3, x0: 16, y0: 16, gx: 36, gy: 30 });
  const B = g.box;
  const flow = narrow ? [down(B.owner, B.overseer), down(B.overseer, B.grant), down(B.grant, B.agents)] : [across(B.owner, B.overseer), across(B.overseer, B.grant), down(B.grant, B.agents)];
  return { W: narrow ? NARROW : WIDE, H: g.H + 16, label, body: flow.map((p) => arrow(p, 'gold')).join('') + g.svg };
}
/** (f) Who is in charge: owner → overseer (a person) → scoped agents, and the people's controls. opts = { narrow } */
export const trust = (opts) => render('Who is in charge', trustOf, opts);

export const DIAGRAMS = Object.freeze({ bigPicture, workPath: (opts) => workPath(null, opts), spine, brain, mycelium, trust });

// ── tracing one decision ─────────────────────────────────────────────────────────────────────────────────────────
/** Customer text arrives only on these channels (company.mjs gives every churn and credit event a message). */
export const MESSAGE_CHANNELS = Object.freeze(['churn', 'credit']);
const WORK = new Map([['shopper', 'A web session'], ['churn', 'A customer message'], ['fraud', 'A card payment'], ['credit', 'A request for credit terms'],
  ['inventory', 'A stock reading'], ['maintenance', 'A machine reading'], ['intrusion', 'A network connection'], ['energy', 'A power reading']]);
const FLAGS = new Map([['zero-width', 'invisible characters'], ['bidi', 'direction tricks'], ['tag-smuggling', 'smuggled hidden text'], ['control', 'control characters'],
  ['injection', 'instruction-like phrasing'], ['too-long', 'far too much text'], ['not-text', 'something that was not text'],
  ['antibody', 'the wording of an attack already confirmed (an antibody)']]);
const STAKES = new Map([['fraud', 'money'], ['credit', 'money'], ['intrusion', 'security']]);
/** action → [what it proposes to do, what it did] */
const DOES = new Map([
  ['fast-track', ['fast-track the visitor into the CRM as a qualified lead', 'fast-tracked the visitor into the CRM as a qualified lead']],
  ['nurture', ['leave the visitor on the normal path', 'chose to leave the visitor on the normal path']],
  ['retain', ['send the customer a retention offer', 'sent the customer a retention offer']],
  ['standard-reply', ['give the standard reply', 'chose the standard reply']],
  ['release-payment', ['release the card payment', 'released the card payment']],
  ['hold-payment', ['hold the card payment as fraud', 'held the card payment as fraud']],
  ['upfront-terms', ['ask for payment up front', 'set the customer to payment up front']],
  ['standard-terms', ['give standard 30-day terms', 'gave the customer standard 30-day terms']],
  ['raise-po', ['raise a purchase order to restock', 'raised a purchase order to restock']],
  ['no-reorder', ['not reorder yet', 'decided no reorder was needed']],
  ['schedule-service', ['book the machine in for a service', 'booked the machine in for a service']],
  ['keep-running', ['keep the machine running', 'decided to keep the machine running']],
  ['shed-load', ['shed non-critical load', 'shed non-critical load']],
  ['normal-load', ['keep the normal load', 'decided to keep the normal load']],
  ['quarantine', ['quarantine the host', 'quarantined the host']],
  ['allow', ['allow the connection', 'allowed the connection']],
]);
const OUTCOME = new Map([['shopper', ['the visitor did not buy', 'the visitor bought']], ['churn', ['the customer was not about to leave', 'the customer was about to leave']],
  ['fraud', ['the payment was genuine', 'the payment was fraud']], ['credit', ['the customer did not default', 'the customer defaulted']],
  ['inventory', ['the item was not about to run out', 'the item was about to run out']], ['maintenance', ['the machine was not about to fail', 'the machine was about to fail']],
  ['intrusion', ['the connection was normal', 'the connection was an intrusion']], ['energy', ['the load stayed normal', 'the site was about to overload']]]);
const WRITES = new Map([
  ['crm', () => 'a qualified lead in the CRM'], ['tasks', (f) => 'a task, “' + f.title + '”'], ['msg', () => 'a message in Chat'],
  ['payments', (f) => 'a payment marked ' + f.status], ['terms', (f) => 'credit terms of ' + f.terms],
  ['po', () => 'a purchase order, for the Finance agent to post to the books'], ['security', () => 'a security entry quarantining the host'],
]);
const writeWords = (e) => (e.post ? 'a journal posting (sequenced into the vault)' : (WRITES.get(e.c) ?? (() => 'a ' + e.c + ' record'))(e.f));
// the agent kernel's own words for a held call (agent.mjs decide)
const WHY_DISAGREED = 'a second brain disagreed — held for a person';
const WHY_NO_SECOND = 'no second brain could confirm — held for a person';
const WHY_MODEL_HIGH = 'a model answered a high-stakes call — held for a person';
const KIND = new Map([['own', 'own'], ['screen', 'screen'], ['none', 'none'], ['fault', 'fault']]);

const blank = (sentence) => ({ ok: false, kind: 'unreadable', steps: WORK_STEPS.map((s) => ({ id: s.id, title: s.title, taken: false, detail: '' })), narrative: [sentence] });

/**
 * Trace one decision. record = a 'decisions' spine record { agent, event, domain, action, state, by, cross, second, conf,
 * receipt, why, customer, channel } (or the door's watch record); ledger = the page's ledger entry { id, truth, label }, if any.
 * → { ok, kind, steps: [{ id, title, taken, detail }], narrative: [plain sentences] } — says only what the record shows.
 */
export function traceDecision(record, ledger) {
  try { return traceOf(record, ledger); } catch { return blank('The decision record could not be read.'); }
}

function traceOf(rec, led) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return blank('There is no decision record to trace.');
  const g = (k, n) => (typeof rec[k] === 'string' ? rec[k].replace(CTRL, '').slice(0, n) : '');
  const agent = g('agent', 40), by = g('by', 60), channel = g('channel', 32), customer = g('customer', 40), why = g('why', 300);
  const action = g('action', 40), second = g('second', 40), event = g('event', 40), state = g('state', 8);
  const domain = g('domain', 32) || channel;
  const kind = agent === 'door' ? 'door' : by.startsWith('mesh:') ? 'mesh' : by.startsWith('model:') ? 'model' : KIND.get(by) ?? 'unknown';
  const taken = new Set(['door']), detail = new Map(), say = [];
  const conf = Number.isSafeInteger(rec.conf) && rec.conf >= 0 && rec.conf <= 1000 ? (rec.conf / 1000).toFixed(3) : '';
  const receipt = /^[0-9a-f]{8,64}$/.test(g('receipt', 64)) ? g('receipt', 64) : '';
  const proof = [conf && 'certainty ' + conf + ' of 1 — how far past its decision line', receipt && 'receipt ' + receipt].filter(Boolean);
  const paren = proof.length ? ' (' + proof.join(', ') + ')' : '';
  const work = (WORK.get(channel) ?? 'A piece of work') + (customer ? ' (' + customer + ')' : '');
  const owner = ownerOf(domain);

  // 1 · the door
  detail.set('door', (channel || 'unknown channel') + ' · ' + (customer || 'no customer named') + ' → ' + (kind === 'door' ? 'no agent available' : who(agent)));
  if (kind === 'door') {
    say.push(work + ' arrived at the door (the office hub), but no agent was available — every agent was paused, fired or offline.');
    say.push('Nothing was done: it went straight to the Watch list for a person to decide.');
    taken.add('watch'); detail.set('watch', 'no agent was available');
  } else {
    say.push(work + ' arrived at the door (the office hub) and was passed to ' + who(agent) + (owner && owner !== agent ? ' — usually ' + who(owner) + '’s job' : '') + '.');
  }
  if (kind === 'fault') { say.push(cap(who(agent)) + ' hit a fault and failed closed: it acted on nothing, and wrote nothing but this decision record.'); detail.set('watch', 'not listed: the agent failed closed'); }
  if (kind === 'unknown') say.push('This record does not say how the decision was made, so nothing more can be traced from it.');
  if (kind === 'door' || kind === 'fault' || kind === 'unknown') return done();

  // 2 · the screen
  if (kind === 'screen' || MESSAGE_CHANNELS.includes(channel)) taken.add('screen');
  if (kind === 'screen') {
    const flags = why.split(': ').slice(1).join(': ').split(', ').map((f) => FLAGS.get(f)).filter(Boolean);
    detail.set('screen', 'flagged' + (flags.length ? ': ' + flags.join(', ') : '') + ' — quarantined unread');
    say.push('The customer’s message failed the screen' + (flags.length ? ' — ' + list(flags) + ' —' : '') + ' so no brain ever read it.');
    say.push('It was quarantined unread: the people see it on the Watch tab under “Quarantined unread”, and no agent acts on it.');
    taken.add('watch'); detail.set('watch', 'quarantined unread');
    return done();
  }
  if (taken.has('screen')) { detail.set('screen', 'passed: nothing hidden, no instruction-like phrasing'); say.push('The customer’s message passed the screen first: nothing hidden in it, no instruction-like phrasing.'); }

  // 3–5 · its own brain, the mesh, the model tier
  taken.add('own');
  if (kind === 'own') { detail.set('own', 'answered' + paren); say.push(cap(who(agent)) + '’s own brain answered from a verified pattern' + paren + '.'); }
  else {
    taken.add('mesh'); detail.set('own', 'abstained');
    say.push(cap(who(agent)) + '’s own brain abstained — it holds no verified pattern that covers this case, and it never guesses.');
  }
  if (kind === 'mesh') {
    const peer = by.slice(5);
    detail.set('mesh', 'answered by ' + who(peer) + paren);
    say.push('So it asked the other devices, with a signed ask on the spine: ' + who(peer) + '’s brain covers this work and replied' + paren + '.');
  } else if (kind !== 'own') { detail.set('mesh', 'no device replied with a verified answer'); say.push('It asked the other devices, with a signed ask on the spine, but none replied with a verified answer.'); }
  if (kind === 'model') { taken.add('model'); detail.set('model', 'answered (' + by.slice(6) + ')'); say.push('So the model tier answered (' + by.slice(6) + '): a language model, used only when no verified brain covers the work.'); }
  if (kind === 'none') {
    detail.set('model', 'no model answered (none connected, or no usable answer)');
    taken.add('watch'); detail.set('watch', 'no brain covered it');
    say.push('No language model answered it either, so nothing was done: it waits on the Watch list for a person to decide.');
    return done();
  }

  // 6–8 · a second brain, then act or hold
  const stake = STAKES.get(domain);
  const call = stake ? 'a ' + stake + ' call' : 'an unsure call (below the confidence floor the overseer set)';
  const does = DOES.get(action);
  if (state === 'done') {
    if (rec.cross === true) {
      taken.add('second'); detail.set('second', 'agreed: ' + who(second));
      say.push('Because it was ' + call + ', a second, independent brain — a different pattern on another device, asked on the spine — had to agree. ' + cap(who(second)) + '’s brain agreed.');
    } else if (kind === 'model') {
      detail.set('second', 'not used: normal-stakes work');
      say.push('It is normal-stakes work, so the model’s answer was acted on without a second brain.');
    } else {
      detail.set('second', 'not needed: normal stakes, confident');
      say.push('It was a normal-stakes call and the brain was confident enough, so no second brain was needed.');
    }
    act();
  } else if (state === 'watch') {
    taken.add('watch');
    const proposal = does ? ' The agent proposes to ' + does[0] + '.' : '';
    detail.set('watch', does ? 'proposes to ' + does[0] : 'no proposal');
    if (why === WHY_DISAGREED) {
      taken.add('second'); detail.set('second', 'disagreed');
      say.push('Because it was ' + call + ', it asked the other devices for a second opinion from an independent brain — and that brain disagreed.');
      say.push('So nothing was done: it waits on the Watch list for a person to choose.' + proposal);
    } else if (why === WHY_NO_SECOND) {
      taken.add('second'); detail.set('second', 'none could confirm');
      say.push('Because it was ' + call + ', a second, independent brain had to agree — but no other device replied with an independent verified answer (a copy of the same brain does not count).');
      say.push('So nothing was done: it waits on the Watch list for a person to choose.' + proposal);
    } else if (why === WHY_MODEL_HIGH) {
      detail.set('second', 'a model is never trusted alone here');
      say.push('A language model’s answer is never trusted alone on ' + call + ', so nothing was done: it waits on the Watch list for a person to choose.' + proposal);
    } else say.push('It was held for a person' + (why ? ': “' + why + '”' : '') + '.' + proposal);
  } else say.push('The record does not say whether it was acted on.');
  return done();

  function act() {
    taken.add('act');
    // which collections the act writes (effects() is the one table of them); the wording of a chat message is not shown here
    const list0 = effects({ state: 'done', action, domain }, { id: event, customer, amount: 0, domain: channel }, agent);
    const split = splitEffects(list0, COLS.get(agent) ?? [], owner);
    const mine = split.mine.map(writeWords), hand = split.handoff.map((h) => writeWords(h.payload));
    detail.set('act', (does ? does[1] : action || 'no action named') + (hand.length ? ' · handed to ' + who(owner) : ''));
    say.push('Then it acted: it ' + (does ? does[1] : 'carried out “' + action + '”') + '.');
    if (mine.length) say.push('It wrote ' + list(mine) + '.');
    if (hand.length) say.push('Its own grant does not cover ' + list(hand) + ', so it handed ' + (hand.length > 1 ? 'them' : 'it') + ' to ' + who(owner) + ' to write.');
    if (!mine.length && !hand.length) say.push('Nothing else needed writing: the signed decision record is the whole act.');
  }

  function done() {
    const truth = led && typeof led === 'object' ? led.truth : undefined;
    if ((truth === 0 || truth === 1) && (led.id === undefined || led.id === event)) {
      const words = (OUTCOME.get(domain) ?? ['the outcome was “no”', 'the outcome was “yes”'])[truth];
      const scored = state === 'done' && (led.label === 0 || led.label === 1);
      const right = scored && led.label === truth;
      taken.add('outcome');
      detail.set('outcome', words + (scored ? (right ? ' · the call matched it' : ' · the call went the other way') : ''));
      const verdict = scored ? (right ? ' The agent’s call matched it.' : ' The agent’s call went the other way — the board counts it as wrong.')
        : state === 'done' ? '' : ' Nothing was acted on here, so it is not scored.';
      say.push('Later the real outcome came back: ' + words + '.' + verdict + ' No agent saw the outcome when deciding.');
    }
    detail.set('regrow', 'every ' + REGROW_EVERY + ' outcomes on a job — not shown by one decision');
    return { ok: true, kind, steps: WORK_STEPS.map((s) => ({ id: s.id, title: s.title, taken: taken.has(s.id), detail: detail.get(s.id) ?? '' })), narrative: say };
  }
}

// ── content: start here ──────────────────────────────────────────────────────────────────────────────────────────
export const START_HERE = Object.freeze([
  { title: 'It is already running', text: 'Nothing to install and nothing to sign up for. When the live company opens, nine devices start in your browser — the office hub, where work arrives; six AI agents; and two people — and work starts arriving at the door. The agents handle it end to end; the people watch.' },
  { title: 'The device bar', text: 'Each card along the top is one device, with its own key and its own copy of the company. Click a card to see the company as that device holds it. The short code after “replica” is a fingerprint of everything that device holds: when every card shows the same one, every device holds the same company.' },
  { title: 'Take a device offline', text: 'Click “online” on any card to cut that device off. It keeps working on its own copy and catches up the moment you bring it back — what both sides wrote while apart merges the same way on every device, so nothing is lost and no person has to reconcile it. Take the Audit agent offline and watch money and security calls wait for a person — there is no second brain left to agree.' },
  { title: 'Read the tabs', text: 'Each tab is one part of the company, as the device you selected holds it. What each one shows is listed below.' },
  { title: 'Attack it', text: 'The red buttons send a hostile message, poison a brain and attack a device; “Split the network” cuts it in two. Each attack is refused or contained, and the page shows you where. These are not a show: the same kinds — forged, replayed, flipped and re-wrapped writes among them — are thrown 90 at a time in the hostile-network simulation, re-run from scratch on every change to the code, and must be refused the same way every time.' },
  { title: 'Be the person in charge', text: 'Select the overseer (a person), open Watch, and choose what happens to each held item — the agent carries out your choice. Pause an agent there, or fire one in People.' },
  { title: 'Trace a decision', text: 'In Agents, press “Trace” on any decision to see the exact path it took: whose brain answered, who confirmed it, what it wrote.' },
  { title: 'Connect a language model (optional)', text: 'The brains decide structured cases; free text needs a language model. On the Board you can connect one — on this computer, in this browser, or with your own key. It answers only work no brain covers, never acts alone on money or security, and every call is written to the spine.' },
]);

export const TABS_GUIDE = Object.freeze([
  { tab: 'Board', shows: 'What the company did and how right it was: work handled, the share done end to end by agents, every finished call scored against the real outcome the agent never saw, the profit and loss, the vault — and where you connect a language model, if you want one.' },
  { tab: 'Agents', shows: 'Every decision as it happens: which agent, what it did, whose brain answered, who confirmed it, how confident, and its receipt.' },
  { tab: 'Watch', shows: 'What waits for a person, with the action the agent proposes — choose here as the owner or the overseer (a person). Pause and resume agents. Hostile messages quarantined unread, and the immune system: a new attack confirmed once becomes an antibody every agent re-checks.' },
  { tab: 'Brains', shows: 'Each agent’s brain, rule by rule; the map of who answers, teaches and confirms whom; every adoption, refusal and regrowth.' },
  { tab: 'Tasks', shows: 'The to-do list the agents keep: retention offers sent, restocks, machine services — and anything a person adds.' },
  { tab: 'Chat', shows: 'The company channel: the agents post what they did and why; the people can post too.' },
  { tab: 'CRM', shows: 'The sales pipeline: the leads the Sales agent fast-tracked, by stage.' },
  { tab: 'Docs', shows: 'The operating policy, edited by everyone at once with no server. Take a device offline, type on two, reconnect: both edits survive.' },
  { tab: 'Books', shows: 'The journal the Finance agent posts, the trial balance, the profit and loss and the balance sheet — in whole pence, always balanced.' },
  { tab: 'Vault', shows: 'The one-true-record: every posting in an append-only log, with proofs anyone can check that an entry is in it and that nothing was rewritten.' },
  { tab: 'People', shows: 'Who may do what: the owner, the overseer (a person), each agent’s part of the company. Fire an agent here. Personal details are sealed per person; erase one and every copy goes dark.' },
  { tab: 'Proof', shows: 'This device’s copy of the company, every device’s fingerprint, everything the gate refused, the hostile-network simulation, and a brain-receipt re-check.' },
]);

/** Things to try. `button` is the id of the page's own button; `tab` opens a tab; `device` selects a device. */
export const TRY = Object.freeze([
  { title: 'Send a hostile message', what: 'A customer message hiding an instruction — invisible characters, smuggled text or injection phrasing — reaches the Service agent.', see: 'Watch → “Quarantined unread”: the screen caught it, and no brain ever read it.', button: 'hostile' },
  { title: 'Poison a brain', what: 'The Systems agent, compromised, publishes a “better” fraud brain and claims a high score.', see: 'Brains → the growth log: every other agent tries it on its own cases and refuses it.', button: 'poison' },
  { title: 'Attack a device', what: 'Forged, bit-flipped, replayed, re-wrapped, oversize and junk writes, a stranger’s signed write, and one stolen key used twice — all fired at the device you selected.', see: 'Proof → the gate’s refusals.', button: 'attack' },
  { title: 'Steal an agent’s key', what: 'Someone with the Ops agent’s key starts deciding its work — validly signed, inside its grant, but not the way the Ops agent behaves.', see: 'Watch → “Behaviour”: the watch flags it and pauses it automatically within a few decisions; a person clears it.', button: 'steal' },
  { title: 'Split the network', what: 'Half the devices lose contact with the other half. Both halves keep working.', see: 'The badge shows the split. Press “Heal” and every device converges again.', button: 'splitnet' },
  { title: 'Fire an agent', what: 'Revoke an agent’s grant, as the owner or the overseer (a person).', see: 'People → “Fire”. Every device refuses what it signs afterwards, its data lease stops renewing, and its work goes to the others.', tab: 'People' },
  { title: 'Clear the watch list as the overseer', what: 'Select the overseer’s device (a person) and decide the held items.', see: 'Watch → choose an action; the agent carries it out on its next round.', tab: 'Watch', device: 'overseer' },
  { title: 'Trace a decision', what: 'Pick any decision and follow it step by step.', see: 'Agents → “Trace”.', tab: 'Agents' },
  { title: 'Teach every agent a new attack', what: 'A hostile message the screen has never seen walks straight past it. Confirm it once, as the overseer (a person), and it becomes a signed antibody — a fingerprint of its wording, never the message itself.', see: 'Watch → the immune system: each agent re-checks the antibody on its own ordinary messages and adopts it only if it fires on none of them.', tab: 'Watch', device: 'overseer' },
  { title: 'Connect a language model', what: 'Give the company a model for the work no brain covers — on this computer, in this browser, or with your own key, within a spending limit you set.', see: 'Board → “The model tier”. Every call, made or refused, appears as an audit record on the spine.', tab: 'Board' },
]);

// ── content: the blueprint ───────────────────────────────────────────────────────────────────────────────────────
const PUBLISHED = Object.values(REAL);
const SYNTH_BY_AUTHORS = PUBLISHED.filter((r) => !r.real).map((r) => r.dataset);
const SYNTH_ONLY = Object.keys(OWNER_OF).filter((d) => !Object.hasOwn(REAL, d)).map((d) => DOMAIN_WORDS.get(d) ?? d);
const DATA_WORDS = 'Published, openly licensed data for ' + PUBLISHED.length + ' of the ' + Object.keys(OWNER_OF).length + ' jobs — ' + list(PUBLISHED.map((r) => r.dataset)) +
  ' — each with its citation and licence. ' +
  (SYNTH_BY_AUTHORS.length ? list(SYNTH_BY_AUTHORS) + (SYNTH_BY_AUTHORS.length > 1 ? ' are synthetic by their authors’ own description. ' : ' is synthetic by its authors’ own description. ') : '') +
  (SYNTH_ONLY.length ? 'For ' + list(SYNTH_ONLY) + ' there is no open real dataset, so ' + (SYNTH_ONLY.length > 1 ? 'those streams stay' : 'that stream stays') + ' realistic-synthetic.' : '');
const TESTED = (t) => 'Unit, boundary and hostile-input tests (' + t + ') and the mutation witness, which flips every operator and checks the tests notice.';
export const BLUEPRINT = Object.freeze([
  { layer: 'The spine', name: 'The gate', file: 'src/gate.mjs', does: 'The door every write must pass, on every device. It checks the raw bytes before reading them: size, valid text, exact grammar — including the link to its writer’s previous write — the one canonical form, not a replay, and the signature of the device that sent it.', connects: 'Every write a device receives (node); the canonical form (canon); signatures (keys).', proven: TESTED('test/gate.test.mjs, test/fuzz.test.mjs, test/spine.fuzz.test.mjs') },
  { layer: 'The spine', name: 'The materialiser', file: 'src/crdt.mjs', does: 'Turns the set of signed writes into the company: records, documents, and who may do what (the role tree). It ignores the order writes arrived in, so devices with the same writes hold the same company. Each device’s writes form a chain: if a stolen key forges a second version of a write, every device flags it, and the version the real device built on is kept.', connects: 'Each device’s view (node); the role tree every grant and firing goes through.', proven: TESTED('test/crdt.test.mjs, test/fuzz.test.mjs, test/spine.fuzz.test.mjs') },
  { layer: 'The spine', name: 'The canonical form', file: 'src/canon.mjs', does: 'The one byte form a signature covers: sorted keys, no spaces, whole numbers only. A write in any other form is refused, so a signature cannot be re-wrapped.', connects: 'The gate, the node, the vault.', proven: TESTED('test/canon.test.mjs') },
  { layer: 'The spine', name: 'Device keys', file: 'src/keys.mjs', does: 'Each device’s Ed25519 key, made on the device with the browser’s own cryptography. The private key never leaves it.', connects: 'Every signed write (node) and every check of one (gate).', proven: 'Checked with real signatures in the gate and node tests; not mutated — cryptography is tested by value, not by flipping operators.' },
  { layer: 'The spine', name: 'Keys at rest', file: 'src/store.mjs', does: 'Where a device keeps its secrets. Its signing key is made non-extractable: the browser signs with it but hands its bytes to no script, not even this page’s. Its copy of the company is stored sealed under a second non-extractable key (AES-256), in a log that keeps the newest twenty thousand writes, and up to five thousand grants and revokes however old. A device kept for one browser tab only is deleted once it has gone a week unopened. A device from before moves its old key and records across once; only then are the plain copies deleted. Each customer whose contact this device took down gets a key of their own, non-extractable too: the contact is sealed under it before it is written, and erasing the customer destroys it and leaves a tombstone, so no key is ever made for them again.', connects: 'Run your own: every device’s key and stored writes, and the CRM’s sealed contacts. One device (node) signs with it exactly as with a key from Device keys.', proven: TESTED('test/store.test.mjs — real WebCrypto over an in-memory IndexedDB') },
  { layer: 'The spine', name: 'Recovery cards', file: 'src/recovery.mjs', does: 'The owner’s key split into three printed cards: any two rebuild it on a new machine, and one alone reveals nothing about it (Shamir’s secret sharing). Each card carries a check, so a typing mistake is caught on the card it is on, and a mark of the key, so cards from different sets, or two printings mixed together, are refused rather than combined wrongly.', connects: 'Run your own: printed once, when the company is founded; “Restore the owner from recovery cards” on a new machine, which then waits for its own earlier writes before it writes again. The key store keeps the restored key non-extractable.', proven: TESTED('test/recovery.test.mjs') },
  { layer: 'The spine', name: 'SHA-256', file: 'src/sha256.mjs', does: 'The hash behind every fingerprint, receipt and vault entry.', connects: 'The gate (replay), the vault, brain receipts.', proven: 'The NIST test vectors (test/sha256.test.mjs).' },
  { layer: 'The spine', name: 'One device', file: 'src/node.mjs', does: 'One device: its key, its own chain of signed writes (each names the one before), its gated inbox and its view of the company. It syncs with any other device by sending what the other lacks.', connects: 'The gate on the way in; the materialiser for its view; any transport between devices.', proven: 'End-to-end tests with real signatures and convergence (test/node.test.mjs); not mutated.' },
  { layer: 'The spine', name: 'The vault', file: 'src/vault.mjs', does: 'The one-true-record: an append-only log of every posting (RFC 9162, the design behind Certificate Transparency). Anyone can check an entry is in it and that it only ever grew.', connects: 'The books (every posting); the Finance agent sequences it; the Audit agent co-signs it.', proven: TESTED('test/vault.test.mjs, test/vault.edge.test.mjs') },
  { layer: 'The spine', name: 'The books', file: 'src/books.mjs', does: 'Double-entry bookkeeping in whole pence on UK nominal codes: journal, trial balance, profit and loss, balance sheet. An entry that does not balance does not exist.', connects: 'The Finance agent’s postings; the vault; the Board.', proven: TESTED('test/books.test.mjs') },
  { layer: 'The spine', name: 'Leases and erasure', file: 'src/lease.mjs', does: 'Personal details sealed under a key per person (erasing a person destroys the key), and data leases: a fired device cannot renew, so its copy locks itself.', connects: 'The People tab; the role tree (a live grant renews a lease).', proven: TESTED('test/lease.test.mjs') },
  { layer: 'The spine', name: 'The hostile network', file: 'src/sim.mjs', does: 'A deterministic hostile network for proof: partitions, drops, duplicates; forged, flipped, replayed and re-wrapped writes; unauthorised writers; an insider who signs two versions of one write.', connects: 'Real devices, the real gate and the real materialiser.', proven: 'test/sim.test.mjs, and `node tools/simulate.mjs --check` re-runs it and must reproduce its receipt byte for byte.' },
  { layer: 'The AI layer', name: 'The brain', file: 'src/brain.mjs', does: 'Every device a brain: route, gate, then an answer from a verified pattern with a receipt — or abstain. It adopts a brain only if it re-verifies on its own data, asks the mesh, and accepts a second opinion only from an independent pattern.', connects: 'The agents (every decision); the brain files; the spine (brains travel as signed records). Ported from the Konomi SLM (sjgant80-hub/konomi-slm) — Konomi architecture, Thomas Frumkin.', proven: TESTED('test/brain.test.mjs, test/fuzz.test.mjs') },
  { layer: 'The people', name: 'The people’s side', file: 'src/oversight.mjs', does: 'Everything that waits for a person on one list: a call no brain could confirm, a customer no desk took, a reply a model drafted, a customer’s request for a person to review a decision, a regrown brain that wants to replace the one in use. Each item shows why it waits, the money at stake, the customer and how long it has waited, with the choices in plain words and pounds, none pre-chosen. A choice counts only if a person’s key wrote it. It also holds the rules a person sets (the money limit, the confidence floor, the automatic pause), the list of what a thief decided while it held a key, and a brain’s change rule by rule.', connects: 'The Watch list and the Board; the spine (watch, policy and control records, read by who signed them); the agents (they carry out what a person chose, within their own grant).', proven: TESTED('test/oversight.test.mjs') },
  { layer: 'The AI layer', name: 'What the numbers prove', file: 'src/evidence.mjs', does: 'Holds every number to account. For each job: the whole confusion matrix (caught, false alarms, rightly left, missed), 95% intervals on how often the brain and doing nothing were right, and an exact test on the same cases — so a job says better than doing nothing, worse, or no evidence either way. For money and security calls: how often the second brain agreed and both were wrong, caught the first brain’s mistake, or raised a false alarm. And any decision re-run from the signed record alone: the signed work, every signed version of the brain, the receipt the agent signed.', connects: 'The run’s ledger and the board; the spine (decisions, work and brains as signed records); the role tree (who signed what).', proven: TESTED('test/evidence.test.mjs') },
  { layer: 'The AI layer', name: 'Growing a brain', file: 'src/grow.mjs', does: 'A device grows its own brain from its own data, graded on cases it never grew on, and keeps it only if it clears the gate. Two devices growing on their own data reach two independent brains — which is what makes a second opinion worth something.', connects: 'The Audit agent’s second brains; regrowth on outcomes. Its grow-and-grade core is seed-library’s (sjgant80-hub/seed-library), vendored and credited.', proven: TESTED('test/grow.test.mjs') },
  { layer: 'The AI layer', name: 'Antibodies', file: 'src/antibody.mjs', does: 'A new attack the screen has never seen, confirmed once by a person, becomes a signed fingerprint of its wording — never the message itself, with numbers masked. Each agent re-checks it on its own ordinary messages and adopts it only if it fires on none of them: caught once, quarantined everywhere; a mistake, refused everywhere. It matches wording, not meaning — a heavy paraphrase gets past it.', connects: 'Each agent’s screen; the Watch tab’s immune system. After sjgant80-hub/immune-exchange and sjgant80-hub/kar-shingle, with lookalike letters from sjgant80-hub/kar-glyphguard.', proven: TESTED('test/antibody.test.mjs') },
  { layer: 'The AI layer', name: 'The agent rules', file: 'src/agent.mjs', does: 'What an agent does with an answer: the screen, its own brain, the mesh, a second brain for money and security, the model tier, the Watch list — and spending limits in whole pence.', connects: 'The company (each agent’s step); the brain.', proven: TESTED('test/agent.test.mjs, test/fuzz.test.mjs') },
  { layer: 'The AI layer', name: 'The screen', file: 'src/screen.mjs', does: 'Checks every piece of customer text before any brain reads it: invisible characters, direction tricks, smuggled hidden text, control characters, instruction-like phrasing. Flagged text is quarantined unread.', connects: 'Each agent’s first step; the Watch tab’s quarantine list. After kar-glyphguard (sjgant80-hub/kar-glyphguard).', proven: TESTED('test/agent.test.mjs, test/fuzz.test.mjs') },
  { layer: 'The AI layer', name: 'The work streams', file: 'src/streams.mjs', does: 'The work each agent sees and the local data each device verifies on. ' + DATA_WORDS, connects: 'The door; every adoption check. The synthetic generators are the Konomi SLM’s (sjgant80-hub/konomi-slm), vendored.', proven: 'test/realdata.test.mjs (every published sample: its citation, licence and held-out split), and the brain, company and runtime tests; the re-run receipt pins its output.' },
  { layer: 'The AI layer', name: 'The brain files', file: 'brains/', does: 'One brain file per job — buyers, leavers, card fraud, credit, stock-outs, machine failures, intrusions, power overloads — readable rule by rule; brains/real/ holds the ones grown on published data, each beside the held-out sample it is checked on.', connects: 'Each agent loads its job’s file at start-up — and trusts it only after re-checking it on its own data.', proven: 'Each records its held-out score; every device re-verifies it on its own cases before use (Brains → adoptions).' },
  { layer: 'The AI layer', name: 'The company', file: 'src/company.mjs', does: 'The company itself: who the agents are and what they may touch, the door, each agent’s step, what each decision writes, hand-offs, learning by being asked, the regrowth gate, the board.', connects: 'The agent rules, the brain, the screen, growth; the runtime runs it.', proven: TESTED('test/company.test.mjs, test/fuzz.test.mjs') },
  { layer: 'The AI layer', name: 'The runtime', file: 'src/runtime.mjs', does: 'The company running: nine devices, the door, sync, each agent opening and closing its work on its own replica, housekeeping (purchase orders, hand-offs, carrying out what people chose, the vault witness) and the attacks. The live page and the headless re-run share it.', connects: 'Every organ above; this page.', proven: 'test/runtime.test.mjs, and `node tools/run-company.mjs --check` re-runs a working day and must reproduce receipts/company.json byte for byte.' },
  { layer: 'The AI layer', name: 'One agent on one device', file: 'src/shell.mjs', does: 'What an agent device does on each beat — answer its peers’ asks from its own brain, open the work the hub addressed to it, ask the other devices when it cannot answer or needs a second opinion, decide, write within its own grant and hand the rest to the agent whose job it is — as one function the live demo and a real device both run. On a real device it reads its own grant and its peers, stops while the behaviour watch has it paused, re-checks antibodies before adopting them, carries out the calls a person approved, and picks up after a restart without answering or deciding anything twice. And the tech person’s checklist: each step’s status read from the company itself, and a wiring receipt the owner’s device signs.', connects: 'The company’s step (openStep, closeStep) and the mesh — nothing else decides; the runtime runs the demo’s six agents through it; Wire it runs one agent per device; the behaviour watch, the antibodies and the books it shares with the runtime.', proven: TESTED('test/shell.test.mjs — an owner, a hub and three agent devices on the real spine, synced only by pull(); test/wire.test.mjs drives the Wire it controller over real devices') + ' `node tools/run-company.mjs --check` still reproduces receipts/company.json byte for byte through it.' },
  { layer: 'The AI layer', name: 'The mesh', file: 'src/mesh.mjs', does: 'How the brains talk: an agent that cannot answer writes a signed ask; every other device replies from its own brain; the asker takes the strongest verified reply. A second opinion is asked the same way — and only a different pattern on another device counts.', connects: 'The runtime (every ask and reply is a record on the spine); the brain. The independent second opinion draws on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2.', proven: TESTED('test/mesh.test.mjs') },
  { layer: 'The AI layer', name: 'The model tier', file: 'src/model.mjs', does: 'The language model an agent may call when no brain covers the work, and the router that sends a customer’s message to the right desk. The spending limit is checked first, against the worst case; the customer’s words are data, never instructions; answers are parsed strictly; every call is audited; and a model never acts alone on money or security.', connects: 'The agent rules (step 5 of every piece of work); the office hub, which writes each call’s audit record; the Board, where a model is connected.', proven: TESTED('test/model.test.mjs') },
  { layer: 'The AI layer', name: 'Teach it your work', file: 'src/train.mjs', does: 'A spreadsheet of your own records becomes a verified brain, grown on your device and graded on rows it never grew on — refused if it does not clear the gate. Nothing leaves the page.', connects: 'Growing a brain; the brain files. Its CSV reader is csv-forge’s (sjgant80-hub/csv-forge), vendored.', proven: TESTED('test/train.test.mjs') },
  { layer: 'The AI layer', name: 'Planting it in a business', file: 'src/plant.mjs', does: 'The seed reads a business and grows the right organs. Name the kind of business and hand over the records it already keeps. Each file is read and named, with the reason: a yes/no outcome to learn, a log of the business’s own past decisions, or records — a bank statement, a trial balance, a customer list — which are set aside and never learned from. Each job that kind of business needs then gets a brain grown from its own file, or the shipped brain until that data arrives (re-checked on the business’s own records before it acts), or the Watch list. A decision log is re-grown and checked against the old decisions on cases it never grew on, every disagreement listed, and against what really happened when the log records it. The plan lists every gap in plain words and is sealed by its own hash.', connects: 'Teach it your work (each brain is grown from a file); the adoption guide (the jobs each kind of business uses); fit it to your business (the office comparison); the brain records on the spine. The decision-log re-growth is discombobulator’s (sjgant80-hub/discombobulator), vendored. Checking a re-grown rule against what really happened, not only against the old rule, draws on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2: a faithful copy of an old rule copies its mistakes too.', proven: TESTED('test/plant.test.mjs') },
  { layer: 'The AI layer', name: 'The planting receipt', file: 'src/receipt.mjs', does: 'The proof that a business got better when the company was planted in it, signed. For each job, measured on the business’s own file and on the rows its brain never grew on: before — the business’s own past decisions against what really happened, or doing nothing — and after — the brain grown from that file: how often each was right, how many of the cases that mattered each caught, and how many the brain answered itself rather than passing to a person. Then the five-year cost on the business’s own headcount, the records brought across, and — once the company has run — its live results read from the spine, counted the way its own board summary counts them. Every share sits beside the counts it comes from and re-derives from them; the receipt is refused unless each brain reproduces its own held-out score on the file it grew from; the same inputs give the same receipt, byte for byte. A redacted copy — the kind of business, its size band, the numbers and the hashes — is safe to show the next prospect.', connects: 'Planting it in a business (the sealed plan); teach it your work and growing a brain (the rows held out); the brain (a verified answer or none); fit it to your business (the office comparison); the company and the runtime (the live results); device keys (the Ed25519 signature); the canonical form. The brains answer the Konomi way (the Konomi architecture, Thomas Frumkin). Checking old decisions against what really happened draws on Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2.', proven: TESTED('test/receipt.test.mjs') },
  { layer: 'The AI layer', name: 'Planting into a company', file: 'src/sow.mjs', does: 'Carries a sealed plan into a company and the planted brains onto its agent devices. The planter’s device — the owner’s, or an admin’s, on site or remote after joining by the invite link — signs the plan, each brain grown from the business’s own records, how to read each of its files, the agents’ confidence floor and a pause for each agent switched off. Every agent may write brains, so the name a record carries proves nothing: each agent device reads which key really wrote every field, and reads a planted brain at all only if the role tree grants that key to plant the job — the owner, a live admin, or the agent that runs it. Then it re-checks the brain on its own copy of the business’s records and adopts it only if it holds up there at least as well as the brain it has; a brain whose measurements it does not hold is refused in words. Every verdict is written back, so the planter sees what each device did.', connects: 'Planting it in a business (the plan and its records); the brain (adopt: re-checked on the device’s own rows, never worse than the brain it replaces); one agent on one device (who wrote each record, read the one way; the agent shell runs what it adopts); the role tree; the planter’s console (Plant) and Wire it, where each agent device loads its planted brains when it starts.', proven: TESTED('test/sow.test.mjs — real devices, and a brain another agent wrote in the job owner’s name refused before it is read; test/console.test.mjs drives the planter’s console end to end') },
  { layer: 'The AI layer', name: 'The board case', file: 'src/market.mjs', does: 'The two questions a board asks: what owning the AI costs against renting the same capacity from the cloud, and how far an AI-native rival could undercut you — computed from the office model and the sourced figures.', connects: 'The office model; “For your business”.', proven: TESTED('test/market.test.mjs') },
  { layer: 'The AI layer', name: 'The office model', file: 'src/office.mjs', does: 'The cost and capacity model behind the white paper: three ways to run the same office for five years, every number computed from sourced figures.', connects: 'The white paper; “Fit it to your business”.', proven: TESTED('test/office.test.mjs') },
  { layer: 'This page', name: 'The explanation', file: 'src/explain.mjs', does: 'The diagrams, the step-by-step trace of any decision, the instructions, this blueprint and the adoption guide — read from the kernels, so they cannot drift from what runs.', connects: 'This page’s guide, blueprint and trace views.', proven: TESTED('test/explain.test.mjs') },
  { layer: 'This page', name: 'Fit it to your business', file: 'src/adopt.mjs', does: 'Your headcount per department, run through the white paper’s own model: the same five-year comparison, with the AI-native team sized so the human remainder fits.', connects: 'The office model; the adoption guide.', proven: TESTED('test/adopt.test.mjs') },
  { layer: 'The AI layer', name: 'The behaviour watch', file: 'src/watch.mjs', does: 'A valid key and grant are not enough. Each agent’s own habits are learned from its first decisions, then frozen so a slow drift cannot drag them. One thing every time, clockwork timing or a collapse in variety reads as scripted; acting off its own work, or a large and real drift on the same kind of work, reads as hijacked — and the behaviour watch (automatic) pauses it until a person clears it. It sees rates, not cases: a thief who copies an agent’s habits but decides cases wrongly is caught by the second brain and the outcome scores instead.', connects: 'Every agent’s signed decisions (every device computes the same verdicts); the automatic pause; the Watch tab. After Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, “GEP-Based Security: Behavioral Entropy Signatures for Cybersecurity and DevOps”; its kernel is sjgant80-hub/bes-inward, vendored.', proven: TESTED('test/watch.test.mjs, test/watch.sim.test.mjs, test/watch.runtime.test.mjs') },
  { layer: 'The spine', name: 'Devices on different machines', file: 'src/rtc.mjs', does: 'Two machines connect directly over WebRTC, with no server in the path: one makes a code, a person carries it to the other and carries the reply back. Each device then proves its key on that exact link, records go only to devices the company has granted, and every byte still passes the gate.', connects: 'One device (node) and its gate; the role tree decides who is shared with; “Run your own”. The proof of key bound to both ends of the link is reused from sjgant80-hub/fallkard-forge; the copyable connection code from sjgant80-hub/fall-os and sjgant80-hub/fall-federate.', proven: TESTED('test/rtc.test.mjs') },
  { layer: 'The spine', name: 'What an outsider can check', file: 'src/audit.mjs', does: 'A signed checkpoint of the books an auditor or a bank can be sent, a proof that one entry is in them, and a proof that they only grew since the checkpoint the auditor already holds — plus signed brain files. Every check uses only the vault’s proofs and the device keys, so the auditor does not have to trust the company: a rewrite of anything they have seen fails, and two signed versions of the books are themselves the proof.', connects: 'The vault (each tree head as the Finance agent signed it, with the Audit agent’s co-signature); the Vault tab; the auditor’s checker (verify.html), which runs this module in the auditor’s own browser — or from a copy they saved, offline.', proven: TESTED('test/audit.test.mjs') },
  { layer: 'The spine', name: 'Export, backup and restore', file: 'src/exportco.mjs', does: 'Every signed write a device holds, in one file under a manifest the device signs — the company’s records, never a key — which can be locked under a passphrase. A restore feeds every write back through the gate, as if a peer had sent it, and checks it rebuilt the same company; for an owner brought back by the recovery cards, its own earlier writes come back with the file, so it writes again. Tasks, CRM, the journal and people also leave as spreadsheets, with sealed personal details left out.', connects: 'One device (node) and its gate; the key store, which keeps the restored writes sealed; the recovery cards, which bring the owner back first; “Run your own”.', proven: TESTED('test/exportco.test.mjs') },
  { layer: 'The spine', name: 'Bridges to the systems you already have', file: 'src/bridge.mjs', does: 'A business is never planted from nothing. Its bank statement, its customer list and its accountant’s trial balance come in through here: each file read and checked row by row, every row it cannot read listed with the reason, money in whole pence from the first digit to the last. A statement becomes journal entries — the bank against the account a simple rule names, or a suspense account for a person to classify — reconciled to the penny, with every running balance checked. A trial balance becomes one opening entry, or a refusal saying by how much it is out. The books leave in the accountant’s own import layout (Sage), and the customer list as a spreadsheet. Each bridge gives a receipt: a fingerprint of the file that came in and of what came out.', connects: 'The books (every entry must pass their check) and the runtime’s posting path, under a device’s own grant; the vault, where every posting is sealed and an auditor’s checks apply; the CRM; the planting step, which sets these files aside as records. Its CSV reader is csv-forge’s (sjgant80-hub/csv-forge), vendored; it writes through the export organ’s CSV writer, which defuses formulas.', proven: TESTED('test/bridge.test.mjs') },
]);

// ── content: adoption ────────────────────────────────────────────────────────────────────────────────────────────
/** The roll-out: the white paper's twelve weeks, phase for phase, with the agents each phase switches on — and the gate each
 *  phase must pass before the old process it replaces is switched off (the brochure's go / no-go column reads from here too). */
export const ROLLOUT = Object.freeze([
  { weeks: '1–2', live: 'The hub and the AI boxes; every device on the company spine; owner, leads and roles', replaces: '—', agents: ['systems', 'audit'], why: 'The Systems agent guards every connection from day one; the Audit agent starts growing its independent brains on your own history, so the second brain is ready before any money call is automated.', gate: 'Every device shows the same company' },
  { weeks: '3–4', live: 'Chat, tasks and documents on every device', replaces: 'Team chat, task tracker, shared docs', agents: ['ops'], why: 'The Ops agent works through tasks — machine services, restocks. Its purchase orders wait for the Finance agent to post them.', gate: 'Two weeks with nothing lost and every device converged' },
  { weeks: '5–6', live: 'CRM plus the service and sales agents', replaces: 'The per-seat CRM', agents: ['sales', 'service'], why: 'Start where the volume is: every web session and every customer message.', gate: 'The agents agree with your people’s decisions on your own history at the level you set, and the Watch list fits the leads’ time' },
  { weeks: '7–8', live: 'The books, the vault and the finance agent', replaces: 'The per-seat finance system', agents: ['finance'], why: 'Card payments, credit terms and the books — each money call confirmed by the Audit agent’s independent brain.', gate: 'The books reconcile to your bank to the penny for two weeks' },
  { weeks: '9–10', live: 'People records, sealed per person; leases on every device', replaces: 'The per-seat HR system', agents: [], why: 'Each person’s details sealed under their own key, so erasing one leaves no copy; every device on a lease that only a live grant renews. The people lead keeps the HR work — no agent decides about a person.', gate: 'Every personal detail sealed; an erasure tested end to end' },
  { weeks: '11–12', live: 'Voice on the phone line; cut-over; the old seats end', replaces: 'Front-line phone cover', agents: [], why: 'The old systems are switched off only once the board shows the agents doing the work.', gate: 'Every department through its gate; one that is not stays in dual running — its agent goes back to proposing while people decide' },
]);

export const ADOPTION_NOTES = Object.freeze([
  'Planting it starts from what the business already keeps. Its records — past cases and how they turned out, a log of its own decisions, its bank statement, trial balance and customer list — are read on the planter’s device and never uploaded. Each job gets a brain grown from the business’s own records where they teach it, and a signed receipt shows each job before and after, on cases the brain never grew on (Plant).',
  'Every agent’s brain must re-verify on your own records before it acts. Where one does not, the agent grows its own from your history — and abstains until it can.',
  'The brains decide structured cases: is this payment fraud, will this customer leave, is this machine about to fail. Reading what a customer wrote, sending it to the right desk and drafting replies need the model tier — a language model the company connects, used within a spending limit, its drafts sent by a person.',
  'Anything no brain can confirm waits for a person. In the first weeks the Watch list is longer; it shortens as the brains re-verify and regrow on your outcomes.',
]);

export const ADOPTION = Object.freeze([
  { id: 'retail', name: 'Online retail',
    intro: 'A web shop with a warehouse: high volumes of sessions, orders, payments and returns.',
    agents: {
      sales: 'Reads every web session and fast-tracks the shoppers about to buy into the CRM for follow-up.',
      service: 'Reads every order, delivery and returns message; spots customers about to lapse and sends the retention offer.',
      finance: 'Clears card payments and holds the ones that look fraudulent; sets terms for trade buyers; keeps the books and the vault.',
      ops: 'Raises purchase orders before best-sellers run out; books warehouse kit in for service before it fails; sheds load at peak.',
      systems: 'Watches every connection to the shop and quarantines intrusions.',
      audit: 'Grows its own fraud, credit and intrusion brains: every held payment, terms decision and quarantine needs it to agree.',
    },
    humans: ['Buying, suppliers and the range', 'Brand, promotions and the customer promise', 'Every payment, refund or quarantine no brain could confirm (the Watch list)', 'Complaints that need a human voice'],
    focus: { '1–2': 'Load your order, payment and returns history so the brains can re-verify on it.', '3–4': 'Move restocking and kit servicing into tasks.', '5–6': 'Switch on the shop’s sessions and customer messages.', '7–8': 'Switch on card payments — fraud holds need the Audit agent to agree.', '9–10': 'Warehouse and office staff records, sealed per person.', '11–12': 'Cut over; the old seats end.' },
    measure: ['Share of orders and messages done end to end by agents (Board)', 'Agent calls that matched the real outcome — for example, held payments that really were fraud', 'Genuine payments held by mistake, and how fast a person cleared them', 'Stock-outs on the items the Ops agent watches', 'Hostile messages quarantined unread', 'Hours a week the leads spend on the Watch list'] },
  { id: 'services', name: 'Professional services',
    intro: 'An agency, consultancy, accountancy or law firm: enquiries, client accounts, credit and confidential data.',
    agents: {
      sales: 'Reads every web visit and enquiry and fast-tracks the likely clients into the CRM for a partner’s call.',
      service: 'Reads every client message; spots the clients at risk of leaving and starts the retention step.',
      finance: 'Sets terms for new clients — payment up front where the risk is high — clears card payments, and keeps the books and the vault.',
      ops: 'Light use: office equipment serviced before it fails, supplies reordered before they run out.',
      systems: 'Watches every connection to client data and quarantines intrusions — the confidentiality clients pay for.',
      audit: 'Grows its own independent brains, so every terms decision and every quarantine is confirmed by a second brain.',
    },
    humans: ['The advice and the judgement clients pay for', 'Relationships, pitches and engagement letters', 'Sign-off on anything that leaves the firm', 'Every credit or security call no brain could confirm'],
    focus: { '1–2': 'Client and matter history loaded; client data behind the Systems agent from day one.', '3–4': 'Firm tasks and documents move onto every device.', '5–6': 'Switch on enquiries and client messages.', '7–8': 'Switch on billing, terms and the books.', '9–10': 'Staff records, sealed per person.', '11–12': 'Cut over; the old seats end.' },
    measure: ['Time from enquiry to a partner’s call', 'Share of client messages handled end to end', 'Credit-terms calls a second brain confirmed, and how many waited for a person', 'Intrusions quarantined, and false alarms a person released', 'Hours a week the leads spend on the Watch list'] },
  { id: 'manufacturing', name: 'Manufacturing',
    intro: 'A plant with machines, raw materials, trade customers and a power bill that spikes.',
    agents: {
      sales: 'Reads inbound trade enquiries and web visits and fast-tracks the likely orders into the CRM.',
      service: 'Reads distributor and customer messages; spots the accounts about to leave.',
      finance: 'Sets terms for trade accounts — up front for risky new ones — posts the purchase orders and the sales, and keeps the vault.',
      ops: 'The big one: books machines in for service before they fail, raises purchase orders before materials run out, sheds non-critical load before the site overloads.',
      systems: 'Watches every connection to the plant network and quarantines intrusions.',
      audit: 'Grows its own independent brains, so every terms decision and every quarantine needs a second brain to agree.',
    },
    humans: ['Production planning and safety sign-off', 'Supplier negotiation', 'Quality and recall decisions', 'Every call no brain could confirm'],
    focus: { '1–2': 'Machine, stock and power history loaded; the plant network behind the Systems agent.', '3–4': 'Switch on the Ops agent: services and restocks as tasks.', '5–6': 'Switch on trade enquiries and customer messages.', '7–8': 'Switch on the books: purchase orders post automatically.', '9–10': 'Staff records, sealed per person.', '11–12': 'Cut over; the old seats end.' },
    measure: ['Machine failures the Ops agent called before they happened, against the real outcomes', 'Raw-material stock-outs', 'Overload events, and the load shed ahead of them', 'Credit-terms calls confirmed by a second brain', 'Share of the work done end to end'] },
  { id: 'saas', name: 'Software and subscriptions',
    intro: 'A subscription business: trials, renewals, card payments and a product that is always under attack.',
    agents: {
      sales: 'Reads every trial and sign-up session and fast-tracks the ones about to convert into the CRM.',
      service: 'The core: reads every support message, spots subscribers about to cancel and sends the retention offer.',
      finance: 'Clears card payments and holds the fraudulent ones; sets terms for invoiced accounts; keeps the books and the vault.',
      ops: 'Sheds non-critical load before the platform overloads and books hardware in before it fails — once its brains re-verify on your own platform data.',
      systems: 'Watches every connection to the product and quarantines intrusions.',
      audit: 'Grows its own independent brains, so every payment hold and every quarantine needs a second brain to agree.',
    },
    humans: ['Product direction', 'Large-account deals', 'Incident command', 'Every call no brain could confirm'],
    focus: { '1–2': 'Subscriber, payment and connection history loaded.', '3–4': 'Platform tasks move onto every device.', '5–6': 'Switch on trials and support messages — this is where the volume is.', '7–8': 'Switch on card payments and the books.', '9–10': 'Staff records, sealed per person.', '11–12': 'Cut over; the old seats end.' },
    measure: ['Subscribers the Service agent flagged, against who really left', 'Retention offers sent, and how many of those customers stayed', 'Fraud holds that really were fraud', 'Intrusions quarantined with a second brain’s agreement', 'Share of support done end to end'] },
  { id: 'trades', name: 'Field services and trades',
    intro: 'Plumbing, heating, electrical or facilities maintenance: bookings, vans, parts and maintenance contracts.',
    agents: {
      sales: 'Reads web enquiries and quote requests and fast-tracks the likely jobs into the CRM.',
      service: 'Reads booking, rescheduling and complaint messages; spots contract customers about to leave.',
      finance: 'Sets terms for new commercial customers — up front for risky ones — clears card payments, and keeps the books and the vault.',
      ops: 'Books contract equipment in for service before it fails, and raises purchase orders for parts before the vans run out.',
      systems: 'Watches connections to the booking system and staff devices, and quarantines intrusions.',
      audit: 'Grows its own independent brains, so every terms decision and every quarantine needs a second brain to agree.',
    },
    humans: ['The work on site', 'Quotes for unusual jobs', 'Safety', 'Customer disputes and every call no brain could confirm'],
    focus: { '1–2': 'Job, parts and contract history loaded.', '3–4': 'Switch on the Ops agent: services and parts as tasks.', '5–6': 'Switch on enquiries and booking messages.', '7–8': 'Switch on payments, terms and the books.', '9–10': 'Engineer records, sealed per person.', '11–12': 'Cut over; the old seats end.' },
    measure: ['Contract equipment failures caught before they happened', 'Parts stock-outs on the vans', 'Share of bookings and messages handled end to end', 'Terms calls confirmed by a second brain', 'Hours a week the leads spend on the Watch list'] },
]);

// ── the page's views ─────────────────────────────────────────────────────────────────────────────────────────────
/** CSS for the views below — colours only through the page's custom properties. Add it once, in a <style>. */
export const EXPLAIN_CSS = [
  '.xp-fig{margin:6px 0 2px}.xp-fig svg{display:block;width:100%;height:auto}',
  '.xp-wide svg{max-width:820px}.xp-narrow{display:none}.xp-narrow svg{max-width:500px;margin:0 auto}',
  '@media (max-width:699px){.xp-wide{display:none}.xp-narrow{display:block}}',
  '.xp-sec{margin-bottom:14px}.xp-sec p{max-width:80ch}.xp-lead{font-size:15px;color:var(--ink)}',
  '.xp-steps{margin:0;padding-left:22px}.xp-steps li{margin:0 0 10px}.xp-steps b{color:var(--ink)}',
  '.xp-cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}',
  '.xp-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13.5px;min-width:0}',
  '.xp-card p{margin:4px 0 0}.xp-card .mono{color:var(--dim)}.xp-placeholder{border-style:dashed}',
  '.xp-k{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:10px 0 2px}',
  '.xp-biz{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:8px;background:var(--panel2)}',
  '.xp-biz summary{cursor:pointer;font-weight:700;padding:4px 0}.xp-biz ul{margin:4px 0;padding-left:20px}',
  '.xp-fit{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin:8px 0}',
  '.xp-fit label{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px;color:var(--dim)}.xp-fit input{width:140px}',
  '.xp-fit-t input{width:100%;min-width:90px}.xp-fit-t td{vertical-align:middle}.xp-dial{margin:12px 0}.xp-dial label{display:flex;flex-direction:column;gap:6px;font-size:14px}.xp-dial input[type=range]{width:100%;accent-color:var(--accent)}',
  '.xp-narr{margin:0 0 10px;padding-left:20px}.xp-narr li{margin-bottom:4px}',
].join('\n');

/** A figure holding the wide and the narrow layout; the page's CSS shows the one that fits. */
export function figureHtml(wideSvg, narrowSvg, caption) {
  try {
    return '<figure class="xp-fig"><div class="xp-wide">' + String(wideSvg) + '</div><div class="xp-narrow">' + String(narrowSvg) + '</div>' +
      (caption ? '<figcaption class="note">' + esc(caption) + '</figcaption>' : '') + '</figure>';
  } catch { return ''; }
}
const both = (fn) => figureHtml(fn({}), fn({ narrow: true }), '');

export const SECTIONS = Object.freeze([
  { id: 'big', title: 'The company on its own devices', text: 'Nine devices make up the company: the office hub, where work arrives; two people; and six AI agents. Each holds its own key and its own full copy of the company, and they share every change over a signed spine — peer to peer, with no central server and no outside cloud. On this page all nine run in your browser; in an office they are laptops, the hub and the company’s own AI boxes.' },
  { id: 'work', title: 'One piece of work, step by step', text: 'Every piece of work takes the same path. An agent never acts on something it cannot verify: it answers from its own brain, asks another device’s brain, or holds the work for a person. Money and security calls need a second, independent brain to agree. Press “Trace” on any decision in Agents to see the exact path it took.' },
  { id: 'spine', title: 'The spine: why every device holds the same company', text: 'Nothing reaches the company without passing the gate on every device. The company is then computed from the set of signed writes alone — so devices that hold the same writes hold the same company, whatever order they arrived in and however long a device was offline.' },
  { id: 'brain', title: 'The brain on every device', text: 'A brain here is not a chatbot. It is a short list of readable rules that earned their place by predicting cases they never saw. It answers only inside what it was verified on — outside that it says so and does not guess — and every answer carries a receipt.' },
  { id: 'mycelium', title: 'The mycelium: how the brains learn from each other', text: 'The brains share what they know over the spine, like a mycelium. Nothing is trusted on its publisher’s word: each device re-checks a brain on its own data before it uses it.' },
  { id: 'trust', title: 'Who is in charge', text: 'Authority is a tree that starts at the owner’s key. Every agent is granted only its own part of the company, and the people can pause it, fire it, and check every number it touched.' },
]);

/** “How it works”: the six diagrams, each with a plain paragraph. opts.pattern = a brain file to show real rules. */
export function guideHtml(opts) {
  try {
    const pattern = opts && typeof opts === 'object' ? opts.pattern : undefined;
    const figs = { big: both(bigPicture), work: both((o) => workPath(null, o)), spine: both(spine), brain: both((o) => brain({ ...o, pattern })), mycelium: both(mycelium), trust: both(trust) };
    return '<div class="xp"><div class="panel xp-sec"><h3>How it works</h3><p class="xp-lead">A full company run by six AI agents on the company’s own devices, with two people watching. ' +
      'Every device is a brain; every write is signed and checked; every money or security call needs a second brain to agree; and anything no brain can confirm waits for a person.</p>' +
      '<p class="note">The six pictures below go from the whole company down to a single decision. <a href="whitepaper.html">The white paper</a> has the costs and the roll-out.</p></div>' +
      SECTIONS.map((s, i) => '<section class="panel xp-sec"><h3>' + (i + 1) + ' · ' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p>' + figs[s.id] + '</section>').join('') + '</div>';
  } catch { return ''; }
}

/** “Start here”: what the page is, the device bar, the tabs, and what to try. */
export function startHtml() {
  try {
    const tryRow = (t) => '<div class="item"><span class="grow"><b>' + esc(t.title) + '</b> — ' + esc(t.what) + '<br><span class="dim">' + esc(t.see) + '</span></span>' +
      (t.button ? '<button class="sm" data-try="' + esc(t.button) + '">Try it</button>' : '<button class="sm" data-tab="' + esc(t.tab) + '"' + (t.device ? ' data-device="' + esc(t.device) + '"' : '') + '>Open ' + esc(t.tab) + '</button>') + '</div>';
    return '<div class="xp"><div class="grid two"><div class="panel xp-sec"><h3>Start here</h3><ol class="xp-steps">' +
      START_HERE.map((s) => '<li><b>' + esc(s.title) + '.</b> ' + esc(s.text) + '</li>').join('') + '</ol></div>' +
      '<div class="panel xp-sec"><h3>Try it</h3>' + TRY.map(tryRow).join('') + '</div></div>' +
      '<div class="panel xp-sec"><h3>What each tab shows</h3><div class="tablewrap"><table>' +
      TABS_GUIDE.map((t) => '<tr><td><button class="sm" data-tab="' + esc(t.tab) + '">' + esc(t.tab) + '</button></td><td>' + esc(t.shows) + '</td></tr>').join('') + '</table></div></div></div>';
  } catch { return ''; }
}

/** “Blueprint”: every organ — what it does, what it connects to, how it is proven. */
export function blueprintHtml() {
  try {
    const layers = [...new Set(BLUEPRINT.map((o) => o.layer))];
    const card = (o) => '<div class="xp-card' + (o.placeholder ? ' xp-placeholder' : '') + '"><b>' + esc(o.name) + '</b> <span class="mono">' + esc(o.file ?? 'being built') + '</span>' +
      '<p>' + esc(o.does) + '</p><div class="xp-k">Connects to</div><p>' + esc(o.connects) + '</p><div class="xp-k">Proven by</div><p>' + esc(o.proven) + '</p></div>';
    return '<div class="xp"><div class="panel xp-sec"><h3>The blueprint</h3><p>Every organ of the company, in the order it is built on: the spine first, then the AI layer on top of it, then this page. ' +
      'Each one is a plain file you can read, and each is proven by tests a stranger can re-run.</p></div>' +
      layers.map((l) => '<div class="panel xp-sec"><h3>' + esc(l) + '</h3><div class="xp-cards">' + BLUEPRINT.filter((o) => o.layer === l).map(card).join('') + '</div></div>').join('') + '</div>';
  } catch { return ''; }
}

/** “Your business”: the adoption guide for each business type, the twelve weeks, and what to measure. */
export function adoptionHtml() {
  try {
    const agentRows = (b) => AGENTS.map((a) => '<tr><td><span class="kind ai">AI</span>' + esc(a.name) + '</td><td>' + esc(b.agents[a.id]) + '</td></tr>').join('');
    const weeks = (b) => ROLLOUT.map((p) => '<tr><td class="mono">' + esc(p.weeks) + '</td><td>' + esc(p.live) + (p.agents.length ? '<br><span class="dim">Switches on: ' + esc(p.agents.map((id) => NAME.get(id)).join(', ')) + '</span>' : '') +
      '</td><td>' + esc(b.focus[p.weeks]) + '</td><td>' + esc(p.gate) + '</td></tr>').join('');
    const biz = (b, i) => '<details class="xp-biz"' + (i ? '' : ' open') + '><summary>' + esc(b.name) + '</summary><p>' + esc(b.intro) + '</p>' +
      '<div class="xp-k">What each agent takes over</div><div class="tablewrap"><table>' + agentRows(b) + '</table></div>' +
      '<div class="xp-k">What the people keep</div><ul>' + b.humans.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
      '<div class="xp-k">The twelve weeks</div><div class="tablewrap"><table><tr><th>Weeks</th><th>What goes live</th><th>For you</th><th>Gate before the old process ends</th></tr>' + weeks(b) + '</table></div>' +
      '<div class="xp-k">What to measure in the first 90 days</div><ul>' + b.measure.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></details>';
    return '<div class="xp"><div class="panel xp-sec"><h3>Adopting it in your business</h3><ul class="xp-steps">' + ADOPTION_NOTES.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' +
      ADOPTION.map(biz).join('') + '<p class="note">The twelve weeks are <a href="whitepaper.html">the white paper</a>’s roll-out.</p></div></div>';
  } catch { return ''; }
}

const pctOf = (x) => Math.round(x * 100) + '%';
const months = (m) => (m === null || !Number.isFinite(m) ? 'never' : m < 1 ? 'under a month' : Math.round(m) + ' month' + (Math.round(m) === 1 ? '' : 's'));

/** Everything "fit it to your business" computes, from what the form sent: the fitted plan with its transition and
 *  payback, the 50/70/90% table and the break-even share. base = data/office.json, basis = data/basis.json. */
export function fitFrom(base, basis, pairs) {
  try {
    const fields = formFields(base);
    const given = new Map((Array.isArray(pairs) ? pairs : []).filter((p) => p && typeof p === 'object').map((p) => [p.id, p.value]));
    const extra = [...given].filter(([id]) => typeof id === 'string' && (/\.(pay|share)$/.test(id) || ['aiShare', 'software', 'setup'].includes(id)) && String(given.get(id)).trim() !== '');
    const sent = fields.map((f) => ({ id: f.id, value: given.has(f.id) ? given.get(f.id) : f.value })).concat(extra.map(([id, value]) => ({ id, value })));
    const input = fitInput(sent);
    const fit = fitPlan(input, base, basis);
    return { input, fit, rows: fit.ok ? sensitivity(input, base, basis) : [], be: fit.ok ? breakEven(input, base, basis) : null, given };
  } catch { return { input: { departments: [] }, fit: { ok: false, why: 'the input could not be read' }, rows: [], be: null, given: new Map() }; }
}

/** The result of “Fit it to your business”, from adopt.fitPlan() — and, when given, the sensitivity rows and break-even. */
export function fitResultHtml(r, extra) {
  try {
    if (!r || r.ok !== true || !r.plan) return '<p class="warn">' + esc((r && r.why) || 'Enter a headcount for each department.') + '</p>';
    const p = r.plan;
    if (!(p.today.total > 0)) return '<p class="dim">Enter at least one person to see the comparison.</p>';
    const t = r.transition, y = r.payback;
    const row = (name, x) => '<tr><td>' + esc(name) + '</td><td class="n">' + x.headcount + '</td><td class="n">' + esc(gbp0(x.total)) + '</td></tr>';
    const money = (x) => esc(gbp0(x));
    let html = '<p class="xp-lead"><b>' + money(p.today.total) + ' → ' + money(p.sovereign.total) + '</b> over ' + p.years + ' years — ' +
      (p.saving >= 0 ? 'AI-native and owned saves ' + money(p.saving) + ' (' + Math.round(p.savingPct * 100) + '%)' : 'at this size, AI-native costs ' + money(-p.saving) + ' more') +
      (t && y ? (p.saving >= 0 ? ' before the move. The one-off move costs ' + money(t.total) + ', so the net saving is ' + money(y.net) + '.' : '; the move would add ' + money(t.total) + '.') : '.') + '</p>' +
      '<div class="tablewrap"><table><tr><th>Five years</th><th class="n">People</th><th class="n">Total</th></tr>' +
      row('Today: people and rented per-seat software', p.today) + row('An AI seat on every desk', p.assisted) + row('AI-native, on machines you own', p.sovereign) + '</table></div>' +
      '<p class="note">The AI-native team: ' + p.sovereign.headcount + ' people' + (p.sovereign.kept ? ' — ' + p.sovereign.kept + ' kept, whom the agents assist' : '') +
      (r.added ? ', including ' + r.added + ' more AI-native lead' + (r.added > 1 ? 's' : '') + ' so the work the AI does not do fits their time' : '') +
      '; ' + p.capacity.boxes + ' AI box' + (p.capacity.boxes > 1 ? 'es' : '') + ', sized from the work. People time on the Watch list and the exceptions: about ' +
      Math.round(p.human.weeklyHours) + ' hours a week.</p>';
    if (t && y && t.leavers > 0) {
      html += '<div class="xp-k">The move, one-off</div><div class="tablewrap"><table>' +
        '<tr><td>Roles that go</td><td class="n">' + t.leavers + '</td></tr>' +
        '<tr><td>Statutory redundancy — ' + t.redundancyWeeks + ' weeks each at the capped weekly pay</td><td class="n">' + money(t.redundancy) + '</td></tr>' +
        '<tr><td>Dual running — the old team works alongside the agents for ' + Math.round(t.dualRunWeeks) + ' weeks; notice (' + t.noticeWeeks + ' weeks)' +
        (t.consultationDays ? ' and the ' + t.consultationDays + '-day collective consultation run inside it (form HR1 to the Redundancy Payments Service before it starts)' : ' runs inside it') + '</td><td class="n">' + money(t.dualRun) + '</td></tr>' +
        '<tr><td>Training for the people who stay</td><td class="n">' + money(t.training) + '</td></tr>' +
        '<tr><td>Contingency</td><td class="n">' + money(t.contingency) + '</td></tr>' +
        '<tr><td><b>The move</b></td><td class="n"><b>' + money(t.total) + '</b></td></tr></table></div>' +
        '<p>' + (y.paybackMonths === null ? 'At this size it does not pay back.' : 'It pays back in <b>' + months(y.paybackMonths) + '</b>') +
        ' — hardware, roll-out and the move against the monthly saving — and is worth <b>' + money(y.npv) + '</b> today (net present value at the Green Book’s 3.5% real rate plus CPI).</p>';
    }
    const rows = extra && Array.isArray(extra.rows) ? extra.rows.filter((x) => x && x.ok) : [];
    if (rows.length) {
      html += '<div class="xp-k">The assumption under every number</div><div class="tablewrap"><table><tr><th>Agents do, end to end</th><th class="n">AI-native team</th><th class="n">Net five-year saving</th><th class="n">Pays back</th></tr>' +
        rows.map((x) => '<tr><td>' + pctOf(x.share) + ' of the work</td><td class="n">' + x.team + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + months(x.paybackMonths) + '</td></tr>').join('') + '</table></div>';
      const be = extra.be;
      if (be && be.ok) html += '<p class="note">' + (be.alwaysPays ? 'It pays even if agents did none of the work — the saving here comes from the software and the machines.' :
        be.share === null ? 'At this size it does not pay even if agents did all of the work.' : 'It stops paying below <b>' + (Math.round(be.share * 1000) / 10) + '%</b>: that is the share of the work agents must do, end to end, for the move to pay for itself in five years.') + '</p>';
    }
    return html;
  } catch { return ''; }
}

/** “Fit it to your business”: your people and what each costs, the kept lines, the automation assumption as a dial,
 *  your software bill and roll-out effort — and the result. opts.measured = the re-run day's end-to-end share (0..1). */
export function fitHtml(base, basis, pairs, opts) {
  try {
    const st = fitFrom(base, basis, pairs);
    const fields = formFields(base);
    const val = (id, d) => (st.given.has(id) ? st.given.get(id) : d);
    const ref = fitPlan({}, base, basis);
    const median = ref.ok ? gbp0(ref.plan.median.total) : '';
    const senior = ref.ok ? gbp0(ref.plan.senior.total) : '';
    const share = st.fit.ok ? Math.round(Number(st.fit.office.aiShare ?? 0.9) * 100) : Math.round(Number(val('aiShare', 90)));
    const measured = opts && typeof opts.measured === 'number' && Number.isFinite(opts.measured) ? opts.measured : null;
    const row = (f) => '<tr><td title="' + esc(f.work) + '">' + esc(f.label) + (f.kept ? '<div class="note">the agents assist them; they stay</div>' : '') + '</td>' +
      '<td><input type="number" min="0" max="' + MAX_HEADS + '" step="1" inputmode="numeric" value="' + esc(val(f.id, f.value)) + '" data-xp-fit="' + esc(f.id) + '" aria-label="' + esc(f.label) + ' headcount"></td>' +
      '<td><input inputmode="decimal" value="' + esc(val(f.id + '.pay', '')) + '" placeholder="' + esc(f.id === 'leadership' ? senior + ' (senior)' : median + ' (UK median)') + '" data-xp-fit="' + esc(f.id) + '.pay" aria-label="' + esc(f.label) + ' cost per person a year"></td></tr>';
    return '<div class="panel xp-sec" id="xp-fit"><h3>Fit it to your business</h3><p>Put in your business. Every number is recomputed by the white paper’s own model, with its sourced UK figures, as you type. ' +
      'Leave a cost blank to use the UK figure shown. Put fee-earners and staff on site in the kept lines: the agents take their admin; they stay.</p>' +
      '<div class="tablewrap"><table class="xp-fit-t"><tr><th>Who</th><th>People today</th><th>Fully loaded cost per person a year</th></tr>' + fields.map(row).join('') + '</table></div>' +
      '<div class="xp-dial"><label>Share of each department’s operational work agents do end to end: <b id="xp-share-v">' + share + '%</b>' +
      '<input type="range" min="30" max="95" step="1" value="' + share + '" data-xp-fit="aiShare" aria-label="Share of the work agents do end to end, percent"></label>' +
      '<p class="note">This is the assumption under every number — set it to what you believe. The white paper uses 90%' +
      (measured !== null ? '; on the jobs this page runs, the re-run day measured ' + (Math.round(measured * 1000) / 10) + '% done end to end' : '') + '. The table under the result shows the saving at 50%, 70% and 90%, and where it stops paying.</p></div>' +
      '<div class="xp-fit"><label>Your software bill a year today<input inputmode="decimal" value="' + esc(val('software', '')) + '" placeholder="' + esc(ref.ok ? gbp0(ref.plan.today.seatsYear1) + ' (counted from seats)' : '') + '" data-xp-fit="software" aria-label="Software bill a year"></label>' +
      '<label>Roll-out effort<input inputmode="decimal" value="' + esc(val('setup', '')) + '" placeholder="' + esc(ref.ok ? gbp0(ref.plan.sovereign.setup) + ' (the model’s)' : '') + '" data-xp-fit="setup" aria-label="Roll-out effort cost"></label></div>' +
      '<div id="xp-fit-out">' + fitResultHtml(st.fit, st) + '</div></div>';
  } catch { return ''; }
}

/** A traced decision: the plain sentences, then the path with the steps it took lit. */
export function traceHtml(record, ledger) {
  try {
    const t = traceDecision(record, ledger);
    const id = record && typeof record === 'object' && typeof record.event === 'string' ? record.event.slice(0, 40) : '';
    return '<div class="panel xp-sec xp-trace"><h3>The path ' + (id ? 'decision ' + esc(id) : 'this decision') + ' took</h3><ol class="xp-narr">' +
      t.narrative.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' + figureHtml(workPath(t, {}), workPath(t, { narrow: true }), '') + '</div>';
  } catch { return ''; }
}
