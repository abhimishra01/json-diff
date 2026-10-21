// Known-answer tests for the JSON diff core. Spec sections 5.1 and 5.2. Run: npm test
import assert from 'node:assert/strict';
import { parse, lineCol } from '../src/lib/jd/parse.js';
import { compareTexts } from '../src/lib/jd/compare.js';
import { defaultOptions, canonNum } from '../src/lib/jd/normalize.js';
import { compileIgnore } from '../src/lib/jd/paths.js';
import { pretty, compact } from '../src/lib/jd/serialize.js';
import { locate, jsonPatch, patchText, reportText } from '../src/lib/jd/report.js';
import { summaryText } from '../src/lib/jd/diff.js';
import { alignRows, buildView } from '../src/lib/jd/view.js';

let checks = 0;
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };
const ok_ = (cond, msg) => { checks++; assert.ok(cond, msg); };

function opts(patch = {}) {
  const o = defaultOptions();
  for (const [k, v] of Object.entries(patch)) o[k] = typeof v === 'object' && !Array.isArray(v) ? { ...o[k], ...v } : v;
  return o;
}
function cmp(a, b, patch) {
  const r = compareTexts(a, b, opts(patch));
  assert.equal(r.state, 'ok', r.state === 'ok' ? '' : `expected ok: ${JSON.stringify(r)}`);
  return r;
}
const brief = (r) => r.changes.map((c) => `${c.kind} ${c.path}`);

// ---- J1 to J9: semantics
{
  const r = cmp('{"a":1,"b":2}', '{"b":2,"a":1}');
  eq(r.changes.length, 0, 'J1');
  eq(r.summaryText, 'No differences');
}
{
  const r = cmp('{"v":1}', '{"v":"1"}');
  eq(r.changes.length, 1, 'J2');
  eq([r.changes[0].kind, r.changes[0].path, r.changes[0].aType, r.changes[0].bType, r.changes[0].a, r.changes[0].b], ['type', '$.v', 'number', 'string', '1', '"1"']);
}
{
  let r = cmp('{"a":null}', '{}');
  eq([brief(r), r.changes[0].a], [['removed $.a'], 'null'], 'J3');
  r = cmp('{}', '{"a":null}');
  eq(brief(r), ['added $.a'], 'J3 reverse');
}
{
  const r = cmp('{"a":null}', '{"a":0}');
  eq([brief(r), r.changes[0].aType, r.changes[0].bType], [['type $.a'], 'null', 'number'], 'J4');
}
{
  const r = cmp('{"a":[]}', '{"a":{}}');
  eq([brief(r), r.changes[0].aType, r.changes[0].bType], [['type $.a'], 'array', 'object'], 'J5');
}
{
  const r = cmp('{}', '[]');
  eq([brief(r), r.changes[0].aType, r.changes[0].bType], [['type $'], 'object', 'array'], 'J6');
}
{
  const r = cmp('[1,2,3]', '[1,3]', { arrays: { mode: 'position' } });
  eq(brief(r), ['changed $[1]', 'removed $[2]'], 'J7');
  eq([r.changes[0].a, r.changes[0].b, r.changes[1].a], ['2', '3', '3']);
}
{
  const r = cmp('[1,2,3]', '[1,3]', { arrays: { mode: 'order' } });
  eq([brief(r), r.changes[0].a], [['removed $[1]'], '2'], 'J8');
}
{
  eq(cmp('["x","y"]', '["y","x"]', { arrays: { mode: 'position' } }).changes.length, 2, 'J9 position');
  eq(cmp('["x","y"]', '["y","x"]', { arrays: { mode: 'order' } }).changes.length, 0, 'J9 order');
}

