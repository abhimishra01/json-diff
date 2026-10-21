# Fix pass summary (Tony, 2026-10-21)

Source: the six reports in this folder (maintainer, minimalism, readability, regression, design and SEO, customers) and the coordinator's list.
Every finding was checked against the code. Accepted items are fixed and tested. Rejected items have a reason.

## Fixed: musts

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Browser and privacy tests were not in the release path | `scripts/run-browser-tests.mjs` runs `test-network` and `test-ui` against a build. `build:bingemind` runs `npm test`, builds, then runs both on `dist-bingemind` served under `/json-diff/`. `deploy` runs `npm test`, build, `test:browser`, then the deploy script. `test:release` does both builds. The Pages workflow builds with its base path, then runs the same script in Chrome (the ubuntu runner has Chrome; `playwright-core` is a dev dependency). The tests need no path outside the project. | Ran `test:release`, and the Pages-style build under `/json-diff/`: all pass. The workflow itself was not run (no push). |
| 2 | Ignore order skipped nested arrays | `canonical()` now sorts array items at every depth (bottom-up, iterative). | `[{"tags":["a","b"]}]` against `[{"tags":["b","a"]}]` gives 0 changes, plus deeper, array-of-arrays and a still-different case. |
| 3 | Tolerance failed on `0.30000000000000004` against `0.3`, and the note was wrong | The tolerance uses the double value for any finite number under 1e15. Numbers of 1e15 and more stay exact. The note now reads "Tolerance not applied: a number is too large to compare safely." Ignore order also uses the tolerance for loose numbers. | Float noise, 16-digit decimals, relative tolerance, 15-digit integers (applied), 16-digit integers (exact, with the note), order mode. |

## Fixed: shoulds and nice items

- **Side by side is row aligned.** `view.js` lines the two documents up and inserts hatched filler rows where one side has more lines. Both panes scroll as one. Moved blocks that cannot line up are skipped without losing a line. Tests: unit tests for `alignRows`, plus a sample-pair test and a browser test.
- **Bracket messages.** `{"a":[}` and `{]` now say which bracket is open. Tests added.
- **Touch targets at 390 px.** Filter chips, option chips, links, checkbox rows, theme toggle, header logo, footer links, FAQ rows and the new selects are 44 px. The browser test checks this list.
- **16 px text** in the boxes and gutter on phones. The error marker reads the real line height.
- **Large input notice.** One-line files say "the first 200,000 characters", the preview stops after a comma, and the notice has a Format button.
- **Deep nesting.** Paths are built only when a change is reported. 10,000 levels went from 3.4 s to 18 ms.
- **Customer top 5.**
  1. Tolerance (above).
  2. Per-array choice: each array in "Matching arrays" has its own select (Auto, By position, Ignore order). Saved with the options, shown as a chip, and cleared by the chip or Reset.
  3. Hint: when a position match finds mostly the same items in another order, a line offers "Ignore order here".
  4. Copy report and Download follow the active filter, and say so in the report header.
  5. 16 px text.
- **Report notes** that values over 2,000 characters are shortened. Cut values now end with an ellipsis.
- **Release and robustness.** Pending Format and Patch requests are answered with "Try again" when the worker restarts. One id counter. A blocked worker shows a message. Comments-allowed mode is no longer remembered. The patch is disabled when Ignore paths are on. The composite-key warning says it is not supported.
- **Dead code removed.** Patch note element, `runStart`, infinite scroll and sentinel (the button stays), the second Sort keys checkbox, the marker-object patch writer (now a direct writer using the pretty printer), `first`, the `Num` re-export, the identity `TYPE_WORD` map, `ParseCache.clear`.
- **Names and copy.** `viewSeq` became `reqId`, the view's `seq` became `compareId`, `waitAllLoaded` became `allLoaded`. The article says "Open", the cash drawer link says "Cash drawer counter", and "most people want" became "the usual choice". The "Clear" in the toolbar became "Clear both". Pane titles are paragraphs, not headings. The 50 MB claim was checked: two 49 MB files open and compare in about 10 s (the FAQ now says so).
- **Phone first screen.** Editors are 200 px high on desktop (the spec says 240) so the first change is closer to the fold.
- **Template items from fix.md** were already right (README, US spelling, fixed dates, no outside paths, scaffolder absent, screenshots and playwright folders ignored, no duplicate link block, deploy runs tests). Last check: no Tailwind scan outside `src`. CSS is 35.5 KB raw, 8.3 KB gzip (the tool styles are in it); JS 15.5 KB gzip, worker 10.5 KB gzip.

## Rejected or deferred

| Finding | Decision | Reason |
|---|---|---|
| Split `ui.js` into four modules | Deferred | A large move with no user gain. The 183-check browser test guards the current file; do it when the next feature lands. |
| Undo toast after Sample and Clear | Deferred | Not in the fix list. Extra state for a rare case. |
| "Fix it" buttons, "Only keys" mode, all errors at once, position in both documents for key-less arrays | Deferred | Spec P1 or new modes. Not needed to ship, and the brief says keep the tool single-purpose. |
| Marked side by side lines are not focusable | Rejected | `n` and `p` do the same by keyboard. |
| Unicode-form note for object keys | Rejected | Very rare. |
| More-tools "text-diff" link | Deferred | The tool is not live yet. |
| Accent hue near the knitting tool | Kept | The hex is unique. Changing it means new icons and og.png. |

