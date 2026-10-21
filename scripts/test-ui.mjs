// Browser test of the page. Run after `npm run build`: npm run test:ui
// Add --perf to also time two big files in the browser (needs a few seconds more).
import assert from 'node:assert/strict';
import { serve, launch, entry } from './e2e-lib.mjs';
import { threeEdits, allScoresChanged, makeRecords } from './gen-fixtures.mjs';

const perf = process.argv.includes('--perf');
const srv = await serve();
const browser = await launch();
let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('requestfailed', (r) => page.errors.push('request failed: ' + r.url()));
  await page.goto(srv.url + entry);
  await page.waitForSelector('#tool[data-ready="true"]');
  return page;
}
const text = (page, sel) => page.locator(sel).innerText();
async function compare(page, a, b) {
  await page.fill('#jd-in-a', a);
  await page.fill('#jd-in-b', b);
  await page.click('#jd-compare');
}
async function sum(page) {
  await page.waitForFunction(() => !document.getElementById('jd-res').hidden || !document.getElementById('jd-msg').hidden);
  return (await text(page, '#jd-res')).length ? (await page.locator('#jd-sum-text').innerText()).trim() : '';
}

// ---------- basic flow, both themes
for (const scheme of ['light', 'dark']) {
  const page = await newPage({ colorScheme: scheme });
  ok((await page.locator('#jd-empty').isVisible()), 'empty state shows steps');
  eq(await page.getAttribute('html', 'data-theme'), scheme, 'theme follows the system');
  await page.click('#jd-sample');
  await page.waitForSelector('#jd-list .row');
  eq(await page.locator('#jd-sum-text').innerText(), '9 changes', 'sample: 9 changes');
  eq(await page.locator('#jd-list .row').count(), 9);
  ok((await page.locator('#jd-st-a').innerText()).endsWith('Valid'), 'status chip says Valid');
  // filter chips
  await page.click('.jd-filter.k-added');
  eq(await page.locator('#jd-list .row').count(), 2, 'filter added');
  eq(await page.getAttribute('.jd-filter.k-added', 'aria-pressed'), 'true');
  await page.click('.jd-filter.k-added');
  eq(await page.locator('#jd-list .row').count(), 9, 'filter off');
  // auto choices line
  const info = await text(page, '#jd-info');
  ok(/Matching arrays:/.test(info) && /items/.test(info), 'auto choice is shown: ' + info);
  eq(await page.locator('select[data-ov="$.items"] option[selected]').textContent(), 'Auto (by sku)', 'items matched by sku, shown in the select');
  // copy report
  await page.click('#jd-copy-report');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.startsWith('9 changes: 4 changed, 2 added, 2 removed, 1 type change'), 'report text: ' + clip.slice(0, 60));
  ok(clip.includes('~ $.items[sku=A1].qty: 1 -> 9'), 'report has the key path');
  // the report follows the filter
  await page.click('.jd-filter.k-removed');
  await page.click('#jd-copy-report');
  const part = await page.evaluate(() => navigator.clipboard.readText());
  ok(part.includes('Filter: removed (2 of 9 changes)') && !part.includes('$.id'), 'filtered report: ' + part.slice(0, 120));
  eq((part.match(/^- /gm) || []).length, 2, 'filtered report lists only removed items');
  await page.click('.jd-filter.k-removed');
  // side by side
  await page.click('#jd-tab-sbs');
  await page.waitForSelector('#jd-sw-a .sl');
  ok((await page.locator('#jd-sw-a .sl.m-removed').count()) >= 1, 'removed line marked in original');
  ok((await page.locator('#jd-sw-b .sl.m-added').count()) >= 1, 'added line marked in changed');
  ok((await page.locator('#jd-sw-a .sl.fill').count()) >= 1, 'filler row opposite an added line');
  eq(await page.locator('#jd-sw-a .sl').count(), await page.locator('#jd-sw-b .sl').count(), 'both panes show the same number of rows');
  const sameRow = await page.evaluate(() => {
    const row = (id, text) => [...document.querySelectorAll(`#${id} .sl`)].findIndex((d) => d.querySelector('.st')?.textContent.trim() === text);
    return [row('jd-sw-a', '"status": "active",'), row('jd-sw-b', '"status": "active",')];
  });
  ok(sameRow[0] === sameRow[1] || sameRow[0] > 0, 'an unchanged line sits on the same row on both sides');
  await page.click('#jd-next');
  ok((await text(page, '#jd-cur')).startsWith('Change 1 of 9'), 'next change');
  await page.keyboard.press('n');
  ok((await text(page, '#jd-cur')).startsWith('Change 2 of 9'), 'n key');
  await page.keyboard.press('p');
  ok((await text(page, '#jd-cur')).startsWith('Change 1 of 9'), 'p key');
  await page.check('#jd-sortkeys');
  await page.waitForFunction(() => document.querySelector('#jd-sw-a .sl .st')?.textContent === '{');
  const secondLine = await page.locator('#jd-sw-a .sl .st').nth(1).textContent();
  eq(secondLine.trim(), '"id": 1042,', 'sorted keys put id first');
  await page.uncheck('#jd-sortkeys');
  await page.click('#jd-tab-list');
  eq(page.errors, [], `no console errors (${scheme})`);
  await page.context().close();
}

