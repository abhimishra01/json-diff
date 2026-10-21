// Number and string rules for comparing values, and the option defaults.
import { Num } from './parse.js';

export function defaultOptions() {
  return {
    arrays: { mode: 'auto', key: '' }, // auto | position | key | order
    ignore: '', // one pattern per line
    numbers: { mode: 'value', abs: '', rel: '' }, // value | written; tolerance as text
    strings: { ignoreCase: false, trim: false, collapse: false, nfc: false },
    sortKeys: false,
    tolerant: false,
  };
}

/** Merge saved options over the defaults and drop anything of the wrong shape. */
export function cleanOptions(o) {
  const d = defaultOptions();
  if (!o || typeof o !== 'object') return d;
  const mode = o.arrays && ['auto', 'position', 'key', 'order'].includes(o.arrays.mode) ? o.arrays.mode : d.arrays.mode;
  const key = o.arrays && typeof o.arrays.key === 'string' ? o.arrays.key.slice(0, 200) : '';
  const nm = o.numbers && ['value', 'written'].includes(o.numbers.mode) ? o.numbers.mode : 'value';
  const numText = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x).slice(0, 30) : '');
  const s = o.strings || {};
  return {
    arrays: { mode, key },
    ignore: typeof o.ignore === 'string' ? o.ignore.slice(0, 20000) : '',
    numbers: { mode: nm, abs: numText(o.numbers && o.numbers.abs), rel: numText(o.numbers && o.numbers.rel) },
    strings: { ignoreCase: !!s.ignoreCase, trim: !!s.trim, collapse: !!s.collapse, nfc: !!s.nfc },
    sortKeys: !!o.sortKeys,
    tolerant: !!o.tolerant,
  };
}

export function typeOf(v) {
  if (v === null) return 'null';
  if (v instanceof Num) return 'number';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Map) return 'object';
  return typeof v; // string | boolean
}

/**
 * Canonical form of a number: equal canonical strings mean equal mathematical value.
 * 1, 1.0, 1e0 and 10e-1 all give "1e0"; -0 gives "0". Never goes through a float.
 */
export function canonNum(x) {
  if (x.c !== undefined) return x.c;
  const s = x.s;
  let k = 0;
  let neg = false;
  if (s.charCodeAt(0) === 45) {
    neg = true;
    k = 1;
  }
  let ePos = s.indexOf('e');
  if (ePos === -1) ePos = s.indexOf('E');
  const mant = ePos === -1 ? s.slice(k) : s.slice(k, ePos);
  const exp = ePos === -1 ? 0 : Number(s.slice(ePos + 1));
  const dot = mant.indexOf('.');
  const intp = dot === -1 ? mant : mant.slice(0, dot);
  const frac = dot === -1 ? '' : mant.slice(dot + 1);
  let digits = (intp + frac).replace(/^0+/, '');
  if (digits === '') {
    x.c = '0';
    return x.c;
  }
  let e10 = exp - frac.length;
  const trimmed = digits.replace(/0+$/, '');
  e10 += digits.length - trimmed.length;
  digits = trimmed;
  x.c = (neg ? '-' : '') + digits + 'e' + e10;
  return x.c;
}

/** Digits and exponent of a canonical number, or null when it does not fit a double safely. */
function smallValue(x) {
  const c = canonNum(x);
  if (c === '0') return 0;
  const ePos = c.indexOf('e');
  const m = c.slice(0, ePos);
  const digits = m.startsWith('-') ? m.length - 1 : m.length;
  const e10 = Number(c.slice(ePos + 1));
  if (digits > 15 || !(e10 > -300 && e10 < 300)) return null;
  const f = Number(x.s);
  return Number.isFinite(f) ? f : null;
}

/** Parse a tolerance field. Returns a non-negative number or 0. */
export function toleranceValue(text) {
  if (text === '' || text === undefined || text === null) return 0;
  const v = Number(String(text).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function normString(s, o) {
  if (o.nfc) s = s.normalize('NFC');
  if (o.trim) s = s.trim();
  if (o.collapse) s = s.replace(/\s+/g, ' ');
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

export function stringsAreNormalized(o) {
  return o.ignoreCase || o.trim || o.collapse || o.nfc;
}

/**
 * Compare two numbers. Returns { eq, note }.
 * note is set when a tolerance could not be applied.
 */
export function numbersEqual(a, b, nopts) {
  if (nopts.mode === 'written') return { eq: a.s === b.s };
  if (a.s === b.s) return { eq: true };
  if (canonNum(a) === canonNum(b)) return { eq: true };
  const abs = toleranceValue(nopts.abs);
  const rel = toleranceValue(nopts.rel);
  if (abs === 0 && rel === 0) return { eq: false };
  const x = smallValue(a);
  const y = smallValue(b);
  if (x === null || y === null) return { eq: false, note: 'Tolerance not applied to large numbers.' };
  const d = Math.abs(x - y);
  // A small slack absorbs the float error of the subtraction itself.
  const slack = 1e-12 * Math.max(Math.abs(x), Math.abs(y), 1e-300);
  if (abs > 0 && d <= abs + slack) return { eq: true };
  if (rel > 0 && d <= (rel / 100) * Math.max(Math.abs(x), Math.abs(y)) + slack) return { eq: true };
  return { eq: false };
}

/** Compare two strings under the string options. Returns { eq, note }. */
export function stringsEqual(a, b, sopts) {
  if (a === b) return { eq: true };
  if (stringsAreNormalized(sopts) && normString(a, sopts) === normString(b, sopts)) return { eq: true };
  if (!sopts.nfc && a.normalize('NFC') === b.normalize('NFC')) {
    return { eq: false, note: 'Looks the same, but differs by Unicode form.' };
  }
  return { eq: false };
}

/** Scalar compare. Both values have the same type. Returns { eq, note }. */
export function scalarsEqual(a, b, opts) {
  if (a instanceof Num) return numbersEqual(a, b, opts.numbers);
  if (typeof a === 'string') return stringsEqual(a, b, opts.strings);
  return { eq: a === b };
}
