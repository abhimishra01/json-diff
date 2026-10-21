// Fixture generator for the speed tests (spec 5.3). Fixed seed. Fixtures are made on the fly, not committed.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia'];

/** Array of `count` objects. Returns the array. */
export function makeRecords(count, seed = 7) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      name: NAMES[Math.floor(r() * NAMES.length)] + ' ' + Math.floor(r() * 100000),
      email: `user${i + 1}@example.com`,
      score: Math.round(r() * 1000000) / 100,
      active: r() > 0.5,
      tags: ['a' + Math.floor(r() * 50), 'b' + Math.floor(r() * 50)],
      address: { city: 'City' + Math.floor(r() * 500), zip: String(10000 + Math.floor(r() * 89999)) },
    });
  }
  return out;
}

export function threeEdits(count) {
  const a = makeRecords(count);
  const b = JSON.parse(JSON.stringify(a));
  b[100].name = 'CHANGED NAME';
  b[Math.min(15000, count - 2)].score = -1;
  b[count - 1].active = null;
  return [JSON.stringify(a), JSON.stringify(b)];
}

export function allScoresChanged(count) {
  const a = makeRecords(count);
  const b = JSON.parse(JSON.stringify(a));
  for (const x of b) x.score = x.score + 1;
  return [JSON.stringify(a), JSON.stringify(b)];
}
