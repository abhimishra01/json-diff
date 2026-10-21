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
    if (typeof x === 'string') return JSON.stringify(x.length > limit ? x.slice(0, limit) : x);
    return String(x);
  };
  for (;;) {
    if (out.length >= limit) return out.slice(0, limit) + '…';
    if (cur instanceof Map || Array.isArray(cur)) {
      const obj = cur instanceof Map;
      const size = obj ? cur.size : cur.length;
      if (size === 0) out += obj ? '{}' : '[]';
      else {
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
 * opts: { sortKeys, indent (2), want: Set of JSON Pointers whose first line number is wanted }
 * Returns { lines, lineOf: Map(pointer -> line index) }
 */
export function pretty(root, opts = {}) {
  const ind = ' '.repeat(opts.indent ?? 2);
  const want = opts.want && opts.want.size ? opts.want : null;
  const lines = [];
  const lineOf = new Map();
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
  let first = true;
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
        stack.push({ obj, src: cur, keys: obj ? entriesOf(cur) : null, i: 0, size, depth: depth + 1, ptr: curPtr });
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
      if (!f) return { lines, lineOf };
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
        cur = f.src[f.i];
        pendingPrefix = '';
        curPtr = want ? f.ptr + '/' + f.i : '';
      }
      f.i++;
      break;
    }
    first = false;
  }
}

/**
 * Canonical text of a value under the compare options. Equal values give equal text.
 * Keys are sorted. Numbers use the canonical value form unless "as written" is on.
 */
export function canonical(root, opts) {
  const written = opts.numbers.mode === 'written';
  const sn = stringsAreNormalized(opts.strings);
  const so = opts.strings;
  let out = '';
  const stack = [];
  let cur = root;
  for (;;) {
    if (cur instanceof Map) {
      if (cur.size === 0) out += '{}';
      else {
        out += '{';
        const ks = Array.from(cur.keys());
        ks.sort();
        stack.push({ obj: true, src: cur, keys: ks, i: 0 });
        cur = undefined;
      }
    } else if (Array.isArray(cur)) {
      if (cur.length === 0) out += '[]';
      else {
        out += '[';
        stack.push({ obj: false, src: cur, keys: null, i: 0 });
        cur = undefined;
      }
    } else if (cur === null) out += 'null';
    else if (cur instanceof Num) out += written ? 'n' + cur.s : 'n' + canonNum(cur);
    else if (typeof cur === 'string') out += JSON.stringify(sn ? normString(cur, so) : cur);
    else if (cur !== undefined) out += String(cur);
    cur = undefined;
    for (;;) {
      const f = stack[stack.length - 1];
      if (!f) return out;
      const size = f.obj ? f.keys.length : f.src.length;
      if (f.i >= size) {
        out += f.obj ? '}' : ']';
        stack.pop();
        continue;
      }
      if (f.i > 0) out += ',';
      if (f.obj) {
        const k = f.keys[f.i];
        out += JSON.stringify(k) + ':';
        cur = f.src.get(k);
      } else cur = f.src[f.i];
      f.i++;
      break;
    }
  }
}
