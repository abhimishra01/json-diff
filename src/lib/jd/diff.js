// Semantic tree diff. Rules are in the spec, section 3.1. Iterative: no recursion limit.
//
// Paths are built lazily. Each pair of values being compared carries a "context": a link to its
// parent plus the path pieces for this step. The path text is joined only when a change is
// reported, so very deep input does not build huge strings at every level.
import { Num } from './parse.js';
import { typeOf, canonNum, scalarsEqual, numbersEqual, toleranceValue } from './normalize.js';
import { keySeg, ptrEsc, shapePath } from './paths.js';
import { compact, canonical } from './serialize.js';

const PREFERRED_KEYS = ['id', 'uuid', '_id', 'key', 'sku', 'code', 'slug', 'email', 'name'];
const VALUE_LIMIT = 2000;
const SIMILARITY_CAP = 1500;
const HINT_ITEM_CAP = 2000; // longest array that is checked for "same items, other order"
const HINT_BUDGET = 20000; // items checked for that hint in one compare
const SHAPE_DEPTH_CAP = 64; // array choices are listed only above this depth

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

// ---- contexts: { up, d (display piece), a (pointer piece in A), b (pointer piece in B), depth }
const child = (up, d, a, b) => ({ up, d, a, b, depth: up ? up.depth + 1 : 1 });
const depthOf = (ctx) => (ctx ? ctx.depth : 0);
function pathOf(ctx, extra = '') {
  const parts = [];
  for (let c = ctx; c; c = c.up) parts.push(c.d);
  return '$' + parts.reverse().join('') + extra;
}
function ptrOf(ctx, side, extra = '') {
  const parts = [];
  for (let c = ctx; c; c = c.up) parts.push(side === 'a' ? c.a : c.b);
  return parts.reverse().join('') + extra;
}

/**
 * Compare two documents.
 * opts is the options object (see normalize.js).
 * Returns { changes, warnings, choices, hints }.
 * Change: { kind, path, ptrA, ptrB, a, b, aType, bType, note, sa, sb }
 */
