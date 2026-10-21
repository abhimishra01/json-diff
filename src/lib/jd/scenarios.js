// One-click examples. Each sets the two boxes and the options that the case needs.
// The ids match the section ids in the article, so a link such as #ignore-array-order loads the example.

const pretty = (o) => JSON.stringify(o, null, 2);

/** About 5 MB per side: 35,000 records, three edits. Built in the browser, nothing is fetched. */
function bigExample() {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const names = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia'];
  const rows = [];
  for (let i = 0; i < 35000; i++) {
    rows.push({
      id: i + 1,
      name: names[Math.floor(rnd() * names.length)] + ' ' + Math.floor(rnd() * 100000),
      email: `user${i + 1}@example.com`,
      score: Math.round(rnd() * 1000000) / 100,
      active: rnd() > 0.5,
      tags: ['a' + Math.floor(rnd() * 50), 'b' + Math.floor(rnd() * 50)],
      address: { city: 'City' + Math.floor(rnd() * 500), zip: String(10000 + Math.floor(rnd() * 89999)) },
    });
  }
  const a = JSON.stringify(rows);
  rows[100].name = 'CHANGED NAME';
  rows[15000].score = -1;
  rows[34999].active = null;
  return { a, b: JSON.stringify(rows) };
}

export const SCENARIOS = {
  'exact-numbers': {
    title: 'the 20-digit example',
    a: '{\n  "orderId": 12345678901234567890,\n  "amount": 10.5,\n  "currency": "USD"\n}',
    b: '{\n  "orderId": 12345678901234567891,\n  "amount": 10.50,\n  "currency": "USD"\n}',
    opts: {},
  },
  'compare-by-id': {
    title: 'the match by id example',
    a: pretty({ users: [{ id: 1, name: 'Ana', email: 'ana@example.com' }, { id: 2, name: 'Ben', email: 'ben@example.com' }, { id: 3, name: 'Cleo', email: 'cleo@example.com' }] }),
    b: pretty({ users: [{ id: 3, name: 'Cleo', email: 'cleo@example.com' }, { id: 1, name: 'Ana', email: 'ana@example.org' }, { id: 2, name: 'Ben', email: 'ben@example.com' }] }),
    opts: { arrays: { mode: 'key', key: 'id' } },
  },
  'ignore-array-order': {
    title: 'the ignore order example',
    a: pretty({ team: 'web', members: ['Ana', 'Ben', 'Cleo'], labels: [{ name: 'bug', color: 'red' }, { name: 'ui', color: 'blue' }] }),
    b: pretty({ team: 'web', members: ['Cleo', 'Ana', 'Ben'], labels: [{ name: 'ui', color: 'green' }, { name: 'bug', color: 'red' }] }),
    opts: { arrays: { mode: 'order' } },
  },
  'ignore-fields': {
    title: 'the ignore fields example',
    a: pretty({ requestId: 'r-1001', updatedAt: '2026-10-20T09:00:00Z', status: 'open', items: [{ id: 1, updatedAt: '2026-10-20T09:00:00Z', qty: 2 }] }),
    b: pretty({ requestId: 'r-1002', updatedAt: '2026-10-21T10:30:00Z', status: 'closed', items: [{ id: 1, updatedAt: '2026-10-21T10:30:00Z', qty: 2 }] }),
    opts: { ignore: '**.updatedAt\nrequestId' },
  },
  'large-files': {
    title: 'two 5 MB files',
    build: bigExample,
    opts: {},
  },
};

export function scenarioTexts(s) {
  return s.build ? s.build() : { a: s.a, b: s.b };
}
