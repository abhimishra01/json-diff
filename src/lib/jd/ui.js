// Page logic for the JSON diff tool. The heavy work runs in worker.js.
import { diffChars, diffWordsWithSpace } from 'diff';
import { cleanOptions, defaultOptions } from './normalize.js';
import { compileIgnore } from './paths.js';
import { locate, reportText, changeLabel } from './report.js';
import { lineCol } from './parse.js';
import { SAMPLE_A, SAMPLE_B } from './sample.js';

const OPT_KEY = 'bm.jsondiff.opts.v1';
const PAGE = 500; // rows drawn at once
const ROW_H = 20; // side by side line height in px (matches the CSS)
const PREVIEW_CHARS = 200000;
const LIVE_DELAY = 400; // ms of no typing before a live compare
const BIG_CHARS = 5_000_000;
const BIG_AT = 1_000_000; // above this many characters a box shows a preview, not the whole text
const PREVIEW_LINES = 1500;
const MAX_FILE = 50 * 1024 * 1024;
const WARN_FILE = 25 * 1024 * 1024;

const KIND = {
  changed: { sym: '~', label: 'Changed' },
  added: { sym: '+', label: 'Added' },
  removed: { sym: '−', label: 'Removed' },
  type: { sym: 'T', label: 'Type change' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function initTool() {
  const root = $('tool');
  if (!root) return;

  // ----- state -----
  const S = {
    opts: loadOptions(),
    worker: null,
    seq: 0, // id of the newest compare
    running: false,
    timer: 0,
    progTimer: 0,
    changes: [],
    total: 0,
    summary: null,
    resultOk: false,
    loaded: 0,
    kinds: new Set(), // active filter
    filtered: [],
    shown: 0,
    tab: 'list',
    texts: { a: '', b: '' },
    big: { a: null, b: null }, // full text of a large input (the box then shows a preview)
    sides: { a: { error: null }, b: { error: null } },
    view: null, // data for the side by side tab, see view.js
    reqId: 0, // ids for requests to the worker (view, patch, format)
    cur: -1,
    jump: false,
    choices: [],
    ignored: { patterns: 0, places: 0 },
    pending: new Map(), // id -> callback for format and patch requests
    hints: [],
    warnings: [],
  };

  const ta = { a: $('jd-in-a'), b: $('jd-in-b') };
  const el = {
    arrays: $('jd-arrays'), keyWrap: $('jd-keywrap'), key: $('jd-key'),
    optBtn: $('jd-options-btn'), optPanel: $('jd-options'), chips: $('jd-chips'),
    ignore: $('jd-ignore'), ignoreErr: $('jd-ignore-err'),
    numMode: root.querySelectorAll('input[name="jd-nummode"]'), abs: $('jd-abs'), rel: $('jd-rel'),
    sIgnoreCase: $('jd-s-case'), sTrim: $('jd-s-trim'), sCollapse: $('jd-s-collapse'), sNfc: $('jd-s-nfc'),
    sortKeys: $('jd-sortkeys'), tolerant: $('jd-tolerant'),
    live: $('jd-live'), empty: $('jd-empty'), msg: $('jd-msg'), res: $('jd-res'),
    sumText: $('jd-sum-text'), filters: $('jd-filters'), info: $('jd-info'),
    list: $('jd-list'), listNote: $('jd-list-note'), more: $('jd-more'),
    tabList: $('jd-tab-list'), tabSbs: $('jd-tab-sbs'), panelList: $('jd-panel-list'), panelSbs: $('jd-panel-sbs'),
    progress: $('jd-progress'), progBar: $('jd-progbar'), progText: $('jd-progtext'), cancel: $('jd-cancel'),
    copyReport: $('jd-copy-report'), download: $('jd-download'), copyPatch: $('jd-copy-patch'),
    toast: $('jd-toast'), bar: $('jd-phonebar'),
    prev: $('jd-prev'), next: $('jd-next'), curLabel: $('jd-cur'), sbsNote: $('jd-sbs-note'),
  };

  // ----- small helpers -----
  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }
  function announce(text) {
    el.live.textContent = '';
    setTimeout(() => { el.live.textContent = text; }, 30);
  }
  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || 'Copied');
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
      toast(ok ? okMsg || 'Copied' : 'Copy failed. Select the text and copy it yourself.');
    }
  }
  function download(name, text, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const isBlank = (t) => /^[\s﻿]*$/.test(t);
  const fmtNum = (n) => n.toLocaleString('en-US');

  // ----- options -----
  function loadOptions() {
    try {
      const raw = localStorage.getItem(OPT_KEY);
      if (raw) return { ...cleanOptions(JSON.parse(raw)), tolerant: false };
    } catch {}
    return defaultOptions();
  }
  function saveOptions() {
    // Comments-allowed mode is not remembered: a strict check is the safe default on every visit.
    try { localStorage.setItem(OPT_KEY, JSON.stringify({ ...S.opts, tolerant: false })); } catch {}
  }
  function optsToForm() {
    const o = S.opts;
    el.arrays.value = o.arrays.mode;
    el.key.value = o.arrays.key;
    el.keyWrap.hidden = o.arrays.mode !== 'key';
    el.ignore.value = o.ignore;
    el.numMode.forEach((r) => { r.checked = r.value === o.numbers.mode; });
    el.abs.value = o.numbers.abs;
    el.rel.value = o.numbers.rel;
    el.abs.disabled = el.rel.disabled = o.numbers.mode === 'written';
    el.sIgnoreCase.checked = o.strings.ignoreCase;
    el.sTrim.checked = o.strings.trim;
    el.sCollapse.checked = o.strings.collapse;
    el.sNfc.checked = o.strings.nfc;
    el.sortKeys.checked = o.sortKeys;
    el.tolerant.checked = o.tolerant;
    renderChips();
    renderIgnoreErrors();
  }
  function formToOpts() {
    const o = S.opts;
    o.arrays.mode = el.arrays.value;
    o.arrays.key = el.key.value.trim();
    o.ignore = el.ignore.value;
    o.numbers.mode = [...el.numMode].find((r) => r.checked)?.value || 'value';
    o.numbers.abs = el.abs.value.trim();
    o.numbers.rel = el.rel.value.trim();
    o.strings = { ignoreCase: el.sIgnoreCase.checked, trim: el.sTrim.checked, collapse: el.sCollapse.checked, nfc: el.sNfc.checked };
    o.tolerant = el.tolerant.checked;
    saveOptions();
  }
  function renderIgnoreErrors() {
    const { errors } = compileIgnore(el.ignore.value);
    if (!errors.length) {
      el.ignoreErr.hidden = true;
      el.ignoreErr.textContent = '';
      el.ignore.removeAttribute('aria-invalid');
      return;
    }
    el.ignoreErr.hidden = false;
    el.ignoreErr.innerHTML = errors.slice(0, 5).map((e) => `<span>Line ${e.line}: ${esc(e.message)}</span>`).join('');
    el.ignore.setAttribute('aria-invalid', 'true');
  }

  // Chips: one per active option. A chip is a button that switches that option off.
  function activeChips() {
    const o = S.opts;
    const chips = [];
    const off = (fn) => () => { fn(); optsToForm(); saveOptions(); requestCompare(0); };
    if (o.arrays.mode !== 'auto') {
      const name = { position: 'by position', key: `by key${o.arrays.key ? ' ' + o.arrays.key : ''}`, order: 'ignore order' }[o.arrays.mode];
      chips.push({ text: `Arrays: ${name}`, off: off(() => { o.arrays.mode = 'auto'; }) });
    }
    const nOv = Object.keys(o.overrides).length;
    if (nOv) chips.push({ text: `Array overrides: ${nOv}`, off: off(() => { o.overrides = {}; }) });
    const pats = compileIgnore(o.ignore).patterns.length;
    if (pats) chips.push({ text: `Ignore paths: ${pats}`, off: off(() => { o.ignore = ''; }) });
    if (o.numbers.mode === 'written') chips.push({ text: 'Numbers as written', off: off(() => { o.numbers.mode = 'value'; }) });
    if (o.numbers.mode === 'value' && o.numbers.abs) chips.push({ text: `Tolerance ±${o.numbers.abs}`, off: off(() => { o.numbers.abs = ''; }) });
    if (o.numbers.mode === 'value' && o.numbers.rel) chips.push({ text: `Tolerance ${o.numbers.rel}%`, off: off(() => { o.numbers.rel = ''; }) });
    if (o.strings.ignoreCase) chips.push({ text: 'Ignore case', off: off(() => { o.strings.ignoreCase = false; }) });
    if (o.strings.trim) chips.push({ text: 'Trim text', off: off(() => { o.strings.trim = false; }) });
    if (o.strings.collapse) chips.push({ text: 'Collapse spaces', off: off(() => { o.strings.collapse = false; }) });
    if (o.strings.nfc) chips.push({ text: 'Normalize Unicode', off: off(() => { o.strings.nfc = false; }) });
    if (o.sortKeys) chips.push({ text: 'Sort keys', off: off(() => { o.sortKeys = false; }) });
    if (o.tolerant) chips.push({ text: 'Not strict JSON', off: off(() => { o.tolerant = false; }) });
    return chips;
  }
  function renderChips() {
    const chips = activeChips();
    el.chips.innerHTML = '';
    el.chips.hidden = chips.length === 0;
    for (const c of chips) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jd-chip';
      b.innerHTML = `${esc(c.text)} <span aria-hidden="true">×</span>`;
      b.setAttribute('aria-label', `${c.text}. Turn off`);
      b.addEventListener('click', c.off);
      li.appendChild(b);
      el.chips.appendChild(li);
    }
    const n = chips.length;
    el.optBtn.firstElementChild.textContent = n ? `Options (${n})` : 'Options';
  }

  // ----- editors -----
  const gutters = { a: $('jd-gut-a'), b: $('jd-gut-b') };
  const errLines = { a: $('jd-errline-a'), b: $('jd-errline-b') };
  const gutterCount = { a: 0, b: 0 };
  // Line height of the editors, read from the page so zoom and font settings keep the marker on the line.
  const lineHeight = () => parseFloat(getComputedStyle(ta.a).lineHeight) || ROW_H;
  function countLines(t) {
    let n = 1;
    let p = t.indexOf('\n');
    while (p !== -1) { n++; p = t.indexOf('\n', p + 1); }
    return n;
  }
  function updateGutter(side) {
    const g = gutters[side];
    const n = countLines(ta[side].value);
    const editor = g.parentElement;
    if (n > 20000) {
      editor.classList.add('no-gutter');
      gutterCount[side] = 0;
      return;
    }
    editor.classList.remove('no-gutter');
    if (n === gutterCount[side]) return;
    gutterCount[side] = n;
    let s = '1';
    for (let i = 2; i <= n; i++) s += '\n' + i;
    g.textContent = s;
    g.style.width = String(n).length + 2 + 'ch';
    g.scrollTop = ta[side].scrollTop;
  }
  function placeErrLine(side) {
    const e = S.sides[side].error;
    const m = errLines[side];
    if (!e) { m.hidden = true; return; }
    const lh = lineHeight();
    const top = 8 + (e.line - 1) * lh - ta[side].scrollTop;
    m.style.height = lh + 'px';
    if (top < -lh || top > ta[side].clientHeight) { m.hidden = true; return; }
    m.hidden = false;
    m.style.transform = `translateY(${top}px)`;
  }
  for (const side of ['a', 'b']) {
    ta[side].addEventListener('scroll', () => {
      gutters[side].scrollTop = ta[side].scrollTop;
      placeErrLine(side);
    }, { passive: true });
    ta[side].addEventListener('paste', (e) => {
      const t = e.clipboardData && e.clipboardData.getData('text');
      if (t && t.length > BIG_AT) {
        e.preventDefault();
        setText(side, t, true);
        requestCompare(0, true);
      }
    });
    ta[side].addEventListener('input', (ev) => {
      if (ta[side].value.length > BIG_AT) { getText(side); requestCompare(0, true); return; }
      updateGutter(side);
      clearSideError(side);
      requestCompare(ev.inputType === 'insertFromPaste' ? 0 : LIVE_DELAY, ev.inputType === 'insertFromPaste');
    });
  }

  // Text of a box. A very large input lives in S.big and the box shows only a preview,
  // because a browser text area gets slow to edit above a few MB.
  function getText(side) {
    if (S.big[side] !== null) return S.big[side];
    const v = ta[side].value;
    if (v.length > BIG_AT) { enterBig(side, v); return v; }
    return v;
  }
  function enterBig(side, full) {
    S.big[side] = full;
    let end = 0;
    for (let i = 0; i < PREVIEW_LINES && end !== -1; i++) end = full.indexOf('\n', end + 1);
    const byChars = end === -1 || end > PREVIEW_CHARS;
    let cut = end;
    if (byChars) {
      // Few long lines (minified JSON): cut after a comma so the preview does not stop inside a token.
      cut = Math.min(PREVIEW_CHARS, full.length);
      const comma = full.lastIndexOf(',', cut);
      if (comma > cut - 2000) cut = comma + 1;
    }
    ta[side].value = full.slice(0, cut) + '\n\u2026';
    ta[side].readOnly = true;
    const mb = (full.length / 1048576).toFixed(1);
    const lines = countLines(full);
    $('jd-big-' + side).hidden = false;
    const shown = byChars ? `the first ${fmtNum(cut)} characters` : `the first ${fmtNum(PREVIEW_LINES)} lines`;
    $('jd-bigtext-' + side).textContent = `Large input: ${mb} MB, ${fmtNum(lines)} ${lines === 1 ? 'line' : 'lines'}. The box shows ${shown}. The whole text is compared.`;
    updateGutter(side);
  }
  function leaveBig(side) {
    if (S.big[side] === null) return;
    S.big[side] = null;
    ta[side].readOnly = false;
    $('jd-big-' + side).hidden = true;
  }
  // Put the whole text back into the box (slow for big input).
  async function editAsText(side) {
    const full = S.big[side];
    if (full === null) return;
    toast('Loading the text into the editor. This may take a while.');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    leaveBig(side);
    ta[side].value = full;
    updateGutter(side);
  }
  function setText(side, text, jump) {
    leaveBig(side);
    if (text.length > BIG_AT) enterBig(side, text); // never put the whole text in the box
    else {
      ta[side].value = text;
      updateGutter(side);
    }
    ta[side].scrollTop = 0;
    ta[side].scrollLeft = 0;
    clearSideError(side);
    if (jump) S.jump = true;
  }

  // ----- pane status and errors -----
  function setStatus(side, state, text) {
    const s = $('jd-st-' + side);
    s.dataset.state = state;
    s.textContent = text;
  }
  function clearSideError(side) {
    S.sides[side].error = null;
    $('jd-err-' + side).hidden = true;
    ta[side].removeAttribute('aria-invalid');
    errLines[side].hidden = true;
  }
  function showSideError(side, e) {
    S.sides[side].error = e;
    const box = $('jd-err-' + side);
    const ctx = e.lineText.replace(/\t/g, ' ');
    box.innerHTML =
      `<p><strong>Line ${e.line}, column ${e.col}.</strong> ${esc(e.message).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` +
      `<pre aria-hidden="true">${esc(ctx)}\n${' '.repeat(e.caret)}^</pre>` +
      `<button type="button" class="btn-sm" data-goto="${side}">Go to the error</button>`;
    box.hidden = false;
    ta[side].setAttribute('aria-invalid', 'true');
    setStatus(side, 'error', `Error at line ${e.line}, column ${e.col}`);
    placeErrLine(side);
  }
  async function gotoError(side) {
    const e = S.sides[side].error;
    if (!e) return;
    if (S.big[side] !== null) await editAsText(side);
    const t = ta[side];
    expandPanes();
    t.focus();
    t.setSelectionRange(e.offset, Math.min(e.offset + 1, t.value.length));
    revealOffset(side, e.line, e.col);
  }
  function revealOffset(side, line, col) {
    const t = ta[side];
    t.scrollTop = Math.max(0, (line - 1) * lineHeight() - t.clientHeight / 2);
    const cw = charWidth(t);
    t.scrollLeft = Math.max(0, (col - 1) * cw - t.clientWidth / 2);
    gutters[side].scrollTop = t.scrollTop;
    placeErrLine(side);
  }
  let cw = 0;
  function charWidth(t) {
    if (cw) return cw;
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + getComputedStyle(t).font;
    s.textContent = 'x'.repeat(50);
    document.body.appendChild(s);
    cw = s.getBoundingClientRect().width / 50 || 8;
    s.remove();
    return cw;
  }

  // ----- worker -----
  const nextId = () => ++S.reqId;
  function getWorker() {
    if (S.worker) return S.worker;
    let w;
    try {
      w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch {
      showMessage('This browser cannot run the compare. Try a current version of Chrome, Edge, Firefox or Safari.');
      return null;
    }
    w.onmessage = (e) => onWorker(e.data);
    w.onerror = () => {
      S.running = false;
      hideProgress();
      showMessage('The comparison stopped because of an error. Reload the page and try again.');
    };
    S.worker = w;
    return w;
  }
  function resetWorker() {
    if (S.worker) S.worker.terminate();
    S.worker = null;
    // Format and patch requests that were waiting will never be answered: tell their buttons.
    const waiting = [...S.pending.values()];
    S.pending.clear();
    for (const cb of waiting) cb({ ok: false, lost: true });
  }

  function requestCompare(delay, jump) {
    clearTimeout(S.timer);
    if (jump) S.jump = true;
    S.timer = setTimeout(runCompare, delay);
  }

  function runCompare() {
    clearTimeout(S.timer);
    const a = getText('a');
    const b = getText('b');
    const blankA = isBlank(a);
    const blankB = isBlank(b);
    if (S.running) { resetWorker(); }
    S.seq++;
    S.view = null;
    if (blankA && blankB) {
      S.running = false;
      hideProgress();
      setStatus('a', 'empty', 'Empty');
      setStatus('b', 'empty', 'Empty');
      clearSideError('a');
      clearSideError('b');
      showEmptyState();
      return;
    }
    S.running = true;
    S.texts = { a, b };
    const id = S.seq;
    clearTimeout(S.progTimer);
    S.progTimer = setTimeout(() => {
      if (S.running && S.seq === id) {
        S.bigWarn = Math.max(a.length, b.length) > BIG_CHARS;
        showProgress(S.bigWarn ? 'This may take a while.' : 'Working', 0);
      }
    }, 400);
    const w = getWorker();
    if (!w) { S.running = false; return; }
    w.postMessage({ type: 'compare', id, a, b, opts: S.opts });
  }

  function onWorker(m) {
    if (m.type === 'formatted' || m.type === 'patch') {
      const cb = S.pending.get(m.id);
      if (cb) { S.pending.delete(m.id); cb(m); }
      return;
    }
    if (m.type === 'view') return onView(m);
    if (m.id !== S.seq) return; // an older compare
    if (m.type === 'progress') {
      if (!el.progress.hidden) showProgress(S.bigWarn ? 'This may take a while. ' + m.stage : m.stage, m.fraction);
    } else if (m.type === 'invalid') {
      S.running = false;
      hideProgress();
      onInvalid(m);
    } else if (m.type === 'result') {
      onResult(m);
    } else if (m.type === 'chunk') {
      for (let i = 0; i < m.items.length; i++) S.changes[m.from + i] = m.items[i];
      S.loaded = Math.min(S.total, m.from + m.items.length);
      onChunk();
    } else if (m.type === 'done') {
      S.running = false;
      hideProgress();
      afterLoaded();
    } else if (m.type === 'error') {
      S.running = false;
      hideProgress();
      showMessage('Something went wrong while comparing: ' + m.message);
    }
  }

  function showProgress(stage, f) {
    el.progress.hidden = false;
    el.progText.textContent = stage;
    if (f > 0 && f < 1) { el.progBar.value = f; } else el.progBar.removeAttribute('value');
  }
  function hideProgress() {
    clearTimeout(S.progTimer);
    el.progress.hidden = true;
  }
  el.cancel.addEventListener('click', () => {
    resetWorker();
    S.running = false;
    S.seq++;
    hideProgress();
    showMessage('Compare cancelled. Press Compare to run it again.');
  });

  // ----- result states -----
  function showMessage(text) {
    S.resultOk = false;
    el.res.hidden = true;
    el.empty.hidden = true;
    el.msg.hidden = false;
    el.msg.textContent = text;
    announce(text);
  }
  function showEmptyState() {
    S.resultOk = false;
    el.res.hidden = true;
    el.msg.hidden = true;
    el.empty.hidden = false;
  }
  function onInvalid(m) {
    S.resultOk = false;
    const bad = [];
    for (const side of ['a', 'b']) {
      const r = m[side];
      clearSideError(side);
      if (r && r.error) {
        showSideError(side, r.error);
        bad.push(side);
      } else if (r && r.empty) setStatus(side, 'empty', 'Empty');
      else setStatus(side, 'valid', 'Valid');
    }
    let text;
    if (bad.length === 2) text = 'Fix the errors in both inputs to compare.';
    else if (bad.length === 1) text = `Fix the error in the ${bad[0] === 'a' ? 'original' : 'changed'} input to compare.`;
    else if (m.a && m.a.empty) text = 'Paste the first JSON to compare.';
    else text = 'Paste the second JSON to compare.';
    showMessage(text);
  }
  function onResult(m) {
    for (const side of ['a', 'b']) {
      clearSideError(side);
      setStatus(side, 'valid', 'Valid');
    }
    S.resultOk = true;
    S.total = m.total;
    S.summary = m.summary;
    S.changes = m.items.slice();
    S.loaded = m.items.length;
    S.choices = m.choices;
    S.hints = m.hints;
    S.ignored = m.ignored;
    S.warnings = m.warnings;
    S.sumTextRaw = m.summaryText;
    S.shown = 0;
    S.cur = -1;
    S.kinds = new Set();
    el.msg.hidden = true;
    el.empty.hidden = true;
    el.res.hidden = false;
    renderSummary();
    renderInfo();
    buildFiltered();
    renderList(true);
    announce(m.total === 0 ? 'No differences found.' : `${m.total} ${m.total === 1 ? 'change' : 'changes'} found.`);
    if (S.tab === 'sbs') loadView();
    if (S.jump) {
      S.jump = false;
      if (isPhone()) { collapsePanes(); el.res.scrollIntoView({ block: 'start' }); setBar('result'); }
    }
  }
  function onChunk() {
    buildFiltered();
    updateListNote();
    if (S.shown < Math.min(PAGE, S.filtered.length)) renderList(false);
  }
  function afterLoaded() {
    updatePatchButton();
  }

  // ----- summary, filters, info -----
  function renderSummary() {
    const s = S.summary;
    el.sumText.innerHTML = '';
    if (s.total === 0) {
      el.sumText.innerHTML = '<span class="ok-mark" aria-hidden="true">✓</span> <strong>No differences</strong>';
    } else {
      el.sumText.innerHTML = `<strong>${fmtNum(s.total)} ${s.total === 1 ? 'change' : 'changes'}</strong>`;
    }
    el.filters.innerHTML = '';
    for (const k of ['changed', 'added', 'removed', 'type']) {
      if (!s[k]) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jd-filter k-' + k;
      b.dataset.kind = k;
      b.setAttribute('aria-pressed', 'false');
      const label = k === 'type' ? (s[k] === 1 ? 'type change' : 'type changes') : k;
      b.innerHTML = `<span class="sym" aria-hidden="true">${KIND[k].sym}</span> ${fmtNum(s[k])} ${label}`;
      el.filters.appendChild(b);
    }
    const has = s.total > 0;
    el.copyReport.hidden = el.download.hidden = !has;
    el.copyPatch.hidden = !has;
    el.tabList.parentElement.hidden = !has;
    if (!has) setTab('list');
    updatePatchButton();
  }
  function renderInfo() {
    const parts = [];
    const ch = S.choices.slice(0, 8);
    if (ch.length) {
      const items = ch.map((c) => {
        const where = c.path === '$' ? 'root array' : esc(c.path.replace(/^\$\.?/, ''));
        const how = c.mode === 'key' ? `by ${esc(c.key)}` : c.mode === 'order' ? 'ignoring order' : 'by position';
        const ov = S.opts.overrides[c.path] || 'auto';
        const autoLabel = ov === 'auto' ? `Auto (${how})` : 'Auto';
        const sel = ['auto', 'position', 'order'].map((v) => `<option value="${v}"${v === ov ? ' selected' : ''}>${v === 'auto' ? autoLabel : v === 'position' ? 'By position' : 'Ignore order'}</option>`).join('');
        return `<label class="choice"><code>${where}</code><select class="ctl ctl-sm" data-ov="${esc(c.path)}" aria-label="How to match ${where}">${sel}</select></label>`;
      });
      const more = S.choices.length > 8 ? `<span class="info-line">and ${S.choices.length - 8} more</span>` : '';
      parts.push(`<div class="info-choices"><span class="info-line">Matching arrays:</span>${items.join('')}${more}</div>`);
    }
    for (const h of S.hints) {
      const where = h.path === '$' ? 'The root array' : '<code>' + esc(h.path.replace(/^\$\.?/, '')) + '</code>';
      parts.push(`<p class="info-hint">${where} has mostly the same items in a different order. <button type="button" class="link" data-hint="${esc(h.path)}">Ignore order here</button></p>`);
    }
    if (S.ignored.patterns) {
      parts.push(`<p class="info-line">Ignored: ${S.ignored.patterns} ${S.ignored.patterns === 1 ? 'pattern' : 'patterns'}, ${fmtNum(S.ignored.places)} ${S.ignored.places === 1 ? 'place' : 'places'}.</p>`);
    }
    if (S.patchWhy) parts.push(`<p class="info-line">${esc(S.patchWhy)}</p>`);
    for (const w of S.warnings || []) parts.push(`<p class="info-warn"><span class="warn-mark" aria-hidden="true">!</span> ${esc(w).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`);
    if (S.summary.total === 0) {
      const bits = ['Key order and spacing are ignored.'];
      if (S.ignored.patterns) bits.push(`${S.ignored.patterns} ${S.ignored.patterns === 1 ? 'path' : 'paths'} ignored.`);
      parts.unshift(`<p class="info-line">${bits.join(' ')}</p>`);
    }
    el.info.innerHTML = parts.join('');
  }

  function buildFiltered() {
    const k = S.kinds;
    const src = S.changes;
    S.filtered = k.size ? src.filter((c) => c && k.has(c.kind)) : src.filter(Boolean);
  }

  el.filters.addEventListener('click', (e) => {
    const b = e.target.closest('.jd-filter');
    if (!b) return;
    const k = b.dataset.kind;
    if (S.kinds.has(k)) S.kinds.delete(k);
    else S.kinds.add(k);
    b.setAttribute('aria-pressed', S.kinds.has(k) ? 'true' : 'false');
    buildFiltered();
    renderList(true);
  });

  // ----- change list -----
  function valueHtml(c, side) {
    const text = side === 'a' ? c.a : c.b;
    if (c.kind === 'changed' && c.sa !== undefined) {
      const hl = inlineDiff(c, side);
      if (hl) return hl;
      return esc(text);
    }
    return esc(text);
  }
  function inlineDiff(c, side) {
    const long = c.sa.length > 40 || c.sb.length > 40;
    let parts;
    try {
      const fn = long || c.sa.length * c.sb.length > 4_000_000 ? diffWordsWithSpace : diffChars;
      parts = fn(c.sa, c.sb, { timeout: 60 });
    } catch { return null; }
    if (!parts) return null;
    const q = (s) => esc(JSON.stringify(s).slice(1, -1));
    let out = '&quot;';
    for (const p of parts) {
      if (side === 'a') {
        if (p.added) continue;
        out += p.removed ? `<del>${q(p.value)}</del>` : q(p.value);
      } else {
        if (p.removed) continue;
        out += p.added ? `<ins>${q(p.value)}</ins>` : q(p.value);
      }
    }
    return out + '&quot;' + (c.sa.length >= 5000 ? '…' : '');
  }
  function rowHtml(c) {
    const k = KIND[c.kind];
    const long = (c.a && c.a.length > 150) || (c.b && c.b.length > 150);
    const val = (side, lbl) => `<div class="val val-${side}"><span class="lbl">${lbl}</span><code class="vtxt${long ? ' clamp' : ''}">${valueHtml(c, side)}</code></div>`;
    let vals = '';
    if (c.kind === 'added') vals = val('b', 'Value');
    else if (c.kind === 'removed') vals = val('a', 'Was');
    else vals = val('a', 'Before') + val('b', 'After');
    const note = c.kind === 'type' ? `<p class="note">Type changed: ${c.aType} to ${c.bType}.</p>` : c.note ? `<p class="note">${esc(c.note)}</p>` : '';
    return `<li class="row k-${c.kind}"><div role="group" aria-label="${esc(changeLabel(c))}">` +
      `<div class="row-head"><span class="badge"><span class="sym" aria-hidden="true">${k.sym}</span> ${k.label}</span><code class="path">${esc(c.path)}</code></div>` +
      `<div class="vals">${vals}</div>${note}` +
      `<div class="row-acts">${long ? '<button type="button" class="mini" data-act="more" aria-expanded="false">Show more</button>' : ''}` +
      `<button type="button" class="mini" data-act="copy-path">Copy path</button>` +
      `<button type="button" class="mini" data-act="show">Show in editors</button></div></div></li>`;
  }
  function renderList(reset) {
    if (reset) {
      el.list.innerHTML = '';
      S.shown = 0;
    }
    const end = Math.min(S.filtered.length, S.shown + PAGE);
    if (end > S.shown) {
      const parts = [];
      for (let i = S.shown; i < end; i++) parts.push(rowHtml(S.filtered[i]));
      el.list.insertAdjacentHTML('beforeend', parts.join(''));
      S.shown = end;
    }
    updateListNote();
  }
  function updateListNote() {
    const total = S.kinds.size ? S.filtered.length : S.total;
    const loading = !S.kinds.size && S.loaded < S.total;
    let txt = '';
    if (S.shown < S.filtered.length) {
      txt = `Showing the first ${fmtNum(S.shown)} of ${fmtNum(total)} changes.${S.total > 10000 ? ' Copy report includes all.' : ''}`;
      el.more.hidden = false;
      el.more.textContent = `Show ${fmtNum(Math.min(PAGE, S.filtered.length - S.shown))} more`;
    } else {
      el.more.hidden = true;
      if (loading) txt = `Loading ${fmtNum(S.total - S.loaded)} more changes…`;
      else if (S.kinds.size && S.filtered.length === 0) txt = 'No changes of this kind.';
    }
    el.listNote.textContent = txt;
    el.listNote.hidden = txt === '';
  }
  el.more.addEventListener('click', () => renderList(false));
  el.list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('li.row');
    const c = S.filtered[Number([...el.list.children].indexOf(li))];
    if (!c) return;
    if (b.dataset.act === 'copy-path') copyText(c.path, 'Path copied');
    else if (b.dataset.act === 'show') showInEditors(c);
    else if (b.dataset.act === 'more') {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Show less' : 'Show more';
      li.querySelectorAll('.vtxt').forEach((v) => v.classList.toggle('clamp', !open));
    }
  });

  function showInEditors(c) {
    if (getText('a') !== S.texts.a || getText('b') !== S.texts.b) {
      toast('The text changed after this result. Press Compare, then try again.');
      return;
    }
    expandPanes();
    const jobs = [['a', c.ptrA], ['b', c.ptrB]];
    let focusSide = null;
    let bigSkipped = false;
    for (const [side, ptr] of jobs) {
      if (ptr === null) continue;
      if (S.big[side] !== null) { bigSkipped = true; continue; }
      const loc = locate(ta[side].value, ptr);
      if (!loc) continue;
      const t = ta[side];
      t.setSelectionRange(loc.start, Math.min(loc.end, loc.start + 20000));
      const lc = lineCol(t.value, loc.start);
      revealOffset(side, lc.line, lc.col);
      if (!focusSide) focusSide = side;
    }
    if (focusSide) {
      ta[focusSide].focus({ preventScroll: true });
      ta[focusSide].closest('.jd-pane').scrollIntoView({ block: 'nearest' });
    } else toast(bigSkipped ? 'Large input. Choose Edit as text to see the exact place.' : 'Could not find this value in the text.');
  }

  // ----- tabs -----
  function setTab(name) {
    S.tab = name;
    const list = name === 'list';
    el.tabList.setAttribute('aria-selected', String(list));
    el.tabSbs.setAttribute('aria-selected', String(!list));
    el.tabList.tabIndex = list ? 0 : -1;
    el.tabSbs.tabIndex = list ? -1 : 0;
    el.panelList.hidden = !list;
    el.panelSbs.hidden = list;
    if (!list && S.resultOk) loadView();
  }
  el.tabList.addEventListener('click', () => setTab('list'));
  el.tabSbs.addEventListener('click', () => setTab('sbs'));
  [el.tabList, el.tabSbs].forEach((t) => t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = t === el.tabList ? el.tabSbs : el.tabList;
      next.focus();
      setTab(next === el.tabList ? 'list' : 'sbs');
    }
  }));

  // ----- side by side -----
  // One row per pair of lines. The worker lines the two documents up (see view.js), so a row can
  // hold a line on one side and a blank filler on the other. Both panes scroll as one.
  class VList {
    constructor(side, vp, sizer, win) {
      this.side = side; this.vp = vp; this.sizer = sizer; this.win = win;
      this.raf = 0;
      vp.addEventListener('scroll', () => { this.schedule(); if (this.onscroll) this.onscroll(); }, { passive: true });
    }
    set(rows) {
      this.sizer.style.height = rows * ROW_H + 'px';
      this.vp.scrollTop = 0;
      this.render();
    }
    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
    }
    render() {
      const v = S.view;
      if (!v) return;
      const rows = this.side === 'a' ? v.rowsA : v.rowsB;
      const lines = this.side === 'a' ? v.a : v.b;
      const marks = this.side === 'a' ? v.markA : v.markB;
      const h = this.vp.clientHeight || 400;
      const first = Math.max(0, Math.floor(this.vp.scrollTop / ROW_H) - 5);
      const last = Math.min(rows.length, first + Math.ceil(h / ROW_H) + 12);
      this.win.style.transform = `translateY(${first * ROW_H}px)`;
      const frag = document.createDocumentFragment();
      const sp = S.cur >= 0 ? v.spans[S.cur] : null;
      const curLo = sp ? (this.side === 'a' ? sp[0] : sp[2]) : -1;
      const curHi = sp ? (this.side === 'a' ? sp[1] : sp[3]) : -1;
      for (let r = first; r < last; r++) {
        const i = rows[r];
        const d = document.createElement('div');
        if (i < 0) {
          d.className = 'sl fill';
          d.setAttribute('aria-hidden', 'true');
          frag.appendChild(d);
          continue;
        }
        const ci = marks[i];
        let cls = 'sl';
        let mk = '';
        if (ci >= 0) {
          const c = S.changes[ci];
          cls += ' m-' + c.kind;
          mk = KIND[c.kind].sym;
          d.dataset.ci = ci;
        }
        if (curLo >= 0 && i >= curLo && i <= curHi) cls += ' cur';
        d.className = cls;
        const n = document.createElement('span');
        n.className = 'sn';
        n.textContent = i + 1;
        const m = document.createElement('span');
        m.className = 'sm';
        m.setAttribute('aria-hidden', 'true');
        m.textContent = mk;
        const t = document.createElement('span');
        t.className = 'st';
        t.textContent = lines[i];
        d.append(n, m, t);
        frag.appendChild(d);
      }
      this.win.replaceChildren(frag);
    }
    scrollToRow(r) {
      this.vp.scrollTop = Math.max(0, r * ROW_H - this.vp.clientHeight / 2 + ROW_H);
      this.render();
    }
  }
  const vl = {
    a: new VList('a', $('jd-sv-a'), $('jd-sz-a'), $('jd-sw-a')),
    b: new VList('b', $('jd-sv-b'), $('jd-sz-b'), $('jd-sw-b')),
  };
  let syncing = false;
  for (const [x, y] of [[vl.a, vl.b], [vl.b, vl.a]]) {
    x.onscroll = () => {
      if (syncing) return;
      syncing = true;
      y.vp.scrollTop = x.vp.scrollTop;
      y.vp.scrollLeft = x.vp.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    };
  }

  function loadView() {
    if (!S.resultOk) return;
    if (S.view && S.view.sortKeys === S.opts.sortKeys && S.view.compareId === S.seq) { showView(); return; }
    const id = nextId();
    el.sbsNote.textContent = 'Loading…';
    const w = getWorker();
    if (!w) return;
    w.postMessage({ type: 'view', id, sortKeys: S.opts.sortKeys });
    S.viewWait = { id, compareId: S.seq };
  }
  function onView(m) {
    if (!S.viewWait || m.id !== S.viewWait.id || S.viewWait.compareId !== S.seq) return;
    if (!m.ok) { el.sbsNote.textContent = 'Compare first to see both documents.'; return; }
    const mark = (n, side) => {
      const arr = new Int32Array(n).fill(-1);
      for (let ci = 0; ci < m.spans.length; ci++) {
        const lo = side === 'a' ? m.spans[ci][0] : m.spans[ci][2];
        const hi = side === 'a' ? m.spans[ci][1] : m.spans[ci][3];
        if (lo < 0) continue;
        for (let i = lo; i <= hi && i < n; i++) if (arr[i] < 0) arr[i] = ci;
      }
      return arr;
    };
    S.view = {
      sortKeys: S.opts.sortKeys, compareId: S.seq, spans: m.spans, a: m.a, b: m.b,
      rowsA: m.rowsA, rowsB: m.rowsB, lineRowA: m.lineRowA, lineRowB: m.lineRowB,
      markA: mark(m.a.length, 'a'), markB: mark(m.b.length, 'b'),
    };
    showView();
  }
  function showView() {
    el.sbsNote.textContent = S.ignored.patterns ? 'Ignored paths are hidden here.' : '';
    const rows = S.view.rowsA.length;
    vl.a.set(rows);
    vl.b.set(rows);
    updateCurLabel();
  }
  function updateCurLabel() {
    const n = S.total;
    if (S.cur < 0 || !S.changes[S.cur]) el.curLabel.textContent = n ? `${fmtNum(n)} ${n === 1 ? 'change' : 'changes'}. Press n for the next.` : '';
    else el.curLabel.textContent = `Change ${S.cur + 1} of ${fmtNum(n)}: ${S.changes[S.cur].path}`;
  }
  function goChange(delta) {
    if (!S.view || !S.total) return;
    const n = S.total;
    S.cur = S.cur < 0 ? (delta > 0 ? 0 : n - 1) : (S.cur + delta + n) % n;
    selectChange(S.cur);
  }
  function selectChange(ci) {
    S.cur = ci;
    const v = S.view;
    const sp = v.spans[ci];
    const rowA = sp[0] >= 0 ? v.lineRowA[sp[0]] : -1;
    const rowB = sp[2] >= 0 ? v.lineRowB[sp[2]] : -1;
    const row = Math.max(0, rowA >= 0 ? rowA : rowB);
    syncing = true;
    vl.a.scrollToRow(row);
    vl.b.scrollToRow(row);
    requestAnimationFrame(() => { syncing = false; });
    updateCurLabel();
  }
  el.prev.addEventListener('click', () => goChange(-1));
  el.next.addEventListener('click', () => goChange(1));
  for (const side of ['a', 'b']) {
    $('jd-sv-' + side).addEventListener('click', (e) => {
      const d = e.target.closest('[data-ci]');
      if (d && S.view) selectChange(Number(d.dataset.ci));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (S.tab !== 'sbs' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'n') { e.preventDefault(); goChange(1); }
    else if (e.key === 'p') { e.preventDefault(); goChange(-1); }
  });

  // Phone: show Before or After, one at a time.
  const sw = root.querySelectorAll('[data-sbs]');
  sw.forEach((b) => b.addEventListener('click', () => {
    sw.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    root.querySelectorAll('.jd-sbs-col').forEach((c) => { c.dataset.hide = String(c.dataset.col !== b.dataset.sbs); });
    const side = b.dataset.sbs;
    const other = side === 'a' ? vl.b : vl.a;
    vl[side].vp.scrollTop = other.vp.scrollTop;
    vl[side].render();
  }));

  // ----- report, patch -----
  const allLoaded = () => S.loaded >= S.total;
  // The report follows the filter: with "added" and "removed" on, it lists only those.
  function buildReport() {
    const list = S.kinds.size ? S.filtered : S.changes.filter(Boolean);
    const extra = [];
    if (S.kinds.size) extra.push(`Filter: ${[...S.kinds].join(', ')} (${fmtNum(list.length)} of ${fmtNum(S.total)} changes)`);
    const chips = activeChips().map((c) => c.text);
    if (chips.length) extra.push('Options: ' + chips.join('; '));
    if (list.some((c) => /\u2026"?$/.test(c.a || '') || /\u2026"?$/.test(c.b || ''))) extra.push('Values longer than 2,000 characters are shortened.');
    return reportText(S.sumTextRaw, list, extra);
  }
  el.copyReport.addEventListener('click', () => {
    if (!allLoaded()) { toast('Still loading changes. Try again in a moment.'); return; }
    copyText(buildReport(), S.kinds.size ? 'Filtered report copied' : 'Report copied');
  });
  el.download.addEventListener('click', () => {
    if (!allLoaded()) { toast('Still loading changes. Try again in a moment.'); return; }
    download('json-diff-report.txt', buildReport());
  });
  function patchBlocked() {
    // A patch needs positions. Matching by key or by content can move items, and ignored paths shift indexes.
    if (S.choices.some((c) => c.mode !== 'position')) return 'Set Arrays to By position to make a patch.';
    if (S.ignored.patterns) return 'Turn off Ignore paths to make a patch.';
    return '';
  }
  function updatePatchButton() {
    const why = S.resultOk && S.total ? patchBlocked() : '';
    el.copyPatch.disabled = !!why;
    el.copyPatch.title = why || 'JSON Patch (RFC 6902)';
    S.patchWhy = why;
    if (S.resultOk) renderInfo();
  }
  // Ask the worker for something and call back with the answer (or { ok: false } if the worker was reset).
  function askWorker(msg, cb) {
    const w = getWorker();
    if (!w) return;
    const id = nextId();
    S.pending.set(id, cb);
    w.postMessage({ ...msg, id });
  }
  const retry = () => toast('That was interrupted. Try again.');
  el.copyPatch.addEventListener('click', () => {
    askWorker({ type: 'patch' }, (m) => { if (m.ok) copyText(m.text, 'JSON Patch copied'); else if (m.lost) retry(); else toast('Could not make a patch.'); });
  });

  // ----- pane buttons -----
  function formatSide(side) {
    askWorker({ type: 'format', text: getText(side), tolerant: S.opts.tolerant }, (m) => {
      if (m.lost) { retry(); return; }
      if (!m.ok) { showSideError(side, m.error); return; }
      setText(side, m.text, false);
      requestCompare(0);
    });
  }
  function openFile(side, file) {
    if (!file) return;
    if (file.size > MAX_FILE) { toast('That file is larger than 50 MB. Open a smaller file.'); return; }
    file.text().then((t) => {
      setText(side, t, true);
      if (file.size > WARN_FILE) toast('Large file. This may take a while.');
      requestCompare(0, true);
    }).catch(() => toast('Could not read that file.'));
  }
  for (const side of ['a', 'b']) {
    const pane = $('jd-pane-' + side);
    const fileInput = pane.querySelector('input[type=file]');
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'open') fileInput.click();
      else if (act === 'format') { if (!isBlank(getText(side))) formatSide(side); }
      else if (act === 'copy') { const t = getText(side); if (t) copyText(t, 'Copied'); }
      else if (act === 'clear') { setText(side, '', false); requestCompare(0); ta[side].focus(); }
      else if (act === 'collapse') {
        const c = !pane.classList.contains('is-collapsed');
        pane.classList.toggle('is-collapsed', c);
        b.setAttribute('aria-expanded', String(!c));
        b.textContent = c ? 'Show' : 'Hide';
      }
    });
    pane.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) gotoError(g.dataset.goto);
      const bb = e.target.closest('[data-big]');
      if (bb && bb.dataset.big === 'edit') editAsText(side);
      else if (bb && bb.dataset.big === 'format') formatSide(side);
      else if (bb && bb.dataset.big === 'clear') { setText(side, '', false); requestCompare(0); ta[side].focus(); }
    });
    fileInput.addEventListener('change', () => { openFile(side, fileInput.files[0]); fileInput.value = ''; });
    pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('is-drop'); });
    pane.addEventListener('dragleave', () => pane.classList.remove('is-drop'));
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.classList.remove('is-drop');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openFile(side, f);
    });
  }
  function expandPanes() {
    for (const side of ['a', 'b']) {
      const pane = $('jd-pane-' + side);
      pane.classList.remove('is-collapsed');
      const b = pane.querySelector('[data-act=collapse]');
      b.setAttribute('aria-expanded', 'true');
      b.textContent = 'Hide';
    }
  }
  function collapsePanes() {
    for (const side of ['a', 'b']) {
      const pane = $('jd-pane-' + side);
      pane.classList.add('is-collapsed');
      const b = pane.querySelector('[data-act=collapse]');
      b.setAttribute('aria-expanded', 'false');
      b.textContent = 'Show';
    }
  }

  // ----- toolbar -----
  $('jd-sample').addEventListener('click', () => {
    setText('a', SAMPLE_A, true);
    setText('b', SAMPLE_B, true);
    expandPanes();
    requestCompare(0, true);
  });
  $('jd-swap').addEventListener('click', () => {
    const a = getText('a');
    setText('a', getText('b'), false);
    setText('b', a, false);
    requestCompare(0);
  });
  $('jd-clear').addEventListener('click', () => {
    setText('a', '', false);
    setText('b', '', false);
    runCompare();
    expandPanes();
    ta.a.focus();
  });
  $('jd-compare').addEventListener('click', () => requestCompare(0, true));
  $('jd-compare-bar').addEventListener('click', () => requestCompare(0, true));
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); requestCompare(0, true); }
  });

  el.arrays.addEventListener('change', () => { formToOpts(); optsToForm(); requestCompare(0); });
  el.key.addEventListener('input', () => { formToOpts(); renderChips(); requestCompare(LIVE_DELAY); });
  el.ignore.addEventListener('input', () => { formToOpts(); renderIgnoreErrors(); renderChips(); requestCompare(LIVE_DELAY); });
  for (const x of [...el.numMode, el.sIgnoreCase, el.sTrim, el.sCollapse, el.sNfc, el.tolerant]) {
    x.addEventListener('change', () => { formToOpts(); optsToForm(); requestCompare(0); });
  }
  for (const x of [el.abs, el.rel]) x.addEventListener('input', () => { formToOpts(); renderChips(); requestCompare(LIVE_DELAY); });
  el.sortKeys.addEventListener('change', () => {
    S.opts.sortKeys = el.sortKeys.checked;
    saveOptions();
    optsToForm();
    if (S.tab === 'sbs') loadView();
  });
  el.optBtn.addEventListener('click', () => toggleOptions());
  function toggleOptions(force) {
    const open = force !== undefined ? force : el.optPanel.hidden;
    el.optPanel.hidden = !open;
    el.optBtn.setAttribute('aria-expanded', String(open));
  }
  $('jd-reset-opts').addEventListener('click', () => {
    S.opts = defaultOptions();
    saveOptions();
    optsToForm();
    requestCompare(0);
  });
  // Matching arrays: each array has its own choice, and a hint can switch one to Ignore order.
  function setOverride(path, mode) {
    if (mode === 'auto') delete S.opts.overrides[path];
    else S.opts.overrides[path] = mode;
    saveOptions();
    renderChips();
    requestCompare(0);
  }
  el.info.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-ov]');
    if (sel) setOverride(sel.dataset.ov, sel.value);
  });
  el.info.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hint]');
    if (h) setOverride(h.dataset.hint, 'order');
  });
  root.querySelectorAll('[data-act=sample-empty]').forEach((b) => b.addEventListener('click', () => $('jd-sample').click()));

  // ----- phone layout -----
  const mq = window.matchMedia('(max-width: 720px)');
  const isPhone = () => mq.matches;
  function setBar(which) {
    el.bar.querySelectorAll('button').forEach((b) => {
      if (b.dataset.go === which) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }
  el.bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-go]');
    if (!b) return;
    if (b.dataset.go === 'edit') {
      expandPanes();
      $('jd-pane-a').scrollIntoView({ block: 'start' });
      setBar('edit');
    } else {
      collapsePanes();
      (S.resultOk ? el.res : el.msg.hidden ? el.empty : el.msg).scrollIntoView({ block: 'start' });
      setBar('result');
    }
  });
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const upd = () => {
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb', gap + 'px');
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
  }
  setBar('edit');

  // ----- start -----
  optsToForm();
  updateGutter('a');
  updateGutter('b');
  showEmptyState();
  root.dataset.ready = 'true';
}
