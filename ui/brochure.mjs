// ui/brochure.mjs — the case for the board, on the page, on THE VISITOR'S numbers. Every number is computed live by the
// kernels (src/office.mjs plan + transition + payback, src/adopt.mjs fitPlan + sensitivity + breakEven, src/market.mjs
// cloudCompare + undercut) from data/basis.json and the business the visitor entered in "For your business"; the
// "working day" figures are read from receipts/company.json — the run CI re-executes byte for byte. Nothing typed.
import { gbp0, gbpM } from '../src/office.mjs';
import { ROLLOUT } from '../src/explain.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const times = (x) => (Math.round(x * 10) / 10).toLocaleString('en-GB') + '×';
const months = (m) => (m === null || !Number.isFinite(m) ? 'does not pay back' : m < 1 ? 'under a month' : Math.round(m) + ' month' + (Math.round(m) === 1 ? '' : 's'));
const m10 = (x) => (x / 10).toFixed(1) + '%';

/** Which work the live company demonstrates today, and which the white paper models (to be planted and measured). */
export const SCOPE = Object.freeze([
  { dept: 'Sales', shown: 'Spots which web visitors are about to buy and fast-tracks them into the pipeline (real shopper sessions).', modelled: 'Proposals and outreach drafted by the model tier for a person to send.' },
  { dept: 'Customer service', shown: 'Spots who is about to leave and sends the retention offer; reads, routes and drafts replies to customer messages (model tier), held for a person.', modelled: 'Answering the phone (a per-use voice service).' },
  { dept: 'Finance', shown: 'Holds fraudulent card payments, sets credit terms, keeps double-entry books and the auditable record.', modelled: 'Invoice matching, reconciliation, VAT and month-end — bridged from your bank and accounts exports.' },
  { dept: 'Operations', shown: 'Raises purchase orders before stock runs out, books machines in before they fail, sheds load before an overload.', modelled: 'Scheduling, suppliers and logistics against your own systems.' },
  { dept: 'Systems', shown: 'Quarantines intrusions; the behaviour watch pauses an agent that stops acting like itself.', modelled: 'Device and access admin, tier-1 support.' },
  { dept: 'Audit', shown: 'Grows its own independent brains; money and security calls need it to agree.', modelled: '—' },
  { dept: 'Marketing · HR and admin', shown: '—', modelled: 'Content, campaigns, recruitment admin, onboarding, rotas — the model tier with a person signing off.' },
]);

/** Where data goes: on your devices, and every optional service outside them. */
export const DATA_FLOWS = Object.freeze([
  { what: 'Records, books, documents, decisions, the brains', where: 'Your own devices and your hub', receives: '—', off: 'Always on your devices' },
  { what: 'A language model you connect (model tier)', where: 'Your machine (Ollama), inside the browser (WebLLM), or a provider with your own key', receives: 'The text of the one message or task it is asked about — nothing, for a local model', off: 'Off by default; local options send nothing out' },
  { what: 'In-browser model files (WebLLM)', where: 'Downloaded from cdn.jsdelivr.net', receives: 'Nothing about you: the model is downloaded, not called', off: 'Use Ollama on your own machine instead' },
  { what: 'A frontier model for the hardest few percent', where: 'The provider you choose (the white paper costs Claude Sonnet)', receives: 'The text of that one task', off: 'Optional — leave it out and those tasks go to a person' },
  { what: 'Voice on the phone line', where: 'A per-use voice service (the white paper costs ElevenLabs)', receives: 'The audio of the calls you route to it', off: 'Optional — leave it out and people take the calls' },
  { what: 'Connecting machines on different networks', where: 'A STUN server (Google’s public one by default, or your own)', receives: 'Each machine’s public network address, to find a direct path', off: 'Same-network use needs none; set your own STUN/TURN server' },
  { what: 'This demonstration page', where: 'GitHub Pages', receives: 'The page request', off: 'In production your hub serves the page on your network' },
]);

/** What it connects to — each one named, which way the data goes, and the file or call that carries it. Only what the code does
 *  and its tests prove: the bridges (src/bridge.mjs), the model adapters (src/model.mjs), the direct links (src/rtc.mjs) and the
 *  exports (src/exportco.mjs, src/audit.mjs). */