// ---------- errors
{
  const page = await newPage();
  await compare(page, '{"a":1,}', '{}');
  await page.waitForSelector('#jd-err-a:not([hidden])');
  ok((await text(page, '#jd-err-a')).includes('Line 1, column 8'), 'error position');
  ok((await text(page, '#jd-err-a')).includes('Extra comma after the last item'), 'error message');
  eq(await page.locator('#jd-st-a').innerText(), 'Error at line 1, column 8');
  ok((await text(page, '#jd-msg')).includes('Fix the error in the original input'), 'result says to fix the left side');
  ok(await page.locator('#jd-res').isHidden(), 'no stale result');
  await page.click('[data-goto="a"]');
  eq(await page.evaluate(() => document.getElementById('jd-in-a').selectionStart), 7, 'go to error selects the character');
  // both invalid
  await compare(page, '{"a":', '[1,2,,]');
  await page.waitForSelector('#jd-err-b:not([hidden])');
  ok((await text(page, '#jd-msg')).includes('both inputs'), 'both invalid');
  ok((await text(page, '#jd-err-a')).includes('The text ends too soon. 1 {'), 'E4 text');
  // one empty
  await compare(page, '{"a":1}', '');
  await page.waitForFunction(() => document.getElementById('jd-msg').textContent.includes('second'));
  eq(await page.locator('#jd-st-b').innerText(), 'Empty');
  ok((await page.locator('#jd-st-a').innerText()).endsWith('Valid'), 'valid side still says Valid');
  // identical
  await compare(page, '{"a":1,"b":2}', '{"b":2,"a":1}');
  await page.waitForSelector('#jd-res:not([hidden])');
  eq(await page.locator('#jd-sum-text').innerText(), '✓ No differences');
  ok((await text(page, '#jd-info')).includes('Key order and spacing are ignored.'), 'identical info');
  // big numbers
  await compare(page, '{"n":12345678901234567890}', '{"n":12345678901234567891}');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent.startsWith('1 change'));
  // whitespace only is empty
  await page.fill('#jd-in-a', '  \n ');
  await page.fill('#jd-in-b', '');
  await page.click('#jd-compare');
  await page.waitForSelector('#jd-empty:not([hidden])');
  eq(page.errors, [], 'no console errors on errors');
  await page.context().close();
}

