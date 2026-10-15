// ui/wire.mjs — "Wire it": the tech person's afternoon, on the page.
//
// The checklist, live against this tab's real device (src/shell.mjs wiringView → wiringChecklist): every status is read from
// the company itself — who is granted, which devices have checked in, which company each one says it holds. On this device:
// choose what it is (a person's device, the office hub, or an AI agent), and — on the AI box — run that agent here with
// src/shell.mjs createAgentShell. On the owner's device: grant each device its role, mark the recovery cards printed, and
// sign the wiring receipt. On the hub: send each agent a real test case. Plus a printable one-page install sheet.
// Pure renderers (renderWire, installSheetHtml, officeSvg) and one controller (createWire) that talks to the page through
// the env it is given — so the renderers are tested in Node (test/wire.test.mjs) and the controller with a fake env.
import { AGENTS, agentName } from '../src/company.mjs';
import { JOBS as JOB_WORDS } from '../src/company.mjs';
import { shopperRows, sample } from '../src/streams.mjs';
import { ollama } from '../src/model.mjs';
import { wiringView, wiringChecklist, grantFor, checkIn, wiringReceipt, verifyWiringReceipt, receiptRecord, createAgentShell, stockBrains, testWork,
  ollamaSteps, planOf, seedFor, agentRoster, oversee, MINUTES, OSES, LOCAL_MODEL } from '../src/shell.mjs';
import { plantedFor, judgePlanted, recordPlanted, rowsFor } from '../src/sow.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (h) => (h ? String(h).slice(0, 8) : '—');
const plantKey = (e) => e.id + '/' + e.patternId + '/' + e.plan + '/' + e.trusted;
const jobOf = (d) => (Object.hasOwn(JOB_WORDS, d) ? JOB_WORDS[d] : String(d));
const HEX64 = /^[0-9a-f]{64}$/;
const ROLE_WORDS = { owner: 'the owner’s device', admin: 'an admin’s device', staff: 'a person’s device', hub: 'the office hub', agent: 'an AI agent device' };
const STATUS_WORDS = { done: 'done', todo: 'to do', waiting: 'waiting', optional: 'optional' };
const OS_WORDS = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
export const TICK_MS = 2000;            // an agent device's beat
export const WATCH_MS = 20000;          // how often the owner's (or an admin's) device runs the behaviour watch over every agent

export const WIRE_CSS = [
  '.wr-progress{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}',
  '.wr-bar{flex:1 1 220px;height:8px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);overflow:hidden}',
  '.wr-bar i{display:block;height:100%;background:var(--accent)}',
  '.wr-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
  '.wr-step{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}',
  '.wr-step.next{border-color:var(--accent2);box-shadow:0 0 0 1px var(--accent2) inset}',
  '.wr-step h4{margin:0;font-size:15px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
  '.wr-step .n{font-family:var(--mono);color:var(--faint);font-size:12px}',
  '.wr-step p{margin:6px 0 0;font-size:14px;color:var(--dim);max-width:86ch}',
  '.wr-step ul{margin:6px 0 0;padding-left:18px;font-size:14px}.wr-step li{margin:3px 0;overflow-wrap:anywhere}',
  '.wr-step .det{font-size:13px;color:var(--ink);margin-top:6px;overflow-wrap:anywhere}',
  '.wr-chip{font-size:11px;border:1px solid var(--line);border-radius:12px;padding:1px 8px;white-space:nowrap}',
  '.wr-chip.done{color:var(--accent);border-color:var(--accent)}.wr-chip.todo{color:var(--warn);border-color:var(--warn)}',
  '.wr-chip.waiting{color:var(--accent2);border-color:var(--accent2)}.wr-chip.optional{color:var(--dim)}',
  '.wr-cmd{font-family:var(--mono);font-size:12.5px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 9px;margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.wr-office{width:100%;height:auto;display:block;max-height:300px}',
  '.wr-office text{font-family:var(--sans);font-size:12px;fill:var(--ink)}.wr-office .s{fill:var(--dim);font-size:11px}',
  '.wr-grid{display:grid;gap:14px;grid-template-columns:1fr;margin:14px 0}@media(min-width:900px){.wr-grid{grid-template-columns:1fr 1fr}}',
  '.wr-sec{margin:14px 0}.wr-sec>p{max-width:86ch}',
  '#wire-print{display:none}',
  '@media print{body.print-sheet>*:not(#wire-print){display:none!important}body.print-sheet #wire-print{display:block!important;background:#fff;color:#000;font-size:12px}',
  '  body.print-sheet #wire-print h2{font-size:18px;margin:0 0 4px}body.print-sheet #wire-print h3{font-size:13px;margin:10px 0 4px}',
  '  body.print-sheet #wire-print table{width:100%;border-collapse:collapse}body.print-sheet #wire-print td,body.print-sheet #wire-print th{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}',
  '  body.print-sheet #wire-print .wr-cmd{border:1px solid #999;background:#fff;color:#000}}',
].join('\n');