// ---- J10 to J13: arrays by key
const J10A = '{"u":[{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":3,"v":"c"}]}';
const J10B = '{"u":[{"id":3,"v":"c"},{"id":1,"v":"CHANGED"},{"id":2,"v":"b"}]}';
{
  const r = cmp(J10A, J10B);
  eq(brief(r), ['changed $.u[id=1].v'], 'J10 auto');
  eq(r.choices.map((c) => [c.path, c.mode, c.key]), [['$.u', 'key', 'id']]);
  eq(cmp(J10A, J10B, { arrays: { mode: 'position' } }).changes.length, 6, 'J10 position gives 6');
}
{
  const r = cmp('{"u":[{"id":1},{"id":2}]}', '{"u":[{"id":2},{"id":3}]}', { arrays: { mode: 'key', key: 'id' } });
  eq(brief(r), ['removed $.u[id=1]', 'added $.u[id=3]'], 'J11');
}
{
  const t = '{"u":[{"id":1,"v":1},{"id":1,"v":2}]}';
  const r = cmp(t, t);
  eq(r.changes.length, 0, 'J12');
  eq(r.warnings, ['`id` is not unique in `$.u`. Matched by position.']);
}
{
  const r = cmp(
    '{"items":[{"sku":"A1","qty":1},{"sku":"B2","qty":2},{"sku":"C3","qty":3}]}',
    '{"items":[{"sku":"C3","qty":3},{"sku":"A1","qty":9},{"sku":"B2","qty":2}]}');
  eq(brief(r), ['changed $.items[sku=A1].qty'], 'J13');
  eq([r.changes[0].a, r.changes[0].b], ['1', '9']);
}

// ---- J14 to J20: numbers
eq(cmp('{"n":12345678901234567890}', '{"n":12345678901234567891}').changes.length, 1, 'J14');
eq(cmp('{"n":1.0}', '{"n":1}').changes.length, 0, 'J15');
eq(cmp('{"n":1.0}', '{"n":1}', { numbers: { mode: 'written' } }).changes.length, 1, 'J15 as written');
eq(cmp('{"n":1e3}', '{"n":1000}').changes.length, 0, 'J16');
eq(cmp('{"n":-0}', '{"n":0}').changes.length, 0, 'J17');
eq(cmp('{"n":0.1}', '{"n":0.10}').changes.length, 0, 'J18');
eq(cmp('{"n":1e400}', '{"n":1e401}').changes.length, 1, 'J19');
eq(cmp('{"n":1.0001}', '{"n":1.0002}', { numbers: { abs: '0.001' } }).changes.length, 0, 'J20');
eq(cmp('{"n":1.0001}', '{"n":1.0002}', { numbers: { abs: '0' } }).changes.length, 1, 'J20 zero');
eq(cmp('{"n":1.0001}', '{"n":1.0002}').changes.length, 1, 'J20 default');
{
  const r = cmp('{"n":100000000000000000000}', '{"n":100000000000000000001}', { numbers: { abs: '5' } });
  eq([r.changes.length, r.changes[0].note], [1, 'Tolerance not applied: a number is too large to compare safely.'], 'J20 large');
}
// float noise and long decimals: the tolerance works (spec says "safe double range", not "15 digits")
eq(cmp('{"n":0.30000000000000004}', '{"n":0.3}', { numbers: { abs: '0.0001' } }).changes.length, 0, 'tolerance on float noise');
eq(cmp('{"n":0.30000000000000004}', '{"n":0.3}').changes.length, 1, 'float noise without tolerance');
eq(cmp('{"n":1234567.123456789}', '{"n":1234567.123456788}', { numbers: { abs: '0.001' } }).changes.length, 0, 'tolerance on 16 digits');
eq(cmp('{"n":0.1}', '{"n":0.1000001}', { numbers: { rel: '0.01' } }).changes.length, 0, 'relative tolerance on a long decimal');
{
  // integers of 1e15 and more stay exact; the note says why
  const r = cmp('{"n":1234567890123456}', '{"n":1234567890123457}', { numbers: { abs: '5' } });
  eq([r.changes.length, r.changes[0].note], [1, 'Tolerance not applied: a number is too large to compare safely.'], '16-digit integers stay exact');
  eq(cmp('{"n":999999999999999}', '{"n":999999999999998}', { numbers: { abs: '5' } }).changes.length, 0, '15-digit integers use the tolerance');
}
eq(cmp('{"n":100}', '{"n":104}', { numbers: { rel: '5' } }).changes.length, 0, 'relative tolerance');
eq(cmp('{"n":100}', '{"n":110}', { numbers: { rel: '5' } }).changes.length, 1, 'relative tolerance exceeded');
eq([canonNum({ s: '1e0' }), canonNum({ s: '10e-1' }), canonNum({ s: '-0.0' }), canonNum({ s: '120' }), canonNum({ s: '-1.50E+2' })], ['1e0', '1e0', '0', '12e1', '-15e1']);