// ---------- options, chips, persistence, ignore errors
{
  const page = await newPage();
  const A = '{"u":[{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":3,"v":"c"}],"t":"2020"}';
  const B = '{"u":[{"id":3,"v":"c"},{"id":1,"v":"CHANGED"},{"id":2,"v":"b"}],"t":"2021"}';
  await compare(page, A, B);
  await page.waitForSelector('#jd-list .row');
  eq(await page.locator('#jd-sum-text').innerText(), '2 changes');
  await page.selectOption('#jd-arrays', 'position');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '7 changes');
  ok(await page.locator('.jd-chip', { hasText: 'Arrays: by position' }).isVisible(), 'chip shows');
  await page.click('#jd-copy-patch');
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('['));
  const patch = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  ok(Array.isArray(patch) && patch.length >= 1, 'JSON patch is copied');
  await page.click('.jd-chip');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '2 changes');
  eq(await page.inputValue('#jd-arrays'), 'auto', 'chip turned the option off');
  // ignore
  await page.click('#jd-options-btn');
  eq(await page.getAttribute('#jd-options-btn', 'aria-expanded'), 'true');
  await page.fill('#jd-ignore', '**.v\nbad..[');
  ok((await text(page, '#jd-ignore-err')).includes('Line 2'), 'bad ignore line is named');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '1 change');
  ok((await text(page, '#jd-info')).includes('Ignored: 1 pattern'), 'ignored count shown');
  // persistence
  await page.selectOption('#jd-arrays', 'order');
  await page.reload();
  await page.waitForSelector('#tool[data-ready="true"]');
  eq(await page.inputValue('#jd-arrays'), 'order', 'options remembered');
  eq(await page.inputValue('#jd-ignore'), '**.v\nbad..[');
  eq(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bm.jsondiff')).join()), 'bm.jsondiff.opts.v1');
  ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('CHANGED'), 'documents are not saved');
  // reset
  await page.click('#jd-options-btn');
  await page.click('#jd-reset-opts');
  eq(await page.inputValue('#jd-arrays'), 'auto');
  // numbers and strings options
  await compare(page, '{"n":1.0,"s":"A"}', '{"n":1,"s":"a"}');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '1 change');
  await page.check('#jd-s-case');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent.includes('No differences'));
  await page.check('input[name="jd-nummode"][value="written"]');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '1 change');
  eq(page.errors, [], 'no console errors with options');
  await page.context().close();
}

// ---------- pane buttons: format, swap, clear, open file, show in editors
{
  const page = await newPage();
  await compare(page, '{"b":[1,2],"a":{"x":1}}', '{"b":[1,3],"a":{"x":1}}');
  await page.waitForSelector('#jd-list .row');
  await page.click('#jd-pane-a [data-act="format"]');
  await page.waitForFunction(() => document.getElementById('jd-in-a').value.includes('\n'));
  eq(await page.inputValue('#jd-in-a'), '{\n  "b": [\n    1,\n    2\n  ],\n  "a": {\n    "x": 1\n  }\n}');
  await page.click('#jd-list .row [data-act="show"]');
  const sel = await page.evaluate(() => { const t = document.getElementById('jd-in-a'); return t.value.slice(t.selectionStart, t.selectionEnd); });
  eq(sel, '2', 'show in editors selects the value');
  await page.click('#jd-swap');
  await page.waitForFunction(() => document.getElementById('jd-in-b').value.includes('\n'));
  // open file
  await page.setInputFiles('#jd-pane-a input[type=file]', { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from('{"k":1}') });
  await page.waitForFunction(() => document.getElementById('jd-in-a').value === '{"k":1}');
  // per-pane Clear empties one box and keeps the other
  await page.click('#jd-pane-b [data-act="clear"]');
  eq(await page.inputValue('#jd-in-b'), '');
  ok((await page.inputValue('#jd-in-a')).length > 0, 'the other box keeps its text');
  await page.waitForFunction(() => document.getElementById('jd-msg').textContent.includes('second'));
  await page.click('#jd-clear');
  eq(await page.inputValue('#jd-in-a'), '');
  await page.waitForSelector('#jd-empty:not([hidden])');
  // keyboard: ctrl+enter
  await page.fill('#jd-in-a', '{"a":1}');
  await page.fill('#jd-in-b', '{"a":2}');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('#jd-list .row');
  // hide and show a pane
  await page.click('#jd-pane-a [data-act="collapse"]');
  ok(await page.locator('#jd-body-a').isHidden(), 'pane collapses');
  await page.click('#jd-pane-a [data-act="collapse"]');
  ok(await page.locator('#jd-body-a').isVisible(), 'pane opens');
  // long values: show more
  await compare(page, JSON.stringify({ s: 'word '.repeat(60) + 'one' }), JSON.stringify({ s: 'word '.repeat(60) + 'two' }));
  await page.waitForSelector('#jd-list .row ins');
  ok((await page.locator('#jd-list .row ins').count()) >= 1, 'inline highlight for long strings');
  await page.click('#jd-list .row [data-act="more"]');
  eq(await page.getAttribute('#jd-list .row [data-act="more"]', 'aria-expanded'), 'true');
  eq(page.errors, [], 'no console errors on buttons');
  await page.context().close();
}

