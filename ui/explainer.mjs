// ui/explainer.mjs — the page explains itself. The diagrams, the traced decision, the blueprint, the adoption guide and
// "fit it to your business" are the explainer kernel's (src/explain.mjs + src/adopt.mjs — gated); this file adds the
// page's own guidance (per-tab help, start-here steps, the guided tour) and the rival + cloud numbers on the visitor's
// own headcount (src/market.mjs). Every number comes from a kernel, never typed here.
import * as X from '../src/explain.mjs';
import { fitInput, fitPlan, formFields } from '../src/adopt.mjs';
import { gbp0, gbpM } from '../src/office.mjs';
import { cloudCompare, undercut } from '../src/market.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';

export const EXPLAIN_CSS = X.EXPLAIN_CSS;

/** One line under each tab of the live company: what you're looking at, and what to try. */
export const TAB_HELP = {
  Board: { demo: '<b>The board.</b> What the company has done and how often it was right — every agent decision is scored against the real outcome, which the agent never saw when it decided. Click any device card above to see the company from that device. At the bottom: connect a language model for free text — reading what customers write, routing it, drafting replies.' },
  Agents: { demo: '<b>Every decision, live.</b> Each line is a signed record: which agent decided, what it did, whose brain answered, who confirmed it, and its receipt. Press <b>Trace</b> on any line to see that exact decision traced step by step.' },
  Watch: { demo: '<b>The people\'s list.</b> Anything no brain could confirm waits here. Select the <b>AI overseer</b> device in the bar above to clear an item — the agent then carries out your choice. You can pause any agent here. Below: <b>the immune system</b> — send a new kind of attack, confirm it once, and watch every agent become immune — and <b>the behaviour watch</b>, which pauses an agent that stops behaving like itself.' },
  Brains: { demo: '<b>The brains.</b> Who answered, taught and confirmed whom — over signed records, never shared memory. Select an agent device to read its brain rule by rule and the data it was grown on. Try <b>Poison a brain</b> and watch every device refuse it.' },
  Tasks: { demo: '<b>Tasks the agents created</b> — retention offers sent, restocks raised, machines booked for service. Select a person\'s device to add your own.', run: '<b>Your company\'s tasks.</b> Add one; every device that joins sees it.' },
  Chat: { demo: '<b>The company channel.</b> Agents post what matters — a payment held, an intrusion quarantined, a brain regrown. People can post too.', run: '<b>Your company channel.</b> Messages are signed by your device and sync to every teammate.' },
  CRM: { demo: '<b>The sales pipeline.</b> The Sales agent fast-tracks likely buyers into Qualified; people take the relationship from there.', run: '<b>Your pipeline.</b> Add a lead; advance it as it moves.' },
  Docs: { demo: '<b>A live shared document.</b> Edit it on two devices — even with the network split — and both edits survive, in one order, everywhere.', run: '<b>A shared document.</b> Every teammate edits the same text live.' },
  Books: { demo: '<b>Double-entry books kept by the Finance agent.</b> Every card sale and purchase order is posted; anything that doesn\'t balance is refused.', run: '<b>Your books.</b> Debits must equal credits or the entry is refused.' },
  Vault: { demo: '<b>The one true record.</b> Every posting is sealed into an append-only log that an outside auditor can check without trusting you; the Audit agent co-signs it.', run: '<b>Your vault.</b> Postings sealed into a log anyone can verify.' },
  People: { demo: '<b>Who may do what.</b> Owner → AI overseer → each agent\'s scoped grant. <b>Fire</b> an agent and every device refuses its writes from that moment; its data locks itself.', run: '<b>Your people.</b> Grant a teammate by their device key; revoke at any time.' },
  Proof: { demo: '<b>Under the hood.</b> This device\'s copy of the company, every forged or malformed write the gate refused, every forked slot and which write was kept, the hostile-network simulation, and a re-check of an AI receipt.', run: '<b>Under the hood.</b> Your replica and the gate\'s refusals.' },
};