export const INTEGRATIONS = Object.freeze([
  { system: 'Your bank', way: 'In', how: 'The statement your online banking exports as CSV — one amount column, paid in and paid out, or debit and credit', does: 'Read to the penny and reconciled against the running balance; each line posted by a rule, and a line no rule knows waits in suspense for a person' },
  { system: 'Your accountant’s trial balance', way: 'In', how: 'A trial balance exported as CSV from the accounting package', does: 'The opening balances, refused unless they balance' },
  { system: 'Your customer list or pipeline', way: 'In and out', how: 'The CSV your CRM or spreadsheet exports — name, company or contact columns, deal stage and value', does: 'Read column by column into the CRM; out again as a spreadsheet any CRM imports' },
  { system: 'Sage Accounting (UK)', way: 'Out and back', how: 'Sage’s journal import file', does: 'The books as journals your accountant imports; their adjusted file reads straight back' },
  { system: 'Xero', way: 'In to Xero', how: 'Xero’s own bank import and conversion balances', does: 'Xero refuses manual journals to bank, receivable and payable accounts, so the statement goes in as the statement file and the opening balances as conversion balances' },
  { system: 'A language model', way: 'Calls out, only when asked', how: 'Ollama on your machine; LM Studio, vLLM or llama.cpp through their OpenAI-compatible server; WebLLM in the browser; or Anthropic with your own key', does: 'Reads, routes and drafts the free text no brain covers, within a spending limit; every call written to the record' },
  { system: 'Your other machines', way: 'Both ways', how: 'A direct encrypted WebRTC link; your own STUN/TURN server if you set one', does: 'Every device holds the same company, with no server in the path' },
  { system: 'Your auditor', way: 'Out', how: 'The record’s signed checkpoint and a standalone checker page', does: 'Proves the books only ever grew, without access to anything else' },
  { system: 'A backup, or a move', way: 'Out and back', how: 'The signed company file plus every list as CSV', does: 'A new device restores the very same company; the spreadsheets open anywhere' },
]);

/** ctx = { fit (adopt.fitPlan + transition + payback), rows (sensitivity), be (breakEven), basis, receipt, revenue, margin,
 *  rival (market.undercut), cloud (market.cloudCompare), measured (0..1), stamp: { date, basis } } → HTML */
