# Design and SEO review (Olivia, 2026-10-21)

Verdict: clearly better than the rivals in the research on the points that matter (result first, path for every change, key matching shown and changeable, exact numbers, phone layout, no ads, 37 KB page). No must-fix. **Must-fix: 0. Should: 6. Nice: 4.**

## Scores (Lighthouse, Google Chrome, my own build served on port 4966)
| Run | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT | Requests | Weight |
|---|---|---|---|---|---|---|---|---|---|
| Mobile | 100 | 100 | 100 | 100 | 1.1 s | 0 | 0 ms | 7 | 37 KiB |
| Desktop | 100 | 100 | 100 | 100 | 0.3 s | 0 | 0 ms | 7 | 37 KiB |

Only cache-lifetime audits fail locally (the local server sends no cache header; `public/_headers` sets one year on `/_astro/*`). axe-core: zero violations in 20 states (390 and 1280, light and dark, empty, result, side by side, error, options open). No horizontal overflow at 320, 390, 820, 1280, 1920, empty and with a result. Console clean. JS: 14.9 KB + 9.4 KB worker (gzip), CSS 8 KB, within the 60 KB budget. Own build in Bingemind mode passes `test:ui` (160 checks) and `test:network`.

## No fake affordances (briefs/review-design.md): PASS
I clicked, with real clicks in Chrome: Sample, Swap, Clear (toolbar), Arrays select (4 values), Key box, Options, every option control (ignore paths, number mode, both tolerance boxes, 4 text rules, sort keys, tolerant, Reset), every chip's "x", Compare, Ctrl+Enter, per pane Open (file chooser), Format, Copy, Clear, Hide/Show, drag and drop, "Go to the error", filter chips (4), Copy path, Show in editors, Show more/less, Copy report, Download .txt, Copy JSON Patch (disabled, with reason, cursor not-allowed), "Change" link, both tabs (and arrow keys), Previous/Next change, n and p keys, clicking a marked line, Before/After (phone), phone bar Edit/Result/Compare, Cancel, "Edit as text", theme toggle (persists), skip link, FAQ (8 items), all header, footer and More-tools links (internal 200, anchors exist). A script found no element with a pointer cursor that is not interactive, and no button with a default cursor. Pictures of UI: none on the page (the OG image shows the result list, it is not on the page). Every control did what its label says.
Small gaps, not fake: marked lines in side by side are clickable but not focusable (n and p do the same by keyboard); the disabled "Copy JSON Patch" looks greyed and the reason is printed next to it (good).

## Findings
| Severity | Area | Finding | Fix |
|---|---|---|---|
| should | Phone, iOS | The editors and gutter use 14 px text (`global.css:154`, `:254`). Safari on iPhone zooms the page when a field under 16 px gets focus. This is the main paste target on a phone. | Use 16 px in the editor at max-width 720 px (keep 14 px on desktop). |
| should | Desktop first screen | At 1280x800 the empty-state steps are fine, but with a result the first change row starts at about y=700, so no change is readable without scrolling. Spec 4.1: "first changes visible without scrolling" (editors collapse after a compare). | After a successful compare on desktop, shrink the editors to 120 px or show an "Edit inputs" strip (the Hide buttons exist but do nothing on their own). |
| should | Side by side | Not row aligned (builder note, confirmed): columns drift after added or removed lines. Spec says aligned. | Filler rows (see regression report). |
| should | Touch targets (phone) | Filter chips 36 px high, theme toggle 40 px, "Change" link 24 px, "Sort keys" checkbox 20 px, FAQ summary rows 24 px, footer links 20 px. Spec: 44 px. (Buttons, tabs, row actions are 44 px: good.) | `min-height: 44px` on `.jd-filter`, `.jd-chip`, `.link`, the toggle, and padding on the FAQ summary. |
| should | Big input | Over 1 MB the box becomes a read-only preview, with the button "Edit as text" (builder deviation). It is clear and works (Edit as text on 30 MB took 2.4 s, then typing took about 1 s per key), but a one-line file shows a cut 200,000-character line and the notice says "first 1 lines". | Better notice; offer "Format" in the notice. Keep until Safari and Firefox are tested. |
| should | Empty state | Both-empty state shows 3 steps and "Load a sample": good. But "Sample" and "Clear" overwrite or wipe typed input with no undo. | Toast with Undo for 8 s after Sample and Clear. |
| nice | Labels | Two buttons named "Clear" (all, and one pane). | "Clear both" in the toolbar. |
| nice | Outline | Headings: H1, then H2 "Original", H2 "Changed", H2 "Result" (hidden), H3 duplicates inside side by side, then the article H2s. Pane titles as H2 add noise to the outline. | Make the pane titles `<p>` or `<h3>` under a hidden H2 "Tool". |
| nice | Persisted state | "Not strict JSON" (tolerant) is remembered between visits. | Do not persist it. |
| nice | Article links | No link from the article to the About page or to other tools except the Bingemind hub; "text-diff" cross link in the spec is not there yet (tool not built). | Add when `text-diff` exists. |

## SEO check
| Item | Result |
|---|---|
| Title | "JSON Diff Checker: Compare JSON Online (Free, Private)", 54 characters. Other pages 25-34. |
| Meta description | Home 147. About 152, Contact 154, Privacy 154, Terms 142: all in 120-155. |
| H1 | One per page. Home: "JSON Diff Checker: Compare Two JSON Files" (matches the spec). |
| Canonical | Self, `https://bingemind.com/json-diff/...` in Bingemind mode; robots meta `index,follow`; contact and terms `noindex, follow` and absent from the sitemap. |
| JSON-LD | Parsed 3 blocks: WebApplication (DeveloperApplication, free Offer, screenshot, author and publisher as the credit brief says), BreadcrumbList, FAQPage (8 Q and A). No aggregateRating. |
| OG image | `og.png` 1200x630, a real result screenshot, readable. Also twitter card large image. |
| Sitemap, robots | `sitemap-index.xml` and `sitemap-0.xml` at `/json-diff/` (3 URLs). No robots.txt in Bingemind mode (the Bingemind root owns it, per brief). Normal mode has robots.txt with Allow and the sitemap line. |
| Article depth | 752 words under the tool (spec: 700-900), 8 sections as in the spec, with a comparison table and an arrays example. FAQ 8 items, 487 words. |
| Facts in the copy | Speed claims match my measures (5.3 MB, 35,000 records, 309 ms compare in Chrome). "Files up to 50 MB open": I verified 30.6 MB only. "This is what most people want when they compare API responses" has no source; soften it. |
| Internal links | Header, footer and More-tools block link to About, Contact, Privacy, Terms and the Bingemind hub. Fine for a single page tool. |
| Favicon and logo | SVG logo (braces with a red and a green bar), crisp at 28 px and in the tab, PNG 32, apple-touch, 192, 512, manifest. Good. |
| Phone | One column, sticky Edit / Result / Compare bar, 44 px buttons, no sideways scroll, Before/After switch in side by side. One-thumb use works. |

Rival comparison (R-AND-D.md claims): result before editors (yes), paths (yes), key match with a visible choice (yes), exact 20-digit numbers (yes), 5 MB in under 3 s with a free page (yes, 0.3 s), line and column errors (yes), ignore paths (yes), phone layout (yes). Still behind: aligned side by side (rivals align), per-array override, "Fix it" buttons (spec P1), tree view (P1).
