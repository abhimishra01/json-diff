# Code review, lens: minimalism (Olivia, 2026-10-21)

Verdict: lean for what it does (tool JS 15 KB gz, worker 9 KB gz, one runtime dependency `diff`). A small amount of dead code and two doubled mechanisms. **Must-fix: 0. Should: 5. Nice: 4.** Template leftovers (README, new-tool.sh, screenshots, duplicate legal block, build-date, British spelling): one line only.

| Severity | File:line | Finding | Why | Fix |
|---|---|---|---|---|
| should | ui.js:75, 585, 971; Tool.astro `jd-patch-note` | `patchNote` element is set to `hidden` twice and never shown. | Dead element and code. | Delete the element, the `el.patchNote` entry and both lines. |
| should | ui.js:428 | `S.runStart` is written, never read. | Dead. | Delete. |
| should | ui.js:710-714, 701-709 | The change list has both an infinite scroll (IntersectionObserver plus `jd-sentinel`) and a "Show N more" button. | Two ways to do one job; the observer is untested. | Keep the button only (simple, keyboard friendly), or the observer only. Delete `jd-sentinel`. |
| should | Tool.astro:58 and :143, ui.js `sortKeys`/`sortKeys2` | Two "Sort keys" checkboxes kept in sync by hand. | Duplicate state and code. | One checkbox in the side by side bar; drop the option-panel copy. |
| should | report.js:132-150 | `toPlain` plus `RawNumber` marker objects plus string replace of `"__RAWn__"` to write exact numbers. | Three steps for a small writer; a marker object can clash with real data shaped `{"__raw":..}`. | Write the patch with a small direct serializer (the iterative `compact` in serialize.js already writes `Num` as source text; extend it with an indent option). |
| nice | serialize.js:86, 136 | `first` variable assigned, never read. | Dead. | Delete. |
| nice | paths.js:227 | `export { Num }` is unused. | Dead. | Delete. |
| nice | report.js:5 | `TYPE_WORD` maps each word to itself. | Pointless. | Use `c.aType` directly. |
| nice | compare.js:19 | `ParseCache.clear()` is never called. | Dead. | Delete. |
| nice | package.json | `wrangler` devDependency (about 100 MB) is only for the template deploy script. | Install weight; CI runs `npm ci`. | Fine to keep if deploy stays; otherwise use `npx`. |

Checked and fine: no leftover template demo code in `src`, no unused CSS classes found for the tool, no extra runtime libraries (`diff` is imported for two functions only and tree-shakes).
