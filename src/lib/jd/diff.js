// Semantic tree diff. Rules are in the spec, section 3.1. Iterative: no recursion limit.
import { Num } from './parse.js';
import { typeOf, canonNum, scalarsEqual } from './normalize.js';
import { keyPath, indexPath, matchPath, ptrEsc, shapePath } from './paths.js';
import { compact, canonical } from './serialize.js';

const PREFERRED_KEYS = ['id', 'uuid', '_id', 'key', 'sku', 'code', 'slug', 'email', 'name'];
const VALUE_LIMIT = 2000;
const SIMILARITY_CAP = 1500;

/** Identity string of a key value, or null when it cannot be a key (not a string or number). */
function keyIdentity(v) {
  if (typeof v === 'string') return 's' + v;
  if (v instanceof Num) return 'n' + canonNum(v);
  return null;
}
function keyShown(v) {
  return typeof v === 'string' ? v : v.s;
}

/** Read a key (name or dot path) from an object item. */
function getKey(item, spec) {
  if (!(item instanceof Map)) return undefined;
  if (spec.length === 1) return item.get(spec[0]);
  let cur = item;
  for (const part of spec) {
    if (!(cur instanceof Map)) return undefined;
    cur = cur.get(part);
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Try a key on one array. Returns 'ok', 'missing' (not on every item) or 'dup'. */
function keyReliability(arr, spec) {
  const seen = new Set();
  for (const item of arr) {
    const id = keyIdentity(getKey(item, spec));
    if (id === null) return 'missing';
    if (seen.has(id)) return 'dup';
    seen.add(id);
  }
  return 'ok';
}

function allObjects(arr) {
  for (const x of arr) if (!(x instanceof Map)) return false;
  return true;
}

/**
 * Compare two documents.
 * opts is the options object (see normalize.js). Returns { changes, warnings, choices }.
 * Change: { kind, path, ptrA, ptrB, a, b, aType, bType, note, sa, sb }
 */
export function diffTrees(A, B, opts) {
  const changes = [];
  const warnings = [];
  const choices = new Map(); // shape|mode|key -> { path, mode, key, count }
  const warned = new Set();

  const keySpecText = (opts.arrays.key || '').trim();
  const userKey = keySpecText ? keySpecText.split('.').map((s) => s.trim()).filter(Boolean) : null;

  const show = (v) => compact(v, VALUE_LIMIT);

  const emit = (c) => changes.push(c);

  const removedChange = (path, ptrA, v) => ({ kind: 'removed', path, ptrA, ptrB: null, a: show(v), aType: typeOf(v) });
  const addedChange = (path, ptrB, v) => ({ kind: 'added', path, ptrA: null, ptrB, b: show(v), bType: typeOf(v) });

  const addWarning = (key, text) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(text);
  };

  const recordChoice = (path, mode, key) => {
    const shape = shapePath(path);
    const id = shape + '|' + mode + '|' + (key || '');
    const c = choices.get(id);
    if (c) c.count++;
    else choices.set(id, { path: shape, mode, key: key || '', count: 1 });
  };

  // Work items: { t: 'pair', a, b, path, pa, pb } or { t: 'emit', c }
  const stack = [{ t: 'pair', a: A, b: B, path: '$', pa: '', pb: '' }];
  const pushAll = (list) => {
    for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
  };

  while (stack.length) {
    const w = stack.pop();
    if (w.t === 'emit') {
      emit(w.c);
      continue;
    }
    const { a, b, path, pa, pb } = w;
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta !== tb) {
      emit({ kind: 'type', path, ptrA: pa, ptrB: pb, a: show(a), b: show(b), aType: ta, bType: tb });
      continue;
    }
    if (ta === 'object') {
      if (a === b) continue;
      const list = [];
      for (const [k, av] of a) {
        const kp = keyPath(path, k);
        const e = ptrEsc(k);
        if (b.has(k)) list.push({ t: 'pair', a: av, b: b.get(k), path: kp, pa: pa + '/' + e, pb: pb + '/' + e });
        else list.push({ t: 'emit', c: removedChange(kp, pa + '/' + e, av) });
      }
      for (const [k, bv] of b) {
        if (!a.has(k)) list.push({ t: 'emit', c: addedChange(keyPath(path, k), pb + '/' + ptrEsc(k), bv) });
      }
      pushAll(list);
      continue;
    }
    if (ta === 'array') {
      if (a === b) continue;
      pushAll(arrayWork(a, b, path, pa, pb));
      continue;
    }
    // scalar
    const r = scalarsEqual(a, b, opts);
    if (r.eq) continue;
    const c = { kind: 'changed', path, ptrA: pa, ptrB: pb, a: show(a), b: show(b), aType: ta, bType: tb };
    if (r.note) c.note = r.note;
    if (ta === 'string') {
      c.sa = a.length > 5000 ? a.slice(0, 5000) : a;
      c.sb = b.length > 5000 ? b.slice(0, 5000) : b;
    }
    emit(c);
  }

  function positionWork(a, b, path, pa, pb) {
    const list = [];
    const m = Math.min(a.length, b.length);
    for (let i = 0; i < m; i++) list.push({ t: 'pair', a: a[i], b: b[i], path: indexPath(path, i), pa: pa + '/' + i, pb: pb + '/' + i });
    for (let i = m; i < a.length; i++) list.push({ t: 'emit', c: removedChange(indexPath(path, i), pa + '/' + i, a[i]) });
    for (let i = m; i < b.length; i++) list.push({ t: 'emit', c: addedChange(indexPath(path, i), pb + '/' + i, b[i]) });
    return list;
  }

  function keyWork(a, b, path, pa, pb, spec) {
    const keyName = spec.join('.');
    const idxB = new Map();
    for (let j = 0; j < b.length; j++) idxB.set(keyIdentity(getKey(b[j], spec)), j);
    const used = new Uint8Array(b.length);
    const list = [];
    for (let i = 0; i < a.length; i++) {
      const kv = getKey(a[i], spec);
      const j = idxB.get(keyIdentity(kv));
      const p = matchPath(path, keyName, keyShown(kv));
      if (j === undefined) list.push({ t: 'emit', c: removedChange(p, pa + '/' + i, a[i]) });
      else {
        used[j] = 1;
        list.push({ t: 'pair', a: a[i], b: b[j], path: p, pa: pa + '/' + i, pb: pb + '/' + j });
      }
    }
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      list.push({ t: 'emit', c: addedChange(matchPath(path, keyName, keyShown(getKey(b[j], spec))), pb + '/' + j, b[j]) });
    }
    return list;
  }

  function orderWork(a, b, path, pa, pb) {
    const canonA = a.map((x) => canonical(x, opts));
    const canonB = b.map((x) => canonical(x, opts));
    const pool = new Map(); // canon -> [indices in b]
    for (let j = 0; j < b.length; j++) {
      const l = pool.get(canonB[j]);
      if (l) l.push(j);
      else pool.set(canonB[j], [j]);
    }
    const usedB = new Uint8Array(b.length);
    const leftA = [];
    for (let i = 0; i < a.length; i++) {
      const l = pool.get(canonA[i]);
      if (l && l.length) usedB[l.shift()] = 1;
      else leftA.push(i);
    }
    const leftB = [];
    for (let j = 0; j < b.length; j++) if (!usedB[j]) leftB.push(j);
    // Pair leftover objects by the number of equal fields, so a changed object is not "removed + added".
    const pairOf = new Map();
    if (leftA.length && leftB.length && leftA.length <= SIMILARITY_CAP && leftB.length <= SIMILARITY_CAP) {
      const fieldsB = new Map();
      const fields = (item, cache, idx) => {
        let f = cache.get(idx);
        if (!f) {
          f = new Map();
          if (item instanceof Map) for (const [k, v] of item) f.set(k, canonical(v, opts));
          cache.set(idx, f);
        }
        return f;
      };
      const fieldsA = new Map();
      const takenB = new Set();
      for (const i of leftA) {
        if (!(a[i] instanceof Map)) continue;
        const fa = fields(a[i], fieldsA, i);
        let best = -1;
        let bestScore = 0;
        for (const j of leftB) {
          if (takenB.has(j) || !(b[j] instanceof Map)) continue;
          const fb = fields(b[j], fieldsB, j);
          let s = 0;
          for (const [k, c] of fa) if (fb.get(k) === c) s++;
          if (s > bestScore) {
            bestScore = s;
            best = j;
          }
        }
        if (best >= 0) {
          takenB.add(best);
          pairOf.set(i, best);
        }
      }
    }
    const list = [];
    for (const i of leftA) {
      const j = pairOf.get(i);
      if (j !== undefined) list.push({ t: 'pair', a: a[i], b: b[j], path: indexPath(path, i), pa: pa + '/' + i, pb: pb + '/' + j });
      else list.push({ t: 'emit', c: removedChange(indexPath(path, i), pa + '/' + i, a[i]) });
    }
    const paired = new Set(pairOf.values());
    for (const j of leftB) {
      if (!paired.has(j)) list.push({ t: 'emit', c: addedChange(indexPath(path, j), pb + '/' + j, b[j]) });
    }
    return list;
  }

  function arrayWork(a, b, path, pa, pb) {
    const mode = opts.arrays.mode;
    const place = path === '$' ? 'the root array' : '`' + path + '`';
    if (mode === 'position') {
      return positionWork(a, b, path, pa, pb);
    }
    if (mode === 'order') {
      recordChoice(path, 'order', '');
      return orderWork(a, b, path, pa, pb);
    }
    if (mode === 'key' && userKey) {
      const objs = allObjects(a) && allObjects(b);
      if (!objs || (a.length === 0 && b.length === 0)) return positionWork(a, b, path, pa, pb);
      const ra = a.length ? keyReliability(a, userKey) : 'ok';
      const rb = b.length ? keyReliability(b, userKey) : 'ok';
      if (ra === 'ok' && rb === 'ok') {
        recordChoice(path, 'key', userKey.join('.'));
        return keyWork(a, b, path, pa, pb, userKey);
      }
      const why = ra === 'dup' || rb === 'dup' ? 'is not unique in' : 'is missing on some items in';
      addWarning('k' + shapePath(path), `\`${userKey.join('.')}\` ${why} ${place}. Matched by position.`);
      recordChoice(path, 'position', '');
      return positionWork(a, b, path, pa, pb);
    }
    // Auto
    if (a.length === 0 && b.length === 0) return [];
    if (a.length && b.length && allObjects(a) && allObjects(b)) {
      let dupName = null;
      for (const name of PREFERRED_KEYS) {
        const spec = [name];
        const ra = keyReliability(a, spec);
        const rb = keyReliability(b, spec);
        if (ra === 'ok' && rb === 'ok') {
          recordChoice(path, 'key', name);
          return keyWork(a, b, path, pa, pb, spec);
        }
        if (!dupName && (ra === 'dup' || rb === 'dup') && ra !== 'missing' && rb !== 'missing') dupName = name;
      }
      if (dupName) addWarning('d' + shapePath(path), `\`${dupName}\` is not unique in ${place}. Matched by position.`);
    }
    recordChoice(path, 'position', '');
    return positionWork(a, b, path, pa, pb);
  }

  return { changes, warnings, choices: Array.from(choices.values()) };
}

export function summarize(changes) {
  const s = { total: changes.length, changed: 0, added: 0, removed: 0, type: 0 };
  for (const c of changes) s[c.kind]++;
  return s;
}

export function summaryText(s) {
  if (s.total === 0) return 'No differences';
  const parts = [];
  if (s.changed) parts.push(`${s.changed} changed`);
  if (s.added) parts.push(`${s.added} added`);
  if (s.removed) parts.push(`${s.removed} removed`);
  if (s.type) parts.push(`${s.type} type ${s.type === 1 ? 'change' : 'changes'}`);
  return `${s.total} ${s.total === 1 ? 'change' : 'changes'}: ${parts.join(', ')}`;
}
