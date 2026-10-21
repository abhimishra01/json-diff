// FAQ items. Rendered on the home page AND output as FAQPage JSON-LD. Plain text only.
export const faq = [
  {
    q: 'Does key order matter when I compare JSON?',
    a: 'No. Objects with the same keys and values are equal, whatever the order of the keys. Spaces and line breaks do not matter either. Arrays are different: the order of items in an array can be part of the data, so the Arrays option lets you choose how to match them.',
  },
  {
    q: 'How do I compare two JSON files and ignore the order of array items?',
    a: 'Set Arrays to Ignore order. The tool then matches items that are equal, in any position, and pairs the rest by how many fields they share. A changed item shows as changed, not as removed plus added. If your items have an id, By key or Auto is usually clearer.',
  },
  {
    q: 'How do I ignore fields like updatedAt or id?',
    a: 'Open Options and write one pattern per line under Ignore paths. Use **.updatedAt to skip that field at any depth, items[*].id to skip the id of every item in items, or $.meta.requestId for one exact place. Ignored parts are removed from both sides before the compare.',
  },
  {
    q: 'Is my JSON uploaded to a server?',
    a: 'No. The compare runs in your browser, in a background worker. The page makes no request that carries what you paste. You can check this: open the Network tab in your browser tools, paste two documents and press Compare. You will see no request with your data.',
  },
  {
    q: 'How big a file can I compare?',
    a: 'Files up to 50 MB open. We tested two 5 MB files with 35,000 records each. The first changes show in under two seconds on a laptop, and the page stays usable. Above 25 MB the tool warns you. A Cancel button stops a long compare. Memory and your device set the real limit.',
  },
  {
    q: 'Why does it show 1 and "1" as different, but 1.0 and 1 as the same?',
    a: 'A number and a string are different types, so 1 and "1" are a type change. Numbers compare by value, so 1.0, 1 and 1e0 are equal. If you want the written form to count, choose As written under Numbers. Large numbers are never rounded: 12345678901234567890 and 12345678901234567891 differ.',
  },
  {
    q: 'What is the difference between null and a missing key?',
    a: 'They are different. If a key is null in one document and absent in the other, the tool reports the key as added or removed, and the value shows as null. If a key is null in one and 0 in the other, that is a type change from null to number.',
  },
  {
    q: 'How do I compare JSON in VS Code or on the command line?',
    a: 'In VS Code, select two files and choose Compare Selected. This is a text diff, so key order and spacing show as changes. On the command line, diff <(jq -S . a.json) <(jq -S . b.json) sorts keys first, but it still compares arrays by position. This tool handles both cases.',
  },
];
