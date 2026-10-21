// Sample pair for the Sample button. It shows every kind of result:
// changed ($.plan), added ($.createdAt, $.tags[2]), removed ($.legacy, $.owner.phone),
// type change ($.id), arrays matched by key ($.items by sku), key order and 3 vs 3.0 ignored.
export const SAMPLE_A = `{
  "id": 1042,
  "status": "active",
  "plan": "basic",
  "retries": 3,
  "tags": ["api", "beta"],
  "owner": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null
  },
  "items": [
    { "sku": "A1", "qty": 1 },
    { "sku": "B2", "qty": 2 },
    { "sku": "C3", "qty": 3 }
  ],
  "notes": "Ship by Friday and call the customer",
  "legacy": true
}`;

export const SAMPLE_B = `{
  "status": "active",
  "id": "1042",
  "plan": "pro",
  "retries": 3.0,
  "tags": ["api", "beta", "new"],
  "owner": {
    "email": "ada@example.org",
    "name": "Ada Lovelace"
  },
  "items": [
    { "sku": "C3", "qty": 3 },
    { "sku": "A1", "qty": 9 },
    { "sku": "B2", "qty": 2 }
  ],
  "notes": "Ship by Monday and call the customer",
  "createdAt": "2026-10-20"
}`;
