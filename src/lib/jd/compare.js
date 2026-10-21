// Orchestrates one comparison: parse both texts (with a cache), apply ignore paths, diff, summarize.
import { parse } from './parse.js';
import { compileIgnore, applyIgnore } from './paths.js';
import { diffTrees, summarize, summaryText } from './diff.js';
import { cleanOptions } from './normalize.js';

/** Keeps the parsed trees of the last texts, so a rerun with other options does not parse again. */
export class ParseCache {
  constructor() {
    this.slots = { a: null, b: null };
  }
  get(side, text, tolerant, onProgress) {
    const s = this.slots[side];
    if (s && s.text === text && s.tolerant === tolerant) return s.result;
    const result = parse(text, { tolerant, onProgress });
    this.slots[side] = { text, tolerant, result };
    return result;
  }
}

/**
 * Compare two texts.
 * Returns { state: 'invalid', a, b } (each: null | { empty } | { error }) when a side cannot be compared,
 * or { state: 'ok', changes, summary, summaryText, warnings, choices, ignored, ... }.
 */
export function compareTexts(textA, textB, rawOpts, cache = new ParseCache(), onStage = () => {}) {
  const opts = cleanOptions(rawOpts);
  const tolerant = opts.tolerant;
  onStage('Reading the original', 0.05);
  const pa = cache.get('a', textA, tolerant, (f) => onStage('Reading the original', 0.05 + f * 0.3));
  onStage('Reading the changed text', 0.35);
  const pb = cache.get('b', textB, tolerant, (f) => onStage('Reading the changed text', 0.35 + f * 0.3));
  const side = (p) => (p.ok ? (p.empty ? { empty: true } : null) : { error: p.error });
  const sa = side(pa);
  const sb = side(pb);
  if (sa || sb) return { state: 'invalid', a: sa, b: sb };

  const warnings = [];
  for (const [label, p] of [['Original', pa], ['Changed', pb]]) {
    for (const w of p.warnings) warnings.push(`Duplicate key \`${w.key}\` in ${label} at line ${w.line}, column ${w.col}. The last value is used.`);
    if (p.dupCount > p.warnings.length) warnings.push(`${p.dupCount - p.warnings.length} more duplicate keys in ${label}.`);
  }

  const ig = compileIgnore(opts.ignore);
  let A = pa.value;
  let B = pb.value;
  let places = 0;
  if (ig.patterns.length) {
    onStage('Applying ignore paths', 0.66);
    const ra = applyIgnore(A, ig.patterns);
    const rb = applyIgnore(B, ig.patterns);
    A = ra.tree;
    B = rb.tree;
    places = ra.places + rb.places;
  }
  onStage('Comparing', 0.7);
  const d = diffTrees(A, B, opts);
  for (const w of d.warnings) warnings.push(w);
  const summary = summarize(d.changes);
  return {
    state: 'ok',
    changes: d.changes,
    summary,
    summaryText: summaryText(summary),
    warnings,
    choices: d.choices,
    hints: d.hints,
    ignored: { patterns: ig.patterns.length, places, errors: ig.errors },
    trees: { a: A, b: B },
  };
}