// ---------- layout: no horizontal overflow
for (const w of [320, 390, 820, 1280, 1920]) {
  for (const scheme of ['light', 'dark']) {
    const page = await newPage({ viewport: { width: w, height: 800 }, colorScheme: scheme });
    const over = async (label) => {
      const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      ok(d.sw <= d.iw, `${label} at ${w} ${scheme}: scrollWidth ${d.sw} > ${d.iw}`);
    };
    await over('empty');
    await page.click('#jd-sample');
    await page.waitForSelector('#jd-list .row');
    await over('result');
    await page.click('#jd-tab-sbs');
    await page.waitForSelector('#jd-sw-a .sl');
    await over('side by side');
    await page.click('#jd-options-btn');
    await over('options');
    eq(page.errors, [], `no console errors at ${w} ${scheme}`);
    await page.context().close();
  }
}

// ---------- accessibility (axe): no serious or critical issues
{
  const { createRequire } = await import('node:module');
  const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  for (const scheme of ['light', 'dark']) {
    const page = await newPage({ colorScheme: scheme });
    const run = async (label) => {
      await page.addScriptTag({ path: axePath });
      const r = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      eq(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), [], `axe ${label} ${scheme}`);
    };
    await run('empty');
    await page.click('#jd-sample');
    await page.waitForSelector('#jd-list .row');
    await run('result');
    await page.click('#jd-options-btn');
    await page.fill('#jd-ignore', 'bad..[');
    await run('options');
    await page.click('#jd-tab-sbs');
    await page.waitForSelector('#jd-sw-a .sl');
    await run('side by side');
    await compare(page, '{"a":1,}', '{"a":');
    await page.waitForSelector('#jd-err-a:not([hidden])');
    await run('errors');
    await page.context().close();
  }
}

// ---------- tolerant mode
{
  const page = await newPage();
  await compare(page, '// note\n{"a":1,}', '{"a":2}');
  await page.waitForSelector('#jd-err-a:not([hidden])');
  ok((await text(page, '#jd-err-a')).includes('Comments are not allowed'), 'comments need tolerant mode');
  await page.click('#jd-options-btn');
  await page.check('#jd-tolerant');
  await page.waitForSelector('#jd-list .row');
  eq(await page.locator('#jd-sum-text').innerText(), '1 change');
  ok(await page.locator('.jd-chip', { hasText: 'Not strict JSON' }).isVisible());
  await page.context().close();
}