// ---- J21 to J24: strings
eq(cmp('{"s":"é"}', '{"s":"é"}').changes.length, 0, 'J21');
{
  const a = '{"s":"é"}';
  const b = '{"s":"é"}';
  const r = cmp(a, b);
  eq([r.changes.length, r.changes[0].note], [1, 'Looks the same, but differs by Unicode form.'], 'J22');
  eq(cmp(a, b, { strings: { nfc: true } }).changes.length, 0, 'J22 nfc');
}
eq(cmp('{"s":"A"}', '{"s":"a"}').changes.length, 1, 'J23');
eq(cmp('{"s":"A"}', '{"s":"a"}', { strings: { ignoreCase: true } }).changes.length, 0, 'J23 ignore case');
eq(cmp('{"s":" a  b "}', '{"s":"a b"}').changes.length, 1, 'J24 default');
eq(cmp('{"s":" a  b "}', '{"s":"a b"}', { strings: { trim: true, collapse: true } }).changes.length, 0, 'J24');

// ---- Ignore order also applies to nested arrays (regression review)
eq(cmp('[{"tags":["a","b"]}]', '[{"tags":["b","a"]}]', { arrays: { mode: 'order' } }).changes.length, 0, 'nested arrays, no other field');
eq(cmp('{"u":[{"tags":["a","b"],"x":{"y":[3,2,1]}}]}', '{"u":[{"x":{"y":[1,2,3]},"tags":["b","a"]}]}', { arrays: { mode: 'order' } }).changes.length, 0, 'deeper nesting');
eq(cmp('[["a","b"],["c"]]', '[["c"],["b","a"]]', { arrays: { mode: 'order' } }).changes.length, 0, 'arrays of arrays');
eq(brief(cmp('[{"tags":["a","b"]}]', '[{"tags":["b","c"]}]', { arrays: { mode: 'order' } })).length > 0, true, 'a real difference still shows');
eq(cmp('[{"tags":["a","b"]}]', '[{"tags":["b","a"]}]', { arrays: { mode: 'position' } }).changes.length, 2, 'by position the same pair differs');
// tolerance also works for loose numbers under Ignore order
eq(cmp('[1.0001, 5]', '[5, 1.0002]', { arrays: { mode: 'order' }, numbers: { abs: '0.01' } }).changes.length, 0, 'order mode uses the tolerance');
// per-array override: users by key, roles ignore order
{
  const a = '{"users":[{"id":1,"roles":["a","b"]},{"id":2,"roles":["c"]}]}';
  const b = '{"users":[{"id":2,"roles":["c"]},{"id":1,"roles":["b","a"]}]}';
  eq(cmp(a, b).changes.length, 2, 'auto: roles by position differ');
  const r = cmp(a, b, { overrides: { '$.users[].roles': 'order' } });
  eq(r.changes.length, 0, 'override: roles ignore order, users still by id');
  eq(r.choices.map((c) => `${c.path} ${c.mode}`).sort(), ['$.users key', '$.users[].roles order']);
  // a hint when Auto picks position for a shuffled list
  const h = cmp(a, b);
  eq(h.hints.map((x) => x.path), ['$.users[].roles'], 'hint for shuffled roles');
  eq(cmp('{"o":[{"q":1},{"q":2},{"q":3}]}', '{"o":[{"q":3},{"q":1},{"q":2}]}').hints.map((x) => x.path), ['$.o'], 'hint for a shuffle of objects');
  eq(cmp('{"o":[1,2,3]}', '{"o":[4,5,6]}').hints, [], 'no hint when the items are different');
  eq(cmp('{"o":[1,2,3]}', '{"o":[1,2,3]}').hints, [], 'no hint when nothing changed');
}

