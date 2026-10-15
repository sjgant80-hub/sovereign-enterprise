// ui/train.mjs — "Teach it your own work": the view over src/train.mjs. The visitor's CSV is read by the browser and
// never leaves the page; the brain is grown on the device and can be downloaded — theirs to keep.
import { parseCsv } from '../vendor/csv-forge/csv.mjs';
import { trainFromCsv } from '../src/train.mjs';
import { brainBody } from '../src/audit.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Load a CSV's text into the training state: its columns, and a sensible default column to predict. */
export function loadCsv(state, text, label) {
  const { header } = parseCsv(text);
  const guess = trainFromCsv(text, { domain: 'your-brain' });
  return { ...state, text, label, columns: header, target: guess.target || header[header.length - 1] || '', result: null };
}

/** Grow the brain on the chosen column. */
export function grow(state) {
  if (!state || !state.text) return state;
  return { ...state, signedBy: '', signError: '', result: trainFromCsv(state.text, { target: state.target, domain: 'your-brain', seed: 7 }) };
}

/**
 * The downloadable brain, before the page signs it with this browser's device key (src/audit.mjs signBrain): the pattern
 * in the form brains travel in on the spine, and where it came from — with no self-asserted "verified". summary false
 * leaves out the per-column summary of the training data (each column's minimum, quartiles and maximum).
 */
export function brainFile(state, summary = true) {
  const r = state && state.result;
  if (!r || !r.ok || !r.verified) return null;
  const b = brainBody(r, { label: state.label, summary });
  return b.ok ? b.body : null;
}

export function renderTrain(state = {}) {
  const r = state.result;
  const names = r && r.features ? Object.fromEntries(r.features.map((f) => [f.name, f.from])) : {};
  const rule = (x) => `${x.w > 0 ? '+' : ''}${x.w} if <b>${esc(names[x.feat] || x.feat)}</b> ${x.op === '>' ? 'is above' : 'is at most'} ${+Number(x.v).toFixed(3)}`;
  return `<h3 class="sec-h">Teach it your own work</h3>
  <p class="sec-sub">Drop in a CSV of your own records with a yes/no outcome — paid or defaulted, renewed or left, bought or browsed. Your device grows a
    brain on it in seconds, grades it on rows it never saw, and refuses if there is no real signal. The file never leaves this page.</p>
  <div class="row">
    <label class="dim" for="train-file">Your CSV</label><input type="file" id="train-file" accept=".csv,text/csv">
    <button data-act="train-sample">Or try it on real shopper data</button>
  </div>
  ${state.error ? `<p class="warn">${esc(state.error)}</p>` : ''}
  ${state.columns ? `<div class="row"><span class="dim">Loaded: ${esc(state.label)} · ${state.columns.length} columns</span>
    <label class="dim" for="train-target">Column to predict</label>
    <select id="train-target">${state.columns.map((c) => `<option ${c === state.target ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <button class="primary" data-act="train-go">Grow the brain</button></div>` : ''}
  ${r ? `<div class="panel">
    ${r.ok && r.verified ? `<h3 class="ok">✓ A verified brain — it predicts “${esc(r.target)} = ${esc(r.positive)}”</h3>
      <p>Grown on ${Math.round(r.rows * 0.7)} of your ${r.rows} rows and graded on the other ${r.rows - Math.round(r.rows * 0.7)} it never saw: held-out AUC <b>${r.pattern.heldAuc.toFixed(3)}</b>
        (0.5 is a coin toss; the gate is 0.6), accuracy ${(r.pattern.heldAcc * 100).toFixed(1)}%. It reads the ${r.features.length} columns most related to the outcome${r.dropped ? ` (${r.dropped} more were left out)` : ''}.</p>
      <p class="dim">Its rules, in full — add up the weights of the rules that fire; above ${+r.pattern.threshold.toFixed(3)} means “${esc(r.positive)}”:</p>
      <ul class="rules">${r.pattern.rules.map((x) => `<li>${rule(x)}</li>`).join('')}</ul>
      <div class="row"><button data-act="train-download">Download your brain, signed (.json)</button><button data-act="train-download-bare">Download without the data summary</button></div>
      ${state.signedBy ? `<p class="ok">Saved — signed by ${state.signedWith === 'device' ? 'this browser’s company device key' : 'this browser’s own signing key (made here; nothing can copy it off this browser)'} ${esc(state.signedBy.slice(0, 16))}….</p>` : ''}
      ${state.signError ? `<p class="warn">${esc(state.signError)}</p>` : ''}
      <p class="note">The file is signed by a key this browser holds: anyone you give it to can check who made it and that not a byte has changed — on
        <a href="verify.html" target="_blank" rel="noopener">the checker</a>, by dropping the file in. The signature proves where it came from, not that it works
        on their data: a device given it re-checks it on its own records first, and refuses it below the gate. The full file carries a summary of your data —
        each column’s minimum, quartiles and maximum — which the brain uses to tell when a case is unlike anything it learned from. “Without the data summary”
        leaves that out, and the device that loads it rebuilds one from its own records. The rules’ cut-off values come from your data in both.</p>
      <p class="note"><b>Where it goes next:</b> into a pilot. When the company is rolled out, the agent for this job is given the file, checks the signature,
        and re-checks the brain on its own records — the same adoption check that refuses a poisoned brain in the live company — answering from it only if
        it clears the gate there too.</p>`
      : `<h3 class="warn">✗ No brain this time</h3><p>${esc(r.why)}</p><p class="dim">That is the gate working: a brain that can't predict cases it never saw is refused, never shipped.</p>`}
  </div>` : ''}`;
}
