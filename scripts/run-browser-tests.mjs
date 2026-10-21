// Runs the privacy test and the page test against a finished build.
// Usage: node scripts/run-browser-tests.mjs [build-folder] [base-path]
//   node scripts/run-browser-tests.mjs                          (dist, served at the root)
//   node scripts/run-browser-tests.mjs dist-bingemind json-diff/   (the Bingemind build)
// The release gate (build:bingemind, deploy, CI) calls this after every build.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dir = 'dist', base = ''] = process.argv.slice(2);
let failed = false;
for (const t of ['test-network.mjs', 'test-ui.mjs']) {
  console.log(`\n== ${t} on ${dir}${base ? ' at /' + base : ''}`);
  const r = spawnSync(process.execPath, [path.join(here, t)], {
    stdio: 'inherit',
    env: { ...process.env, JD_DIST: dir, JD_PATH: base },
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