// ---- J25: ignore paths
{
  const a = '{"id":1,"updatedAt":"x","items":[{"updatedAt":1,"k":1}]}';
  const b = '{"id":1,"updatedAt":"y","items":[{"updatedAt":2,"k":1}]}';
  const r = cmp(a, b, { ignore: '**.updatedAt' });
  eq([r.changes.length, r.ignored.patterns, r.ignored.places], [0, 1, 4], 'J25 any depth');
  eq(brief(cmp(a, b, { ignore: '$.updatedAt' })), ['changed $.items[0].updatedAt'], 'J25 root only');
  eq(cmp(a, b, { ignore: 'items[*].updatedAt\n$.updatedAt' }).changes.length, 0, 'J25 two lines');
  eq(cmp(a, b, { ignore: '# comment\n\n$..updatedAt' }).changes.length, 0, 'J25 comment and ..');
  eq(cmp(a, b, { ignore: 'items[0].updatedAt\nupdatedAt' }).changes.length, 0, 'J25 index');
}
{
  const c = compileIgnore('a.b\n$.x[*].y\n**.z\na["odd key"]\nbad..[\n$');
  eq(c.patterns.length, 4, 'ignore patterns compile');
  eq(c.errors.map((e) => e.line), [5, 6], 'ignore errors name the line');
}

// ---- J26 to J31
{
  const r = compareTexts('{"a":1,"a":2}', '{"a":2}', opts());
  eq(r.changes.length, 0, 'J26');
  eq(r.warnings, ['Duplicate key `a` in Original at line 1, column 8. The last value is used.']);
}
eq(brief(cmp('1', '2')), ['changed $'], 'J27');
{
  const r = cmp('"abc"', '"abd"');
  eq([brief(r), r.changes[0].sa, r.changes[0].sb], [['changed $'], 'abc', 'abd'], 'J28');
}
eq(brief(cmp('{"a b":1,"a.b":2}', '{"a b":3,"a.b":2}')), ['changed $["a b"]'], 'J29');
eq(brief(cmp('{"\u{1F600}":1}', '{"\u{1F600}":2}')), ['changed $["\u{1F600}"]'], 'J30');
{
  const pretty4 = '{\r\n    "a": [\r\n        1,\r\n        2\r\n    ],\r\n    "b": "x"\r\n}';
  eq(cmp(pretty4, '{"a":[1,2],"b":"x"}').changes.length, 0, 'J31');
}

// ---- extra semantics
eq(brief(cmp('{"a":{"b":1}}', '{"a":{"b":1},"c":[]}')), ['added $.c'], 'added key');
eq(cmp('[]', '[]').changes.length, 0, 'empty arrays');
eq(cmp('[[1,2],[3]]', '[[1,2],[3]]').changes.length, 0, 'nested arrays');
{
  // ignore-order pairs a changed object instead of remove + add
  const r = cmp('[{"x":1,"y":2},{"x":5,"y":6}]', '[{"x":5,"y":6},{"x":1,"y":3}]', { arrays: { mode: 'order' } });
  eq(brief(r), ['changed $[0].y'], 'order mode pairs leftovers');
}
{
  // BOM is ignored
  eq(cmp('﻿{"a":1}', '{"a":1}').changes.length, 0, 'E16 BOM');
}
{
  // summary text
  const r = cmp('{"a":1,"b":null,"c":1,"d":2}', '{"a":2,"c":"1","e":true,"d":3}');
  eq(r.summaryText, '5 changes: 2 changed, 1 added, 1 removed, 1 type change');
  eq(summaryText({ total: 1, changed: 0, added: 0, removed: 0, type: 1 }), '1 change: 1 type change');
}