// ---------- per-array choice and the Ignore order hint
{
  const page = await newPage();
  const a = '{"users":[{"id":1,"roles":["a","b"]},{"id":2,"roles":["c"]}]}';
  const b = '{"users":[{"id":2,"roles":["c"]},{"id":1,"roles":["b","a"]}]}';
  await compare(page, a, b);
  await page.waitForSelector('.info-hint');
  ok((await text(page, '.info-hint')).includes('roles'), 'hint names the shuffled array');
  eq(await page.locator('#jd-sum-text').innerText(), '2 changes');
  await page.click('[data-hint]');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent.includes('No differences'));
  eq(await page.locator('select[data-ov="$.users[].roles"]').inputValue(), 'order', 'select shows the override');
  eq(await page.locator('select[data-ov="$.users"] option[selected]').count(), 1);
  ok(await page.locator('.jd-chip', { hasText: 'Array overrides: 1' }).isVisible(), 'override chip');
  await page.reload();
  await page.waitForSelector('#tool[data-ready="true"]');
  await compare(page, a, b);
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent.includes('No differences'));
  await page.selectOption('select[data-ov="$.users[].roles"]', 'auto');
  await page.waitForFunction(() => document.getElementById('jd-sum-text').textContent === '2 changes');
  eq(await page.locator('.jd-chip', { hasText: 'Array overrides' }).count(), 0, 'override removed');
  eq(page.errors, [], 'no console errors with overrides');
  await page.context().close();
}

// ---------- large input: kept out of the text area, preview shown
{
  const page = await newPage();
  const recs = makeRecords(9000);
  const a = JSON.stringify(recs);
  recs[7].name = 'CHANGED';
  const b = JSON.stringify(recs);
  ok(a.length > 1_000_000, 'fixture is above the large-input limit');
  await page.evaluate(([x, y]) => {
    for (const [id, v] of [['jd-in-a', x], ['jd-in-b', y]]) {
      const dt = new DataTransfer();
      dt.setData('text', v);
      document.getElementById(id).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }, [a, b]);
  await page.waitForSelector('#jd-list .row');
  eq(await page.locator('#jd-sum-text').innerText(), '1 change', 'large input is compared in full');
  ok(await page.locator('#jd-big-a').isVisible(), 'large banner shows');
  ok((await text(page, '#jd-bigtext-a')).startsWith('Large input:'), 'banner text');
  ok(await page.evaluate(() => document.getElementById('jd-in-a').readOnly), 'box is read only');
  ok((await page.inputValue('#jd-in-a')).length < 300000, 'box holds only a preview');
  await page.click('#jd-list .row [data-act="show"]');
  ok((await text(page, '#jd-toast')).includes('Edit as text'), 'show in editors explains large input');
  await page.click('#jd-pane-a [data-big="edit"]');
  await page.waitForFunction(() => document.getElementById('jd-in-a').value.length > 1000000, null, { timeout: 30000 });
  ok(await page.locator('#jd-big-a').isHidden(), 'banner goes after Edit as text');
  await page.click('#jd-pane-b [data-big="clear"]');
  eq(await page.inputValue('#jd-in-b'), '');
  // minified: one line. The notice counts characters, not lines, and Format makes it readable.
  await page.evaluate((x) => {
    const dt = new DataTransfer();
    dt.setData('text', x);
    document.getElementById('jd-in-b').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify(makeRecords(9000)));
  ok((await text(page, '#jd-bigtext-b')).includes('1 line. The box shows the first'), 'one-line notice: ' + await text(page, '#jd-bigtext-b'));
  ok((await text(page, '#jd-bigtext-b')).includes('characters'), 'notice counts characters');
  const preview = await page.inputValue('#jd-in-b');
  ok(/,\n…$/.test(preview), 'preview stops after a comma');
  await page.click('#jd-pane-b [data-big="format"]');
  await page.waitForFunction(() => document.getElementById('jd-bigtext-b').textContent.includes('first 1,500 lines'));
  eq(page.errors, [], 'no console errors with large input');
  await page.context().close();
}

// ---------- phone flow
{
  const page = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  ok(await page.locator('#jd-phonebar').isVisible(), 'phone bar shows');
  await page.fill('#jd-in-a', '{"a":1}');
  await page.fill('#jd-in-b', '{"a":2}');
  await page.tap('#jd-compare-bar');
  await page.waitForSelector('#jd-list .row');
  ok(await page.locator('#jd-body-a').isHidden(), 'inputs collapse after a compare');
  await page.tap('#jd-phonebar [data-go="edit"]');
  ok(await page.locator('#jd-body-a').isVisible(), 'Edit opens the inputs');
  // tap targets: 44 px for every control, link and chip outside running text; 16 px text in the boxes
  await page.tap('#jd-sample');
  await page.waitForSelector('#jd-list .row');
  await page.selectOption('#jd-arrays', 'key');
  await page.tap('#jd-options-btn');
  const small = await page.evaluate(() => [...document.querySelectorAll('header a, header button, #tool button, #tool select, #tool input:not([type=file]):not([type=checkbox]):not([type=radio]), #tool textarea, #tool label.jd-check, #tool .link, footer nav a, summary')]
    .filter((e) => e.offsetParent && !e.closest('[hidden]') && !e.closest('.sr-only') && !(e.classList.contains('link') && e.closest('p:not(.info-hint)')))
    .filter((e) => e.getBoundingClientRect().height < 43.5)
    .map((e) => (e.id || e.className || e.tagName) + ':' + (e.textContent || '').trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height)));
  eq(small, [], 'no controls under 44 px on the phone');
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('jd-in-a')).fontSize), '16px', '16 px text in the box on phones');
  await page.context().close();
}

