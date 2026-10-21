// Iterative writers for the value model: compact preview, pretty print, canonical form.
// All of them use an explicit stack, so deep nesting cannot overflow the call stack.
import { Num } from './parse.js';
import { canonNum, normString, stringsAreNormalized } from './normalize.js';
import { ptrEsc } from './paths.js';

const isMap = (v) => v instanceof Map;

/** Short JSON text of a value, cut off after about `limit` characters. */
export function compact(v, limit = 1000) {
  let out = '';
  const stack = [];
  let cur = v;
  const scalar = (x) => {
    if (x === null) return 'null';
    if (x instanceof Num) return x.s;
    if (typeof x === 'string') return x.length > limit ? JSON.stringify(x.slice(0, limit)).slice(0, -1) + '\u2026"' : JSON.stringify(x);
    return String(x);
  };
  for (;;) {
    if (out.length >= limit) return out.slice(0, limit) + '…';
    if (cur instanceof Map || Array.isArray(cur)) {
      const obj = cur instanceof Map;
      const size = obj ? cur.size : cur.length;
      if (size === 0) {
        out += obj ? '{}' : '[]';
        cur = undefined;
      } else {
        out += obj ? '{' : '[';
        stack.push({ obj, it: obj ? cur.entries() : null, arr: obj ? null : cur, i: 0, size, first: true });
        cur = undefined;
      }
    } else if (cur !== undefined) {
      out += scalar(cur);
      cur = undefined;
    }
    // advance
    if (cur === undefined) {
      for (;;) {
        const f = stack[stack.length - 1];
        if (!f) return out;
        if (f.i >= f.size) {
          out += f.obj ? '}' : ']';
          stack.pop();
          continue;
        }
        if (!f.first) out += ',';
        f.first = false;
        if (f.obj) {
          const e = f.it.next().value;
          out += JSON.stringify(e[0]) + ':';
          cur = e[1];
        } else cur = f.arr[f.i];
        f.i++;
        break;
      }
    }
  }
}

/**
 * Pretty print to an array of lines.
 * opts: { sortKeys, indent (2), want: Set of JSON Pointers whose first line number is wanted,
 *         order: Map(array -> indexes in the order to show), moved: Map(array -> Set of indexes) }
 * Returns { lines, lineOf: Map(pointer -> line index), movedLines: first lines of moved items }
 */
export function pretty(root, opts = {}) {
  const ind = ' '.repeat(opts.indent ?? 2);
  const want = opts.want && opts.want.size ? opts.want : null;
  const lines = [];
  const lineOf = new Map();
  const movedLines = []; // first line of each item listed in opts.moved
  const scalar = (x) => {
    if (x === null) return 'null';
    if (x instanceof Num) return x.s;
    if (typeof x === 'string') return JSON.stringify(x);
    return String(x);
  };
  const entriesOf = (m) => {
    const ks = Array.from(m.keys());
    if (opts.sortKeys) ks.sort();
    return ks;
  };
  // Each frame: container, keys (objects), index, depth, ptr prefix
  const stack = [];
  let pendingPrefix = ''; // text before the next value on the same line, e.g. '"a": '
  let depth = 0;
  let cur = root;
  let curPtr = '';
  for (;;) {
    // write cur
    if (want && want.has(curPtr)) lineOf.set(curPtr, lines.length);
    if (cur instanceof Map || Array.isArray(cur)) {
      const obj = isMap(cur);
      const size = obj ? cur.size : cur.length;
      if (size === 0) {
        lines.push(ind.repeat(depth) + pendingPrefix + (obj ? '{}' : '[]'));
        pendingPrefix = '';
        cur = undefined;
      } else {
        lines.push(ind.repeat(depth) + pendingPrefix + (obj ? '{' : '['));
        pendingPrefix = '';
        stack.push({
          obj, src: cur, keys: obj ? entriesOf(cur) : null, i: 0, size, depth: depth + 1, ptr: curPtr,
          order: obj ? null : (opts.order && opts.order.get(cur)) || null, // item order to show, as original indexes
          moved: obj ? null : (opts.moved && opts.moved.get(cur)) || null, // original indexes of moved items
        });
        cur = undefined;
      }
    } else {
      lines.push(ind.repeat(depth) + pendingPrefix + scalar(cur));
      pendingPrefix = '';
      cur = undefined;
    }
    // find the next value
    for (;;) {
      const f = stack[stack.length - 1];
      if (!f) return { lines, lineOf, movedLines };
      if (f.i >= f.size) {
        stack.pop();
        lines.push(ind.repeat(f.depth - 1) + (f.obj ? '}' : ']'));
        continue;
      }
      // a comma goes on the previous line
      if (f.i > 0) {
        // the previous value ended with the last pushed line when it was scalar or a closing bracket
        lines[lines.length - 1] += ',';
      }
      depth = f.depth;
      if (f.obj) {
        const k = f.keys[f.i];
        cur = f.src.get(k);
        pendingPrefix = JSON.stringify(k) + ': ';
        curPtr = want ? f.ptr + '/' + ptrEsc(k) : '';
      } else {
        const idx = f.order ? f.order[f.i] : f.i;
        cur = f.src[idx];
        pendingPrefix = '';
        curPtr = want ? f.ptr + '/' + idx : '';
        if (f.moved && f.moved.has(idx)) movedLines.push(lines.length);
      }
      f.i++;
      break;
    }
  }
}

/**
 * Canonical text of a value under the compare options. Equal values give equal text.
 * Keys are sorted. Array items are sorted too, because this is only used by "Ignore order",
 * where the order of items at any depth does not matter.
 * Numbers use the canonical value form unless "as written" is on.
 * Built bottom-up with an explicit stack, so deep nesting cannot overflow the call stack.
 */
export function canonical(root, opts) {
  const written = opts.numbers.mode === 'written';
  const sn = stringsAreNormalized(opts.strings);
  const so = opts.strings;
  const scalar = (v) => {
    if (v === null) return 'null';
    if (v instanceof Num) return written ? 'n' + v.s : 'n' + canonNum(v);
    if (typeof v === 'string') return JSON.stringify(sn ? normString(v, so) : v);
    return String(v);
  };
  const isBox = (v) => v instanceof Map || Array.isArray(v);
  if (!isBox(root)) return scalar(root);
  // frame: { obj, src, keys, i, parts, prefix } ; prefix is the key text the finished frame goes under
  const open = (v, prefix) => {
    const obj = v instanceof Map;
    let keys = null;
    if (obj) {
      keys = Array.from(v.keys());
      keys.sort();
    }
    return { obj, src: v, keys, i: 0, size: obj ? keys.length : v.length, parts: [], prefix };
  };
  const stack = [open(root, '')];
  for (;;) {
    const f = stack[stack.length - 1];
    if (f.i >= f.size) {
      stack.pop();
      if (!f.obj) f.parts.sort();
      const text = (f.obj ? '{' : '[') + f.parts.join(',') + (f.obj ? '}' : ']');
      if (stack.length === 0) return text;
      stack[stack.length - 1].parts.push(f.prefix + text);
      continue;
    }
    let prefix = '';
    let child;
    if (f.obj) {
      const k = f.keys[f.i];
      prefix = JSON.stringify(k) + ':';
      child = f.src.get(k);
    } else child = f.src[f.i];
    f.i++;
    if (isBox(child)) stack.push(open(child, prefix));
    else f.parts.push(prefix + scalar(child));
  }
}
