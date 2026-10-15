import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hiddenSpans, PAIRS } from '../witness-all.mjs';

// The witness masks '…' and "…" as strings without stopping at a newline, so a stray quote hides real code from
// mutation and the kernel reads clean without being tested. explain.mjs shipped that way: a " inside an escape regex
// hid its diagrams from every mutant. witness-all now refuses such a kernel; this pins the detector and the tree.
test('hidden code: a stray quote that would hide code from the witness is found, ordinary code is not', () => {
  // the shape that shipped: a quote inside a regex character class — and the parity it breaks hides the rest of the file
  assert.deepEqual(hiddenSpans('s.replace(/[&<>"\']/g, f);\nconst x = a < b;\nconst y = "ok";\n'), [[1, 3], [3, 4]]);
  // an apostrophe inside a backtick template
  assert.deepEqual(hiddenSpans('const t = `it\'s ${x}`;\nif (a > b) go();\nconst q = \'z\';\n'), [[1, 3], [3, 4]]);
  // never closed: the rest of the file
  assert.deepEqual(hiddenSpans('x();\nconst r = /"/;\nif (a && b) go();\n'), [[2, 4]]);
  // ordinary strings, escapes, comments and \x22 / \x27 hide nothing
  assert.deepEqual(hiddenSpans('const a = "x\'y", b = \'p"q\', c = "a\\"b", d = \'it\\\'s\';\n// it\'s a "comment"\n/* don\'t */ f(/[\\x22\\x27]/g);\n'), []);
  // a string continued with a backslash-newline is a span too (legal, but it would be masked across lines)
  assert.deepEqual(hiddenSpans('const s = "a\\\nb";\n'), [[1, 2]]);
  assert.deepEqual(hiddenSpans(''), []);
});

test('hidden code: no witnessed kernel hides a line from the witness', () => {
  for (const [src] of PAIRS) assert.deepEqual(hiddenSpans(readFileSync(new URL('../' + src, import.meta.url), 'utf8')), [], src);
});