/** The office, wired: who connects to what. Each agent device on the AI box is its own browser profile. */
export function officeSvg() {
  const box = (x, y, w, h, t, s, stroke) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="var(--panel2)" stroke="' + stroke + '" stroke-width="1.5"/>' +
    '<text x="' + (x + w / 2) + '" y="' + (y + 22) + '" text-anchor="middle">' + esc(t) + '</text><text class="s" x="' + (x + w / 2) + '" y="' + (y + 38) + '" text-anchor="middle">' + esc(s) + '</text>';
  const line = (x1, y1, x2, y2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="var(--accent2)" stroke-width="2" stroke-dasharray="6 5"/>';
  const agents = AGENTS.map((a, i) => '<rect x="' + (436 + (i % 3) * 58) + '" y="' + (150 + Math.floor(i / 3) * 34) + '" width="52" height="26" rx="6" fill="var(--panel)" stroke="var(--violet)"/>' +
    '<text class="s" x="' + (462 + (i % 3) * 58) + '" y="' + (167 + Math.floor(i / 3) * 34) + '" text-anchor="middle">' + esc(a.name.replace(' agent', '')) + '</text>').join('');
  return '<svg class="wr-office" viewBox="0 0 640 250" role="img" aria-label="The office wired: the owner’s laptop, each person’s device, the office hub and the AI box with one device per agent, each linked directly to another">' +
    line(110, 70, 320, 70) + line(110, 190, 320, 90) + line(320, 90, 420, 170) +
    box(10, 40, 200, 56, 'Owner’s laptop', 'founds the company · grants', 'var(--gold)') +
    box(10, 160, 200, 56, 'Each person’s device', 'laptop or phone', 'var(--gold)') +
    box(250, 40, 150, 56, 'Office hub', 'always on · the door', 'var(--accent2)') +
    '<rect x="420" y="110" width="210" height="132" rx="12" fill="none" stroke="var(--violet)" stroke-width="1.5"/>' +
    '<text x="525" y="134" text-anchor="middle">AI box</text>' + agents +
    '<text class="s" x="320" y="236" text-anchor="middle">Dashed: a direct link between two machines (a code carried by hand once each way). No server.</text></svg>';
}

const chip = (s) => '<span class="wr-chip ' + esc(s) + '">' + esc(STATUS_WORDS[s] || s) + '</span>';

/** One step of the checklist. */
function stepHtml(s, next) {
  return '<li class="wr-step' + (s.id === next ? ' next' : '') + '" id="wr-' + esc(s.id) + '"><h4><span class="n">' + s.n + '</span>' + esc(s.title) + ' ' + chip(s.status) +
    '<span class="dim" style="font-size:12px;font-weight:400">' + esc(s.who) + ' · about ' + s.minutes + ' min' + (s.optional ? ' · optional' : '') + '</span></h4>' +
    '<p>' + esc(s.say) + '</p><ul>' + s.how.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
    s.detail.map((d) => '<div class="det">' + esc(d) + '</div>').join('') + '</li>';
}

/** The local-model steps for one system, with copyable command lines. */
export function modelStepsHtml(os, origin) {
  const m = ollamaSteps(os, origin);
  return '<ol>' + m.steps.map((s) => '<li>' + esc(s.say) + (s.cmd ? '<div class="wr-cmd">' + esc(s.cmd) + '</div>' : '') + '</li>').join('') + '</ol>';
}

/** Words for this device, from its own grants. */
export function deviceRole(view) {
  try {
    if (view.owner) return { role: 'owner', agent: '' };
    const mine = view.devices.filter((d) => d.pub === view.me);
    const a = mine.find((d) => d.role === 'agent');
    if (a) return { role: 'agent', agent: a.agent };
    for (const r of ['hub', 'admin', 'staff']) if (mine.some((d) => d.role === r)) return { role: r, agent: '' };
    return { role: '', agent: '' };
  } catch { return { role: '', agent: '' }; }
}

/**
 * The whole Wire it view from a snapshot (createWire().state()). s = { hasNode, store, view, checklist, role, want, name, plan,
 * pending, link, origin, os, model, agent, hub, receipt, say, verifyOut }.
 */
export function renderWire(s) {
  try { return wireHtml(s || {}); } catch { return '<p class="bad">This view could not be drawn. Reload the page.</p>'; }
}
function wireHtml(s) {
  const head = '<h2 class="sec-h">Wire it — set up a real office</h2><p class="sec-sub">The afternoon a tech person spends turning this page into a working company on the office’s own machines: the owner’s laptop, each person’s device, an always-on office hub, and an AI box with one device per agent — linked directly, each step checked against the company itself, and finished with a receipt the owner signs.</p>';
  const intro = '<div class="wr-grid"><div class="panel"><h3>What you are building</h3>' + officeSvg() + '</div><div class="panel"><h3>Before you start</h3><ul class="b-list">' +
    '<li><b>Machines:</b> the owner’s laptop; an always-on PC for the office hub; a PC for the AI agents (the AI box — it can be the hub’s machine); each person’s own laptop or phone. Chrome or Edge on each.</li>' +
    '<li><b>A printer</b> for the owner’s three recovery cards.</li>' +
    '<li><b>About ' + minutesFor(s) + ' minutes</b> of your time, by our step-by-step estimate, plus the model download if you add one.</li>' +
    '<li><b>What only a person can do:</b> print and store the recovery cards; carry each connection code between two machines once each way; decide who gets which role; keep the hub and the AI box windows open. After a machine restarts, its connection is made again by hand — this page uses no server to find other machines.</li>' +
    '<li><b>Stuck?</b> AI Native Solutions plants and supports it — start at <a href="https://www.ai-nativesolutions.com" target="_blank" rel="noopener">ai-nativesolutions.com</a>; the support terms are agreed per deployment.</li>' +
    '</ul><div class="row" style="margin-top:8px"><button class="primary" data-act="wire-print">Print the install sheet</button></div></div></div>';
  if (!s.hasNode) {
    return head + intro + '<div class="panel"><h3>No company on this device yet</h3><p>Wiring starts on the <b>owner’s laptop</b>: open <a href="#run" data-view="run">Run your own</a> and press “Found a company on this device”, then come back here.</p>' +
      '<p>On every other machine — a person’s laptop, the hub, each agent profile on the AI box — open the <b>invite link</b> the owner sends you. This tab then becomes a device of that company, and this page shows its steps.</p>' +
      (s.store ? '<p class="bad">' + esc(s.store) + '</p>' : '') + '</div>';
  }
  const c = s.checklist && s.checklist.ok ? s.checklist : null;
  const pct = c && c.required ? Math.round((100 * c.done) / c.required) : 0;
  const progress = c ? '<div class="wr-progress"><b>' + c.done + ' of ' + c.required + ' steps done</b><span class="wr-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + c.required + '" aria-valuenow="' + c.done + '" aria-label="Steps done"><i style="width:' + pct + '%"></i></span>' +
    '<span class="dim">' + (c.complete ? 'Wired. Sign the receipt again whenever a device changes.' : 'about ' + c.minutesLeft + ' minutes left (our estimate)') + '</span></div>' : '';
  const list = c ? '<ol class="wr-steps">' + c.steps.map((x) => stepHtml(x, c.next)).join('') + '</ol>' : '<p class="dim">Reading the company…</p>';
  return head + (s.say ? '<p class="flash" role="status">' + esc(s.say) + '</p>' : '') + progress +
    '<div class="wr-grid">' + devicePanel(s) + (s.view && s.view.owner || (s.role && s.role.role === 'admin') ? ownerPanel(s) : rolePanel(s)) + '</div>' +
    (s.agent ? agentPanel(s) : '') + (s.hub ? hubPanel(s) : '') +
    '<h3 class="sec-h" style="font-size:20px">The steps</h3>' + list +
    '<div class="wr-grid">' + modelPanel(s) + verifyPanel(s) + '</div>' + intro;
}
function minutesFor(s) {
  const c = s && s.checklist && s.checklist.ok ? s.checklist : null;
  if (c) return c.minutesTotal;
  const p = planOf(s && s.plan);
  return MINUTES.found + MINUTES.cards + (MINUTES.invite + MINUTES.roles) * p.people + MINUTES.hub + MINUTES.agents * p.agents.length + MINUTES.machines * (p.people + 1 + p.agents.length) + MINUTES.proof + MINUTES.same + MINUTES.receipt;
}

function devicePanel(s) {
  const v = s.view || {};
  const r = s.role || { role: '' };
  const what = r.role ? ROLE_WORDS[r.role] + (r.agent ? ' — the ' + agentName(r.agent) : '') : 'not granted yet';
  return '<div class="panel"><h3>This device</h3><p style="margin:0 0 6px">It is <b>' + esc(what) + '</b> in company <span class="mono">' + esc(short(v.genesis)) + '</span>.</p>' +
    '<div class="row"><span class="dim">Device key:</span><span class="mono" id="wire-me">' + esc(v.me) + '</span></div>' +
    '<div class="row"><span class="dim">Company mark:</span><b class="mono">' + esc(v.mark) + '</b><span class="dim">— the same on every device once they are connected and no work is moving</span></div>' +
    '<div class="row"><label class="dim" for="wire-name">Name this device (optional, shown to the owner)</label><input id="wire-name" maxlength="40" value="' + esc(s.name) + '" placeholder="e.g. Front desk laptop"><button class="sm" data-act="wire-name">Save</button></div>' +
    (s.link ? '<div class="row"><span class="dim">Invite link:</span><input readonly value="' + esc(s.link) + '" aria-label="Invite link" style="flex:1 1 260px"></div>' : '') + '</div>';
}

function rolePanel(s) {
  const r = s.role || { role: '' };
  const w = s.want || { role: '', agent: '' };
  const pick = (role, label) => '<button class="sm' + (w.role === role ? ' on' : '') + '" data-act="wire-want" data-role="' + role + '">' + esc(label) + '</button>';
  const agents = '<select id="wire-agent" aria-label="Which agent">' + AGENTS.map((a) => '<option value="' + a.id + '"' + (w.agent === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select>';
  const asked = w.role === 'agent' ? 'the ' + agentName(w.agent) : w.role === 'hub' ? 'the office hub' : w.role === 'staff' ? 'a person’s device' : '';
  return '<div class="panel"><h3>What this device will be</h3>' +
    '<div class="row">' + pick('staff', 'A person’s device') + pick('hub', 'The office hub') + '<span class="row" style="margin:0">' + agents + '<button class="sm' + (w.role === 'agent' ? ' on' : '') + '" data-act="wire-want" data-role="agent">An AI agent</button></span></div>' +
    (asked && !r.role ? '<p class="warn" style="margin:6px 0 0">Waiting for a grant. Send the owner this device’s key (above) and ask for it to be granted as <b>' + esc(asked) + '</b>. Or link this machine to the owner’s (Run your own → Connect another machine): the owner then sees it and grants it with one button.</p>' : '') +
    (r.role ? '<p class="ok" style="margin:6px 0 0">Granted as ' + esc(ROLE_WORDS[r.role] + (r.agent ? ' — the ' + agentName(r.agent) : '')) + '.</p>' : '') + '</div>';
}

function ownerPanel(s) {
  const v = s.view || { devices: [], checkins: {} };
  const owner = !!v.owner;
  const rows = (v.devices || []).map((d) => {
    const c = v.checkins[d.pub];
    const p = d.agent && s.control ? s.control[d.agent] : null;
    return '<tr><td class="mono">' + esc(short(d.pub)) + (c && c.name ? ' · ' + esc(c.name) : '') + '</td><td>' + esc(d.agent ? agentName(d.agent) : d.role === 'hub' ? 'office hub' : d.role) +
      (p && p.paused ? '<br><span class="bad">paused by ' + esc(p.by || 'a person') + (p.watch ? ': the watch read it as ' + esc(p.watch) : '') + '</span> <button class="sm" data-act="wire-clear" data-agent="' + esc(d.agent) + '">Clear — a person has checked it</button>' : '') + '</td><td>' +
      (c ? (c.mark === v.mark ? '<span class="ok">same company</span>' : '<span class="warn">shows ' + esc(c.mark) + '</span>') : '<span class="warn">not heard from</span>') + '</td></tr>';
  }).join('');
  const roleOpts = '<option value="staff">staff</option><option value="hub">office hub</option>' + AGENTS.map((a) => '<option value="agent:' + a.id + '">' + esc(a.name) + '</option>').join('') +
    (owner ? '<option value="admin">admin — can grant and revoke</option>' : '');   // staff first: the safe default
  const pend = (s.pending || []).map((p) => '<div class="item"><span class="grow"><span class="mono">' + esc(short(p.pub)) + '</span> <span class="dim">reached this device (' + esc(p.via) + ') — no grant yet</span></span>' +
    '<span class="row" style="margin:0"><select data-wire-role="' + esc(p.pub) + '" aria-label="Role for ' + esc(short(p.pub)) + '">' + roleOpts + '</select><button class="sm primary" data-act="wire-grant" data-pub="' + esc(p.pub) + '">Grant</button></span></div>').join('');
  const plan = planOf(s.plan);
  return '<div class="panel"><h3>Devices — granted by ' + (owner ? 'you, the owner' : 'you, an admin') + '</h3>' +
    (rows ? '<div class="tablewrap"><table><tr><th>Device</th><th>Role</th><th>Company it holds</th></tr>' + rows + '</table></div>' : '<p class="dim" style="margin:0">No device granted yet.</p>') +
    pend +
    '<div class="row" style="margin-top:10px"><input id="wire-key" maxlength="64" placeholder="A device key (64 characters)" aria-label="Device key to grant" style="flex:1 1 220px"><select id="wire-role" aria-label="Role">' + roleOpts + '</select><button class="primary" data-act="wire-grant">Grant</button></div>' +
    '<p class="note">Staff: tasks, chat, documents, CRM. Admin: can grant and revoke (only the owner makes admins). The hub: the door where work arrives. An agent: that agent’s own scope. Revoke in Run your own → People.</p>' +
    '<h3 style="margin-top:14px">The plan</h3><div class="row"><label class="dim" for="wire-people">People’s devices besides yours</label><input id="wire-people" type="number" min="0" max="64" value="' + plan.people + '" style="width:80px"></div>' +
    '<div class="row">' + AGENTS.map((a) => '<label class="dim"><input type="checkbox" data-plan-agent="' + a.id + '"' + (plan.agents.includes(a.id) ? ' checked' : '') + '> ' + esc(a.name) + '</label>').join(' ') + '</div>' +
    '<div class="row"><button class="sm" data-act="wire-plan">Save the plan</button></div>' +
    (owner ? '<div class="row" style="margin-top:10px">' + (v.cards ? '<span class="ok">Recovery cards marked printed' + (v.cardsMade ? ' on ' + esc(v.cardsMade) : '') + '.</span>' : '<button class="sm" data-act="wire-cards">The cards are printed and stored</button>') +
      '<button class="sm" data-act="wire-roll">Ask every device to check in</button><button class="sm primary" data-act="wire-sign">Sign the wiring receipt</button>' + (s.receipt ? '<button class="sm" data-act="wire-save">Save the receipt</button>' : '') + '</div>' +
      (s.receipt ? '<p class="note">Signed: receipt <span class="mono">' + esc(String(s.receipt.hash).slice(0, 16)) + '</span> · ' + s.receipt.devices.length + ' devices · ' + esc(s.receipt.at) + '. It is kept on the spine too.</p>' : '') : '') + '</div>';
}

function agentPanel(s) {
  const a = s.agent;
  const st = a.status;
  const name = agentName(a.id);
  const rowsHtml = st && Array.isArray(st.last) && st.last.length ? '<div class="tablewrap"><table><tr><th>Work</th><th>Decision</th><th>Whose brain</th></tr>' + st.last.map((d) =>
    '<tr><td class="mono">' + esc(d.event) + '</td><td>' + esc(d.state === 'done' ? d.action : 'held for a person') + '</td><td>' + esc(d.by === 'own' ? 'its own' : String(d.by).replace('mesh:', 'asked: ')) + (d.cross ? ' · confirmed by ' + esc(agentName(d.second)) : '') + '</td></tr>').join('') + '</table></div>' : '';
  return '<div class="panel wr-sec" id="wire-agent-panel"><h3>Run the ' + esc(name) + ' on this device</h3>' +
    '<p>This browser profile is the ' + esc(name) + '’s own device: it reads the work the hub addresses to it, screens the text, answers from its own brain, asks the other agents’ devices when it cannot, takes a second opinion from another device on money and security calls, and writes each decision signed with this device’s key. Anything no brain can confirm waits for a person. Its brains are Konomi SLM pattern libraries (Konomi architecture — Thomas Frumkin): the shipped ones for its job, re-checked on the published data before it acts. A planting can replace them with brains grown from the business’s own records — each re-checked here first (below).</p>' +
    '<div class="row">' + (a.running ? '<button data-act="wire-stop">Stop the agent</button>' : '<button class="primary" data-act="wire-run"' + (a.granted ? '' : ' disabled') + '>Start the agent</button>') +
    '<span class="dim">' + esc(a.running && st ? stateWords(st) : a.granted ? (a.why || 'Ready. It starts again by itself when this page reopens.') : 'Waiting for the owner to grant this device as the ' + name + '.') + '</span></div>' +
    (st && a.running ? '<div class="kpis"><div class="kpi"><div class="v">' + (st.decisions | 0) + '</div><div class="l">decided by this device</div></div><div class="kpi"><div class="v">' + (st.replies | 0) + '</div><div class="l">answers given to other agents</div></div>' +
      '<div class="kpi"><div class="v">' + (st.pending | 0) + '</div><div class="l">waiting on other devices’ replies</div></div><div class="kpi"><div class="v">' + esc(st.watch || '—') + '</div><div class="l">the behaviour watch reads it as</div></div></div>' +
      '<p class="note">Brains: ' + esc((st.brains || []).join(', ') || 'none') + ' · talks to: ' + esc((st.peers || []).map(agentName).join(', ') || 'no other agent yet') + ' · antibodies adopted: ' + (st.antibodies | 0) + (st.model ? ' · local model connected' : '') + '</p>' + rowsHtml : '') +
    plantedPanel(a) + '</div>';
}
/** The brains a planting signed into the company for this agent's jobs, and what this device did with each. */
function plantedPanel(a) {
  const p = a.planted;
  const own = (a.own || []).map((f) => f.name);
  const by = (r) => (r.role === 'owner' ? 'the owner' : r.role === 'admin' ? 'an admin' : r.role ? agentName(r.role) : 'no one device');
  const rows = p && p.results.length ? '<div class="tablewrap"><table><tr><th>Job</th><th>Planted by</th><th>What this device did</th></tr>' + p.results.map((r) =>
    '<tr><td>' + esc(jobOf(r.domain)) + '</td><td>' + esc(by(r)) + '</td><td>' + (r.adopted ? '<span class="ok">Adopted</span>' : '<span class="warn">Refused</span>') + ' — ' +
      esc(r.reason.replace(/^(Adopted|Refused): /, '')) + '</td></tr>').join('') + '</table></div>' +
    '<p class="note">Holding: ' + esc(Object.entries(p.kept).map(([d, k]) => jobOf(d) + ' — ' + (k === 'planted' ? 'the planted brain' : k === 'shipped' ? 'the shipped brain (it does better here)' : 'no brain: that work waits for a person')).join('; ')) + '.</p>' : '';
  return '<div class="wr-sec"><h4 style="margin:10px 0 4px">Brains planted for this agent</h4><p class="note" style="margin-top:0">When a planting signs brains grown from the business’s own records into the company, this device takes one only if the company grants its signer to plant that job — the owner, an admin, or this agent — and only if it holds up on this device’s own records, at least as well as the brain it has. It checks when it starts and on every beat.</p>' +
    (rows || '<p class="dim" style="margin:0">' + (a.running ? 'No planted brain for this agent’s jobs yet.' : 'Start the agent to load them.') + '</p>') +
    '<div class="row" style="margin-top:8px"><label class="dim" for="wire-own">This device’s own copy of the business’s records for its jobs (CSV — read here, never uploaded; kept on this device, sealed under its own key, until you replace or forget them)</label><input type="file" id="wire-own" multiple accept=".csv,text/csv" data-wire-own="1"></div>' +
    (own.length ? '<p class="note">Re-checking on: ' + esc(own.join(', ')) + (a.ownKept ? ' — kept on this device, sealed, so a restart re-checks on them too.' : '.') + ' <button class="sm" data-act="wire-own-forget">Forget these files</button></p>' : '<p class="note">Without one, it re-checks on the published data it holds — enough only when the business’s columns match it.</p>') + '</div>';
}
function stateWords(st) {
  if (st.state === 'running') return 'Working — ' + (st.pending | 0) + ' piece' + (st.pending === 1 ? '' : 's') + ' of work waiting on other devices.';
  return String(st.why || st.state);
}

function hubPanel(s) {
  return '<div class="panel wr-sec" id="wire-hub-panel"><h3>The office hub</h3><p>The hub is the door: work arrives here and is addressed to the agent whose job it is. Until the bridges connect your mail, web shop and payments, send each agent a real test case — a held-out case from the published data its brain was never grown on — and watch each agent device decide it.</p>' +
    '<div class="row"><button class="primary" data-act="wire-test"' + (s.hub.agents ? '' : ' disabled') + '>Send a test piece of work to each agent</button><span class="dim">' +
    esc(s.hub.agents ? s.hub.agents + ' agent device' + (s.hub.agents === 1 ? '' : 's') + ' granted' + (s.hub.sent ? ' · ' + s.hub.sent + ' test cases sent from here' : '') : 'No agent device is granted yet.') + '</span></div></div>';
}

function modelPanel(s) {
  const m = s.model || {};
  const os = OSES.includes(s.os) ? s.os : 'windows';
  return '<div class="panel" id="wire-model"><h3>Optional: a local model on the AI box</h3><p class="note" style="margin-top:0">The brains decide structured cases without one. A model on the AI box reads free text no brain covers, on your own machine; a model never acts alone on money or security. Commands checked against Ollama’s own documentation.</p>' +
    '<div class="row"><label class="dim" for="wire-os">This machine runs</label><select id="wire-os" data-wire-os="1">' + OSES.map((o) => '<option value="' + o + '"' + (o === os ? ' selected' : '') + '>' + OS_WORDS[o] + '</option>').join('') + '</select>' +
    '<button class="sm" data-act="wire-model">Check for a local model</button></div>' + modelStepsHtml(os, s.origin) +
    (m.checked ? '<p class="' + (m.ok ? 'ok' : 'warn') + '">' + esc(m.ok ? 'Found on this machine: ' + m.models.join(', ') + '. An agent started on this device will use ' + pickModel(m.models) + ' for work no brain covers.' : m.why || 'No local model answered on this machine.') + '</p>' : '') + '</div>';
}

function verifyPanel(s) {
  return '<div class="panel" id="wire-verify"><h3>Check a wiring receipt</h3><p class="note" style="margin-top:0">Anyone can check a receipt with nothing but the receipt: its hash, and the owner’s signature over it. Paste the saved file’s contents.</p>' +
    '<textarea id="wire-verify-in" rows="3" spellcheck="false" class="mono" aria-label="A wiring receipt"></textarea><div class="row" style="margin-top:6px"><button class="sm" data-act="wire-verify">Check it</button></div>' +
    (s.verifyOut ? '<p class="note" role="status">' + esc(s.verifyOut) + '</p>' : '') + '</div>';
}

/** The latest roll call on the spine ('' if none): when it changes, every device checks in again. */
export function rollCall(node) {
  try { const r = node.list('wire').find((x) => x.id === 'rollcall'); return r && typeof r.at === 'string' ? r.at : ''; } catch { return ''; }
}

/** The model an agent device uses from what Ollama lists: the page’s default if it is there, else the first. */
export function pickModel(models) {
  try { return models.includes(LOCAL_MODEL) ? LOCAL_MODEL : String(models[0] || LOCAL_MODEL); } catch { return LOCAL_MODEL; }
}

/** The printable one-page install sheet. */
export function installSheetHtml(s) {
  try {
    const x = s || {};
    const v = x.view || {};
    const c = x.checklist && x.checklist.ok ? x.checklist : null;
    const os = OSES.includes(x.os) ? x.os : 'windows';
    const plan = planOf(x.plan);
    const steps = c ? c.steps : [];
    return '<h2>Sovereign Enterprise — install sheet</h2><p>Company <b>' + esc(v.genesis ? short(v.genesis) : '(found it first, on the owner’s laptop)') + '</b>' + (v.mark ? ' · company mark when printed: <b>' + esc(v.mark) + '</b>' : '') +
      ' · planned: ' + plan.people + ' person' + (plan.people === 1 ? '' : 's') + '’ device' + (plan.people === 1 ? '' : 's') + ', the hub, ' + plan.agents.map(agentName).join(', ') + '.</p>' +
      (x.link ? '<p>Invite link: <span class="wr-cmd">' + esc(x.link) + '</span></p>' : '') +
      '<h3>What you need</h3><p>The owner’s laptop · an always-on PC for the office hub · a PC for the AI agents (it can be the hub’s) · each person’s laptop or phone · Chrome or Edge on each · a printer. About ' + minutesFor(x) + ' minutes by our estimate.</p>' +
      '<h3>Steps</h3><table><tr><th>✓</th><th>#</th><th>Step</th><th>Who</th><th>How</th></tr>' +
      (steps.length ? steps : FALLBACK).map((st) => '<tr><td>' + (st.status === 'done' ? '✓' : '☐') + '</td><td>' + st.n + '</td><td>' + esc(st.title) + (st.optional ? ' (optional)' : '') + '</td><td>' + esc(st.who) + '</td><td>' + esc(st.how.filter((h) => !/^Invite link/.test(h)).join(' ')) + '</td></tr>').join('') + '</table>' +
      '<h3>The local model on the AI box (' + OS_WORDS[os] + ')</h3>' + modelStepsHtml(os, x.origin) +
      '<h3>Done means</h3><p>Every step ticked; every device shows the same company mark when no work is moving; each agent decided a test case on its own device; the owner signed the wiring receipt and saved it.</p>' +
      '<h3>What still needs a person</h3><p>Printing and storing the recovery cards; carrying each connection code between two machines; deciding roles; keeping the hub and AI box windows open; reconnecting a machine by hand after it restarts.</p>';
  } catch { return '<p>The install sheet could not be made.</p>'; }
}
const FALLBACK = [
  ['found', 'Found the company on the owner’s device', 'the owner', 'Run your own → Found a company on this device.'],
  ['cards', 'Print the owner’s recovery cards and store them apart', 'the owner', 'Print recovery cards; keep each in a different place.'],
  ['invite', 'Invite each person’s device', 'you, then each person', 'Send the invite link; they open it and send back their device key.'],
  ['roles', 'Grant each person’s device its role', 'the owner', 'Wire it → Devices: paste the key, pick the role, Grant.'],
  ['hub', 'Stand up the office hub', 'you', 'Open the invite link on the always-on PC, choose The office hub; the owner grants it.'],
  ['agents', 'Stand up each AI agent device', 'you, then the owner', 'One browser profile per agent on the AI box; open the invite link, pick the agent; the owner grants it.'],
  ['machines', 'Connect the machines to each other', 'you', 'Run your own → Connect another machine: carry the code and the reply by hand.'],
  ['model', 'Optional: a language model on the AI box', 'you', 'See the commands below.'],
  ['proof', 'Send each agent a test piece of work', 'you, at the hub', 'On the hub: Send a test piece of work to each agent.'],
  ['same', 'Every device shows the same company', 'you', 'Every Wire it screen shows the same company mark.'],
  ['receipt', 'Sign the wiring receipt', 'the owner', 'Sign the wiring receipt, then Save the receipt.'],
].map(([id, title, who, how], i) => ({ id, n: i + 1, title, who, how: [how], status: 'todo', optional: id === 'model' }));

// ── the data an agent device checks its brains on, and the door's held-out cases (the same split runtime.boot makes) ──
/** brains/index.json + the brain files + the published samples → what stockBrains and testWork need. */
export async function loadBrains(fetchJson) {
  const index = await fetchJson('brains/index.json');
  const factory = {}, features = {}, titles = {}, own = {}, door = {};
  for (const [d, m] of Object.entries(index)) {
    factory[d] = await fetchJson('brains/' + m.file);
    features[d] = factory[d].features;
    titles[d] = m.title;
    if (m.sample) {
      const rows = shopperRows(await fetchJson('brains/' + m.sample));
      own[d] = rows.filter((_, i) => i % 2 === 0);              // the company's own history: what a brain is re-checked on
      door[d] = rows.filter((_, i) => i % 2 === 1);             // the live door: cases no brain was grown or checked on
    }
  }
  const synth = new Map();
  const rows = (id, d, n = 600) => {
    if (own[d]) return own[d];
    const k = id + '/' + d;
    if (!synth.has(k)) synth.set(k, sample(d, seedFor(id, d), n).rows);
    return synth.get(k);
  };
  const pools = {};
  for (const d of Object.keys(index)) pools[d] = door[d] || sample(d, 900001 + d.length * 7919, 400).rows;
  return { index, factory, features, titles, rows, pools };
}

/**
 * The Wire it controller. env = { node(), keys(), store: { get(k), set(k, v) }, fetchJson(url), peers() → [{ pub, via }], link(),
 * origin, os, now(), print(html), download(name, text), render(), probeModel() → Promise<{ ok, models, why }> }.
 * → { state(), act(name, el, read), start(), stop(), beat() }
 */
export function createWire(env) {
  const E = env || {};
  const get = (k) => { try { return E.store.get(k); } catch { return null; } };
  const set = (k, v) => { try { E.store.set(k, v); } catch { /* storage blocked: this tab only */ } };
  const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const now = () => { try { return Number(E.now()) || Date.now(); } catch { return Date.now(); } };
  const ui = { want: { role: '', agent: '' }, name: '', plan: planOf(null), prefsFor: null,
    os: OSES.includes(E.os) ? E.os : 'windows', model: { checked: false, ok: false, models: [], why: '' }, say: '', verifyOut: '', receipt: null, sent: 0,
    shell: null, status: null, running: false, starting: false, why: '', brains: null, answered: null, watchedAt: -Infinity, timer: null, log: [],
    planted: null, judged: new Set(), own: [], lib: {}, shellOpts: null };
  /** This device's own choices, kept per device (the page's storage is per device): read once the device is known. */
  const node = () => {
    let n = null;
    try { n = E.node() || null; } catch { n = null; }
    const who = n ? n.pub : '';
    if (ui.prefsFor !== who) {
      ui.prefsFor = who;
      ui.want = parse(get('se.wire.want')) || { role: '', agent: '' };
      ui.name = get('se.wire.name') || '';
      ui.plan = planOf(parse(get('se.wire.plan')));
      ui.answered = null;
    }
    return n;
  };
  const paint = () => { try { E.render(); } catch { /* the page is not drawing this view */ } };

  function state() {
    const n = node();
    if (!n) return { hasNode: false, plan: ui.plan, os: ui.os, origin: E.origin, link: '', store: '' };
    const view = wiringView(n);
    const members = new Set([view.genesis, ...view.devices.map((d) => d.pub)]);
    let peers = [];
    try { peers = E.peers().filter((p) => p && HEX64.test(p.pub) && !members.has(p.pub)); } catch { peers = []; }
    const seen = new Set();
    const pending = peers.filter((p) => !seen.has(p.pub) && seen.add(p.pub));
    let link = '';
    try { link = E.link(); } catch { link = ''; }
    const checklist = wiringChecklist({ view, probes: { plan: ui.plan, pending: pending.length, model: ui.model, os: ui.os, origin: E.origin, link } });
    const role = deviceRole(view);
    const wantAgent = ui.want.role === 'agent' && AGENTS.some((a) => a.id === ui.want.agent) ? ui.want.agent : role.role === 'agent' ? role.agent : '';
    const granted = !!wantAgent && agentRoster(n).some((g) => g.agent === wantAgent && g.pub === n.pub);
    const agent = wantAgent ? { id: wantAgent, granted, running: ui.running, status: ui.status, why: ui.starting ? 'Loading its brains and checking them on the published data…' : ui.why, planted: ui.planted, own: ui.own, ownKept: !!ui.ownKept } : null;
    const hub = role.role === 'hub' || view.devices.some((d) => d.pub === view.me && d.role === 'hub') ? { agents: new Set(agentRoster(n).map((g) => g.agent)).size, sent: ui.sent } : null;
    const control = {};
    for (const r of n.list('control')) control[r.id] = { paused: !!r.paused, by: typeof r.by === 'string' ? r.by : '', watch: typeof r.watch === 'string' ? r.watch : '' };
    return { hasNode: true, view, checklist, role, want: ui.want, name: ui.name, plan: ui.plan, pending, link, origin: E.origin, os: ui.os, model: ui.model, agent, hub, control,
      receipt: ui.receipt, say: ui.say, verifyOut: ui.verifyOut };
  }

  async function startAgent() {
    const n = node();
    const s = state();
    if (!n || !s.agent || !s.agent.granted || ui.running || ui.starting) return;
    const a = AGENTS.find((x) => x.id === s.agent.id);
    ui.starting = true; paint();
    try {
      if (!ui.brains) ui.brains = await loadBrains(E.fetchJson);
      await keptFiles();   // a restarted AI box re-checks on the business's files it kept, not only the published data
      const B = ui.brains;
      // planted brains first — read BEFORE this device publishes anything, so its shipped publish never writes over a planted
      // record (src/sow.mjs): a job with a planted brain from a key that may plant it holds what the judgement gives
      const j = judgePlanted({ node: n, agentId: a.id, rows: (d) => ownRows(n, a.id, d), shipped: B.factory });
      const r = await stockBrains({ node: n, agent: { ...a, domains: a.domains.filter((d) => !j.held.includes(d)) }, factory: B.factory, features: B.features, titles: B.titles, rows: (d, k) => B.rows(a.id, d, k), log: (x) => ui.log.push(x) });
      await recordPlanted(n, a.id, j);
      ui.planted = j;
      ui.judged = new Set(plantedFor(n, a.id).map(plantKey));
      const model = ui.model.ok ? { adapter: ollama({ model: pickModel(ui.model.models) }), budget: 0 } : null;
      ui.shellOpts = { node: n, agentId: a.id, localRows: (d) => B.rows(a.id, d, 600), model, log: (x) => ui.log.push(x) };
      ui.lib = { ...r.lib, ...j.library };
      ui.shell = createAgentShell({ ...ui.shellOpts, library: ui.lib });
      ui.running = true;
      ui.why = '';
      set('se.wire.auto', a.id);
      ui.status = await ui.shell.tick();
    } catch (e) {
      ui.why = 'It could not start: ' + String((e && e.message) || e).slice(0, 160);
    } finally { ui.starting = false; paint(); }
  }

  /** This device's own rows for a job: the business's file it was given, read by a planting's job record — else the published data. */
  function ownRows(n, agentId, d) {
    for (const f of ui.own) for (const r of n.list('plan')) {
      if (r.kind !== 'job' || r.domain !== d) continue;
      const x = rowsFor(r, f.text);
      if (x.ok) return x.rows;
    }
    return ui.brains.rows(agentId, d, 600);
  }
  /** Judge the planted brains again (a new planting, or the business's own file given) and run on with what it gives. */
  async function replant(n) {
    const id = ui.shellOpts.agentId;
    const j = judgePlanted({ node: n, agentId: id, rows: (d) => ownRows(n, id, d), shipped: ui.brains.factory });
    await recordPlanted(n, id, j);
    ui.planted = j;
    ui.judged = new Set(plantedFor(n, id).map(plantKey));
    // a job no longer held by a planting it may trust (a record another device wrote over) keeps the brain it already had
    ui.lib = { ...Object.fromEntries(Object.entries(ui.lib).filter(([d]) => !j.held.includes(d))), ...j.library };
    ui.shell = createAgentShell({ ...ui.shellOpts, library: ui.lib });   // it picks up from the spine, as after a restart
  }
  const cleanFiles = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f.text === 'string' && f.text.length <= 8 * 1024 * 1024).slice(0, 8).map((f) => ({ name: String(f.name || 'a file').slice(0, 80) || 'a file', text: f.text }));
  /** The business's own files for this device's jobs — kept at rest on this device (env.files: the key store, sealed under
   *  the device's own key) so a restart re-checks on them too. A new set replaces the old; an empty one forgets them. */
  async function ownFiles(list) {
    ui.own = cleanFiles(list);
    let kept = false;
    try { kept = !!(E.files && (await E.files.keep(ui.own)).ok); } catch { kept = false; }
    ui.ownKept = kept && ui.own.length > 0;
    const n = node();
    if (n && ui.running && ui.shell) await replant(n);
    ui.say = ui.own.length ? 'This device re-checks its planted brains on ' + ui.own.map((f) => f.name).join(', ') + (kept ? ' — kept on this device, sealed, so a restart re-checks on them too.' : ' — until this page closes.')
      : kept ? 'Forgotten: this device keeps none of the business’s files.' : '';
    paint();
  }
  /** On start: the files this device kept at rest, if none were given since the page opened. */
  async function keptFiles() {
    if (ui.own.length || !E.files) return;
    try { ui.own = cleanFiles(await E.files.load()); ui.ownKept = ui.own.length > 0; } catch { /* nothing kept, or unreadable: the published data stands in */ }
  }

  async function beat() {
    const n = node();
    if (!n) return;
    if (ui.running && ui.shell) {
      if (plantedFor(n, ui.shellOpts.agentId).some((e) => !ui.judged.has(plantKey(e)))) await replant(n);   // a planting arrived: judge it, then carry on with what it gives
      ui.status = await ui.shell.tick();
    }
    else if (!ui.starting && get('se.wire.auto') && ui.want.role === 'agent' && get('se.wire.auto') === ui.want.agent) await startAgent();   // an AI box restarts its agent by itself
    // a device checks in once when it starts, when its name changes, and whenever someone calls the roll — never on a timer, so a
    // running company is not filled with check-ins; checkIn writes only if what it would say has changed
    // the behaviour watch (src/watch.mjs — Behavioral Entropy Signatures, Gary W. Floyd, Lumiea Systems Research Division —
    // ThunderStruck Service, LLC): on a device that may pause agents, an agent that stops behaving like itself is paused
    // until a person clears it — the same pass the behaviour watch (automatic) runs in the demo (shell.mjs oversee)
    if (n.canWrite(null) && now() - ui.watchedAt >= WATCH_MS) {
      ui.watchedAt = now();
      const paused = await oversee({ node: n, agents: [...new Set(agentRoster(n).map((g) => g.agent))], by: 'the behaviour watch', log: (x) => ui.log.push(x) });
      if (paused.length) ui.say = 'The behaviour watch paused the ' + paused.map(agentName).join(', the ') + ': it stopped behaving like itself. Check its decisions, then clear it in Devices.';
    }
    if (n.canWrite('wire')) {
      const roll = rollCall(n);
      if (ui.answered !== roll) {
        ui.answered = roll;
        const r = deviceRole(wiringView(n));
        await checkIn(n, { role: r.role, agent: r.agent, name: ui.name, at: new Date(now()).toISOString() });
      }
    }
  }

  const val = (read, id) => { try { return String(read(id) ?? '').trim(); } catch { return ''; } };
  /** One action from the page. read(id) gives an input's value; el is the clicked element (its dataset). */
  async function act(name, el, read = () => '') {
    const n = node();
    const d = (el && el.dataset) || {};
    ui.say = '';
    try {
      if (name === 'wire-print') { E.print(installSheetHtml(state())); return; }
      if (name === 'wire-want') {
        ui.want = { role: d.role === 'agent' || d.role === 'hub' || d.role === 'staff' ? d.role : '', agent: d.role === 'agent' ? val(read, 'wire-agent') : '' };
        set('se.wire.want', JSON.stringify(ui.want));
        ui.say = ui.want.role ? 'This device will be ' + (ui.want.role === 'agent' ? 'the ' + agentName(ui.want.agent) : ui.want.role === 'hub' ? 'the office hub' : 'a person’s device') + '. Send its key to the owner.' : '';
      } else if (name === 'wire-name') {
        ui.name = val(read, 'wire-name').slice(0, 40);
        set('se.wire.name', ui.name);
        ui.answered = null;
        ui.say = 'Saved. The owner sees this name beside the device once it checks in.';
      } else if (name === 'wire-plan') {
        const people = Number(val(read, 'wire-people'));
        const agents = AGENTS.map((a) => a.id).filter((id) => read('plan:' + id) === true);
        ui.plan = planOf({ people: Number.isSafeInteger(people) ? people : ui.plan.people, agents });
        set('se.wire.plan', JSON.stringify(ui.plan));
        ui.say = 'Plan saved: ' + ui.plan.people + ' people’s devices and ' + ui.plan.agents.length + ' agents.';
      } else if (name === 'wire-own-forget') {
        await ownFiles([]);
        return;
      } else if (name === 'wire-os') {
        ui.os = OSES.includes(val(read, 'wire-os')) ? val(read, 'wire-os') : ui.os;
      } else if (name === 'wire-model') {
        const m = await E.probeModel();
        ui.model = { checked: true, ok: !!(m && m.ok && Array.isArray(m.models) && m.models.length), models: m && Array.isArray(m.models) ? m.models.map(String).slice(0, 12) : [], why: m && m.why ? String(m.why) : '' };
      } else if (name === 'wire-verify') {
        const r = await verifyWiringReceipt(parse(val(read, 'wire-verify-in')));
        ui.verifyOut = r.ok ? 'Genuine: signed by the owner of company ' + short(r.company) + ' at ' + r.at + ' — ' + r.devices + ' devices, ' + r.same + ' showing the same company.'
          : 'Not genuine: ' + ({ hash: 'it was changed after it was signed', signature: 'the owner’s signature does not match it', 'not-owner': 'it was not signed by the company’s owner', model: 'it is not a wiring receipt', fault: 'it is not a wiring receipt' }[r.reason] || r.reason) + '.';
      } else if (!n) {
        ui.say = 'There is no company on this device yet.';
      } else if (name === 'wire-grant') {
        const pub = (d.pub || val(read, 'wire-key')).toLowerCase();
        const pick = d.pub ? val(read, 'role:' + d.pub) : val(read, 'wire-role');
        const [role, agent] = pick.startsWith('agent:') ? ['agent', pick.slice(6)] : [pick, ''];
        if (!n.canWrite(null)) { ui.say = 'Only the owner or an admin can grant a device.'; return; }
        const g = grantFor(wiringView(n), { role, agent, pub });
        if (!g.ok) { ui.say = 'Not granted: ' + ({ key: 'that is not a device key (64 characters, 0–9 and a–f)', owner: 'that is the owner’s own key', already: 'that device already holds that role', 'only-the-owner': 'only the owner makes admins', agent: 'pick an agent', role: 'pick a role' }[g.reason] || g.reason) + '.'; return; }
        const r = await n.grant(g.id, g.to, g.role, g.cols);
        ui.say = r.ok ? 'Granted ' + short(g.to) + ' as ' + (g.role === 'agent' ? 'the ' + agentName(agent) : g.role) + '. It can write as soon as this grant reaches it.' : 'The grant was refused: ' + r.reason + '.';
      } else if (name === 'wire-clear') {
        const id = AGENTS.some((a) => a.id === d.agent) ? d.agent : '';
        if (!id || !n.canWrite(null)) { ui.say = 'Only the owner or an admin clears a paused agent.'; return; }
        const last = n.list('decisions').filter((x) => x.agent === id).map((x) => x.id).sort().pop() || '';
        const r = await n.put('control', id, { paused: false, cleared: last, rebaseline: false, watch: '', by: n.pub === n.genesis ? 'Owner' : 'Admin' });
        ui.say = r.ok ? 'Cleared: the ' + agentName(id) + ' works again, and the watch judges it afresh from its next decision.' : 'Not cleared (' + r.reason + ').';
      } else if (name === 'wire-roll') {
        const r = await n.put('wire', 'rollcall', { kind: 'rollcall', at: new Date(now()).toISOString() });
        ui.say = r.ok ? 'Asked every device to check in. Each answers within a few seconds of the request reaching it.' : 'This device cannot call the roll (' + r.reason + ').';
      } else if (name === 'wire-cards') {
        const r = await n.put('wire', 'cards', { kind: 'cards', made: new Date(now()).toISOString().slice(0, 10) });
        ui.say = r.ok ? 'Marked: the owner’s recovery cards are printed and stored.' : 'Only the owner can mark the cards (' + r.reason + ').';
      } else if (name === 'wire-sign') {
        const view = wiringView(n);
        const checklist = wiringChecklist({ view, probes: { plan: ui.plan, model: ui.model, os: ui.os, origin: E.origin } });
        const r = await wiringReceipt({ view, checklist, keys: E.keys(), at: new Date(now()).toISOString() });
        if (!r.ok) { ui.say = r.reason === 'not-owner' ? 'Only the owner’s device signs the wiring receipt.' : 'The receipt could not be signed (' + r.reason + ').'; return; }
        const rec = receiptRecord(r.receipt);
        await n.put('wire', rec.id, rec.f);
        ui.receipt = r.receipt;
        ui.say = 'Signed by the owner’s key: ' + r.receipt.devices.length + ' devices, ' + rec.f.same + ' showing this company. Save it and keep it with the recovery cards’ record.';
      } else if (name === 'wire-save') {
        if (ui.receipt) E.download('wiring-receipt-' + ui.receipt.hash.slice(0, 16) + '.json', JSON.stringify(ui.receipt, null, 1));
      } else if (name === 'wire-run') {
        await startAgent();
      } else if (name === 'wire-stop') {
        ui.running = false; ui.shell = null; ui.status = null;
        set('se.wire.auto', '');
        ui.why = 'Stopped on this device. Work addressed to it waits; start it again to carry on.';
      } else if (name === 'wire-test') {
        if (!ui.brains) ui.brains = await loadBrains(E.fetchJson);
        const agents = [...new Set(agentRoster(n).map((g) => g.agent))];
        const base = 100000000 + (Math.floor(now() / 1000) % 89999999) * 10;
        const work = testWork({ agents, pools: ui.brains.pools, seed: Math.floor(now()) % 2147483647, base });
        let sent = 0;
        for (const w of work) if ((await n.put('inbox', w.id, w.f)).ok) sent++;
        ui.sent += sent;
        ui.say = sent ? 'Sent ' + sent + ' test case' + (sent === 1 ? '' : 's') + ': ' + work.map((w) => w.id + ' → ' + agentName(w.f.to)).join(', ') + '. Each agent device decides its own within a minute.' : 'Nothing was sent — this device is not granted as the hub.';
      }
    } catch (e) {
      ui.say = 'That did not work: ' + String((e && e.message) || e).slice(0, 160);
    } finally { paint(); }
  }

  return {
    state, act, beat, startAgent, ownFiles,
    start() { if (!ui.timer) ui.timer = setInterval(() => { beat().catch(() => {}).finally(paint); }, TICK_MS); },
    stop() { if (ui.timer) { clearInterval(ui.timer); ui.timer = null; } },
    get running() { return ui.running; },
    log: () => ui.log.slice(-50),
  };
}