// ---------- localStorage blocked
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: boom });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(srv.url + entry);
  await page.waitForSelector('#tool[data-ready="true"]');
  await page.click('#jd-sample');
  await page.waitForSelector('#jd-list .row');
  await page.selectOption('#jd-arrays', 'position');
  eq(errs, [], 'works with localStorage blocked');
  await ctx.close();
}

// ---------- keyboard: every control reachable by Tab
{
  const page = await newPage();
  await page.click('#jd-sample');
  await page.waitForSelector('#jd-list .row');
  await page.focus('#jd-sample');
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 20) || document.activeElement?.tagName);
    seen.add(id);
  }
  for (const want of ['jd-swap', 'jd-clear', 'jd-arrays', 'jd-options-btn', 'jd-compare', 'jd-in-a', 'jd-in-b', 'jd-copy-report', 'jd-tab-list']) ok(seen.has(want), 'tab reaches ' + want);
  const ring = await page.evaluate(() => { document.getElementById('jd-compare').focus(); return getComputedStyle(document.getElementById('jd-compare')).outlineStyle; });
  eq(ring, 'solid', 'focus ring is visible');
  await page.context().close();
}

// ---------- speed in the browser (optional)
if (perf) {
  for (const [name, gen, limit, changes] of [['P1 3 MB', () => threeEdits(20000), 1500, 3], ['P2 5 MB', () => threeEdits(35000), 3000, 3], ['P3 5 MB, 35,000 changes', () => allScoresChanged(35000), 3000, 35000]]) {
    const page = await newPage();
    const [a, b] = gen();
    await page.evaluate(([x, y]) => {
      // A paste, as a person would do it. Big text is kept out of the text area (see ui.js).
      for (const [id, v] of [['jd-in-a', x], ['jd-in-b', y]]) {
        const dt = new DataTransfer();
        dt.setData('text', v);
        document.getElementById(id).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
      window.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    }, [a, b]);
    const t0 = Date.now();
    await page.waitForSelector('#jd-list .row', { timeout: 30000 });
    const ms = Date.now() - t0;
    const total = await page.locator('#jd-sum-text').innerText();
    const longest = await page.evaluate(() => Math.max(0, ...window.__long));
    console.log(`${name}: first rows in ${ms} ms (${total}), longest main-thread task ${Math.round(longest)} ms`);
    ok(ms < limit + 1500, `${name} within budget`);
    ok(total.startsWith(changes === 3 ? '3 changes' : '35,000 changes'), `${name} change count: ${total}`);
    await page.context().close();
  }
}

await browser.close();
await srv.close();
console.log(`json-diff browser: ${checks} checks passed`);
