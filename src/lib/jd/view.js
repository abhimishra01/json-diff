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

/** Which values of a sequence are NOT part of the longest increasing run. Returns a Uint8Array flag per entry. */
function outsideLongestRun(seq) {
  const n = seq.length;
  const tails = []; // index in seq of the smallest tail for each run length
  const prev = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[k]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out = new Uint8Array(n).fill(1);
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out[k] = 0;
  return out;
}

/**
 * For arrays that were matched by key or by content, show the Changed items in the order of the
 * Original, so matched items meet on one row. Items only in Changed go after their old neighbor.
 * Returns { order: Map(B array -> order), movedA: Map(A array -> Set), movedB: Map(B array -> Set) }.
 */
export function planMatchedArrays(matches) {
  const order = new Map();
  const movedA = new Map();
  const movedB = new Map();
  for (const { a, b, pairs } of matches || []) {
    const n = pairs.length / 2;
    const idx = Array.from({ length: n }, (_, k) => k).sort((x, y) => pairs[2 * x] - pairs[2 * y]);
    const js = idx.map((k) => pairs[2 * k + 1]);
    const is = idx.map((k) => pairs[2 * k]);
    const out = outsideLongestRun(js);
    const mA = new Set();
    const mB = new Set();
    for (let k = 0; k < n; k++) {
      if (out[k]) {
        mA.add(is[k]);
        mB.add(js[k]);
      }
    }
    if (mA.size) {
      movedA.set(a, mA);
      movedB.set(b, mB);
    }
    // linked list of B indexes: matched ones in the order of A, the rest after their old neighbor
    const HEAD = b.length;
    const next = new Int32Array(b.length + 1).fill(-1);
    const matched = new Uint8Array(b.length);
    let tail = HEAD;
    for (const j of js) {
      next[tail] = j;
      tail = j;
      matched[j] = 1;
    }
    for (let j = 0; j < b.length; j++) {
      if (matched[j]) continue;
      const prevNode = j === 0 ? HEAD : j - 1;
      next[j] = next[prevNode];
      next[prevNode] = j;
    }
    const list = [];
    for (let k = next[HEAD]; k !== -1; k = next[k]) list.push(k);
    let same = list.length === b.length;
    for (let k = 0; same && k < list.length; k++) if (list[k] !== k) same = false;
    if (!same) order.set(b, list);
  }
  return { order, movedA, movedB };
}

/** Build everything the side by side tab needs. */
export function buildView(trees, changes, matches, sortKeys) {
  const wantA = new Set();
  const wantB = new Set();
  for (const c of changes) {
    if (c.ptrA !== null) wantA.add(c.ptrA);
    if (c.ptrB !== null) wantB.add(c.ptrB);
  }
  const plan = planMatchedArrays(matches);
  const a = pretty(trees.a, { sortKeys, want: wantA, moved: plan.movedA });
  const b = pretty(trees.b, { sortKeys, want: wantB, order: plan.order, moved: plan.movedB });
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
  return {
    a: a.lines, b: b.lines, spans, rowsA, rowsB, lineRowA, lineRowB,
    movedA: Int32Array.from(a.movedLines), movedB: Int32Array.from(b.movedLines),
  };
}
