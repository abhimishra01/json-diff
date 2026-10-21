# Mock-customer test (Olivia, 2026-10-21)

I ran five people through the live page in Chrome with their own data (two on phones: 390 and 360 px, with touch). Page: my own build on port 4966. Their words below are in their voice; the findings (counts, paths, notes, button sizes) are what I saw on screen. Time estimates and the iPhone zoom are my judgement: I could not run Safari here, and the zoom follows from the 14 px field text.

## Dana, backend developer, 32, laptop 1440 px (expert)
Task: two API responses of `/users`. Users come back in a different order, `updatedAt` and `requestId` change on every call.
Story: pastes both, sees 9 changes with paths like `$.data.users[id=7].updatedAt`. Opens Options, writes `**.updatedAt` and `requestId`, gets 6 changes in under a second. She likes that the page says "Matching arrays: users by id".
Then `roles` comes back as `["admin","dev"]` against `["dev","admin"]` and shows as 2 changes. She switches Arrays to Ignore order: now `users` lose their id match and paths turn into `users[1]`. She wants "users by id, roles ignore order" at the same time.
- Click this on Google over the others? "Yes, if the snippet says 'by path' and 'ignore order'. The title says Free, Private. Good."
- Under 30 seconds? "Yes for the first result, 90 seconds for my case."
- Confused me: ignore order and by key cannot be mixed.
- To bookmark: per-array override, and a Copy button for one change as a JSON path plus value.
- Trust: high. Exact paths, and it said what it matched.
- Come back: yes.

## Raj, QA tester, 41, desktop 1280 px (intermediate)
Task: staging against production order lists with no ids, items in different order, one quantity changed.
Story: default (Auto) says "orders by position" and shows 9 changes: all noise. He sees the "Change" link, opens it, picks Ignore order: 1 change, `$.orders[0].qty`. He is happy but only because the page told him what it chose.
- Google click: "Yes."
- 30 seconds: "About 45; I had to find the select."
- Confused: the path `$.orders[0]` points at the first item of the old list, not the new one. He wants both positions ("A[0], B[1]").
- Missing: an "ignore order" hint when Auto chooses position and the changes look like a shuffle ("These look like the same items in a different order. Try Ignore order").
- Trust: good; he checked the 1 change by hand.
- Come back: yes.

## Priya, data analyst, 28, laptop 1366 px (intermediate)
Task: two exports with money values, one from Python (`0.30000000000000004`) and one rounded.
Story: default: reports that value as changed (correct, it is different text). She sets "Allow a difference of 0.0001". Result is still 1 change, now with a note "Tolerance not applied to large numbers". "It is 0.3. That is not large." She loses trust in that option. The 20-digit id test works and she likes that exact numbers are kept.
- Google click: "Yes: 'exact numbers' would make me click."
- 30 seconds: "Yes for the compare. Not for the tolerance."
- Confused: the note, and she cannot tell which numbers were skipped.
- Missing: tolerance must work for float noise. Save as CSV of changes.
- Trust: medium until the tolerance is fixed.
- Come back: maybe.

## Jess, first-year student, 20, phone 390 px, touch (beginner)
Task: check her homework JSON; she wrote it like JavaScript: `{name: 'Jess', age: 20,}`.
Story: pastes into the box. The zoom jumps in when she taps the box (14 px text, iPhone style behavior). The page says "Fix the error in the original input to compare", the error box says "Line 1, column 2. Keys need double quotes." with a caret under the place. She edits to valid JSON; result: 1 change, `$.age` 20 to 21. The Edit / Result bar at the bottom works for her thumb.
- Google click: "I would click the one that says Free."
- 30 seconds: "Yes."
- Confused: "Original" and "Changed", which one is the answer key? Also the error lists only the first problem (single quotes and the comma came later).
- Missing: a "Fix it" button (single quotes, trailing comma). Spec P1.
- Trust: high; plain words.
- Come back: yes, for homework.

## Tom, localization lead, 37, phone 360 px, touch (intermediate)
Task: `en.json` against `de.json`, find missing keys.
Story: every German text differs, so there are 7 changes. He taps the "added" and "removed" filter chips (36 px high, tight but works) and sees `$.nav.contact` and `$.footer.imprint`. Then he taps "Copy report" expecting only those two; the report holds all 10 lines. He wants the filter to apply to the copy.
- Google click: "I would search 'compare i18n json missing keys'. This page does not say so, but the tool does the job."
- 30 seconds: "Yes."
- Confused: a "changed" row for each translation, which is expected but noisy.
- Missing: "Only keys" mode (ignore values), copy of the filtered list.
- Trust: good. Come back: yes (monthly).

## Ranked change list
| Rank | Severity | Change | Personas who asked |
|---|---|---|---|
| 1 | must | Fix Tolerance for 16 and 17 digit numbers, and the wrong "large numbers" note | 1 (Priya; but it kills trust in the whole option) |
| 2 | should | Per-array choice (users by id, roles ignore order) or let Ignore order keep id matching | 2 (Dana, Raj) |
| 3 | should | When Auto picks position and the changes look like a shuffle, suggest Ignore order | 1 (Raj), would help Jess too |
| 4 | should | Copy report and Download should follow the active filter | 1 (Tom), 1 more would likely (Dana) |
| 5 | should | 16 px text in the editor on phones (no zoom on focus) | 1 (Jess) |
| 6 | should | "Fix it" buttons for single quotes, comments and trailing comma (spec P1) | 1 (Jess) |
| 7 | should | Show the position in both documents for key-less arrays (A[0] and B[1]) | 1 (Raj) |
| 8 | nice | "Only keys" mode (ignore values) for translation files | 1 (Tom) |
| 9 | nice | Show all errors in a file, not only the first | 1 (Jess) |
| 10 | nice | Short labels: which box is the "answer", Original or Changed | 1 (Jess) |

Top 5 changes: (1) tolerance for float noise, (2) per-array matching, (3) Ignore-order hint, (4) filter-aware report, (5) 16 px editor text on phones.
