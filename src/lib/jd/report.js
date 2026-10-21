// Text report, JSON Patch (RFC 6902) and finding a value in the source text.
import { ptrSegments } from './paths.js';
import { pretty } from './serialize.js';

export function changeLine(c) {
  switch (c.kind) {
    case 'added': return `+ ${c.path}: ${c.b}`;
    case 'removed': return `- ${c.path}: ${c.a}`;
    case 'type': return `T ${c.path}: type change, ${c.aType} to ${c.bType}: ${c.a} -> ${c.b}`;
    default: return `~ ${c.path}: ${c.a} -> ${c.b}` + (c.note ? ` (${c.note.replace(/\.$/, '')})` : '');
  }
}

/** Plain text report, one line per change. */
export function reportText(summaryLine, changes, extra = []) {
  const out = [summaryLine, ...extra, ''];
  for (const c of changes) out.push(changeLine(c));
  return out.join('\n') + '\n';
}

/** Words for screen readers: "Changed, path $.a, from 1 to 2". */
export function changeLabel(c) {
  const k = { added: 'Added', removed: 'Removed', changed: 'Changed', type: 'Type change' }[c.kind];
  if (c.kind === 'added') return `${k}, path ${c.path}, value ${c.b}`;
  if (c.kind === 'removed') return `${k}, path ${c.path}, was ${c.a}`;
  if (c.kind === 'type') return `${k}, path ${c.path}, from ${c.aType} ${c.a} to ${c.bType} ${c.b}`;
  return `${k}, path ${c.path}, from ${c.a} to ${c.b}`;
}

// ---------------------------------------------------------------------------
// Find a value in the source text by JSON Pointer. Re-scans the text on demand.

function skipWs(t, i) {
  for (;;) {
    const c = t.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) i++;
    else if (c === 47 && t.charCodeAt(i + 1) === 47) {
      const e = t.indexOf('\n', i);
      i = e === -1 ? t.length : e + 1;
    } else if (c === 47 && t.charCodeAt(i + 1) === 42) {
      const e = t.indexOf('*/', i + 2);
      i = e === -1 ? t.length : e + 2;
    } else return i;
  }
}

function skipString(t, i) {
  // t[i] is the opening quote
  i++;
  for (;;) {
    const q = t.indexOf('"', i);
    if (q === -1) return t.length;
    let b = q - 1;
    let slashes = 0;
    while (b >= i && t.charCodeAt(b) === 92) { slashes++; b--; }
    if (slashes % 2 === 0) return q + 1;
    i = q + 1;
  }
}

/** End offset (exclusive) of the value that starts at i. */
export function skipValue(t, i) {
  const c = t.charCodeAt(i);
  if (c === 34) return skipString(t, i);
  if (c === 123 || c === 91) {
    let depth = 0;
    for (; i < t.length; i++) {
      const d = t.charCodeAt(i);
      if (d === 34) { i = skipString(t, i) - 1; continue; }
      if (d === 47 && (t.charCodeAt(i + 1) === 47 || t.charCodeAt(i + 1) === 42)) { i = skipWs(t, i) - 1; continue; }
      if (d === 123 || d === 91) depth++;
      else if (d === 125 || d === 93) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return t.length;
  }
  while (i < t.length) {
    const d = t.charCodeAt(i);
    if (d === 44 || d === 125 || d === 93 || d === 32 || d === 9 || d === 10 || d === 13 || d === 47) break;
    i++;
  }
  return i;
}

/**
 * Find where the value at a JSON Pointer sits in the text.
 * Returns { start, end } offsets or null. Duplicate keys: the last one wins, as in the diff.
 */
export function locate(text, ptr) {
  const segs = ptrSegments(ptr);
  let i = skipWs(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  for (const seg of segs) {
    const c = text.charCodeAt(i);
    if (c === 123) {
      i = skipWs(text, i + 1);
      let found = -1;
      while (i < text.length && text.charCodeAt(i) === 34) {
        const kEnd = skipString(text, i);
        let key;
        try { key = JSON.parse(text.slice(i, kEnd)); } catch { key = null; }
        i = skipWs(text, kEnd);
        i = skipWs(text, i + 1); // colon
        if (key === seg) found = i;
        i = skipWs(text, skipValue(text, i));
        if (text.charCodeAt(i) === 44) i = skipWs(text, i + 1);
        else break;
      }
      if (found < 0) return null;
      i = found;
    } else if (c === 91) {
      const want = Number(seg);
      if (!Number.isInteger(want)) return null;
      i = skipWs(text, i + 1);
      let idx = 0;
      let found = -1;
      while (i < text.length && text.charCodeAt(i) !== 93) {
        if (idx === want) { found = i; break; }
        i = skipWs(text, skipValue(text, i));
        if (text.charCodeAt(i) === 44) i = skipWs(text, i + 1);
        else break;
        idx++;
      }
      if (found < 0) return null;
      i = found;
    } else return null;
  }
  return { start: i, end: skipValue(text, i) };
}

// ---------------------------------------------------------------------------
// JSON Patch (RFC 6902). Valid for "by position" matching and for matching without moves.

/**
 * Build a patch from changes whose pointers refer to positions in the two documents.
 * Order: removes (array items from the highest index down), then replaces, then adds.
 */
export function jsonPatch(changes, trees) {
  const removes = [];
  const replaces = [];
  const adds = [];
  for (const c of changes) {
    if (c.kind === 'removed') removes.push(c);
    else if (c.kind === 'added') adds.push(c);
    else replaces.push(c);
  }
  const lastIdx = (p) => {
    const s = p.slice(p.lastIndexOf('/') + 1);
    return /^\d+$/.test(s) ? Number(s) : -1;
  };
  removes.sort((x, y) => lastIdx(y.ptrA) - lastIdx(x.ptrA));
  const ops = [];
  for (const c of removes) ops.push({ op: 'remove', path: c.ptrA });
  for (const c of replaces) ops.push({ op: 'replace', path: c.ptrA, value: valueAt(trees.b, c.ptrB) });
  for (const c of adds) ops.push({ op: 'add', path: c.ptrB, value: valueAt(trees.b, c.ptrB) });
  return ops;
}

function valueAt(root, ptr) {
  let cur = root;
  for (const seg of ptrSegments(ptr)) {
    cur = cur instanceof Map ? cur.get(seg) : cur[Number(seg)];
  }
  return cur;
}

/** Write a patch as JSON text. Values keep their number text exactly. */
export function patchText(ops) {
  const out = ops.map((op) => {
    const lines = ['  {', `    "op": ${JSON.stringify(op.op)},`, `    "path": ${JSON.stringify(op.path)}${'value' in op ? ',' : ''}`];
    if ('value' in op) {
      const v = pretty(op.value, { indent: 2 }).lines;
      lines.push('    "value": ' + v[0]);
      for (let i = 1; i < v.length; i++) lines.push('    ' + v[i]);
    }
    lines.push('  }');
    return lines.join('\n');
  });
  return out.length ? '[\n' + out.join(',\n') + '\n]' : '[]';
}