// ---- E1 to E18: invalid JSON, line, column, message
function err(text, patch) {
  const p = parse(text, patch);
  assert.equal(p.ok, false, `expected an error for ${JSON.stringify(text.slice(0, 40))}`);
  return p.error;
}
function expectErr(id, text, line, col, message) {
  const e = err(text);
  checks++;
  assert.deepEqual([e.line, e.col, e.message], [line, col, message], id);
}
expectErr('E1', '{"a":1,}', 1, 8, 'Extra comma after the last item. Remove it.');
expectErr('E2', "{'a':1}", 1, 2, 'Keys and strings need double quotes (`"`), not single quotes.');
expectErr('E3', '{"a":}', 1, 6, 'A value is missing after the colon.');
expectErr('E4', '{"a":1', 1, 7, 'The text ends too soon. 1 `{` is not closed.');
expectErr('E5', '[1,2,,]', 1, 6, 'Two commas in a row. A value is missing.');
expectErr('E6', '{"a":01}', 1, 7, 'Numbers cannot start with a zero.');
expectErr('E7', '{"a":NaN}', 1, 6, '`NaN` is not valid JSON. Use a string or null.');
expectErr('E8', '{a:1}', 1, 2, 'Keys need double quotes.');
expectErr('E9', '{"a":1 "b":2}', 1, 8, 'A comma is missing between items.');
expectErr('E10', '{\n  "a": 1,\n  "b": [1,2,,]\n}', 3, 13, 'Two commas in a row. A value is missing.');
expectErr('E11', '// comment\n{}', 1, 1, 'Comments are not allowed in JSON. To allow them, open Options and turn on "Allow comments and trailing commas".');
expectErr('E12', '{"a":"x\ty"}', 1, 8, 'A tab inside a string must be written as `\\t`.');
expectErr('E13', '{"a":"\\x"}', 1, 7, 'Unknown escape `\\x`.');
expectErr('E14', '{"a":"abc', 1, 6, 'This string is not closed.');
eq(parse('').empty, true, 'E15 empty');
eq(parse(' \n\t ').empty, true, 'E15 whitespace');
eq(parse('﻿{"a":1}').ok, true, 'E16');
{
  const e = err('['.repeat(10001) + ']'.repeat(10001));
  eq([e.message, e.offset], ['Nesting is deeper than 10,000 levels.', 10000], 'E17');
}
{
  const deep = '['.repeat(10000) + ']'.repeat(10000);
  const r = compareTexts(deep, deep, opts());
  eq([r.state, r.changes.length], ['ok', 0], 'E18 equal 10,000 deep');
  const deep2 = '['.repeat(10000) + '1' + ']'.repeat(10000);
  const deep3 = '['.repeat(10000) + '2' + ']'.repeat(10000);
  const r2 = compareTexts(deep2, deep3, opts());
  eq([r2.state, r2.changes.length], ['ok', 1], 'E18 one change 10,000 deep');
  eq(compact(parse(deep2).value, 50).length > 0, true, 'compact on deep input');
  eq(pretty(parse(deep2).value).lines.length, 20001, 'pretty on deep input');
}
// QA: empty containers print once (they used to repeat until the length limit)
{
  eq(compact(parse('[]').value), '[]', 'compact empty array');
  eq(compact(parse('{}').value), '{}', 'compact empty object');
  eq(compact(parse('{"a":[],"b":{},"c":[[],{}],"d":1}').value), '{"a":[],"b":{},"c":[[],{}],"d":1}', 'compact nested empties');
  const r = cmp('{"a":[]}', '{"a":{}}');
  eq([r.changes[0].a, r.changes[0].b], ['[]', '{}'], 'J5 shows [] and {}');
}
// more error shapes
expectErr('mismatch value', '{"a":[}', 1, 7, 'This `}` does not match. The open bracket is `[`.');
expectErr('mismatch key', '{]', 1, 2, 'This `]` does not match. The open bracket is `{`.');
expectErr('mismatch after colon', '{"a":]', 1, 6, 'This `]` does not match. The open bracket is `{`.');
expectErr('stray close', '}', 1, 1, 'This `}` has no matching `{`.');
expectErr('mismatch', '{"a":[1}', 1, 8, 'This `}` does not match. The open bracket is `[`.');
expectErr('colon', '{"a" 1}', 1, 6, 'A colon is missing after the key.');
expectErr('trailing array comma', '[1,]', 1, 4, 'Extra comma after the last item. Remove it.');
expectErr('end in array', '[1,2', 1, 5, 'The text ends too soon. 1 `[` is not closed.');
expectErr('mixed unclosed', '{"a":[1', 1, 8, 'The text ends too soon. 1 `{` and 1 `[` are not closed.');
expectErr('extra after end', '{} x', 1, 4, 'Unexpected `x` after the end of the JSON. A document holds one value.');
expectErr('literal case', '{"a":True}', 1, 6, 'Write `true`, `false` and `null` in lowercase.');
expectErr('bare word', '{"a":hello}', 1, 6, '`hello` is not a valid JSON value. Text needs double quotes.');
expectErr('minus', '[-]', 1, 3, 'A number needs digits after the minus sign.');
expectErr('decimal', '[1.]', 1, 4, 'A decimal point needs digits after it.');
expectErr('exponent', '[1e]', 1, 4, 'An exponent needs digits after `e`.');
expectErr('hex escape', '["\\u12"]', 1, 3, 'A `\\u` escape needs 4 hex digits, for example `\\u00e9`.');
{
  // line and column rules: tab is one column, CRLF is one line break
  const e = err('{\r\n\t"a": ,\r\n}');
  eq([e.line, e.col], [2, 7], 'tab counts as one column');
  eq(lineCol('a\nb\nc', 4), { line: 3, col: 1 });
  const e2 = err('{"a":1,}');
  eq([e2.lineText, e2.caret], ['{"a":1,}', 7], 'caret position in line text');
}
{
  // tolerant mode
  const t = parse('// c\n{"a":1, /* x */ "b":[1,2,],}', { tolerant: true });
  eq(t.ok, true, 'tolerant');
  eq(parse('{"a":1,}', { tolerant: true }).ok, true);
  eq(parse('[1,]', { tolerant: true }).ok, true);
}