export function diffTrees(A, B, opts) {
  const changes = [];
  const warnings = [];
  const choices = new Map(); // shape|mode|key -> { path, mode, key, count }
  const hints = new Map(); // shape -> { path }
  const matches = []; // arrays matched by key or content: { a, b, pairs: [i, j, i, j, ...] }, used by the side by side view
  const warned = new Set();
  let hintBudget = HINT_BUDGET;

  const keySpecText = (opts.arrays.key || '').trim();
  const userKey = keySpecText ? keySpecText.split('.').map((s) => s.trim()).filter(Boolean) : null;
  const overrides = opts.overrides && Object.keys(opts.overrides).length ? opts.overrides : null;
  const hasTolerance = opts.numbers.mode === 'value' && (toleranceValue(opts.numbers.abs) > 0 || toleranceValue(opts.numbers.rel) > 0);

  const show = (v) => compact(v, VALUE_LIMIT);

  const addWarning = (key, text) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(text);
  };

  const recordChoice = (ctx, mode, key) => {
    if (depthOf(ctx) > SHAPE_DEPTH_CAP) return;
    const shape = shapePath(pathOf(ctx));
    const id = shape + '|' + mode + '|' + (key || '');
    const c = choices.get(id);
    if (c) c.count++;
    else choices.set(id, { path: shape, mode, key: key || '', count: 1 });
  };

  // Work items: { t: 'pair', a, b, ctx } | { t: 'rem', up, d, pa, v } | { t: 'add', up, d, pb, v }
  const stack = [{ t: 'pair', a: A, b: B, ctx: null }];
  const pushAll = (list) => {
    for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
  };
  const rem = (up, d, pa, v) => ({ t: 'rem', up, d, pa, v });
  const add = (up, d, pb, v) => ({ t: 'add', up, d, pb, v });

  while (stack.length) {
    const w = stack.pop();
    if (w.t === 'rem') {
      changes.push({ kind: 'removed', path: pathOf(w.up, w.d), ptrA: ptrOf(w.up, 'a', w.pa), ptrB: null, a: show(w.v), aType: typeOf(w.v) });
      continue;
    }
    if (w.t === 'add') {
      changes.push({ kind: 'added', path: pathOf(w.up, w.d), ptrA: null, ptrB: ptrOf(w.up, 'b', w.pb), b: show(w.v), bType: typeOf(w.v) });
      continue;
    }
    const { a, b, ctx } = w;
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta !== tb) {
      changes.push({ kind: 'type', path: pathOf(ctx), ptrA: ptrOf(ctx, 'a'), ptrB: ptrOf(ctx, 'b'), a: show(a), b: show(b), aType: ta, bType: tb });
      continue;
    }
    if (ta === 'object') {
      if (a === b) continue;
      const list = [];
      for (const [k, av] of a) {
        const seg = '/' + ptrEsc(k);
        if (b.has(k)) list.push({ t: 'pair', a: av, b: b.get(k), ctx: child(ctx, keySeg(k), seg, seg) });
        else list.push(rem(ctx, keySeg(k), seg, av));
      }
      for (const [k, bv] of b) {
        if (!a.has(k)) list.push(add(ctx, keySeg(k), '/' + ptrEsc(k), bv));
      }
      pushAll(list);
      continue;
    }
    if (ta === 'array') {
      if (a === b) continue;
      pushAll(arrayWork(a, b, ctx));
      continue;
    }
    // scalar
    const r = scalarsEqual(a, b, opts);
    if (r.eq) continue;
    const c = { kind: 'changed', path: pathOf(ctx), ptrA: ptrOf(ctx, 'a'), ptrB: ptrOf(ctx, 'b'), a: show(a), b: show(b), aType: ta, bType: tb };
    if (r.note) c.note = r.note;
    if (ta === 'string') {
      c.sa = a.length > 5000 ? a.slice(0, 5000) : a;
      c.sb = b.length > 5000 ? b.slice(0, 5000) : b;
    }
    changes.push(c);
  }

  function positionWork(a, b, ctx) {
    const list = [];
    const m = Math.min(a.length, b.length);
    for (let i = 0; i < m; i++) list.push({ t: 'pair', a: a[i], b: b[i], ctx: child(ctx, '[' + i + ']', '/' + i, '/' + i) });
    for (let i = m; i < a.length; i++) list.push(rem(ctx, '[' + i + ']', '/' + i, a[i]));
    for (let i = m; i < b.length; i++) list.push(add(ctx, '[' + i + ']', '/' + i, b[i]));
    return list;
  }

  function keyWork(a, b, ctx, spec) {
    const keyName = spec.join('.');
    const idxB = new Map();
    for (let j = 0; j < b.length; j++) idxB.set(keyIdentity(getKey(b[j], spec)), j);
    const used = new Uint8Array(b.length);
    const list = [];
    const pairs = [];
    for (let i = 0; i < a.length; i++) {
      const kv = getKey(a[i], spec);
      const j = idxB.get(keyIdentity(kv));
      const d = '[' + keyName + '=' + keyShown(kv) + ']';
      if (j === undefined) list.push(rem(ctx, d, '/' + i, a[i]));
      else {
        used[j] = 1;
        pairs.push(i, j);
        list.push({ t: 'pair', a: a[i], b: b[j], ctx: child(ctx, d, '/' + i, '/' + j) });
      }
    }
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      list.push(add(ctx, '[' + keyName + '=' + keyShown(getKey(b[j], spec)) + ']', '/' + j, b[j]));
    }
    if (pairs.length) matches.push({ a, b, pairs });
    return list;
  }

  function orderWork(a, b, ctx) {
    const canonA = a.map((x) => canonical(x, opts));
    const canonB = b.map((x) => canonical(x, opts));
    const pool = new Map(); // canon -> [indices in b]
    for (let j = 0; j < b.length; j++) {
      const l = pool.get(canonB[j]);
      if (l) l.push(j);
      else pool.set(canonB[j], [j]);
    }
    const usedB = new Uint8Array(b.length);
    const pairs = [];
    let leftA = [];
    for (let i = 0; i < a.length; i++) {
      const l = pool.get(canonA[i]);
      if (l && l.length) {
        const j = l.shift();
        usedB[j] = 1;
        pairs.push(i, j);
      } else leftA.push(i);
    }
    let leftB = [];
    for (let j = 0; j < b.length; j++) if (!usedB[j]) leftB.push(j);

    // Numbers that differ only inside the tolerance count as equal.
    if (hasTolerance && leftA.length && leftB.length && leftA.length <= SIMILARITY_CAP && leftB.length <= SIMILARITY_CAP) {
      const gone = new Set();
      const takenB = new Set();
      for (const i of leftA) {
        if (!(a[i] instanceof Num)) continue;
        for (const j of leftB) {
          if (takenB.has(j) || !(b[j] instanceof Num)) continue;
          if (numbersEqual(a[i], b[j], opts.numbers).eq) {
            pairs.push(i, j);
            gone.add(i);
            takenB.add(j);
            break;
          }
        }
      }
      leftA = leftA.filter((i) => !gone.has(i));
      leftB = leftB.filter((j) => !takenB.has(j));
    }

    // Pair leftover objects by the number of equal fields, so a changed object is not "removed + added".
    const pairOf = new Map();
    if (leftA.length && leftB.length && leftA.length <= SIMILARITY_CAP && leftB.length <= SIMILARITY_CAP) {
      const fieldsA = new Map();
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
    for (const [i, j] of pairOf) pairs.push(i, j);
    if (pairs.length) matches.push({ a, b, pairs });
    for (const i of leftA) {
      const j = pairOf.get(i);
      if (j !== undefined) list.push({ t: 'pair', a: a[i], b: b[j], ctx: child(ctx, '[' + i + ']', '/' + i, '/' + j) });
      else list.push(rem(ctx, '[' + i + ']', '/' + i, a[i]));
    }
    const paired = new Set(pairOf.values());
    for (const j of leftB) {
      if (!paired.has(j)) list.push(add(ctx, '[' + j + ']', '/' + j, b[j]));
    }
    return list;
  }

  // Do the two arrays hold mostly the same items in a different order? Then Ignore order would help.
  function looksShuffled(a, b, ctx) {
    if (a.length < 2 || b.length < 2 || a.length > HINT_ITEM_CAP || b.length > HINT_ITEM_CAP) return;
    if (hintBudget < a.length + b.length || depthOf(ctx) > SHAPE_DEPTH_CAP) return;
    hintBudget -= a.length + b.length;
    const ca = a.map((x) => canonical(x, opts));
    const cb = b.map((x) => canonical(x, opts));
    const m = Math.min(ca.length, cb.length);
    let same = 0;
    for (let i = 0; i < m; i++) if (ca[i] === cb[i]) same++;
    const pool = new Map();
    for (const c of cb) pool.set(c, (pool.get(c) || 0) + 1);
    let found = 0;
    for (const c of ca) {
      const n = pool.get(c);
      if (n) {
        found++;
        pool.set(c, n - 1);
      }
    }
    if (found > same && found >= Math.max(2, 0.6 * Math.max(ca.length, cb.length))) {
      const shape = shapePath(pathOf(ctx));
      if (!hints.has(shape)) hints.set(shape, { path: shape });
    }
  }

  function positionWithHint(a, b, ctx) {
    looksShuffled(a, b, ctx);
    return positionWork(a, b, ctx);
  }

  function arrayWork(a, b, ctx) {
    let mode = opts.arrays.mode;
    if (overrides && depthOf(ctx) <= SHAPE_DEPTH_CAP) {
      const ov = overrides[shapePath(pathOf(ctx))];
      if (ov === 'position' || ov === 'order') mode = ov;
    }
    const place = () => (ctx ? '`' + pathOf(ctx) + '`' : 'the root array');
    if (mode === 'position') {
      recordChoice(ctx, 'position', '');
      return positionWithHint(a, b, ctx);
    }
    if (mode === 'order') {
      recordChoice(ctx, 'order', '');
      return orderWork(a, b, ctx);
    }
    if (mode === 'key' && userKey) {
      const objs = allObjects(a) && allObjects(b);
      if (!objs || (a.length === 0 && b.length === 0)) return positionWork(a, b, ctx);
      const ra = a.length ? keyReliability(a, userKey) : 'ok';
      const rb = b.length ? keyReliability(b, userKey) : 'ok';
      if (ra === 'ok' && rb === 'ok') {
        recordChoice(ctx, 'key', userKey.join('.'));
        return keyWork(a, b, ctx, userKey);
      }
      if (keySpecText.includes(',')) addWarning('c', `Composite keys are not supported yet. Use one key, such as \`${userKey[0]}\`.`);
      else {
        const why = ra === 'dup' || rb === 'dup' ? 'is not unique in' : 'is missing on some items in';
        addWarning('k' + shapePath(pathOf(ctx)), `\`${userKey.join('.')}\` ${why} ${place()}. Matched by position.`);
      }
      recordChoice(ctx, 'position', '');
      return positionWithHint(a, b, ctx);
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
          recordChoice(ctx, 'key', name);
          return keyWork(a, b, ctx, spec);
        }
        if (!dupName && (ra === 'dup' || rb === 'dup') && ra !== 'missing' && rb !== 'missing') dupName = name;
      }
      if (dupName) addWarning('d' + shapePath(pathOf(ctx)), `\`${dupName}\` is not unique in ${place()}. Matched by position.`);
    }
    recordChoice(ctx, 'position', '');
    return positionWithHint(a, b, ctx);
  }

  return { changes, warnings, choices: Array.from(choices.values()), hints: Array.from(hints.values()), matches };
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
