# JSON Diff Checker

Free JSON compare tool. Live target: https://bingemind.com/json-diff/ (Pages copy: https://abhimishra01.github.io/json-diff/, noindex).
Astro (static) + Tailwind 4. No backend. The compare runs in a Web Worker in the browser.

## What it does
- Two input boxes (paste, drop a file, Open file, Format, Copy). Live compare after 400 ms, and a Compare button.
- Changes list with path, old value, new value, kind filters, inline word diff for long strings, Copy report, Download .txt, Copy JSON Patch.
- Side by side tab with marked lines, previous and next change (keys `p` and `n`), sort keys.
- Options: array matching (Auto, by position, by key, ignore order), ignore paths, numbers by value or as written with tolerance, string rules, tolerant parsing.
- Exact numbers (never rounded), key order ignored, `null` is not a missing key, duplicate keys warn.
- Plain-language errors with line, column and a caret.
- Large input (above 1 MB) is kept out of the text area. The box shows a preview and the whole text is compared.

## Where the logic lives
- `src/lib/jd/parse.js`: strict iterative parser (positions, errors, exact numbers, duplicate keys).
- `src/lib/jd/normalize.js`: number and string rules, option defaults.
- `src/lib/jd/paths.js`: display paths, JSON Pointers, ignore patterns.
- `src/lib/jd/diff.js`: tree diff and array matching. `serialize.js`: compact, pretty and canonical writers.
- `src/lib/jd/compare.js`: one compare, with a parse cache. `worker.js`: the worker. `ui.js`: page logic.

## Commands
- `npm run dev` (port 4961), `npm run build`, `npm run build:bingemind`.
- `npm test`: known-answer tests (spec 5.1 and 5.2).
- `npm run test:perf`: speed tests P1, P2, P3, P6 in Node.
- After a build: `node scripts/test-ui.mjs` (add `--perf` for timings in the browser) and `npm run test:network` (privacy test). They need Google Chrome and `playwright-core` (set `PLAYWRIGHT_CORE` if it is not installed).