// ---- pretty print, locate, patch
{
  const v = parse('{"b":[1,{"c":2}],"a":"x","e":{},"f":[]}').value;
  eq(pretty(v).lines.join('\n'), '{\n  "b": [\n    1,\n    {\n      "c": 2\n    }\n  ],\n  "a": "x",\n  "e": {},\n  "f": []\n}');
  eq(pretty(v, { sortKeys: true }).lines[1], '  "a": "x",');
  const want = new Set(['/b/1/c', '/a']);
  const m = pretty(v, { want }).lineOf;
  eq([m.get('/b/1/c'), m.get('/a')], [4, 7], 'pretty line numbers');
  eq(pretty(parse('12345678901234567890.5e2').value).lines, ['12345678901234567890.5e2'], 'numbers keep their text');
}
{
  const text = '{\n  "a": 1,\n  "b": [10, {"c": "x\\"y"}],\n  "d": 3\n}';
  const loc = locate(text, '/b/1/c');
  eq(text.slice(loc.start, loc.end), '"x\\"y"', 'locate string');
  const loc2 = locate(text, '/d');
  eq(text.slice(loc2.start, loc2.end), '3', 'locate last key');
  eq(locate(text, '/zz'), null, 'locate missing');
  eq(text.slice(locate(text, '/b').start, locate(text, '/b').end), '[10, {"c": "x\\"y"}]');
}
{
  // J33 JSON Patch
  const r = cmp('{"a":1,"b":[1,2]}', '{"a":2,"b":[1,2,3],"c":true}', { arrays: { mode: 'position' } });
  const ops = jsonPatch(r.changes, r.trees);
  eq(JSON.parse(patchText(ops)), [{ op: 'replace', path: '/a', value: 2 }, { op: 'add', path: '/b/2', value: 3 }, { op: 'add', path: '/c', value: true }], 'J33');
  // J34 escapes
  const r2 = cmp('{"a/b":1,"m~n":2}', '{}', { arrays: { mode: 'position' } });
  eq(jsonPatch(r2.changes, r2.trees).map((o) => o.path), ['/a~1b', '/m~0n'], 'J34');
  // removes go from the highest index to the lowest
  const r3 = cmp('[1,2,3,4]', '[1,2]', { arrays: { mode: 'position' } });
  eq(jsonPatch(r3.changes, r3.trees).map((o) => o.path), ['/3', '/2'], 'patch remove order');
}
{
  const r = cmp('{"a":1}', '{"a":2}');
  eq(reportText(r.summaryText, r.changes), '1 change: 1 changed\n\n~ $.a: 1 -> 2\n', 'report text');
}

