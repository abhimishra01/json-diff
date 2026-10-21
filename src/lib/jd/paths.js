// Path helpers: display paths, JSON Pointers, and the "ignore paths" patterns (JSONPath-lite).

const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Display segment for an object key: .name or ["odd key"]. */
export function keySeg(key) {
  return SIMPLE_KEY.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
}

/** JSON Pointer segment escape (RFC 6901). */
export function ptrEsc(s) {
  return s.indexOf('~') === -1 && s.indexOf('/') === -1 ? s : s.replace(/~/g, '~0').replace(/\//g, '~1');
}
export function ptrUnesc(s) {
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}
export function ptrSegments(ptr) {
  if (ptr === '' || ptr == null) return [];
  return ptr.slice(1).split('/').map(ptrUnesc);
}

/** Remove the [..] groups of a display path, so "$.u[id=1].tags" and "$.u[id=2].tags" count as one place. */
export function shapePath(path) {
  return path.replace(/\[(?!")[^\]]*\]/g, '[]');
}

// ---------------------------------------------------------------------------
// Ignore patterns

/**
 * Compile the ignore text. One pattern per line. Lines that start with # are comments.
 * Returns { patterns: [{ src, segs }], errors: [{ line, message }] }
 * Segment kinds: { t: 'key', v }, { t: 'idx', v }, { t: 'star' }, { t: 'any' }.
 */
export function compileIgnore(text) {
  const patterns = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const s = raw.trim();
    if (s === '' || s.startsWith('#')) continue;
    const r = parseOne(s);
    if (typeof r === 'string') errors.push({ line: ln + 1, message: r });
    else patterns.push({ src: s, segs: r });
  }
  return { patterns, errors };
}

function parseOne(s) {
  let i = 0;
  const n = s.length;
  if (s[0] === '$') i = 1;
  const segs = [];
  const readName = () => {
    const st = i;
    while (i < n && s[i] !== '.' && s[i] !== '[') i++;
    return s.slice(st, i);
  };
  const pushName = (name) => {
    if (name === '') return 'A name is missing here.';
    if (name === '**') segs.push({ t: 'any' });
    else if (name === '*') segs.push({ t: 'star' });
    else segs.push({ t: 'key', v: name });
    return null;
  };
  if (i === n) return 'This pattern is empty. Name a field, for example `updatedAt`.';
  if (i === 0 && s[0] !== '.' && s[0] !== '[') {
    const err = pushName(readName());
    if (err) return err;
  }
  while (i < n) {
    const c = s[i];
    if (c === '.') {
      i++;
      if (s[i] === '.') {
        i++;
        segs.push({ t: 'any' });
      }
      if (i >= n) {
        if (s[i - 1] === '.' && s[i - 2] === '.') return 'A name is missing after `..`.';
        return 'A name is missing after the dot.';
      }
      if (s[i] === '[') continue;
      const err = pushName(readName());
      if (err) return err;
    } else if (c === '[') {
      const close = findClose(s, i);
      if (close < 0) return 'A `]` is missing.';
      const inner = s.slice(i + 1, close).trim();
      i = close + 1;
      if (inner === '*') segs.push({ t: 'star' });
      else if (/^\d+$/.test(inner)) segs.push({ t: 'idx', v: Number(inner) });
      else if ((inner[0] === '"' && inner.endsWith('"') && inner.length >= 2) || (inner[0] === "'" && inner.endsWith("'") && inner.length >= 2)) {
        let key;
        if (inner[0] === '"') {
          try { key = JSON.parse(inner); } catch { return 'The quoted name is not valid. Use `["name"]`.'; }
        } else key = inner.slice(1, -1);
        segs.push({ t: 'key', v: key });
      } else return 'Inside `[ ]` use a number, `*`, or a quoted name.';
    } else {
      return `Unexpected \`${c}\`. Separate names with dots.`;
    }
  }
  if (segs.length === 0) return 'This pattern is empty. Name a field, for example `updatedAt`.';
  if (segs.length > 60) return 'This pattern is too long.';
  return segs;
}

function findClose(s, from) {
  let q = null;
  for (let j = from + 1; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === '\\' && q === '"') j++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ']') return j;
  }
  return -1;
}

// State sets for the pattern matcher. A state is p * 64 + s (pattern p, next segment s).
const SEG_MAX = 64;

function closure(patterns, set) {
  // follow "any" segments with zero length
  for (let k = 0; k < set.length; k++) {
    const st = set[k];
    const p = Math.floor(st / SEG_MAX);
    const si = st % SEG_MAX;
    const segs = patterns[p].segs;
    if (si < segs.length && segs[si].t === 'any') {
      const nx = p * SEG_MAX + si + 1;
      if (!set.includes(nx)) set.push(nx);
    }
  }
  return set;
}

/** Start state set for the root. */
export function startStates(patterns) {
  const set = [];
  for (let p = 0; p < patterns.length; p++) set.push(p * SEG_MAX);
  return closure(patterns, set);
}

/** True when a state set holds a finished pattern. */
export function accepts(patterns, set) {
  for (const st of set) {
    const p = Math.floor(st / SEG_MAX);
    if (st % SEG_MAX === patterns[p].segs.length) return true;
  }
  return false;
}

/** Move to a child. seg is a string (object key) or a number (array index). */
export function stepStates(patterns, set, seg) {
  const out = [];
  const isIdx = typeof seg === 'number';
  for (const st of set) {
    const p = Math.floor(st / SEG_MAX);
    const si = st % SEG_MAX;
    const segs = patterns[p].segs;
    if (si >= segs.length) continue;
    const pat = segs[si];
    if (pat.t === 'any') {
      if (!out.includes(st)) out.push(st);
    } else if (pat.t === 'star' || (pat.t === 'key' && !isIdx && pat.v === seg) || (pat.t === 'idx' && isIdx && pat.v === seg)) {
      const nx = st + 1;
      if (!out.includes(nx)) out.push(nx);
    }
  }
  return closure(patterns, out);
}

/**
 * Copy a tree without the ignored parts. Iterative. Returns { tree, places }.
 * Parts of the tree that no pattern can reach are shared, not copied.
 */
export function applyIgnore(root, patterns) {
  let places = 0;
  const start = startStates(patterns);
  if (accepts(patterns, start)) return { tree: root, places: 0 };
  if (!(root instanceof Map) && !Array.isArray(root)) return { tree: root, places: 0 };
  const isObj = root instanceof Map;
  const outRoot = isObj ? new Map() : [];
  // frame: [src, dst, states, keysOrNull, index]
  const stack = [{ src: root, dst: outRoot, states: start, keys: isObj ? Array.from(root.keys()) : null, idx: 0 }];
  while (stack.length) {
    const f = stack[stack.length - 1];
    const len = f.keys ? f.keys.length : f.src.length;
    if (f.idx >= len) {
      stack.pop();
      continue;
    }
    const seg = f.keys ? f.keys[f.idx] : f.idx;
    const child = f.keys ? f.src.get(seg) : f.src[seg];
    f.idx++;
    const cs = stepStates(patterns, f.states, seg);
    if (cs.length && accepts(patterns, cs)) {
      places++;
      continue;
    }
    const container = child instanceof Map || Array.isArray(child);
    if (!container || cs.length === 0) {
      if (f.keys) f.dst.set(seg, child);
      else f.dst.push(child);
      continue;
    }
    const cIsObj = child instanceof Map;
    const cd = cIsObj ? new Map() : [];
    if (f.keys) f.dst.set(seg, cd);
    else f.dst.push(cd);
    stack.push({ src: child, dst: cd, states: cs, keys: cIsObj ? Array.from(child.keys()) : null, idx: 0 });
  }
  return { tree: outRoot, places };
}