/** Start here (overview) — each step runnable with "Show me". */
export const START_STEPS = [
  { id: 'watch', title: 'Watch the company work', text: 'The Board shows what the agents decided and how often they were right against the real outcome.', go: 'live', tab: 'Board' },
  { id: 'feed', title: 'Read any decision', text: 'On Agents, press Trace on a line to see that exact decision traced step by step through the company.', go: 'live', tab: 'Agents' },
  { id: 'brains', title: 'See the brains talk', text: 'On Brains, the map shows who answered, taught and confirmed whom — every message a signed record.', go: 'live', tab: 'Brains' },
  { id: 'attack', title: 'Attack it', text: 'Send a hostile customer message and watch it quarantined unread; poison a brain and watch every device refuse it.', go: 'live', tab: 'Watch', then: 'hostile' },
  { id: 'steal', title: 'Steal an agent’s key', text: 'A thief with a valid key and grant starts deciding the Ops agent’s work. The behaviour watch sees it is not behaving like itself and the AI overseer pauses it; a person clears it.', go: 'live', tab: 'Watch', then: 'steal' },
  { id: 'immune', title: 'Make it immune', text: 'Send a new kind of attack that gets past the screen, confirm it once as the overseer, and watch every agent re-check it and become immune — while a mistaken confirmation is refused by all of them.', go: 'live', tab: 'Watch', then: 'immune' },
  { id: 'model', title: 'Connect a language model', text: 'On the Board, connect a model — on your own machine, in the browser, or with your own key — and write to the company as a customer: it routes the message and drafts a reply a person sends.', go: 'live', tab: 'Board', then: 'model-tier' },
  { id: 'overseer', title: 'Be the overseer', text: 'Select the AI overseer device and clear a held call — the agent carries out your choice. Pause or fire any agent.', go: 'live', tab: 'Watch', device: 'overseer' },
  { id: 'split', title: 'Cut the network', text: 'Split the network or take devices offline: work carries on, and every device converges again when it heals.', go: 'live', tab: 'Board', then: 'splitnet' },
  { id: 'fit', title: 'Put in your own numbers', text: 'Enter your headcount and revenue: the five-year saving, the cloud comparison and the rival that could undercut you, on your figures.', go: 'business' },
  { id: 'case', title: 'Take it to your board', text: 'The full case — the saving, the cloud, the rival, security and regulation, the roll-out — printable as a PDF.', go: 'case' },
  { id: 'own', title: 'Run your own', text: 'Turn this browser into a device in your own company, invite your team, and connect another machine directly over WebRTC — no server in the path.', go: 'run' },
];

/** The guided tour: view, tab, device, what to highlight, what to say. */
export const TOUR = [
  { view: 'overview', target: '#ov-live', title: 'This is a whole company, running', text: 'Nine devices — six AI agents, two people and the office hub — running the real code, right here in your browser. These numbers are live.' },
  { view: 'live', tab: 'Board', target: '#devices', title: 'Every card is a separate device', text: 'Each has its own key and its own copy of the company. Take one offline and it keeps working; bring it back and it catches up.' },
  { view: 'live', tab: 'Board', target: '#app .kpis', title: 'The board', text: 'What got done, how often it was right against the real outcome, and what is waiting for a person.' },
  { view: 'live', tab: 'Agents', target: '#app .feed', title: 'Every decision, explained', text: 'Each line is a signed decision with its receipt. Press Trace on any line to trace it step by step.' },
  { view: 'live', tab: 'Brains', target: '#app .myc', title: 'Brains that talk to each other', text: 'An agent that can\'t answer asks the others over the network; asked the same thing again and again, it learns. A poisoned brain is refused by every device that tests it.' },
  { view: 'live', tab: 'Watch', target: '#immune', title: 'An attack caught once is refused everywhere', text: 'A new kind of attack gets past the screen once. Confirm it, and it becomes a signed antibody every agent re-checks on its own genuine messages before adopting it — a mistaken one is refused by all of them.' },
  { view: 'live', tab: 'Watch', device: 'overseer', target: '#app', title: 'You are the overseer', text: 'Calls no brain could confirm wait here. Choose an action and the agent carries it out. Pause or fire any agent in one click.' },
  { view: 'how', target: '#v-how', title: 'How it works', text: 'Every step as diagrams — and a real decision this company just made, traced through them.' },
  { view: 'business', target: '#v-business', title: 'On your own numbers', text: 'Put in your headcount, revenue and margin: the saving, the cloud comparison and the rival are recomputed by the same kernels.' },
  { view: 'case', target: '#brochure-doc', title: 'The case for your board', text: 'The saving, the comparison with renting from the cloud, the AI-native rival, security and regulation, the roll-out. Print it for your board.' },
];

const fig = (fn, caption) => X.figureHtml(fn({}), fn({ narrow: true }), caption);

/** The whole company at a glance (overview). */
export function renderBigPicture() { return fig(X.bigPicture, ''); }

/** Start here + try it + what each tab shows (the live company's guide panel). */
export function renderStart() { return X.startHtml(); }