// ---- JSON Patch round trip: apply the patch to A and get B (RFC 6902, position mode)
{
  const apply = (doc, ops) => {
    const get = (parts) => parts.reduce((o, k) => o[k], doc);
    for (const op of ops) {
      const parts = op.path === '' ? [] : op.path.slice(1).split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
      if (!parts.length) { doc = op.value; continue; }
      const last = parts.pop();
      const parent = get(parts);
      if (op.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
      else if (op.op === 'replace') parent[Array.isArray(parent) ? Number(last) : last] = op.value;
      else if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : Number(last), 0, op.value);
      else parent[last] = op.value;
    }
    return doc;
  };
  const pairs = [
    ['{"a":1,"b":[1,2]}', '{"a":2,"b":[1,2,3],"c":true}'],
    ['[1,2,3,4]', '[1,2]'],
    ['{"x":[{"a":1},{"a":2}],"y":[5,6,7]}', '{"x":[{"a":1,"z":1}],"y":[5]}'],
    ['{"a":{"b":1}}', '[1]'],
    ['{"a/b":1,"m~n":2,"k":3}', '{"k":4}'],
    ['{"a":[1,[2,3]]}', '{"a":[1,[2,3,4]]}'],
    ['{}', '{"a":{"b":[1,{"c":null}]}}'],
  ];
  for (const [a, b] of pairs) {
    const r = cmp(a, b, { arrays: { mode: 'position' } });
    const ops = JSON.parse(patchText(jsonPatch(r.changes, r.trees)));
    eq(apply(JSON.parse(a), ops), JSON.parse(b), `patch round trip ${a} -> ${b}`);
  }
  // exact number text in the patch
  const r = cmp('{"n":1}', '{"n":12345678901234567890.5e2}', { arrays: { mode: 'position' } });
  ok_(patchText(jsonPatch(r.changes, r.trees)).includes('12345678901234567890.5e2'), 'patch keeps number text');
}

// ---- side by side: rows line up around added and removed lines
{
  eq(Array.from(alignRows(4, 3, [[1, 1, -1, -1]]).rowsA), [0, 1, 2, 3], 'removed line: A rows');
  eq(Array.from(alignRows(4, 3, [[1, 1, -1, -1]]).rowsB), [0, -1, 1, 2], 'removed line: B gets a filler');
  eq(Array.from(alignRows(3, 4, [[-1, -1, 1, 1]]).rowsA), [0, -1, 1, 2], 'added line: A gets a filler');
  // a scalar that becomes an object (1 line to 3 lines)
  const t = alignRows(3, 5, [[1, 1, 1, 3]]);
  eq([Array.from(t.rowsA), Array.from(t.rowsB)], [[0, 1, -1, -1, 2], [0, 1, 2, 3, 4]], 'type change with more lines');
  // moved blocks that cannot line up are skipped, never crash or lose lines
  const m = alignRows(6, 6, [[0, 1, 4, 5], [4, 5, 0, 1]]);
  eq([m.rowsA.length >= 6, new Set(Array.from(m.rowsA).filter((x) => x >= 0)).size], [true, 6], 'moved blocks keep every line');
}
{
  const { SAMPLE_A, SAMPLE_B } = await import('../src/lib/jd/sample.js');
  const r = cmp(SAMPLE_A, SAMPLE_B);
  const v = buildView(r.trees, r.changes, r.matches, false);
  const text = (lines, rows, i) => (rows[i] >= 0 ? lines[rows[i]].trim() : null);
  let level = 0;
  for (let i = 0; i < v.rowsA.length; i++) {
    const x = text(v.a, v.rowsA, i);
    if (x && x === text(v.b, v.rowsB, i) && /"(status|notes|items|retries)"|^\{$|^\}$/.test(x.split(':')[0] + '')) level++;
  }
  ok_(level >= 2, 'equal lines meet on the same row');
  // the tags array gets a new item: A shows a filler row there
  const rowOfNew = v.lineRowB[v.b.findIndex((l) => l.trim() === '"new"')];
  eq(v.rowsA[rowOfNew], -1, 'filler row opposite an added line');
  eq(v.rowsA.length, v.rowsB.length);
  // every line is on exactly one row
  eq(new Set(Array.from(v.rowsA).filter((x) => x >= 0)).size, v.a.length, 'all A lines are shown');
  eq(new Set(Array.from(v.rowsB).filter((x) => x >= 0)).size, v.b.length, 'all B lines are shown');
}

