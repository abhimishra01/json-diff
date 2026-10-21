// Web Worker: all parsing and diffing runs here, so the page never freezes.
// Messages in:  { type: 'compare', id, a, b, opts } | { type: 'format', id, text, tolerant } | { type: 'view', id, sortKeys } | { type: 'patch', id }
// Messages out: progress, result (with the first chunk), chunk, invalid, formatted, view, error
import { compareTexts, ParseCache } from './compare.js';
import { parse } from './parse.js';
import { pretty } from './serialize.js';
import { jsonPatch, patchText } from './report.js';

const CHUNK = 500;
const cache = new ParseCache();
let last = null; // { trees, changes } of the last good compare, used by the side by side view

function post(m) {
  self.postMessage(m);
}

function onCompare(msg) {
  const { id } = msg;
  let lastStage = '';
  const r = compareTexts(msg.a, msg.b, msg.opts, cache, (stage, fraction) => {
    if (stage !== lastStage || fraction > 0) {
      lastStage = stage;
      post({ type: 'progress', id, stage, fraction });
    }
  });
  if (r.state === 'invalid') {
    last = null;
    post({ type: 'invalid', id, a: r.a, b: r.b });
    return;
  }
  last = { trees: r.trees, changes: r.changes };
  post({
    type: 'result',
    id,
    summary: r.summary,
    summaryText: r.summaryText,
    warnings: r.warnings,
    choices: r.choices,
    ignored: r.ignored,
    total: r.changes.length,
    items: r.changes.slice(0, CHUNK),
  });
  for (let from = CHUNK; from < r.changes.length; from += CHUNK) {
    post({ type: 'chunk', id, from, items: r.changes.slice(from, from + CHUNK) });
  }
  post({ type: 'done', id });
}

function onFormat(msg) {
  const p = parse(msg.text, { tolerant: msg.tolerant });
  if (!p.ok) {
    post({ type: 'formatted', id: msg.id, ok: false, error: p.error });
    return;
  }
  if (p.empty) {
    post({ type: 'formatted', id: msg.id, ok: true, text: '' });
    return;
  }
  post({ type: 'formatted', id: msg.id, ok: true, text: pretty(p.value).lines.join('\n') });
}

// Where a block that starts at line s ends: the closing bracket line with the same indent.
function blockEnd(lines, s) {
  const t = lines[s];
  const last = t.charCodeAt(t.length - 1);
  const lastNoComma = last === 44 ? t.charCodeAt(t.length - 2) : last;
  if (lastNoComma !== 123 && lastNoComma !== 91) return s;
  let ind = 0;
  while (t.charCodeAt(ind) === 32) ind++;
  for (let k = s + 1; k < lines.length; k++) {
    const u = lines[k];
    let j = 0;
    while (u.charCodeAt(j) === 32) j++;
    if (j === ind) return k;
  }
  return s;
}

function onView(msg) {
  if (!last) {
    post({ type: 'view', id: msg.id, ok: false });
    return;
  }
  const wantA = new Set();
  const wantB = new Set();
  for (const c of last.changes) {
    if (c.ptrA !== null) wantA.add(c.ptrA);
    if (c.ptrB !== null) wantB.add(c.ptrB);
  }
  const a = pretty(last.trees.a, { sortKeys: msg.sortKeys, want: wantA });
  const b = pretty(last.trees.b, { sortKeys: msg.sortKeys, want: wantB });
  // For each change: first line and last line in each document (-1 when the side has none).
  const spans = new Array(last.changes.length);
  for (let i = 0; i < last.changes.length; i++) {
    const c = last.changes[i];
    const sa = c.ptrA !== null && a.lineOf.has(c.ptrA) ? a.lineOf.get(c.ptrA) : -1;
    const sb = c.ptrB !== null && b.lineOf.has(c.ptrB) ? b.lineOf.get(c.ptrB) : -1;
    spans[i] = [sa, sa >= 0 ? blockEnd(a.lines, sa) : -1, sb, sb >= 0 ? blockEnd(b.lines, sb) : -1];
  }
  post({ type: 'view', id: msg.id, ok: true, a: a.lines, b: b.lines, spans });
}

function onPatch(msg) {
  if (!last) {
    post({ type: 'patch', id: msg.id, ok: false });
    return;
  }
  post({ type: 'patch', id: msg.id, ok: true, text: patchText(jsonPatch(last.changes, last.trees)) });
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'compare') onCompare(msg);
    else if (msg.type === 'format') onFormat(msg);
    else if (msg.type === 'view') onView(msg);
    else if (msg.type === 'patch') onPatch(msg);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