/** How it works — a real decision traced first, then the six diagrams. */
export function renderHow({ co, trace } = {}) {
  let rec = null, led = null;
  if (co) {
    const decisions = co.nodes.owner.list('decisions');
    rec = trace ? decisions.find((r) => r.event === trace) : null;
    if (!rec) rec = [...decisions].reverse().find((r) => r.by && r.by.startsWith('mesh:') && r.cross) || [...decisions].reverse().find((r) => r.cross) || decisions[decisions.length - 1] || null;
    led = rec ? co.byEvent.get(rec.event) : null;
  }
  return `<h2 class="sec-h">How it works</h2>
    <p class="sec-sub">${trace ? 'The decision you chose, traced step by step — then every part of the system as a diagram.' : 'A real decision this company just made, traced step by step (press Trace on any line in the live company to trace that one instead) — then every part of the system as a diagram.'}</p>
    ${rec ? X.traceHtml(rec, led) : '<p class="dim">The company is starting up — a decision will be traced here in a moment.</p>'}
    ${X.guideHtml({ pattern: co && co.factory && co.factory.shopper })}`;
}

/** The blueprint — every organ, how it connects, how it is proven. */
export function renderBlueprint() { return X.blueprintHtml(); }

/** For your business: the adoption guide by business type, then your numbers — the saving, the move, the cloud, the rival.
 *  ctx = the page's figures; biz = the visitor's business (pairs, revenue, margin); bs = the page's bizState() of it. */
export function renderBusiness(ctx, biz = {}, bs = null) {
  if (!ctx) return '<p class="dim">Loading the figures…</p>';
  const pairs = biz && Array.isArray(biz.pairs) ? biz.pairs : undefined;
  return X.adoptionHtml() + X.fitHtml(ctx.office, ctx.basis, pairs, { measured: bs ? bs.measured : undefined }) + `<div class="panel xp-sec" id="biz-rival">${rivalHtml(bs, biz)}</div>`;
}

/** The rival and the cloud, on the visitor's own business (bs = bizState(): the fit plan, the rival, the cloud). */
export function rivalHtml(bs, biz = {}) {
  const p = bs && bs.fit && bs.fit.ok ? bs.fit.plan : null;
  const rival = bs && bs.rival, cloud = bs && bs.cloud;
  return `<h3>The rival you haven't met yet — on your numbers</h3>
    <p>An AI-native company — a competitor, or ${p ? p.sovereign.headcount - (p.sovereign.kept || 0) : 'a few'} of your own people who leave to start one — runs a business like yours on the AI-native cost base.</p>
    <div class="b-calc">
      <label>Annual revenue (£) <input inputmode="numeric" data-biz="revenue" value="${esc(String(biz.revenue ?? ''))}" placeholder="e.g. 6m or 6,000,000" aria-label="Annual revenue in pounds"></label>
      <label>Operating margin % <input inputmode="decimal" data-biz="margin" value="${esc(String(biz.margin ?? ''))}" aria-label="Operating margin percent"></label>
    </div>
    ${!p ? '<p class="warn">Fix the business above first.</p>'
      : !rival ? '<p class="warn">Enter your revenue (e.g. 6m or 6,000,000) and a margin between −99% and 99%.</p>'
      : rival.mismatch ? `<p class="warn">Your revenue and margin mean costs of ${gbp0(rival.costBase)} a year, but the business above costs ${gbp0(rival.modelledYear)} a year to run today — one of them isn’t your business. Check the headcount and costs above, or the revenue here.</p>`
      : `<div class="b-stats">
      <div><b>${gbp0(rival.gapYear)}</b><span>a year lower costs than yours, doing the same work</span></div>
      <div><b>${pct(rival.priceCut, 1)}</b><span>it can cut its prices by — and still make the profit you make</span></div>
      <div><b>${pct(rival.sameMarginCut, 1)}</b><span>it can cut them by — and still keep your ${pct(rival.yourMargin, 1)} margin</span></div>
      <div><b>${gbp0(rival.startupCost)}</b><span>what it costs to start: the machines plus the roll-out — nobody to make redundant</span></div>
    </div>`}
    ${cloud ? `<h3>Against the cloud, on your numbers</h3><p>Owning the AI boxes your work needs costs <b>${gbp0(cloud.owned)}</b> over five years.
      Renting the smallest AWS London GPU that holds the same model class only while the office is open costs <b>${gbp0(cloud.officeHours)}</b>
      (${(Math.round(cloud.officeHoursTimes * 10) / 10)}× more); kept on around the clock, ${gbp0(cloud.alwaysOn)}.
      Paying per token on Amazon Bedrock in London would be ${gbp0(cloud.perToken)} — cheaper on raw compute, but every call sends your data out,
      and here most decisions need no language model at all.</p>` : ''}`;
}
