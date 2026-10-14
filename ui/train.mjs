// ui/train.mjs — "Teach it your own work": the view over src/train.mjs. The visitor's CSV is read by the browser and
// never leaves the page; the brain is grown on the device and can be downloaded — theirs to keep.
import { parseCsv } from '../vendor/csv-forge/csv.mjs';
import { trainFromCsv } from '../src/train.mjs';

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
  return { ...state, result: trainFromCsv(state.text, { target: state.target, domain: 'your-brain', seed: 7 }) };
}

/** The downloadable brain: the pattern plus what it was grown on, plainly labelled. */
export function brainFile(state) {
  const r = state && state.result;
  if (!r || !r.ok || !r.verified) return null;
  return JSON.stringify({ about: 'A verified brain grown in your browser by Sovereign Enterprise (Konomi SLM pattern; seed-library ribosome). Readable rules; answers only inside what it was verified on.',
    grownOn: state.label, predicts: r.target + ' = ' + r.positive, rows: r.rows, features: r.features, pattern: r.pattern }, null, 1);
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
      <div class="row"><button data-act="train-download">Download your brain (.json)</button></div>`
      : `<h3 class="warn">✗ No brain this time</h3><p>${esc(r.why)}</p><p class="dim">That is the gate working: a brain that can't predict cases it never saw is refused, never shipped.</p>`}
  </div>` : ''}`;
}
