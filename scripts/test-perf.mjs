// Speed tests P1 to P3, P6 from the spec (5.3). Run: npm run test:perf
import { performance } from 'node:perf_hooks';
import { compareTexts, ParseCache } from '../src/lib/jd/compare.js';
import { defaultOptions } from '../src/lib/jd/normalize.js';
import { threeEdits, allScoresChanged } from './gen-fixtures.mjs';

const mb = (s) => (s.length / 1048576).toFixed(2) + ' MB';
let failed = false;
function run(name, a, b, limitMs, expectChanges, opts = defaultOptions(), cache = new ParseCache()) {
  const t0 = performance.now();
  const r = compareTexts(a, b, opts, cache);
  const ms = performance.now() - t0;
  const ok = r.state === 'ok' && r.changes.length === expectChanges && ms < limitMs;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${mb(a)} per side, ${r.changes && r.changes.length} changes, ${ms.toFixed(0)} ms (limit ${limitMs} ms)`);
  return cache;
}

{
  const [a, b] = threeEdits(20000);
  run('P1', a, b, 1500, 3);
}
{
  const [a, b] = threeEdits(35000);
  const cache = run('P2', a, b, 3000, 3);
  const o = defaultOptions();
  o.sortKeys = true;
  run('P6 (rerun, only an option changed)', a, b, 1500, 3, o, cache);
}
{
  const [a, b] = allScoresChanged(35000);
  run('P3', a, b, 3000, 35000);
}
process.exit(failed ? 1 : 0);
