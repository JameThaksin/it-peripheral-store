# Database Design — IT Peripheral Store (MongoDB)

Status: Draft v5 (M1-009). Satisfies REQ-B02, B03, B09, B12. Concurrency policies: [ADR-002](../decisions/ADR-002-DATA_CONSISTENCY.md). Business rules referenced as BR-xx are in [SYSTEM_REQUIREMENTS.md](../requirements/SYSTEM_REQUIREMENTS.md#6-business-rules--orders-and-inventory).

## 1. Conventions

| Topic | Rule |
|---|---|
| Database | `itps_<env>` e.g. `itps_dev`, `itps_test`, `itps_prod` |
| Collection names | lower camelCase plural |
| IDs | `_id: ObjectId` |
| Money | Integer **satang** (THB×100), BSON `int` (int32). Field suffix `Satang`. Never `Double`/`Decimal128`/`long` in v1. Bounds in §1.1. |
| Timestamps | `createdAt`, `updatedAt` (`Date`, UTC) via Mongoose `timestamps: true` |
| Strings | Trimmed; length limits enforced by Zod and by `$jsonSchema` |
| Validation | Three layers: strict Zod at the API boundary (primary, unknown keys rejected), Mongoose schemas with `strict: 'throw'` (unknown paths throw instead of being dropped), MongoDB `$jsonSchema` validator `validationLevel: strict` (safety net). |
| Deletes | Products and categories are **never hard-deleted by the application**; delete = `isActive:false` + `deletedAt` (ADR-002 D5, BR-10) |

### 1.1 Numeric types, bounds and arithmetic (R03)

The Node.js driver serializes a JS `number` that is an integer within int32 range as BSON `int`, and any other number as `double`. Every money and stock bound below keeps stored values, including sums, within int32 (max 2,147,483,647). Their validators therefore require `bsonType: "int"`, so a stray double, fraction or overflow fails loudly. The one exception is `inventoryRevision`, a counter that is stored as BSON `long` via Mongoose `BigInt` and validated as `bsonType: "long"`.

| Field | Mongoose type | Bounds | Notes |
|---|---|---|---|
| `products.priceSatang`, `compareAtPriceSatang` | `Number` + `validate: Number.isInteger` | 1 – 10,000,000 (฿100,000) | |
| `products.stock` | `Number` + integer validator | Admin-set: 0 – 1,000,000 (`MAX_ADMIN_STOCK`). Stored: 0 – 2,147,483,647 | Admin operations (create, `stockAdjust` up, `stockSet`) may not raise stock above 1,000,000. Cancellation restores are exempt (§7.4), so stored stock can exceed the admin cap by up to the units in open orders |
| `products.inventoryRevision` | Mongoose `BigInt` → BSON **`long`** (int64) | 0 – 9,223,372,036,854,775,807 | +1 on every stock mutation (§7.1, G04). Always written as `long` (`$inc` with `Long(1)`, insert with `0n`), so it never shares the int32 limit with stock. Lifecycle: starts at 0 on insert, only ever increases, and is never reset or reused for the product's lifetime (the seed never touches it, §8). At 1,000 mutations per second it would take about 292 million years to exhaust. An `$inc` overflow raises a server error, which aborts the transaction like any other failed write (§7.4). Serialized in the API as a **decimal string** (e.g. `"7"`), because JSON numbers can't hold every int64 value exactly |
| `items[].unitPriceSatang` | same | 1 – 10,000,000 | |
| `items[].quantity` | same | 1 – 10 (after merge) | |
| `items[].lineTotalSatang` | same | ≤ 100,000,000 | = unit × qty |
| `subtotalSatang`, `totalSatang` | same | ≤ **1,000,000,000** (BR-15) | checked after each addition; over cap → `422 ORDER_LIMIT_EXCEEDED` |
| `shippingFeeSatang` | same | 0 – 100,000 | |
| Config `SHIPPING_FEE_SATANG`, `FREE_SHIPPING_THRESHOLD_SATANG` | parsed by Zod at startup | 0 – 100,000 and 0 – 1,000,000,000 | invalid config stops startup |
| `categories.activeProductCount` | same | 0 – 1,000,000 | |

Arithmetic rules: compute only in `packages/shared/money.ts` helpers (`mulSatang`, `addSatang`) that assert `Number.isSafeInteger(result)` and the relevant cap, and throw otherwise. No division, percentages or floats in v1. API JSON carries plain integers. Zod: `z.number().int().min(a).max(b)`. Do not use `mongoose.Schema.Types.Int32` or `Long` plugins; plain `Number` plus the validators above is sufficient and matches the driver's int32 serialization.

## 2. Entity relationships

```mermaid
erDiagram
  USERS ||--o{ ORDERS : places
  CATEGORIES ||--o{ PRODUCTS : groups
  PRODUCTS ||--o{ ORDER_ITEMS : "snapshotted into"
  ORDERS ||--|{ ORDER_ITEMS : embeds
  USERS ||--o{ AUDIT_LOGS : "admin actions"
  USERS ||--o{ IDEMPOTENCY_KEYS : "checkout attempts"
  IDEMPOTENCY_KEYS |o--|| ORDERS : "replays"
  USERS {
    ObjectId _id
    string email UK
    string passwordHash
    string role
  }
  CATEGORIES {
    ObjectId _id
    string slug UK
    string name
    int activeProductCount
  }
  PRODUCTS {
    ObjectId _id
    string sku UK
    string slug UK
    ObjectId categoryId FK
    int priceSatang
    int stock
    long inventoryRevision
    bool isActive
  }
  ORDERS {
    ObjectId _id
    string orderNumber UK
    ObjectId userId FK
    int totalSatang
    string status
  }
  IDEMPOTENCY_KEYS {
    ObjectId userId FK
    string key
    string fingerprint
    ObjectId orderId FK
    date expiresAt
  }
  ORDER_ITEMS {
    ObjectId productId
    string name
    int unitPriceSatang
    int quantity
  }
```

Supporting collections (not part of the four core ones): `idempotencyKeys` (checkout replay, F02), `sessions` (managed by `connect-mongo`, TTL) and `auditLogs` (admin actions, REQ-E08).

## 3. Embedding vs referencing

| Relationship | Decision | Reason |
|---|---|---|
| Order → items | **Embed** (`items[]`) | Always read with the order, bounded size (≤ 20, BR-04), must be immutable snapshot (BR-03) |
| Order → shipping address | **Embed** | Snapshot at order time; user may change address later |
| Order → user | **Reference** `userId` + embed `customer.email/name` snapshot | Users change; order lists for admin need name without `$lookup` |
| Product → category | **Reference** `categoryId` only (no copied slug) | Category rename needs no propagation. `?category=<slug>` resolves the slug to an id with one indexed lookup, then filters by `categoryId`. Consistency with category deactivation is coordinated via `categories.activeProductCount` (§7, ADR-002 D9). |
| Product → images | **Embed** `images[]` (URL + alt) | Small, owned by product |
| Product → specs | **Embed** `specs[]` key/value | Varies by peripheral type; avoids per-type collections |
| User → orders | **Not embedded**; query `orders` by `userId` | Unbounded growth |
| User → addresses | Embed up to 5 `addresses[]` | Small, owned by user (engineering, optional for v1) |

## 4. Collections

### 4.1 `users`

**Purpose:** customer and admin accounts, login identity.

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `_id` | ObjectId | ✓ | |
| `email` | string | ✓ | lowercase, trimmed, RFC-ish email, ≤ 254; **unique** |
| `passwordHash` | string | ✓ | Argon2id (or bcrypt cost ≥ 12) encoded hash. Never plaintext; `select: false` |
| `name` | string | ✓ | 1–100 chars |
| `role` | string | ✓ | enum `customer` \| `admin`; default `customer`; **not settable via public API** |
| `phone` | string | | ≤ 20, digits/+/-/space |
| `addresses` | array<Address> | | max 5 |
| `isActive` | bool | ✓ | default `true`; inactive users cannot log in |
| `failedLoginCount` | int | ✓ | default 0 |
| `lockedUntil` | Date | | set after repeated failures |
| `lastLoginAt` | Date | | |
| `createdAt`/`updatedAt` | Date | ✓ | |

`Address` = `{ recipient: string(1–100), line1: string(1–200), line2?: string(≤200), district: string, province: string, postalCode: string(/^\d{5}$/), phone: string }`

Indexes:

| Index | Purpose |
|---|---|
| `{ email: 1 }` unique, collation `{locale:'en', strength:2}` | Login lookup; case-insensitive uniqueness |
| `{ role: 1, createdAt: -1 }` | Admin user list (future) |

```json
{
  "_id": { "$oid": "6740a1f2c1a2b3c4d5e6f701" },
  "email": "customer@example.com",
  "passwordHash": "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>",
  "name": "Example Customer",
  "role": "customer",
  "addresses": [
    { "recipient": "Example Customer", "line1": "99 Example Rd.", "district": "Pathum Wan",
      "province": "Bangkok", "postalCode": "10330", "phone": "0800000000" }
  ],
  "isActive": true,
  "failedLoginCount": 0,
  "createdAt": { "$date": "2026-11-14T06:00:00Z" },
  "updatedAt": { "$date": "2026-11-14T06:00:00Z" }
}
```

### 4.2 `categories`

**Purpose:** product grouping for navigation and filtering (REQ-B04).

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `name` | string | ✓ | 1–60, unique (case-insensitive) |
| `slug` | string | ✓ | `/^[a-z0-9]+(-[a-z0-9]+)*$/`, ≤ 60, **unique** |
| `description` | string | | ≤ 500 |
| `sortOrder` | int | ✓ | default 0 |
| `isActive` | bool | ✓ | default true |
| `deletedAt` | Date | | set on deactivation |
| `activeProductCount` | int | ✓ | default 0; number of products with `isActive:true` in this category; maintained transactionally (§7.5) |

Categories are **flat** in v1 (no `parentId`), so hierarchy cycles cannot occur; nesting is REQ-F07.

Indexes: `{ slug: 1 }` unique · `{ name: 1 }` unique (collation strength 2) · `{ isActive: 1, sortOrder: 1 }`.

Seed categories (≥ 6): `keyboards`, `mice`, `headsets`, `monitors`, `webcams`, `storage`, `networking`, `accessories`.

```json
{ "_id": { "$oid": "6740a1f2c1a2b3c4d5e6f710" }, "name": "Keyboards", "slug": "keyboards",
  "description": "Mechanical and membrane keyboards", "sortOrder": 1, "isActive": true, "activeProductCount": 6,
  "createdAt": { "$date": "2026-11-14T06:00:00Z" }, "updatedAt": { "$date": "2026-11-14T06:00:00Z" } }
```

### 4.3 `products`

**Purpose:** catalog items (REQ-B02/B03). Minimum 30 seeded documents.

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `sku` | string | ✓ | `/^[A-Z0-9-]{3,32}$/`, **unique** |
| `slug` | string | ✓ | kebab-case ≤ 120, **unique** |
| `name` | string | ✓ | 2–150 |
| `brand` | string | ✓ | 1–60 |
| `description` | string | ✓ | 10–5000, plain text (rendered escaped) |
| `categoryId` | ObjectId → categories | ✓ | must reference an active category, enforced by the conditional category write in §7.5 |
| `priceSatang` | int | ✓ | 1 – 10,000,000 (≤ ฿100,000), §1.1 |
| `compareAtPriceSatang` | int | | > `priceSatang` if set |
| `currency` | string | ✓ | const `THB` |
| `stock` | int | ✓ | ≥ 0; admin cap 1,000,000, stored max int32 (§1.1); changed only by the operations in §7.1 |
| `inventoryRevision` | long | ✓ | 0 on insert; incremented by **every** stock mutation; never reset; required by absolute stock corrections (§7.1) |
| `images` | array<{url, alt}> | ✓ | 1–8; `url` https or `/images/` path ≤ 500; `alt` ≤ 150 |
| `specs` | array<{key, value}> | | ≤ 30; key ≤ 50, value ≤ 200 |
| `tags` | array<string> | | ≤ 10, each ≤ 30 |
| `isActive` | bool | ✓ | default true; `false` = deleted (soft) |
| `deletedAt` | Date | | set when deactivated by DELETE; cleared on reactivation |
| `isFeatured` | bool | ✓ | default false (landing "featured" section) |
| `createdBy`/`updatedBy` | ObjectId → users | | admin who changed it |

Indexes:

| Index | Purpose |
|---|---|
| `{ sku: 1 }` unique | Admin lookup, seed idempotency |
| `{ slug: 1 }` unique | Product page |
| `{ isActive: 1, categoryId: 1, priceSatang: 1 }` | Category filter + price sort/range |
| `{ isActive: 1, createdAt: -1 }` | "Newest" listing |
| `{ isActive: 1, isFeatured: 1 }` | Landing page featured products |
| Text `{ name: 10, brand: 5, tags: 3, description: 1 }`, `default_language: 'none'` | `?q=` search (REQ-B04). `none` avoids English stemming mangling model numbers. |

Atlas Search is a future option (REQ-F06); the native text index is sufficient for v1 and works locally.

```json
{
  "_id": { "$oid": "6740a1f2c1a2b3c4d5e6f720" },
  "sku": "KB-MECH-TKL-01",
  "slug": "tkl-mechanical-keyboard-red-switch",
  "name": "TKL Mechanical Keyboard (Red Switch)",
  "brand": "GenericBrand",
  "description": "87-key tenkeyless mechanical keyboard with linear red switches and USB-C.",
  "categoryId": { "$oid": "6740a1f2c1a2b3c4d5e6f710" },
  "priceSatang": 189000,
  "currency": "THB",
  "stock": 25,
  "inventoryRevision": { "$numberLong": "3" },
  "images": [{ "url": "/images/products/kb-mech-tkl-01.webp", "alt": "TKL mechanical keyboard" }],
  "specs": [{ "key": "Switch", "value": "Linear Red" }, { "key": "Connection", "value": "USB-C wired" }],
  "tags": ["mechanical", "tkl"],
  "isActive": true,
  "isFeatured": true,
  "createdAt": { "$date": "2026-11-14T06:00:00Z" },
  "updatedAt": { "$date": "2026-11-14T06:00:00Z" }
}
```

### 4.4 `orders`

**Purpose:** persisted purchases (REQ-B08/B09) with immutable item snapshots (BR-03).

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `orderNumber` | string | ✓ | `ORD-YYYYMMDD-XXXXXX` (base32 random), **unique** |
| `userId` | ObjectId → users | ✓ | |
| `customer` | {email, name} | ✓ | snapshot |
| `items` | array<OrderItem> | ✓ | 1–20 |
| `shippingAddress` | Address | ✓ | snapshot |
| `subtotalSatang` | int | ✓ | = Σ `lineTotalSatang` (server) |
| `shippingFeeSatang` | int | ✓ | ≥ 0 (BR-09) |
| `totalSatang` | int | ✓ | = subtotal + shipping |
| `currency` | string | ✓ | `THB` |
| `status` | string | ✓ | enum `pending`,`confirmed`,`shipped`,`delivered`,`cancelled` |
| `statusHistory` | array<{status, at, by}> | ✓ | append-only |
| `note` | string | | ≤ 500 customer note |
| `idempotencyKey` | string | ✓ | the checkout's idempotency key (UUID v7); kept for the order's lifetime so a key can never create a second order (R1) |

`OrderItem` = `{ productId: ObjectId, sku: string, name: string, imageUrl: string, unitPriceSatang: int 1–10,000,000, quantity: int 1–10, lineTotalSatang: int }`. `productId` is unique within `items` (lines are merged before insert, BR-04).

Indexes:

| Index | Purpose |
|---|---|
| `{ orderNumber: 1 }` unique | Lookup / display |
| `{ userId: 1, createdAt: -1 }` | "My orders" |
| `{ status: 1, createdAt: -1 }` | Admin order queue |
| `{ "items.productId": 1 }` | Admin report "orders containing product" |
| `{ userId: 1, idempotencyKey: 1 }` unique | Permanent backstop: one order per key, ever (R1). Also serves the client reconciliation lookup `GET /api/orders?idempotencyKey=` |

```json
{
  "_id": { "$oid": "6740a1f2c1a2b3c4d5e6f730" },
  "orderNumber": "ORD-20261114-7K2M9Q",
  "userId": { "$oid": "6740a1f2c1a2b3c4d5e6f701" },
  "customer": { "email": "customer@example.com", "name": "Example Customer" },
  "items": [
    { "productId": { "$oid": "6740a1f2c1a2b3c4d5e6f720" }, "sku": "KB-MECH-TKL-01",
      "name": "TKL Mechanical Keyboard (Red Switch)", "imageUrl": "/images/products/kb-mech-tkl-01.webp",
      "unitPriceSatang": 189000, "quantity": 2, "lineTotalSatang": 378000 }
  ],
  "shippingAddress": { "recipient": "Example Customer", "line1": "99 Example Rd.", "district": "Pathum Wan",
    "province": "Bangkok", "postalCode": "10330", "phone": "0800000000" },
  "subtotalSatang": 378000,
  "shippingFeeSatang": 0,
  "totalSatang": 378000,
  "currency": "THB",
  "status": "pending",
  "statusHistory": [{ "status": "pending", "at": { "$date": "2026-11-14T06:10:00Z" }, "by": { "$oid": "6740a1f2c1a2b3c4d5e6f701" } }],
  "createdAt": { "$date": "2026-11-14T06:10:00Z" },
  "updatedAt": { "$date": "2026-11-14T06:10:00Z" }
}
```

### 4.5 Supporting: `idempotencyKeys`, `sessions`, `auditLogs`

**`idempotencyKeys`** (F02, ADR-002 D2): one document per accepted checkout, used for **payload-checked replay** during the 24 h replay window. The permanent one-order-per-key guarantee comes from the unique index on `orders` (§4.4).

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `userId` | ObjectId → users | ✓ | |
| `key` | string | ✓ | UUID v7 from client (its embedded timestamp is the key's issue time, §7.2) |
| `fingerprint` | string | ✓ | hex SHA-256 of canonical JSON of the **normalized** request: items sorted by `productId` with merged quantities, `shippingAddress`, `note` |
| `orderId` | ObjectId → orders | ✓ | order created by this key |
| `createdAt` | Date | ✓ | |
| `expiresAt` | Date | ✓ | `createdAt + 24 h`, where `createdAt` is the server time of the committing transaction. This is the end of the replay window |

Indexes: `{ userId: 1, key: 1 }` unique · `{ expiresAt: 1 }` TTL `expireAfterSeconds: 0`. TTL removal runs roughly once a minute, so the service treats a record with `expiresAt <= now` as absent and deletes it inside the checkout transaction before inserting the new one.

```json
{ "_id": { "$oid": "6740a1f2c1a2b3c4d5e6f740" }, "userId": { "$oid": "6740a1f2c1a2b3c4d5e6f701" },
  "key": "6f1c6d6e-3c1e-4a8e-9b5b-0b9b3d7a2c11", "fingerprint": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "orderId": { "$oid": "6740a1f2c1a2b3c4d5e6f730" },
  "createdAt": { "$date": "2026-11-14T06:10:00Z" }, "expiresAt": { "$date": "2026-11-15T06:10:00Z" } }
```

- `sessions`: managed by `connect-mongo`; `{ _id: sid, expires: Date, session: string }`; TTL index on `expires`.
- `auditLogs`: `{ actorId, action ('product.create' …), entity, entityId, changes (diff, no secrets), ip, requestId, createdAt }`; index `{ entity: 1, entityId: 1, createdAt: -1 }`, TTL 365 days (assumption).

## 5. Server-side validator example

Applied by `database/validators/products.json` during `npm run db:migrate`. Validators for `orders`, `categories` and `idempotencyKeys` follow the same pattern with the bounds of §1.1.

```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["sku","slug","name","brand","description","categoryId","priceSatang","currency","stock","inventoryRevision","images","isActive"],
    "properties": {
      "priceSatang": { "bsonType": "int", "minimum": 1, "maximum": 10000000 },
      "compareAtPriceSatang": { "bsonType": "int", "minimum": 1, "maximum": 10000000 },
      "stock":       { "bsonType": "int", "minimum": 0 },
      "inventoryRevision": { "bsonType": "long", "minimum": 0 },
      "currency":    { "enum": ["THB"] },
      "images":      { "bsonType": "array", "minItems": 1, "maxItems": 8 }
    }
  }
}
```

## 6. Integrity rules mapped to mechanisms

| Constraint | Mechanism |
|---|---|
| Consistent money | Integer satang, BSON `int`, bounds and safe arithmetic per §1.1; Zod `z.number().int().min().max()`; `$jsonSchema` `bsonType: "int"` |
| Order snapshots | Embedded `items[]` copied from product at checkout; orders never re-join products for display |
| Server-calculated totals | `CreateOrder` schema has **no** price fields (`.strict()` rejects them); `OrderService` computes all money |
| No negative stock | All stock writes are conditional (§7.1, §7.2) + validator `minimum: 0` |
| No lost stock updates | Admin stock changes are relative, or preconditioned on `inventoryRevision` (§7.1) |
| Unique email | Unique index (case-insensitive collation) + email lowercased before save; duplicate key → `409 EMAIL_TAKEN` |
| No plaintext passwords | Hash in `AuthService` before insert; `passwordHash` `select:false`; never in responses or logs |
| No hardcoded products | Frontend reads `/api/products`; seed script is the only product source; CI lint rule bans product JSON under `apps/web/src` |
| Orders never reference missing products | No hard delete of products (§7.3) |

## 7. Write paths, transactions and concurrency

MongoDB transactions use snapshot isolation. Two transactions that **write the same document** conflict, and the loser gets a `WriteConflict` error labelled `TransientTransactionError`. Reads take no locks. Every rule below therefore makes competing operations write a shared document (ADR-002).

`session.withTransaction()` retries only on the error labels `TransientTransactionError` (whole transaction) and `UnknownTransactionCommitResult` (commit). **Any other error**, including duplicate key (`E11000`), aborts the transaction and is thrown to the caller. Recovery for those errors happens **outside** the aborted transaction (§7.2). Transactions use read concern `snapshot` and write concern `majority`, must finish within 1 s and at most 20 product updates, and run with driver `maxCommitTimeMS: 5000`.

### 7.1 Stock mutations and inventory revision (F01, N02)

`products.inventoryRevision` is a monotonically increasing 64-bit integer (§1.1). **Every** write that changes `stock` also does `$inc: { inventoryRevision: Long(1) }` (written `1` below for brevity). This includes operational scripts: the only stock writers are the operations in this table, and the seed never updates existing products (§8). So a revision observed by a client identifies one exact inventory state, even if the stock number later returns to the same value.

| Operation | Filter | Update | No match → |
|---|---|---|---|
| Checkout decrement (§7.2) | `{ _id, isActive: true, stock: { $gte: qty } }` | `{ $inc: { stock: -qty, inventoryRevision: 1 } }` | `OUT_OF_STOCK` / `PRODUCT_UNAVAILABLE` |
| Cancellation restore (§7.4) | `{ _id, stock: { $lte: 2147483647 - qty } }` (int32 hard limit only; no admin cap) | `{ $inc: { stock: +qty, inventoryRevision: 1 } }` | Abort the cancellation, `409 INVENTORY_LIMIT` |
| `stockAdjust: n`, n > 0 (restock) | `{ _id, stock: { $lte: 1000000 - n } }` | `{ $inc: { stock: n, inventoryRevision: 1 } }` | `409 STOCK_CONFLICT` (would exceed admin cap) |
| `stockAdjust: n`, n < 0 (write-off) | `{ _id, stock: { $gte: -n } }` | `{ $inc: { stock: n, inventoryRevision: 1 } }` | `409 STOCK_CONFLICT` (would go negative) |
| `stockSet: v, expectedRevision: r` (absolute count, 0 ≤ v ≤ 1,000,000; `r` parsed from its decimal string to `Long`) | `{ _id, inventoryRevision: r }` | `{ $set: { stock: v }, $inc: { inventoryRevision: 1 } }` | `409 STOCK_CONFLICT` with `details.currentStock`, `details.currentRevision` |
| Product create (API or seed insert, §7.5 `createProduct`) | `{ sku }` with `upsert`, `$setOnInsert` only | `stock: initial (0–1,000,000), inventoryRevision: Long(0)` | Existing SKU → nothing written (`409 SKU_TAKEN` via the API; skipped by the seed) |

There is no unconditional stock write and no write that changes `stock` without incrementing the revision. Relative adjustments never conflict with checkout: both are atomic `$inc`, so both changes are kept. An absolute correction succeeds only if **no** stock mutation happened since the admin loaded the product. For example: admin loads (stock 10, rev 5) → sale (7, rev 6) → restock (10, rev 7) → `stockSet` with `expectedRevision: 5` is rejected although stock is 10 again. A missing id → `404`. Each change writes an `auditLogs` entry with before/after stock and revision.

### 7.2 Checkout (F02, F05, R01, N03)

The request is validated and normalized before any database work (merge duplicates; merged qty 1–10; ≤ 20 products), and its fingerprint is computed. The service pre-generates `orderId` and `orderNumber`, then runs:

**Transaction body**

1. `idempotencyKeys.findOne({ userId, key })`. Found and not expired → stop and go to *Replay* below with that record. Found and expired (`expiresAt <= now`) → delete it and continue.
1a. **Retired-key check (R1).** `orders.findOne({ userId, idempotencyKey: key })`. Found → stop: `409 IDEMPOTENCY_KEY_EXPIRED` with `details: { orderNumber, createdAt }`. The key already produced an order whose replay window has ended, and it will never create another.
1b. **Key age check (R1).** If the key's UUID v7 timestamp is ≥ 24 h before server time → stop: `422 IDEMPOTENCY_KEY_EXPIRED` with `details: { orderNumber: null }`. No order exists for it, and an old key can't create one. (A timestamp more than 5 min in the future is rejected earlier by validation, `400`.)
2. Insert `idempotencyKeys { userId, key, fingerprint, orderId, expiresAt }`.
3. Load the products; each must be `isActive: true`, else throw `PRODUCT_UNAVAILABLE`.
4. Apply the checkout decrement of §7.1 per line. Zero matches → re-read to choose between `OUT_OF_STOCK` and `PRODUCT_UNAVAILABLE`, then throw.
5. Compute the money (§1.1) and insert the order with the pre-generated `_id`, `orderNumber` and `idempotencyKey`. A concurrent duplicate of a retired key that got past step 1a fails here on the unique `orders {userId, idempotencyKey}` index → aborted → handled as in the table below.

**Outcome states (G01).** Every checkout attempt ends in exactly one of three states, and the response follows from the state:

| State | Meaning | Response |
|---|---|---|
| **Committed** | Known to have committed: the driver acknowledged the commit, or reconciliation found a record with our `orderId` | `201` new order |
| **Not committed** | Known not to have committed: the transaction body threw **before** `commitTransaction` was sent, so the driver aborted it | Business error (`409`/`422`), or the next attempt |
| **Unknown** | `commitTransaction` was sent and its result is unresolved: an `UnknownTransactionCommitResult` the driver couldn't resolve, or a network error or timeout after the commit was sent | *Reconcile* (below). **Never** a business error, and never a fresh attempt within this request |

An absent idempotency record **never** moves an attempt from Unknown to Not committed. Absence can mean the commit hasn't been applied, isn't yet majority-visible, or failed.

**Outer control (outside the transaction)**: at most 3 attempts, 10 s overall deadline (driver `timeoutMS: 10000`), `maxCommitTimeMS: 5000`

| Result of an attempt | Handling |
|---|---|
| Commit acknowledged | **Committed** → `201` |
| Body stopped at step 1 (record already committed) | *Replay* |
| Body stopped at step 1a or 1b | Not committed → `409`/`422 IDEMPOTENCY_KEY_EXPIRED` (definitive; nothing written) |
| Body throws `E11000` on `orders {userId, idempotencyKey}` | Not committed: an order for this key exists → read it (majority) → `409 IDEMPOTENCY_KEY_EXPIRED` with its `orderNumber`, or *Replay* if a live key record exists |
| Body throws a business error (`OUT_OF_STOCK`, `PRODUCT_UNAVAILABLE`, `ORDER_LIMIT_EXCEEDED`) before commit | **Not committed** → return the error. It is definitive: this attempt inserted the idempotency key in its own transaction (step 2), which is only possible while no other transaction for this `(userId, key)` is committed or in progress on the primary. A committed one gives `E11000`; an in-progress one gives `WriteConflict` |
| Body throws `E11000` on the `idempotencyKeys` `{userId,key}` index | Another transaction committed this key → *Reconcile*, because the committed record may not yet be majority-visible |
| Body throws `E11000` on `orders.orderNumber` | Not committed: regenerate `orderNumber` and `orderId`, then next attempt |
| Body throws `E11000` on any other index | Not committed: `500 INTERNAL_ERROR`, logged with the index name; no retry |
| `WriteConflict`/`TransientTransactionError` still failing after the driver's own retries | Not committed: next attempt if the deadline allows, else `503 CHECKOUT_RETRY` |
| Commit result unresolved | **Unknown**. The driver has already retried `commitTransaction` on the same session until `maxCommitTimeMS`; a retry uses the same transaction number, so it can't commit twice. → *Reconcile*; no further attempts |
| Attempts or deadline exhausted without reaching Unknown | `503 CHECKOUT_RETRY` |

***Reconcile*** (bounded, read-only): poll `idempotencyKeys.findOne({userId,key})` on the primary with read concern `majority`, every 250 ms for up to 3 s, within the 10 s deadline.
- Record with **our** `orderId` → **Committed** → `201` with that order.
- Record with another `orderId` → *Replay*.
- Still absent → `503 CHECKOUT_RETRY` with `Retry-After: 5`. The response says the outcome is unknown, never that nothing was ordered. The client must retry with the **same** key and must not create a new one. The retry then either replays the original order or, if the original never committed, creates exactly one order.

***Replay***: if `record.fingerprint` equals ours → load `orders` by `record.orderId` and return `200` with `Idempotent-Replay: true`. Else → `422 IDEMPOTENCY_KEY_REUSED`. A missing referenced order is impossible (key and order commit together); if it happens, return `500` and log it.

**Exact replay and expiry guarantee (R1).** For a request with key K from user U, received at server time t:

| Condition (checked in this order) | Result |
|---|---|
| A key record exists with `t < expiresAt` (= commit time + 24 h) | Same fingerprint → `200` replay of the original order; different → `422 IDEMPOTENCY_KEY_REUSED` |
| An order with `(U, K)` exists (its record expired or was removed) | `409 IDEMPOTENCY_KEY_EXPIRED` with `orderNumber`. **No new order** |
| K's UUID v7 timestamp is ≥ 24 h before t | `422 IDEMPOTENCY_KEY_EXPIRED` (no order exists). **No new order** |
| Otherwise | Normal checkout (may create exactly one order) |

So: a committed checkout is replayed for at least 24 h after its commit, and **a key can create an order only within 24 h of its own issue time**. Because the commit happens after the key is issued, the replay window always outlasts the creation window, which leaves no gap in which an expired key could create an order. TTL deletion delay doesn't matter, because records with `expiresAt <= t` are treated as expired, and the `orders` lookup still answers. Unknown-outcome semantics are unchanged: a `503 CHECKOUT_RETRY` response still means "outcome unknown", and a same-key retry inside the window replays or creates exactly once. After the window, the client must reconcile (API_CONTRACTS §3.3) instead of retrying blindly.

**Why a later retry is safe.** A retry with the same key can only reach a business error after inserting the key in its own transaction (step 2). If the earlier transaction committed on the current primary, that insert fails with `E11000` (→ *Reconcile* → *Replay*). If it is still running, the insert gets `WriteConflict` and is retried. So a definitive business error is returned only when no earlier transaction for that key is committed or in progress on the primary. A commit acknowledged only by a deposed primary (not majority-committed) is rolled back during failover, so it can't materialize later. Commits use write concern `majority`. In every path at most one order and one set of stock decrements commit per `(userId, key)`, **for the key's whole lifetime** (unique index on `orders`).

### 7.3 Product and category deactivation (F06, R01, R05, N06)

- **Product delete** (or `PATCH isActive:false`) = `findOneAndUpdate({ _id }, { $set: { isActive: false, deletedAt: now } })` in a transaction that, **if the product was active**, also runs `categories.updateOne({ _id: categoryId }, { $inc: { activeProductCount: -1 } })`. Already inactive → no change, same `200`. No hard delete exists in the API.
- **Category deactivation has exactly one write path**: `DELETE /api/admin/categories/:id` = `findOneAndUpdate({ _id, isActive: true, activeProductCount: 0 }, { $set: { isActive: false, deletedAt: now } })`. No match because of the count → `409 CATEGORY_HAS_ACTIVE_PRODUCTS`. Already inactive → `200`. Category `PATCH` does **not** accept `isActive`; it is rejected as an unknown field.
- **Category reactivation** has its own operation: `POST /api/admin/categories/:id/reactivate` = `updateOne({ _id }, { $set: { isActive: true }, $unset: { deletedAt: 1 } })`, idempotent. Reactivation cannot break an invariant, since an active category with zero products is valid.

### 7.4 Order status transitions and cancellation (R02, N04, N05)

Allowed transitions: `pending→confirmed|cancelled`, `confirmed→shipped|cancelled`, `shipped→delivered`. A customer may only do `pending→cancelled` on their own order.

```
withTransaction:
  order = orders.findOneAndUpdate(
     { orderNumber, status: { $in: allowedFrom(target, actorRole) }, [userId if customer] },
     { $set: { status: target }, $push: { statusHistory: { status: target, at, by } } },
     { returnDocument: 'after' })
  if !order → re-read: missing/not owner → 404; else 409 INVALID_STATUS_TRANSITION {currentStatus}
  if target == 'cancelled':
     for item in order.items:
        res = products.updateOne({ _id: item.productId, stock: { $lte: 2147483647 - item.quantity } },
                                 { $inc: { stock: item.quantity, inventoryRevision: Long(1) } })
        if res.matchedCount == 0 → abort, 409 INVENTORY_LIMIT
```

- **At most one restoration.** Stock is restored only inside the transaction whose conditional status update matched. Two concurrent cancellations both write the order document: one commits, the other's retry no longer matches its filter and returns `409`.
- **Valid serial orderings are allowed.** A concurrent admin confirm and admin cancel on a pending order can legitimately both succeed (`pending→confirmed→cancelled`), because cancel is allowed from `confirmed`. The acceptance tests (AC-R02b) accept every serializable outcome and assert exactly one restoration whenever the final status is `cancelled`.
- **The admin cap never blocks a cancellation (N04).** The restore has no admin-cap condition. The admin cap (1,000,000) applies only to admin increases (§7.1), and stored stock may exceed it by the units being returned. Restoration ignores `isActive`, so inactive products still get their units back.
- **Hard numeric limits can block a cancellation, atomically and recoverably (R02, G04).** There are two hard limits:
  - **Stock (int32, 2,147,483,647).** The restore filter requires `stock <= 2147483647 - quantity`. No match → the transaction aborts, the order keeps its prior status, no unit is restored, discarded or double-counted, and the API returns **`409 INVENTORY_LIMIT`** with `details: [{ productId, currentStock, quantity }]`. Recovery: an admin lowers stock with a negative `stockAdjust` (e.g. after moving units elsewhere), then the cancellation is retried. Reaching this needs over 2.1 billion units on one product, which isn't expected at this project's scale, but the behavior is defined and tested (AC-R02e).
  - **Revision (int64).** Overflow is unreachable (§1.1). If the server ever rejected the `$inc`, the transaction aborts the same way and the API returns `500 INTERNAL_ERROR` (logged). Nothing is reset and no unit is lost. Recovery is a manual data fix by an operator.

  Either way the cancellation is atomic: it fully commits (status, history, every restore and revision) or changes nothing.

### 7.5 Product ↔ category coordination (R05, N06)

Invariant: **every active product references an active category, and each category's `activeProductCount` equals its number of active products.**

| Product write | Category writes in the same transaction | Failure |
|---|---|---|
| Create with `isActive: true` (`createProduct`) | `updateOne({ _id: cat, isActive: true }, { $inc: { activeProductCount: 1 } })`, only if the product was actually inserted | No match → abort (product insert rolled back), `409 CATEGORY_UNAVAILABLE` |
| Create with `isActive: false` (`createProduct`) | Category must exist (`findOne({ _id: cat })`), any state; no counter change | Missing → abort, `409 CATEGORY_UNAVAILABLE` |
| Reactivate (`isActive: true` on an inactive product) | Same as active create, on its current category | Category inactive → `409 CATEGORY_UNAVAILABLE` (product stays inactive) |
| Move an **active** product to another category | `+1` conditional on the new category being active; `-1` on the old | New category inactive → `409 CATEGORY_UNAVAILABLE` |
| Move an **inactive** product | New category must exist (any state); no counter change | Missing → `409` |
| Deactivate / delete product | `-1` on its category if it was active | — |

**Product creation (R2).** Creation is a separate function from updates. It never reads a before-state:

```
createProduct(input, mode)                                   // mode: 'api' | 'seed'
withTransaction:
  res = products.updateOne(
          { sku: input.sku },
          { $setOnInsert: { _id: newId, ...input fields, stock: input.stock, inventoryRevision: Long(0),
                            isActive: input.isActive, categoryId: input.categoryId, deletedAt: null } },
          { upsert: true })
  if res.upsertedCount == 0:                                 // SKU already exists: nothing was written
      mode == 'api'  ⇒ abort, 409 SKU_TAKEN
      mode == 'seed' ⇒ return 'skipped' (existing product untouched, no counter change)
  if input.isActive:
      c = categories.updateOne({ _id: input.categoryId, isActive: true }, { $inc: { activeProductCount: 1 } })
      c.matchedCount == 0 ⇒ abort (the insert is rolled back), 409 CATEGORY_UNAVAILABLE
  else:
      categories.findOne({ _id: input.categoryId }) == null ⇒ abort, 409 CATEGORY_UNAVAILABLE
  return 'created'
errors outside the body:
  E11000 on products.sku  (concurrent create committed first)  ⇒ api: 409 SKU_TAKEN · seed: 'skipped'
  E11000 on products.slug                                      ⇒ api: 409 SLUG_TAKEN · seed: fail with the slug named (seed data bug)
```

Concurrency:
- **Duplicate SKU.** Two concurrent creates with the same SKU both try to insert. The unique `sku` index and the shared write make one commit. The other either sees the committed document on retry (`upsertedCount == 0`) or gets `E11000`; both map to `409 SKU_TAKEN` (seed: skipped). The category counter is incremented only by the transaction that actually inserted.
- **Active create vs category DELETE.** Both write the category document: the create's conditional `+1` (filter `isActive: true`) and the DELETE's conditional deactivation (filter `activeProductCount: 0`). One commits first. Either the product is created and the DELETE returns `409 CATEGORY_HAS_ACTIVE_PRODUCTS`, or the category is deactivated and the create returns `409 CATEGORY_UNAVAILABLE` with no product document left behind.
- **Inactive create vs category DELETE.** Neither changes the counter, and inactive products may reference inactive categories, so both may succeed. The invariant still holds.

**Single transition rule for product updates (G03).** Product PATCH and DELETE (not creation) go through one function, `applyProductTransition(id, requested)`. It runs inside one transaction and derives category effects only from the **persisted before-state** and the **resulting after-state**, never from which fields the request happened to contain:

```
withTransaction:
  before = products.findOne({ _id: id })                     // in-transaction snapshot read
  if before == null ⇒ abort, 404 NOT_FOUND                   // updates never create
  after  = merge(before, requested)                          // categoryId and isActive after the request
  wasActive = before.isActive;            willBeActive = after.isActive
  oldCat = before.categoryId;             newCat = after.categoryId
  if willBeActive and (not wasActive or newCat != oldCat):
      categories.updateOne({ _id: newCat, isActive: true }, { $inc: { activeProductCount: 1 } })  → 0 matched ⇒ 409 CATEGORY_UNAVAILABLE
  if not willBeActive and newCat != oldCat:
      categories.findOne({ _id: newCat })                    → missing ⇒ 409 CATEGORY_UNAVAILABLE
  if wasActive and (not willBeActive or newCat != oldCat):
      categories.updateOne({ _id: oldCat }, { $inc: { activeProductCount: -1 } })
  products.updateOne({ _id, isActive: before.isActive, categoryId: before.categoryId }, { $set: after fields })
      → 0 matched ⇒ concurrent change: throw a transient error so the transaction re-runs from the new before-state (max 3), then 409 PRODUCT_CONFLICT
```

| Before → after | Category writes |
|---|---|
| inactive → active, same category | +1 on category (must be active) |
| inactive → active, moved A → B | +1 on B (must be active); none on A |
| active → inactive, same category | −1 on category |
| active → inactive, moved A → B | −1 on A; B must exist (any state) |
| active → active, moved A → B | +1 on B (must be active); −1 on A |
| active → active, same category | none |
| inactive → inactive, moved A → B | B must exist (any state) |
| inactive → inactive, same category | none |

The per-operation table above is a special case of this rule. Combined changes (e.g. `{ categoryId: B, isActive: true }`) are therefore allowed and handled atomically. A concurrent `DELETE` of B serializes with them because both write B's document. Either the DELETE commits first (the `+1` on B then fails → `409 CATEGORY_UNAVAILABLE`, nothing changes), or it commits after (B's count is now 1, so the DELETE returns `409 CATEGORY_HAS_ACTIVE_PRODUCTS`).

Every path that can increase a category's count writes that category document with the filter `isActive: true`. Category deactivation (§7.3) writes the same document with the filter `activeProductCount: 0`. Concurrent operations therefore conflict and serialize, and neither can commit against a stale view. Inactive products may reference inactive categories; they are hidden from the catalog and must pass the reactivation rule before being sold. Category slug or name changes touch only the category. `npm run db:verify` recomputes the counts and reports drift; CI runs it after the seed and integration tests.

### 7.6 Replica set and Atlas limitations

- Transactions require a **replica set or sharded cluster**. Atlas clusters, including the free **M0**, are 3-node replica sets. A standalone local `mongod` does **not** support transactions, so local development uses the Docker single-node replica set from DEPLOYMENT_DESIGN §2 (or an Atlas dev cluster), and tests use `MongoMemoryReplSet`.
- Atlas **M0/Flex limits** to plan for: shared throughput caps, a connection limit (pool `maxPoolSize: 10`), 512 MB storage on M0, no managed backups on M0 (DEPLOYMENT_DESIGN §7), and some operators such as `$where` and server-side JavaScript are unavailable. Check current Atlas docs at setup time, because tier limits change.
- Default transaction lifetime limit is 60 s. Ours are far shorter.
- Without transactions the policies above don't hold, so the API refuses to start unless `hello` reports a replica set (`setName` present) with a writable primary.

## 8. Seeding and migration

- `npm run db:migrate` → creates the collections, applies validators (`collMod`) and indexes, including the `idempotencyKeys` TTL index. It is idempotent and never modifies documents.
- `npm run db:seed` → **insert-only** and repeatable (G02):
  - Categories: `updateOne({ slug }, { $setOnInsert: { name, slug, description, sortOrder, isActive: true, activeProductCount: 0 } }, { upsert: true })`. An existing category is never modified: not its name, activation or counter.
  - Products: each goes through `createProduct(input, 'seed')` (§7.5) in its own transaction, as insert-if-absent by `sku` using `$setOnInsert` only. **Only if the upsert actually inserted** and the product is active does the same transaction `$inc` the category's `activeProductCount`, conditional on the category being active. An existing product's stock, revision, category, activation and every other field are never touched.
  - Admin user: `$setOnInsert` by email from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (never hardcoded). An existing user is never modified, including its password and role.
  - There is no `$set` anywhere in the seed. Changing existing seeded data (e.g. a corrected price) requires a reviewed one-off migration that uses the normal service operations (§7.1 for stock).
  - **Safe on a live database**: seed writes are inserts plus conditional counter increments through the §7.5 path, so they serialize with concurrent product, category and checkout operations exactly as API writes do. Two seeds running at once are also safe: the unique `sku`/`slug`/`email` indexes let only one insert win, and the loser's upsert matches the existing document without changing it.
- `npm run db:verify` → read-only check of the §7.5 invariant (each `activeProductCount` equals its active-product count; no active product in an inactive category), the BSON types (`int` for money and stock, `long` for `inventoryRevision`), and `stock ≥ 0`. It exits non-zero on drift. `npm run db:verify -- --repair` fixes counter drift one category at a time, in a transaction that recomputes the count and `$set`s it on the category document. That write conflicts with any concurrent product transition touching the same category, so a repair can't commit a stale count. Repair is a maintenance command and is logged to `auditLogs`.
- `npm run db:reset` → drops and recreates the database, then migrates and seeds. It refuses to run unless `NODE_ENV` is `development` or `test`, `MONGODB_DB_NAME` ends with `_dev` or `_test`, and `--confirm` is passed. It is never run against staging or production, or while the API is serving traffic.
- A CI integration test asserts `products.countDocuments({isActive:true}) >= 30` after seeding (REQ-B02 traceability), and AC-G02 checks that a rerun changes nothing.
