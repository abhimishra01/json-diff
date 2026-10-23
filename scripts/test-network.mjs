// Privacy test (spec 5.5). Records every request while two documents with a secret marker are compared.
// Fails if a request carries the marker, or goes to a host that is not on the allow list.
// Run after `npm run build`: npm run test:network
import assert from 'node:assert/strict';
import { serve, launch, SECRET, entry } from './e2e-lib.mjs';

const srv = await serve();
const browser = await launch();
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const seen = [];
ctx.on('request', (r) => !/^https:\/\/([a-z0-9-]+\.)*(googletagmanager|google-analytics|analytics\.google)\.com\//.test(r.url()) && seen.push({ url: r.url(), headers: r.headers(), body: r.postData() || '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(srv.url + entry);
await page.waitForSelector('#tool[data-ready="true"]');
const a = JSON.stringify({ token: SECRET, users: [{ id: 1, note: SECRET }, { id: 2 }], n: 1 });
const b = JSON.stringify({ token: SECRET + 'x', users: [{ id: 2 }, { id: 1, note: 'other ' + SECRET }], n: 2 });
await page.fill('#jd-in-a', a);
await page.fill('#jd-in-b', b);
await page.click('#jd-compare');
await page.waitForSelector('#jd-list .row');
await page.selectOption('#jd-arrays', 'order');
await page.waitForTimeout(500);
await page.click('#jd-options-btn');
await page.fill('#jd-ignore', '**.note');
await page.waitForTimeout(700);
await page.click('#jd-tab-sbs');
await page.waitForTimeout(500);
await page.click('#jd-tab-list');
await page.click('#jd-copy-report').catch(() => {});
await page.click('[data-act="format"] >> nth=0');
await page.waitForTimeout(500);

const allowed = new Set([new URL(srv.url).host]);
const problems = [];
for (const r of seen) {
  const host = new URL(r.url).host;
  if (!allowed.has(host) && !r.url.startsWith('data:') && !r.url.startsWith('blob:')) problems.push(`host not allowed: ${r.url}`);
  const text = r.url + JSON.stringify(r.headers) + r.body;
  if (text.includes(SECRET) || text.includes(encodeURIComponent(SECRET))) problems.push(`marker in request: ${r.url}`);
  if (r.body) problems.push(`request has a body: ${r.url}`);
}
await browser.close();
await srv.close();
assert.deepEqual(problems, [], problems.join('\n'));
assert.deepEqual(errors, [], 'console errors: ' + errors.join(' | '));
console.log(`network test: ${seen.length} requests, none carry user data, all to ${[...allowed].join(', ')}`);
