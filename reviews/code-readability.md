# Code review, lens: readability (Olivia, 2026-10-21)

Verdict: comments explain the why (position rule, value model, worker protocol) and the modules are named by job. A new engineer can read the core in an hour. The page text has a few mismatches with the buttons. **Must-fix: 0. Should: 5. Nice: 4.** Template leftovers (README, new-tool.sh, screenshots dir, duplicate legal block, build-date "Last updated", British spelling): one line only. I found no placeholder text, no em dashes and no British spelling in the tool's own pages.

| Severity | File:line | Finding | Why | Fix |
|---|---|---|---|---|
| should | Article.astro:12, README.md:7 | Text says "press **Open file**"; the button reads **Open** (aria-label "Open a file for Original"). | Reader looks for a button that does not exist. | Say "press **Open**" or rename the button "Open file". |
| should | ui.js:295 | Big-input notice says "The box shows the first 1 lines" for a one-line file (it shows 200,000 characters). | Wrong and clumsy. | Word it by characters when the line count is small. |
| should | normalize.js:120 | Note "Tolerance not applied to large numbers." appears for 17-digit decimals that are not large. | Misleading (the bug is in the regression report). | New text: "Tolerance not applied: the number does not fit a double." |
| should | ui.js:54, 864, 976, 983 | `S.viewSeq` is the id counter for view, patch and format requests. `S.view.seq` is something else (the compare id). | Two meanings for "seq". | Rename to `S.reqId` and `S.view.compareId`. |
| should | ui.js:945 | `waitAllLoaded()` does not wait; it returns a boolean. | Name lies. | `allLoaded()`. |
| nice | Tool.astro `jd-sortkeys2`, `jd-patch-note`, `jd-sentinel` | Suffix names and ids with no meaning. | Reader must grep. | `jd-sortkeys-sbs`; delete the dead ones (see minimalism). |
| nice | report.js:`RawNumber` | A function named like a class that returns a marker object. | Confusing. | See minimalism: remove. |
| nice | parse.js:`keyed` | `let keyed` is declared after the function that uses it (works, hard to read). | Order of reading. | Move the declaration above `readKeyAndColon`. |
| nice | MoreTools.astro | Link text "Count the drawer calculator" is awkward English (shared with the cash drawer tool). | Reads wrong in the footer block. | "Cash drawer counter". |

README accuracy: matches the code (modules, commands, 1 MB rule). The line "Open file" above is the only mismatch. Page copy: US spelling, short sentences, no hype. Article 752 words, FAQ 8 items (487 words), About, Privacy, Terms, Contact are complete and not placeholders. Dates "October 20, 2026" are consistent with the build date.