## Final status

- `npm test`: 159 checks pass. `test:perf`: P1 0.22 s, P2 0.29 s, P3 0.31 s, P6 0.15 s.
- `npm run build`, `build:bingemind` and the Pages-style build all pass. `test:browser` passes on all three (183 page checks, privacy test: 6 requests, none carry user data). axe finds no serious issue in light and dark. No overflow from 320 to 1920 px. Every control is 44 px at 390.
- Lighthouse mobile: 100, 100, 100, 100. LCP 1.2 s, CLS 0, 7 requests.
- Screenshots at 1280 and 390, light and dark, in `screenshots/` (empty, result and side by side). I looked at them.

## Left for the owner

- Safari, Firefox and a real Android phone are untested. Two WebKit and Firefox builds exist in the playwright cache if you want a smoke run.
- The CI workflow has not run. It needs the first push.
- When analytics is switched on, the privacy test's allow list must name the analytics host.
- Large input (over 1 MB) is a read-only preview with "Edit as text". This replaces the CodeMirror fallback in the spec.

## Phase 2 SEO pages (do not build yet)

The ten in the spec: ignore-array-order, ignore-fields, compare-api-responses, compare-two-json-files, by-key, large-files, json-patch, vs-code-and-command-line, translation-files, config-files. Ten more:
11. compare-json-in-javascript (guide, links to the tool)
12. compare-json-in-python
13. compare-postman-responses
14. ignore-timestamps
15. big-numbers-and-precision
16. null-vs-missing-key
17. duplicate-keys-in-json
18. compare-package-json
19. compare-kubectl-json-output
20. compare-geojson

## Gap fix (Tony, 2026-10-21)

Source: `comparison/json-diff.md` (Abed) and the coordinator's list. The tool stays single-purpose and browser-only. No new pages: the long-tail phrases are sections of the article with one-click examples.

### Done: the 4 musts
1. **Matched and moved items line up in side by side.** For arrays matched by key or by content (Ignore order), the Changed side now shows the items in the order of the Original. Matched items meet on one row. Items that exist on one side only get a filler row on the other. Items outside the longest unmoved run carry a quiet "moved" mark on both sides, with a one-line note. Tests: order, same-row, moved count, filler rows, Ignore order mode.
2. **Five one-click examples** for the long-tail phrases: ignore array order, ignore fields, compare by id, exact numbers, large files. They sit as buttons under the tool and as sections with an H2 and an anchor in the article. Each loads both documents and sets only the options it needs. The page address `#ignore-array-order` (and the other ids) opens the example. "Large files" builds two 5 MB files in the browser and shows how long the compare took. Tests check the promised result for each example (1, 1, 1, 1 and 3 changes).
3. **Proof block for exact numbers** in the article (the 20-digit pair, with the "Try the 20-digit example" button). It says three of four popular tools called the pair identical in our test, without naming them.
4. **Phone: the editors collapse after Compare, paste, Sample, Open file and examples.** A collapsed box is one line: name, state, line count and an "Edit" button. The result starts near the top of the screen. Edit opens both boxes. Typing does not collapse the boxes while you work.

### Done: cheap shoulds
- Copy report names the type change: `T $.v: type change, number to string: 1 -> "1"`.
- Copy share link (fragment, gzip, up to 50 KB of link, warning that it holds your data). The link opens the same documents and options. The network test still shows no request with data.
- Filter box in the Changes list. The report follows both the kind filter and the box.
- "Compared in N ms" under the result, a visible speed proof.
- Ctrl+Enter hint on the Compare button (shows the Command key on Mac, hidden on touch).
- Two FAQ items: Python, and sending a diff. The large-files text keeps the measured numbers.

### Skipped, with reasons
| Gap | Reason |
|---|---|
| 5. Show duplicate keys as a diff row | Spec J26 says the result is 0 changes plus a warning. The warning stays. |
| 9. Tree tab | Spec P1, a larger feature. The filter box is done. |
| 10. JSON Lines detection | Spec P1, not needed to win the named intents. |
| 13. Link to the text diff tool | That tool is not live. Add it when it is. |
| Up to 10 long-tail pages (gapfix brief) | The coordinator asked for sections inside the article. The page list stays under "Phase 2 SEO pages" above. |

### Status
- `npm test`: 181 checks. `test:release` (both builds, then privacy and page tests): pass, 205 page checks including axe, 44 px targets, examples, share round trip and the phone collapse.
- Lighthouse mobile: 100, 100, 100, 100. LCP 1.3 s, CLS 0, 7 requests.
- Screenshots at 1280 and 390, light and dark (empty, result, side by side, phone collapsed) in `screenshots/`.
- Article is now about 1,050 words (8 sections plus the proof block). FAQ has 10 items.
