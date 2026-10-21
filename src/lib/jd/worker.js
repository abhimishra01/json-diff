// Web Worker: all parsing and diffing runs here, so the page never freezes.
// Messages in:  { type: 'compare', id, a, b, opts } | { type: 'format', id, text, tolerant } | { type: 'view', id, sortKeys } | { type: 'patch', id }
// Messages out: progress, result (with the first chunk), chunk, invalid, formatted, view, error
import { compareTexts, ParseCache } from './compare.js';
import { parse } from './parse.js';
import { pretty } from './serialize.js';
import { buildView } from './view.js';
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
    hints: r.hints,
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

function onView(msg) {
  if (!last) {
    post({ type: 'view', id: msg.id, ok: false });
    return;
  }
  const v = buildView(last.trees, last.changes, msg.sortKeys);
  post({ type: 'view', id: msg.id, ok: true, ...v });
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