export function renderBrochure(ctx) {
  const { fit, rows, be, basis, receipt, rival, cloud } = ctx;
  if (!fit || !fit.ok) return `<article class="brochure" id="brochure-doc"><p class="warn">${esc((fit && fit.why) || 'Enter your business in “For your business”.')} <button data-go="business">Fix it in For your business</button></p></article>`;
  const p = fit.plan, t = fit.transition, y = fit.payback, S = receipt.summary;
  const office = fit.office;
  const box = basis.aiBox, gpu = basis.awsGpuLondon;
  const team = p.sovereign.headcount, kept = p.sovereign.kept || 0, leads = team - kept;
  const measured = typeof ctx.measured === 'number' ? ctx.measured : S.automatedPermille / 1000;
  const share = typeof office.aiShare === 'number' ? office.aiShare : 0.9;
  const rows3 = (rows || []).filter((r) => r && r.ok);
  return `
<article class="brochure" id="brochure-doc">
<header class="b-hero">
  <p class="b-kicker">SOVEREIGN ENTERPRISE · THE CASE FOR THE BOARD · AI NATIVE SOLUTIONS</p>
  <h2>Your company, run by AI agents on machines you own.</h2>
  <p class="b-lede">Six AI agents — sales, service, finance, operations, systems and audit — do the routine operational work end to end,
    around the clock. ${leads} AI-native ${leads === 1 ? 'person directs' : 'people direct'} them${kept ? `, and ${kept} ${kept === 1 ? 'person keeps' : 'people keep'} doing the work clients pay for, with the agents taking their admin` : ''}.
    Your records, books and decisions stay on your own devices; optional per-use services receive only what one call needs.</p>
  <p class="b-modelled"><b>Modelled on your business:</b> ${p.today.headcount} people today · ${ctx.revenue ? gbpM(ctx.revenue) + ' revenue' : 'revenue not entered'} ·
    ${Number.isFinite(ctx.margin) ? pct(ctx.margin, 1) + ' margin' : 'margin not entered'} · agents doing ${pct(share)} of each department’s work (your assumption) — <button class="link" data-go="business">change it</button></p>
  <div class="b-stats">
    <div><b>${gbpM(p.today.total)} → ${gbpM(p.sovereign.total)}</b><span>five-year cost today → AI-native, on your numbers</span></div>
    <div><b>${gbpM(y.net)}</b><span>saved over five years after the one-off move (${gbpM(t.total)})</span></div>
    <div><b>${months(y.paybackMonths)}</b><span>to pay back the machines, the roll-out and the move</span></div>
    <div><b>${gbpM(y.npv)}</b><span>what it is worth today (net present value, Green Book rate)</span></div>
  </div>
  <div class="b-actions"><button class="primary" data-go="live">See it running now</button><button data-go="business">Put in your numbers</button><button data-act="print-brochure">Print / save as PDF</button></div>
</header>

<section class="b-sec b-threat">
  <h3>Why this can't wait: the rival you haven't met yet</h3>
  <p>An AI-native company runs a business like yours on the AI-native cost base. It might be a competitor. It might be
    ${rival ? rival.headcountRival : leads} of your own people who leave and start one — the machines cost them ${gbp0(p.hardware.total)}, the roll-out
    ${gbp0(p.sovereign.setup)}: <b>${gbp0(rival ? rival.startupCost : p.hardware.total + p.sovereign.setup)} to start</b>, with nobody to make redundant.</p>
  <div class="b-calc">
    <label>Your annual revenue <input id="b-rev" inputmode="numeric" value="${esc(String(ctx.revenueText ?? ctx.revenue ?? ''))}" aria-label="Annual revenue in pounds, e.g. 6m or 6,000,000"></label>
    <label>Your operating margin % <input id="b-margin" inputmode="decimal" value="${esc(String(ctx.marginText ?? (Number.isFinite(ctx.margin) ? Math.round(ctx.margin * 1000) / 10 : '')))}" aria-label="Operating margin percent"></label>
  </div>
  ${!rival ? '<p class="warn">Enter your revenue (e.g. 6m or 6,000,000) and a margin between −99% and 99%.</p>'
    : rival.mismatch ? `<p class="warn">Your revenue and margin mean costs of ${gbp0(rival.costBase)} a year, but the business you entered costs ${gbp0(rival.modelledYear)} a year to run today. One of them isn’t your business — check your headcount and costs in “For your business”, or your revenue here.</p>`
    : `<div class="b-stats">
    <div><b>${gbp0(rival.gapYear)}</b><span>a year lower costs than yours, doing the same work</span></div>
    <div><b>${pct(rival.priceCut, 1)}</b><span>it can cut its prices by — and still make the profit you make</span></div>
    <div><b>${pct(rival.sameMarginCut, 1)}</b><span>it can cut them by — and still keep your ${pct(rival.yourMargin, 1)} margin</span></div>
    <div><b>${rival.headcountRival} vs ${rival.headcountYou}</b><span>people on payroll for the same output</span></div>
  </div>`}
  <p>And it doesn't sleep. Every customer message, payment, order and alert is decided the moment it arrives — nights and
    weekends included — and every decision carries a receipt saying exactly why. You can match it, or you can be the
    company it undercuts.</p>
</section>

<section class="b-sec">
  <h3>What it does — shown today, and modelled</h3>
  <p>The live company on this page runs the decisions below on published datasets, end to end. The rest of each department’s work
    is modelled in the white paper and is what a pilot plants and measures on your own records.</p>
  <div class="tablewrap"><table><tr><th>Department</th><th>Running in the live company today</th><th>Modelled — planted and measured in your pilot</th></tr>
    ${SCOPE.map((s) => `<tr><td><b>${esc(s.dept)}</b></td><td>${esc(s.shown)}</td><td>${esc(s.modelled)}</td></tr>`).join('')}</table></div>
</section>

<section class="b-sec">
  <h3>A working day, re-run from scratch</h3>
  <p>The same code this page runs, re-run from a fixed seed on GitHub's own servers, gives the same result byte for byte. The brains were
    grown on published datasets — card transactions, telecom customers, credit-card clients, IoT network flows, household power and web
    shopping sessions — and scored on cases they never saw. <b>These are public datasets, not your data:</b> your own figures come from
    the brains re-verifying on your history in the pilot.</p>
  <div class="b-stats">
    <div><b>${m10(S.automatedPermille)}</b><span>of ${S.events} pieces of work done end to end by agents; the rest waited for a person</span></div>
    <div><b>${m10(S.rightPermille)}</b><span>of the agents' finished calls matched the real outcome, which they never saw when deciding</span></div>
    <div><b>${S.crossChecked}</b><span>money and security calls confirmed by a second, independent brain</span></div>
    <div><b>${S.converged ? 'All 9' : 'NOT'}</b><span>devices holding the identical company; books ${S.books.balanced ? 'balanced' : 'NOT balanced'}; record ${S.vault.audits ? 'audited' : 'NOT audited'}</span></div>
  </div>
  ${ctx.metricsHtml || ''}
</section>

<section class="b-sec">
  <h3>What it's worth to each of you</h3>
  <div class="b-grid">
    <div><h4>CEO</h4><p>A cost base an AI-native rival can't undercut, because you are the AI-native company. Every decision explained, and an asset you own outright.</p></div>
    <div><h4>CFO</h4><p>${gbpM(y.net)} net over five years on your numbers, paid back in ${months(y.paybackMonths)}. Books in whole pence that refuse an unbalanced entry, sealed into a record your auditor can check.</p></div>
    <div><h4>COO</h4><p>Throughput that doesn't depend on hours. The same decision at 3 a.m. as at 3 p.m. Anything no brain can confirm lands on one list for a person, with the evidence beside it.</p></div>
    <div><h4>CTO / CISO</h4><p>Every write signed by the device that made it and checked before it is read. Brains that refuse inputs outside what they were proven on and refuse poisoned updates. A revoked device is refused by every other device.</p></div>
    <div><h4>Heads of department</h4><p>Your agent does the volume; you take the exceptions, the relationships and the judgement calls — and see every decision it made and why.</p></div>
    <div><h4>The people who stay</h4><p>${leads} AI-native ${leads === 1 ? 'role directs' : 'roles direct'} a workforce of agents${kept ? `; ${kept} kept ${kept === 1 ? 'person' : 'people'} keep the client and on-site work, with the agents taking their admin` : ''}. Higher-value work, fewer hand-offs.</p></div>
  </div>
</section>

<section class="b-sec">
  <h3>The money: five years, three ways — on your numbers</h3>
  <div class="tablewrap"><table>
    <tr><th></th><th class="n">People</th><th class="n">Five-year cost</th></tr>
    <tr><td>Today — people plus rented per-seat software</td><td class="n">${p.today.headcount}</td><td class="n">${gbpM(p.today.total)}</td></tr>
    <tr><td>An AI seat on every desk — the same people, plus an assistant each</td><td class="n">${p.assisted.headcount}</td><td class="n">${gbpM(p.assisted.total)}</td></tr>
    <tr><td><b>AI-native, owned — agents do the work on your machines</b></td><td class="n"><b>${p.sovereign.headcount}</b></td><td class="n ok"><b>${gbpM(p.sovereign.total)}</b></td></tr>
  </table></div>
  <p>An AI seat on every desk costs <b>more</b> than today — the people still do the work and you add a licence. The saving
    comes from changing who does the work, not from adding tools.</p>
  ${t.leavers > 0 ? `<h4>The move, one-off</h4>
  <div class="tablewrap"><table>
    <tr><td>Roles that go</td><td class="n">${t.leavers}</td></tr>
    <tr><td>Statutory redundancy (${t.redundancyWeeks} weeks each at the capped weekly pay, gov.uk)</td><td class="n">${gbp0(t.redundancy)}</td></tr>
    <tr><td>Dual running for ${Math.round(t.dualRunWeeks)} weeks — notice (${t.noticeWeeks} weeks)${t.consultationDays ? ` and the ${t.consultationDays}-day collective consultation run inside it; form HR1 goes to the Redundancy Payments Service first` : ' runs inside it'}</td><td class="n">${gbp0(t.dualRun)}</td></tr>
    <tr><td>Training for the people who stay</td><td class="n">${gbp0(t.training)}</td></tr>
    <tr><td>Contingency</td><td class="n">${gbp0(t.contingency)}</td></tr>
    <tr><td><b>The move</b></td><td class="n"><b>${gbp0(t.total)}</b></td></tr>
  </table></div>
  <p>After the move the five-year saving is <b>${gbp0(y.net)}</b>. It pays back in <b>${months(y.paybackMonths)}</b>, and is worth <b>${gbp0(y.npv)}</b> today
    at the Green Book’s 3.5% real discount rate plus CPI. Statutory amounts are the legal minimum; enter your own costs in “For your business”.</p>` : ''}
  <h4>The assumption under every number</h4>
  <p>The model assumes agents do <b>${pct(share)}</b> of each department’s operational work end to end — your setting. The live company
    measured <b>${pct(measured, 1)}</b> on the jobs it runs. People cover the rest: about <b>${Math.round(p.human.weeklyHours)} hours a week</b> on the
    Watch list and the exceptions, which the ${leads} AI-native ${leads === 1 ? 'lead covers' : 'leads cover'}.</p>
  ${rows3.length ? `<div class="tablewrap"><table><tr><th>Agents do, end to end</th><th class="n">AI-native team</th><th class="n">Net five-year saving</th><th class="n">Pays back</th></tr>
    ${rows3.map((r) => `<tr><td>${pct(r.share)} of the work</td><td class="n">${r.team}</td><td class="n">${gbp0(r.net)}</td><td class="n">${months(r.paybackMonths)}</td></tr>`).join('')}</table></div>` : ''}
  ${be && be.ok ? `<p>${be.alwaysPays ? 'It pays even if agents did none of the work.' : be.share === null ? 'At this size it does not pay at any share.' : `<b>It stops paying below ${(Math.round(be.share * 1000) / 10)}%</b> of the work done by agents.`}</p>` : ''}
</section>

<section class="b-sec">
  <h3>Against the cloud</h3>
  ${cloud ? `<div class="tablewrap"><table>
    <tr><th>Running the company's AI for five years</th><th class="n">Cost</th></tr>
    <tr><td>Owned: ${p.capacity.boxes} × ${esc(box.product.split('(')[0].trim())} bought once (one carries the load, one is the spare and the replacement), plus electricity running flat out around the clock</td><td class="n ok"><b>${gbp0(cloud.owned)}</b></td></tr>
    <tr><td>Rented only while the office is open: the smallest AWS London GPU that holds this model class (${esc(gpu.product.split(' — ')[0])}, $${gpu.usdPerHour}/hour, ${Math.round(p.capacity.busyHours).toLocaleString('en-GB')} hours a year)</td><td class="n">${gbp0(cloud.officeHours)}</td></tr>
    <tr><td>The same instance kept on around the clock, as a service other systems call needs</td><td class="n">${gbp0(cloud.alwaysOn)}</td></tr>
    <tr><td>Pay per token on Amazon Bedrock in London, the same open-model class</td><td class="n">${gbp0(cloud.perToken)}</td></tr>
  </table></div>
  <p>Owning costs ${times(cloud.officeHoursTimes)} less than renting a GPU only while the office is open. <b>Paying per token is cheaper on raw
    compute at this volume</b> — and every call then sends your data to the provider, and your costs move with its prices. Most decisions
    here need no language model at all: the agents' brains decide them on your devices at no cost per decision. The per-seat software
    ends too — ${gbp0(p.today.seatsYear1)} a year today. The biggest saving is not the software: it is who does the work.</p>` : '<p class="dim">The cloud comparison needs a valid business.</p>'}
</section>

<section class="b-sec">
  <h3>Where your data goes</h3>
  <div class="tablewrap"><table><tr><th>What</th><th>Where</th><th>What it receives</th><th>Switch off / your own</th></tr>
    ${DATA_FLOWS.map((d) => `<tr><td>${esc(d.what)}</td><td>${esc(d.where)}</td><td>${esc(d.receives)}</td><td>${esc(d.off)}</td></tr>`).join('')}</table></div>
</section>

<section class="b-sec">
  <h3>What it connects to</h3>
  <div class="tablewrap"><table>
    <tr><th>System</th><th>Which way</th><th>How</th><th>What happens</th></tr>
    ${INTEGRATIONS.map((x) => `<tr><td><b>${esc(x.system)}</b></td><td>${esc(x.way)}</td><td>${esc(x.how)}</td><td>${esc(x.does)}</td></tr>`).join('')}
  </table></div>
</section>

<section class="b-sec">
  <h3>Security, data protection and oversight — built in</h3>
  <div class="b-grid">
    <div><h4>Every write signed and checked</h4><p>Each device signs what it writes with its own key; every other device checks the signature, the form and the sender's grant before reading it. Forged, altered, replayed or malformed writes are refused.</p></div>
    <div><h4>Scoped authority</h4><p>Authority is a tree from the owner: each agent and person is granted only their part of the company. Revoke a device and every other device refuses its writes from that moment.</p></div>
    <div><h4>Personal details sealed per person</h4><p>Each staff member’s personal details are sealed under their own key. Erasing a person destroys the key on every device that syncs; the books and the record still verify. A device that stays offline keeps its copy until it reconnects.</p></div>
    <div><h4>People oversee every decision</h4><p>Anyone can see every decision and why. Money and security calls need a second, independent brain; anything no brain can confirm waits for a person, who chooses what happens. Any agent can be paused or fired in one click.</p></div>
    <div><h4>Records of every decision</h4><p>Every decision is a signed record with a receipt naming the brain, the evidence and the score — and every brain is readable rule by rule.</p></div>
    <div><h4>Built without protected characteristics</h4><p>The brains never see age, sex, marital status or education: those columns are left out of their data, and every rule they use is readable.</p></div>
    <div><h4>A record your auditor can check</h4><p>The books are sealed into an append-only transparency log (the design behind Certificate Transparency). Send its signed checkpoints to your auditor or bank, and they can prove any entry is in the books and that nothing was rewritten — without trusting you. <a href="verify.html" target="_blank" rel="noopener">Try the auditor’s checker ↗</a></p></div>
  </div>
</section>

<section class="b-sec">
  <h3>Questions your board will ask — answered straight</h3>
  <dl class="b-faq">
    <dt>What if an AI makes a wrong call?</dt><dd>Each brain answers only inside what it was proven on and abstains outside it. Money and security calls need a second, independent brain to agree; disagreements go to a person. Outcomes come back and the brains regrow — a new brain replaces the old only if it beats it on cases neither saw. In the re-run day, ${m10(S.rightPermille)} of the agents' finished calls matched the real outcome.</dd>
    <dt>Do we still need ChatGPT or Copilot?</dt><dd>Not for the decisions the agents make — those are the company's own brains, with no per-call bill. For free text — reading what a customer wrote, sending it to the right desk, drafting a reply — you connect a language model of your choice: on your own machine, inside the browser, or a provider with your own key. Spend is capped before any paid call, every call is written to the audit trail, a model never acts alone on money or security, and its replies are held as drafts — a model never sends one.</dd>
    <dt>What if someone attacks it?</dt><dd>Hostile messages are quarantined before any AI reads them. Once a person confirms a new attack, every device becomes immune to it. An AI update is adopted only if it does at least as well as the brain it replaces on each device's own records. Forged writes are refused at the door. An agent behaving unlike itself is paused automatically until a person clears it.</dd>
    <dt>What if a laptop is stolen?</dt><dd>Revoke its grant and every device refuses its writes from that moment. Nobody can rewrite what that device already wrote: every write names the one before it, so a forged version of the past is flagged with a proof on every device. Then issue the person a new device key. Each device's key is held by its browser in a form no web page can export and its copy of the company is stored sealed, so with full-disk encryption on and the screen locked, a thief with the laptop gets nothing. The owner's device is the one key that cannot be revoked; any two of the three recovery cards printed when the company was founded bring it back on a new machine.</dd>
    <dt>What if the internet goes down?</dt><dd>It keeps working. Devices sync with each other directly; when they reconnect, every device converges to the identical company.</dd>
    <dt>Do we have to rip out our systems?</dt><dd>No. Your bank statement (one amount column, paid in and paid out, or debit and credit), your accountant’s trial balance and your customer list come in as the files those systems already export: every line is checked, money is read to the penny, the running balances are reconciled, and a line no rule recognises waits in a suspense account for a person. The books go back out as a Sage Accounting journal import, and the customers as a spreadsheet any CRM imports. On Xero, the bank statement goes in as the statement itself through Xero’s own bank import and the opening balances as its conversion balances — Xero refuses manual journals to bank, receivable and payable accounts, so that is the door it keeps. Your old systems keep running beside the agents until each department passes its go/no-go gate.</dd>
    <dt>Who supplies it, and are we locked in?</dt><dd>AI Native Solutions (<a href="https://www.ai-nativesolutions.com" target="_blank" rel="noopener">ai-nativesolutions.com</a>) plants and supports it. The software is MIT-licensed — no licence fee — and you own the machines, the data and the brains, so it keeps running if you stop working with us. Support, response times, warranty and liability are set in each deployment's agreement.</dd>
    <dt>Is this proven or a promise?</dt><dd>The software is proven: its full test suite, a mutation gate that checks the tests catch every deliberate fault, and two byte-for-byte re-runs run on GitHub's servers on every change — and you can run them yourself. The business result on this page is modelled from sourced figures; your pilot measures it on your own records, and its receipt is yours to keep.</dd>
    <dt>What happens to our people?</dt><dd>${leads} AI-native roles direct the agents${kept ? ` and ${kept} kept people keep the client and on-site work` : ''}. Roles that go follow the statutory process — consultation, notice inside the dual-running months, redundancy pay — and the people who know the work best help train the agents before the old process is switched off.</dd>
    <dt>How long do we keep records, if people can be erased?</dt><dd>The books keep every transaction for as long as the law requires (six years for HMRC) against a customer number; a person's details — a member of staff's, or a customer's name, email and phone — are sealed under that person's own key before they are written, so erasing them destroys the key, every copy goes dark, and the books stay complete.</dd>
  </dl>
</section>

<section class="b-sec">
  <h3>The people side of the move</h3>
  <div class="tablewrap"><table>
    <tr><th>When</th><th>What happens</th></tr>
    <tr><td>Before week 1</td><td>Decide which roles stay and which go, with fair selection criteria; ${t.consultationDays ? `notify the Redundancy Payments Service (form HR1) and start the ${t.consultationDays}-day collective consultation` : 'consult the people affected'}.</td></tr>
    <tr><td>Weeks 1–12</td><td>Dual running: the old team keeps working while each department's agent runs alongside it. The people leaving teach the agents — their decisions on real cases become the record the brains are checked against — and work their notice inside these weeks.</td></tr>
    <tr><td>Throughout</td><td>The ${leads} AI-native ${leads === 1 ? 'lead is' : 'leads are'} trained (${office.transition && office.transition.trainingDays ? office.transition.trainingDays : 10} days each in the model) and take over the Watch list department by department. Keep key people through the dual run with a retention agreement where the knowledge is critical.</td></tr>
    <tr><td>Each switch-off</td><td>A department's old process ends only when its agent has passed its go/no-go gate (below).</td></tr>
  </table></div>
</section>

<section class="b-sec">
  <h3>How it's delivered: twelve weeks, gated</h3>
  <div class="tablewrap"><table>
    <tr><th>Weeks</th><th>What goes live</th><th>Go / no-go before the old process ends</th></tr>
    ${ROLLOUT.map((r) => `<tr><td>${esc(r.weeks)}</td><td>${esc(r.live)}</td><td>${esc(r.gate)}</td></tr>`).join('')}
  </table></div>
  <p>The hardware: the laptops your leads already have; one hub (${esc(basis.hub.product)}); ${p.capacity.boxes} AI boxes
    (${esc(box.product)}) — one carries the load at ${pct(p.capacity.decodeUtilisation)} busy, the second is the spare.</p>
</section>

<section class="b-sec">
  <h3>How it is planted</h3>
  <p>The same seed grows into each business’s own company — differentiated to what that business does, never a one-size template.</p>
  <div class="tablewrap"><table>
    <tr><th>Step</th><th>What happens</th><th>Who</th></tr>
    <tr><td>Understand</td><td>We walk into the office — or remote in — and learn what the business does: its kind of work and its people, department by department.</td><td>The planter, with you</td></tr>
    <tr><td>Plant</td><td>Your own records go into the planter’s console, read on that device and never uploaded. Each job gets a brain grown from your records and graded on cases it never grew on; your past decisions are re-grown and checked against what really happened; a job with no data waits for a person.</td><td>The planter</td></tr>
    <tr><td>Bridge</td><td>Your bank statement, trial balance and customer list are read across and checked to the penny; the books go back out in your accountant’s own import layout.</td><td>The planter</td></tr>
    <tr><td>Wire</td><td>Your tech person puts it on your own machines — the owner’s laptop, each person’s device, the office hub, one device per agent — following a checklist that checks each step against the company itself.</td><td>Your tech person</td></tr>
    <tr><td>Load</td><td>Each agent device takes a planted brain only if a key your company grants signed it, and only if it holds up on that device’s own records at least as well as the brain it has.</td><td>The agent devices</td></tr>
    <tr><td>Tend and prove</td><td>We remote in and tend it. A signed receipt shows each job before and after, measured on your own records; its redacted copy — no names, no amounts — is what the next business sees.</td><td>The planter, with you</td></tr>
  </table></div>
</section>

<section class="b-sec">
  <h3>How to start</h3>
  <p><b>A pilot on one department.</b> AI Native Solutions plants the seed on your own records for one department, runs its agent
    beside your people for four weeks, and hands you the measured result: how often the agent agreed with your people, how often it was
    right against what really happened, and what it would save — on your own data, re-runnable, yours to keep. Start at
    <a href="https://www.ai-nativesolutions.com" target="_blank" rel="noopener">ai-nativesolutions.com</a>.</p>
</section>

<section class="b-sec">
  <h3>Licences and credits</h3>
  <ul class="b-list">
    <li>The software: MIT licence — use, change and run it freely (<a href="https://github.com/sjgant80-hub/sovereign-enterprise/blob/main/LICENSE" target="_blank" rel="noopener">LICENSE</a>, <a href="https://github.com/sjgant80-hub/sovereign-enterprise/blob/main/NOTICE" target="_blank" rel="noopener">NOTICE</a>).</li>
    <li>The demo brains are grown on published datasets: UCI Machine Learning Repository sets under CC BY 4.0 (attribution, given in NOTICE) and the card-fraud sample under the Open Database License v1.0, whose share-alike applies to that sample file. Your own brains are grown on your own records and are yours.</li>
    <li>Powered by the Konomi architecture, created by Thomas Frumkin — used with his permission.</li>
    <li>The design lens — GEP, WIPER, BES and Dual-Map — is the work of Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC, published as Open Defensive Prior Art under Creative Commons; the independent second brain draws on his “From GEP Stabilization to Dual-Map Ethical Reasoning,” Derivation v0.2.</li>
  </ul>
</section>

<section class="b-sec b-board">
  <h3>The board in one paragraph</h3>
  <p>Over five years, our ${p.today.headcount}-person business costs ${gbpM(p.today.total)} run the way it is today. Run AI-native on machines
    we own, the same work costs ${gbpM(p.sovereign.total)}; after the one-off move of ${gbpM(t.total)}, that is ${gbpM(y.net)} saved, paid back in
    ${months(y.paybackMonths)}, with ${leads} AI-native ${leads === 1 ? 'lead' : 'leads'} and agents doing ${pct(share)} of the operational work${rows3.length > 1 ? ` (at ${pct(rows3[0].share)} it would be ${gbpM(rows3[0].net)})` : ''}.
    ${rival && !rival.mismatch ? `An AI-native rival with our revenue could cut its prices by ${pct(rival.priceCut, 1)} and still match our profit.` : ''}
    The decision is not whether the work goes AI-native — it is whether we do it, or a competitor does it to us.</p>
  <p class="b-small">Figures as of ${esc(ctx.stamp ? ctx.stamp.date : '')}${ctx.stamp && ctx.stamp.basis ? ' · sourced figures ' + esc(ctx.stamp.basis) : ''}. Pay from ONS, UK tax, NI and pension rules,
    statutory redundancy and consultation from gov.uk, the discount rate from HM Treasury's Green Book, and published prices — every figure
    and its source is listed below and in the white paper.</p>
</section>

<section class="b-sec b-sources">
  <h3>Assumptions and sources</h3>
  <ul class="b-list">
    <li>Agents' share of each department's work: ${pct(share)} — your assumption (the white paper uses 90%; the live company measured ${pct(measured, 1)}).</li>
    <li>Hours a year per person: ${office.hoursPerFte || 1950}; busy hours of the AI boxes: ${Math.round(p.capacity.busyHours)}; years: ${p.years}.</li>
    <li>Leavers' service ${office.transition ? office.transition.serviceYears : 5} years, dual running ${t.dualRunMonths} months, contingency ${pct(office.transition ? office.transition.contingency : 0.2)} (the model's; change them in the white paper's model office).</li>
    ${Object.entries(basis).filter(([, v]) => v && typeof v === 'object' && v.source).map(([k, v]) => `<li>${esc(v.what || v.product || k)} — <a href="${esc(v.source)}" target="_blank" rel="noopener">source</a>${v.via ? ' (' + esc(v.via) + ')' : ''}</li>`).join('')}
  </ul>
</section>
</article>`;
}