// ---- side by side: matched items meet on one row, even when moved
{
  const r = cmp(J10A, J10B);
  const v = buildView(r.trees, r.changes, r.matches, false);
  const idLine = (lines, n) => lines.findIndex((l) => l.trim() === `"id": ${n},`);
  eq([1, 2, 3].map((n) => idLine(v.b, n)).every((x, k, arr) => k === 0 || x > arr[k - 1]), true, 'B shows its items in the order of A');
  for (const n of [1, 2, 3]) {
    const rowA = v.lineRowA[idLine(v.a, n)];
    const rowB = v.lineRowB[idLine(v.b, n)];
    eq(rowA, rowB, `item ${n} is on the same row on both sides`);
  }
  eq([v.movedA.length, v.movedB.length], [1, 1], 'one item is tagged as moved on each side');
  eq(v.a[v.movedA[0]].trim(), '{', 'moved tag sits on the first line of the item');
  // the change inside a moved item is still marked on the right lines
  const sp = v.spans[0];
  eq([v.a[sp[0]].trim(), v.b[sp[2]].trim()], ['"v": "a"', '"v": "CHANGED"'], 'the change lines are found');
  // items only in B go after their old neighbor; items only in A leave a filler row
  const r2 = cmp('{"u":[{"id":1},{"id":2},{"id":3}]}', '{"u":[{"id":3},{"id":9},{"id":1}]}');
  const v2 = buildView(r2.trees, r2.changes, r2.matches, false);
  eq(v2.rowsA.length, v2.rowsB.length);
  eq(new Set(Array.from(v2.rowsB).filter((x) => x >= 0)).size, v2.b.length, 'all B lines are shown');
  eq(v2.lineRowA[idLine(v2.a, 1)], v2.lineRowB[idLine(v2.b, 1)], 'matched item 1 aligned');
  eq(v2.lineRowA[idLine(v2.a, 3)], v2.lineRowB[idLine(v2.b, 3)], 'matched item 3 aligned');
  // Ignore order matches too
  const r3 = cmp('["a","b","c"]', '["c","a","b"]', { arrays: { mode: 'order' } });
  const v3 = buildView(r3.trees, r3.changes, r3.matches, false);
  eq(v3.b.map((l) => l.trim()), v3.a.map((l) => l.trim()), 'order mode: both sides read alike');
}

// ---- the one-click examples show what they promise
{
  const { SCENARIOS, scenarioTexts } = await import('../src/lib/jd/scenarios.js');
  const run = (id) => { const sc = SCENARIOS[id]; const t = scenarioTexts(sc); return cmp(t.a, t.b, sc.opts); };
  eq(brief(run('exact-numbers')), ['changed $.orderId'], 'exact numbers example: 1 change, 10.5 equals 10.50');
  eq(brief(run('compare-by-id')), ['changed $.users[id=1].email'], 'by id example');
  eq(brief(run('ignore-array-order')), ['changed $.labels[1].color'], 'ignore order example');
  eq(brief(run('ignore-fields')), ['changed $.status'], 'ignore fields example');
  const big = run('large-files');
  eq([big.changes.length, big.changes.map((c) => c.path)], [3, ['$[id=101].name', '$[id=15001].score', '$[id=35000].active']], 'large example: 3 edits');
  eq(Object.keys(SCENARIOS).sort(), ['compare-by-id', 'exact-numbers', 'ignore-array-order', 'ignore-fields', 'large-files']);
}

// ---- deep nesting is fast now that paths are built lazily
{
  const deep = '['.repeat(10000) + '1' + ']'.repeat(10000);
  const deep2 = '['.repeat(10000) + '2' + ']'.repeat(10000);
  const t0 = Date.now();
  cmp(deep, deep2);
  ok_(Date.now() - t0 < 1500, `10,000 levels deep in under 1.5 s (took ${Date.now() - t0} ms)`);
}

// ---- cache: a second compare with other options reuses the parse
{
  const { ParseCache } = await import('../src/lib/jd/compare.js');
  const cache = new ParseCache();
  const t = '{"a":1}';
  compareTexts(t, t, opts(), cache);
  const first = cache.slots.a.result;
  compareTexts(t, t, opts({ sortKeys: true }), cache);
  eq(cache.slots.a.result === first, true, 'parse cache reused');
}

console.log(`json-diff core: ${checks} checks passed`);
