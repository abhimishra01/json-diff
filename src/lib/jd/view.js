// Data for the side by side view: both documents as lines, the lines of each change,
// and rows that line the two documents up (blank filler rows where one side has more lines).
import { pretty } from './serialize.js';

// Where a block that starts at line s ends: the closing bracket line with the same indent.
function blockEnd(lines, s) {
  const t = lines[s];
  const last = t.charCodeAt(t.length - 1);
  const lastNoComma = last === 44 ? t.charCodeAt(t.length - 2) : last;
  if (lastNoComma !== 123 && lastNoComma !== 91) return s;
  let ind = 0;
  while (t.charCodeAt(ind) === 32) ind++;
  for (let k = s + 1; k < lines.length; k++) {
    const u = lines[k];
    let j = 0;
    while (u.charCodeAt(j) === 32) j++;
    if (j === ind) return k;
  }
  return s;
}

/**
 * Line up two lists of lines. Rows pair line i of A with line j of B. Where a change adds or removes
 * lines (or changes their number), the shorter side gets filler rows (-1), so the rest stays level.
 * spans[i] = [startA, endA, startB, endB] for change i, -1 when the side has no lines for it.
 * Returns { rowsA, rowsB } (Int32Array, one entry per row: a line number or -1).
 * Changes that do not run in the same order in both documents (moved items) are skipped.
 */
export function alignRows(nA, nB, spans) {
  const events = [];
  for (const [sa, ea, sb, eb] of spans) {
    const la = sa >= 0 ? ea - sa + 1 : 0;
    const lb = sb >= 0 ? eb - sb + 1 : 0;
    if (sa >= 0 && sb >= 0 && la === lb) continue; // same length, stays level by itself
    events.push({ sa, la, sb, lb, done: false });
  }
  const evA = events.filter((e) => e.sa >= 0).sort((x, y) => x.sa - y.sa);
  const evB = events.filter((e) => e.sb >= 0).sort((x, y) => x.sb - y.sb);
  const rowsA = [];
  const rowsB = [];
  let pa = 0;
  let pb = 0;
  let ia = 0;
  let ib = 0;
  const level = (d) => {
    for (let k = 0; k < d; k++) {
      rowsA.push(pa < nA ? pa : -1);
      rowsB.push(pb < nB ? pb : -1);
      pa++;
      pb++;
    }
  };
  for (;;) {
    while (ia < evA.length && evA[ia].done) ia++;
    while (ib < evB.length && evB[ib].done) ib++;
    const hA = evA[ia];
    const hB = evB[ib];
    if (!hA && !hB) break;
    let pick = null;
    let dist = Infinity;
    if (hA && hA.sb < 0) {
      pick = hA;
      dist = hA.sa - pa;
    }
    if (hB && hB.sa < 0 && hB.sb - pb < dist) {
      pick = hB;
      dist = hB.sb - pb;
    }
    if (hA && hA === hB && hA.sa - pa === hA.sb - pb && hA.sa - pa < dist) {
      pick = hA;
      dist = hA.sa - pa;
    }
    if (!pick) {
      // the heads cannot meet (the documents run in another order here): drop the one that blocks
      (hA && hA.sb >= 0 ? hA : hB).done = true;
      continue;
    }
    pick.done = true;
    if (dist < 0) continue; // already passed
    level(dist);
    const m = Math.max(pick.la, pick.lb);
    for (let k = 0; k < m; k++) {
      rowsA.push(k < pick.la ? pa + k : -1);
      rowsB.push(k < pick.lb ? pb + k : -1);
    }
    pa += pick.la;
    pb += pick.lb;
  }
  level(Math.max(nA - pa, nB - pb, 0));
  return { rowsA: Int32Array.from(rowsA), rowsB: Int32Array.from(rowsB) };
}

/** Build everything the side by side tab needs. */
export function buildView(trees, changes, sortKeys) {
  const wantA = new Set();
  const wantB = new Set();
  for (const c of changes) {
    if (c.ptrA !== null) wantA.add(c.ptrA);
    if (c.ptrB !== null) wantB.add(c.ptrB);
  }
  const a = pretty(trees.a, { sortKeys, want: wantA });
  const b = pretty(trees.b, { sortKeys, want: wantB });
  const spans = new Array(changes.length);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const sa = c.ptrA !== null && a.lineOf.has(c.ptrA) ? a.lineOf.get(c.ptrA) : -1;
    const sb = c.ptrB !== null && b.lineOf.has(c.ptrB) ? b.lineOf.get(c.ptrB) : -1;
    spans[i] = [sa, sa >= 0 ? blockEnd(a.lines, sa) : -1, sb, sb >= 0 ? blockEnd(b.lines, sb) : -1];
  }
  const { rowsA, rowsB } = alignRows(a.lines.length, b.lines.length, spans);
  const lineRowA = new Int32Array(a.lines.length).fill(-1);
  const lineRowB = new Int32Array(b.lines.length).fill(-1);
  for (let r = 0; r < rowsA.length; r++) {
    if (rowsA[r] >= 0) lineRowA[rowsA[r]] = r;
    if (rowsB[r] >= 0) lineRowB[rowsB[r]] = r;
  }
  return { a: a.lines, b: b.lines, spans, rowsA, rowsB, lineRowA, lineRowB };
}
