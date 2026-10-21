// Shared helpers for the browser tests. Needs playwright-core and Google Chrome.
// Set PLAYWRIGHT_CORE to the playwright-core folder if it is not installed in this project.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core', path.join(process.env.HOME || '', '.local/lib/node_modules/@playwright/cli/node_modules/playwright-core')].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch {}
  }
  throw new Error('playwright-core not found. Set PLAYWRIGHT_CORE.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };

/** Serve a build folder. Returns { url, close }. */
// JD_DIST: another build folder to serve. JD_PATH: the page path inside it (for a base path such as json-diff/).
export const entry = process.env.JD_PATH || '';
export function serve(dir = path.resolve(root, process.env.JD_DIST || 'dist'), port = 0) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) });
  }));
}

export async function launch(opts = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ channel: 'chrome', headless: true, ...opts });
}

export const SECRET = 'SECRET-MARKER-7f3a';
