// Strict JSON parser (RFC 8259) with exact numbers, positions and plain-language errors.
//
// Why our own parser: JSON.parse turns 12345678901234567890 into a float, hides duplicate keys
// and words its errors differently in every browser. This parser is iterative, so it has no
// recursion limit (nesting up to 10,000 levels works).
//
// Value model (kept small and fast):
//   object  -> Map (key -> value, source order, last duplicate wins)
//   array   -> Array
//   string  -> string
//   number  -> Num (keeps the source text)
//   boolean -> true / false
//   null    -> null
//
// Position rule (see spec 5.2): lines and columns start at 1. The position is the first character
// the parser cannot accept. A tab counts as one column. Columns count UTF-16 code units, which
// matches the selection offsets of a browser text area. A BOM at the start is ignored (it is not
// counted in the column).

export class Num {
  constructor(s) {
    this.s = s; // source text, for example "1.0" or "12345678901234567890"
    this.c = undefined; // canonical form, filled in by normalize.js
  }
}

export const MAX_DEPTH = 10000;

const WS_RE = /[ \t\r\n]*/y;
const STR_RE = /[^"\\\u0000-\u001f]*/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

/** Line and column (both 1-based) of an offset in text. */
export function lineCol(text, offset) {
  let line = 1;
  let lineStart = 0;
  let p = text.indexOf('\n');
  while (p !== -1 && p < offset) {
    line++;
    lineStart = p + 1;
    p = text.indexOf('\n', lineStart);
  }
  let col = offset - lineStart + 1;
  if (line === 1 && text.charCodeAt(0) === 0xfeff && offset > 0) col -= 1;
  return { line, col };
}

/** The text of one line, a window of it when the line is very long, and the caret column in that window. */
export function lineContext(text, offset, maxWidth = 100) {
  let start = text.lastIndexOf('\n', offset - 1) + 1;
  let end = text.indexOf('\n', offset);
  if (end === -1) end = text.length;
  let lineText = text.slice(start, end).replace(/\r$/, '');
  let caret = offset - start;
  if (start === 0 && text.charCodeAt(0) === 0xfeff) {
    lineText = lineText.slice(1);
    caret -= 1;
  }
  if (lineText.length > maxWidth * 2) {
    const from = Math.max(0, caret - maxWidth);
    const to = Math.min(lineText.length, caret + maxWidth);
    lineText = (from > 0 ? '…' : '') + lineText.slice(from, to) + (to < lineText.length ? '…' : '');
    caret = caret - from + (from > 0 ? 1 : 0);
  }
  return { lineText, caret: Math.max(0, caret) };
}

function showChar(c) {
  if (c === '\n') return 'a line break';
  if (c === '\r') return 'a line break';
  if (c === '\t') return 'a tab';
  return '`' + c + '`';
}

/**
 * Parse text.
 * Returns one of:
 *   { ok: true, empty: true }
 *   { ok: true, value, warnings: [{ key, offset, line, col }], dupCount }
 *   { ok: false, error: { offset, line, col, message, lineText, caret } }
 * opts.tolerant: allow comments and trailing commas (not strict JSON).
 * opts.onProgress(fraction): called now and then for big input.
 */
export function parse(text, opts = {}) {
  const tolerant = !!opts.tolerant;
  const onProgress = opts.onProgress;
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const warnings = [];
  let dupCount = 0;
  let nextProgress = 262144;

  // Container stack as parallel arrays (fewer allocations than objects).
  const conts = []; // Map | Array
  const keys = []; // pending key for the open object
  const starts = []; // offset of the opening bracket

  const fail = (offset, message) => {
    const { line, col } = lineCol(text, offset);
    const { lineText, caret } = lineContext(text, Math.min(offset, n));
    return { ok: false, error: { offset, line, col, message, lineText, caret } };
  };

  const endFail = () => {
    let o = 0;
    let a = 0;
    for (const c of conts) {
      if (c instanceof Map) o++;
      else a++;
    }
    const parts = [];
    if (o) parts.push(`${o} \`{\``);
    if (a) parts.push(`${a} \`[\``);
    const total = o + a;
    const tail = total === 0 ? 'A value is missing.' : `${parts.join(' and ')} ${total === 1 ? 'is' : 'are'} not closed.`;
    return fail(n, `The text ends too soon. ${tail}`);
  };

  // Skip white space (and comments in tolerant mode). Returns an error object or null.
  const skipWs = () => {
    for (;;) {
      WS_RE.lastIndex = i;
      WS_RE.test(text);
      i = WS_RE.lastIndex;
      if (i >= n) return null;
      if (tolerant && text.charCodeAt(i) === 47) {
        const d = text.charCodeAt(i + 1);
        if (d === 47) {
          const e = text.indexOf('\n', i + 2);
          i = e === -1 ? n : e + 1;
          continue;
        }
        if (d === 42) {
          const e = text.indexOf('*/', i + 2);
          if (e === -1) return fail(i, 'This comment is not closed. Add `*/`.');
          i = e + 2;
          continue;
        }
      }
      return null;
    }
  };

  // Read a string starting at the opening quote (text[i] === '"'). Returns string or error object.
  const readString = () => {
    const open = i;
    i++;
    let out = '';
    for (;;) {
      const from = i;
      STR_RE.lastIndex = i;
      STR_RE.test(text);
      i = STR_RE.lastIndex;
      if (i > from) out += text.slice(from, i);
      if (i >= n) return fail(open, 'This string is not closed.');
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return out;
      }
      if (c === 92) {
        const e = text.charAt(i + 1);
        switch (e) {
          case '"': out += '"'; i += 2; break;
          case '\\': out += '\\'; i += 2; break;
          case '/': out += '/'; i += 2; break;
          case 'b': out += '\b'; i += 2; break;
          case 'f': out += '\f'; i += 2; break;
          case 'n': out += '\n'; i += 2; break;
          case 'r': out += '\r'; i += 2; break;
          case 't': out += '\t'; i += 2; break;
          case 'u': {
            const h = text.slice(i + 2, i + 6);
            if (!HEX4.test(h)) return fail(i, 'A `\\u` escape needs 4 hex digits, for example `\\u00e9`.');
            out += String.fromCharCode(parseInt(h, 16));
            i += 6;
            break;
          }
          default:
            if (i + 1 >= n) return fail(open, 'This string is not closed.');
            return fail(i, `Unknown escape \`\\${e}\`.`);
        }
        continue;
      }
      // Control character (below U+0020) inside a string.
      if (c === 9) return fail(i, 'A tab inside a string must be written as `\\t`.');
      if (c === 10 || c === 13) return fail(open, 'This string is not closed. A line break inside a string must be written as `\\n`.');
      return fail(i, 'A control character inside a string must be written as an escape such as `\\u0001`.');
    }
  };

  // Read a number starting at text[i] ('-' or digit). Returns Num or error object.
  const readNumber = () => {
    const s = i;
    let c = text.charCodeAt(i);
    if (c === 45) {
      i++;
      c = text.charCodeAt(i);
      if (!(c >= 48 && c <= 57)) {
        if (text.startsWith('Infinity', i)) return fail(s, '`-Infinity` is not valid JSON. Use a string or null.');
        return fail(i < n ? i : s, 'A number needs digits after the minus sign.');
      }
    }
    if (c === 48) {
      i++;
      const d = text.charCodeAt(i);
      if (d >= 48 && d <= 57) return fail(i, 'Numbers cannot start with a zero.');
    } else {
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d >= 48 && d <= 57) i++;
        else break;
      }
    }
    if (text.charCodeAt(i) === 46) {
      i++;
      const f = i;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d >= 48 && d <= 57) i++;
        else break;
      }
      if (i === f) return fail(i < n ? i : i, 'A decimal point needs digits after it.');
    }
    c = text.charCodeAt(i);
    if (c === 101 || c === 69) {
      i++;
      c = text.charCodeAt(i);
      if (c === 43 || c === 45) i++;
      const f = i;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d >= 48 && d <= 57) i++;
        else break;
      }
      if (i === f) return fail(i, 'An exponent needs digits after `e`.');
    }
    return new Num(text.slice(s, i));
  };

  // Read a word such as true, false, null, NaN. Returns { v } or error object.
  const readWord = () => {
    const s = i;
    let j = i;
    while (j < n) {
      const d = text.charCodeAt(j);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95 || d === 36 || (d >= 48 && d <= 57)) j++;
      else break;
    }
    const w = text.slice(s, j);
    if (w === 'true') { i = j; return { v: true }; }
    if (w === 'false') { i = j; return { v: false }; }
    if (w === 'null') { i = j; return { v: null }; }
    if (w === 'NaN' || w === 'Infinity') return fail(s, `\`${w}\` is not valid JSON. Use a string or null.`);
    const lw = w.toLowerCase();
    if (lw === 'true' || lw === 'false' || lw === 'null') return fail(s, 'Write `true`, `false` and `null` in lowercase.');
    if (w === 'undefined') return fail(s, '`undefined` is not valid JSON. Use null.');
    return fail(s, `\`${w}\` is not a valid JSON value. Text needs double quotes.`);
  };

  // Why a character cannot start a value.
  const badValueStart = (ch) => {
    const top = conts.length ? conts[conts.length - 1] : null;
    if (ch === '}' || ch === ']') {
      if (!top) return `This \`${ch}\` has no matching \`${ch === '}' ? '{' : '['}\`.`;
      const open = top instanceof Map ? '{' : '[';
      if ((ch === '}') !== (top instanceof Map)) return `This \`${ch}\` does not match. The open bracket is \`${open}\`.`;
      if (top instanceof Map) return 'A value is missing after the colon.';
      return 'A value is missing before `]`.';
    }
    if (ch === ',') {
      if (top instanceof Map) return 'A value is missing after the colon.';
      return 'A value is missing before the comma.';
    }
    if (ch === ':') return 'A colon cannot start a value. A key or a value is missing.';
    if (ch === "'") return 'Keys and strings need double quotes (`"`), not single quotes.';
    if (ch === '/') return 'Comments are not allowed in JSON. Turn on Tolerant mode to allow them.';
    if (ch === '+') return 'Numbers cannot start with `+`. Remove it.';
    if (ch === '.') return 'Numbers cannot start with a decimal point. Write `0.5`, not `.5`.';
    return `Unexpected ${showChar(ch)}. A value is expected here.`;
  };

  let keyed = 0; // offset of the last key (for duplicate warnings)

  // Read an object key at text[i] (after white space). Then the colon. Returns key string or error object.
  const readKeyAndColon = () => {
    let e = skipWs();
    if (e) return e;
    if (i >= n) return endFail();
    const kc = text.charCodeAt(i);
    let key;
    const keyStart = i;
    if (kc === 34) {
      key = readString();
      if (typeof key !== 'string') return key;
    } else if (kc === 39) {
      return fail(i, 'Keys and strings need double quotes (`"`), not single quotes.');
    } else if (kc === 44) {
      return fail(i, 'A key is missing before the comma.');
    } else if (kc === 125) {
      return fail(i, 'Extra comma after the last item. Remove it.');
    } else if (kc === 93) {
      return fail(i, 'This `]` does not match. The open bracket is `{`.');
    } else if (kc === 47 && !tolerant) {
      return fail(i, 'Comments are not allowed in JSON. Turn on Tolerant mode to allow them.');
    } else {
      return fail(i, 'Keys need double quotes.');
    }
    e = skipWs();
    if (e) return e;
    if (i >= n) return endFail();
    if (text.charCodeAt(i) !== 58) return fail(i, 'A colon is missing after the key.');
    i++;
    keyed = keyStart;
    return key;
  };
  let root;
  let v;
  let e0 = skipWs();
  if (e0) return e0;
  if (i >= n) return { ok: true, empty: true };

  outer: for (;;) {
    // ----- expect a value -----
    let e = skipWs();
    if (e) return e;
    if (i >= n) return endFail();
    let c = text.charCodeAt(i);
    if (onProgress && i >= nextProgress) {
      nextProgress = i + 262144;
      onProgress(i / n);
    }
    if (c === 123) {
      if (conts.length >= MAX_DEPTH) return fail(i, 'Nesting is deeper than 10,000 levels.');
      const m = new Map();
      starts.push(i);
      i++;
      e = skipWs();
      if (e) return e;
      if (i >= n) { conts.push(m); keys.push(''); return endFail(); }
      if (text.charCodeAt(i) === 125) {
        i++;
        starts.pop();
        v = m;
      } else {
        conts.push(m);
        keys.push('');
        const k = readKeyAndColon();
        if (typeof k !== 'string') return k;
        keys[keys.length - 1] = k;
        starts[starts.length - 1] = keyed;
        continue outer;
      }
    } else if (c === 91) {
      if (conts.length >= MAX_DEPTH) return fail(i, 'Nesting is deeper than 10,000 levels.');
      const a = [];
      i++;
      e = skipWs();
      if (e) return e;
      if (i >= n) { conts.push(a); keys.push(''); starts.push(0); return endFail(); }
      if (text.charCodeAt(i) === 93) {
        i++;
        v = a;
      } else {
        conts.push(a);
        keys.push('');
        starts.push(0);
        continue outer;
      }
    } else if (c === 34) {
      v = readString();
      if (typeof v !== 'string') return v;
    } else if (c === 45 || (c >= 48 && c <= 57)) {
      v = readNumber();
      if (!(v instanceof Num)) return v;
    } else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36) {
      const w = readWord();
      if (!('v' in w)) return w;
      v = w.v;
    } else {
      return fail(i, badValueStart(text.charAt(i)));
    }

    // ----- a value is complete: attach it and read what follows -----
    for (;;) {
      if (conts.length === 0) {
        root = v;
        break outer;
      }
      const top = conts[conts.length - 1];
      const isObj = top instanceof Map;
      if (isObj) {
        const k = keys[keys.length - 1];
        if (top.has(k)) {
          dupCount++;
          if (warnings.length < 50) {
            const { line, col } = lineCol(text, starts[starts.length - 1]);
            warnings.push({ key: k, offset: starts[starts.length - 1], line, col });
          }
        }
        top.set(k, v);
      } else {
        top.push(v);
      }
      let e2 = skipWs();
      if (e2) return e2;
      if (i >= n) return endFail();
      const ch = text.charCodeAt(i);
      if (ch === 44) {
        i++;
        e2 = skipWs();
        if (e2) return e2;
        if (i >= n) return endFail();
        const nx = text.charCodeAt(i);
        if (isObj) {
          if (nx === 125 && tolerant) {
            i++;
            conts.pop(); keys.pop(); starts.pop();
            v = top;
            continue;
          }
          const k = readKeyAndColon();
          if (typeof k !== 'string') return k;
          keys[keys.length - 1] = k;
          starts[starts.length - 1] = keyed;
          continue outer;
        }
        if (nx === 93) {
          if (tolerant) {
            i++;
            conts.pop(); keys.pop(); starts.pop();
            v = top;
            continue;
          }
          return fail(i, 'Extra comma after the last item. Remove it.');
        }
        if (nx === 44) return fail(i, 'Two commas in a row. A value is missing.');
        continue outer;
      }
      if ((isObj && ch === 125) || (!isObj && ch === 93)) {
        i++;
        conts.pop(); keys.pop(); starts.pop();
        v = top;
        continue;
      }
      // Something else follows a finished value.
      const chs = text.charAt(i);
      if (isObj && ch === 93) return fail(i, 'This `]` does not match. The open bracket is `{`.');
      if (!isObj && ch === 125) return fail(i, 'This `}` does not match. The open bracket is `[`.');
      if (ch === 34 || ch === 123 || ch === 91 || ch === 45 || (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) {
        return fail(i, 'A comma is missing between items.');
      }
      if (ch === 58) return fail(i, 'This colon is not expected here. Check the key before it.');
      if (ch === 47 && !tolerant) return fail(i, 'Comments are not allowed in JSON. Turn on Tolerant mode to allow them.');
      return fail(i, `Unexpected ${showChar(chs)}. A comma or a closing bracket is expected here.`);
    }
  }

  const e = skipWs();
  if (e) return e;
  if (i < n) {
    const ch = text.charAt(i);
    if (ch === '/' && !tolerant) return fail(i, 'Comments are not allowed in JSON. Turn on Tolerant mode to allow them.');
    return fail(i, `Unexpected ${showChar(ch)} after the end of the JSON. A document holds one value.`);
  }
  return { ok: true, value: root, warnings, dupCount };
}
