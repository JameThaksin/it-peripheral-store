# Database Design — IT Peripheral Store (MongoDB)

Status: Draft v2 (M1-003). Satisfies REQ-B02, B03, B09, B12. Concurrency policies: [ADR-002](../decisions/ADR-002-DATA_CONSISTENCY.md). Business rules referenced as BR-xx are in [SYSTEM_REQUIREMENTS.md](../requirements/SYSTEM_REQUIREMENTS.md#6-business-rules--orders-and-inventory).

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

The Node.js driver serializes a JS `number` that is an integer within int32 range as BSON `int`, and any other number as `double`. Every bound below keeps all stored values, including sums, within int32 (max 2,147,483,647). Validators therefore require `bsonType: "int"`, so a stray double, fraction or overflow fails loudly.

| Field | Mongoose type | Bounds | Notes |
|---|---|---|---|
| `products.priceSatang`, `compareAtPriceSatang` | `Number` + `validate: Number.isInteger` | 1 – 10,000,000 (฿100,000) | |
| `products.stock` | `Number` + integer validator | 0 – 1,000,000 | `stockAdjust` result must stay in range |
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
| `stock` | int | ✓ | 0 – 1,000,000 (validator `minimum: 0`); changed only via §7.1 |
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

`OrderItem` = `{ productId: ObjectId, sku: string, name: string, imageUrl: string, unitPriceSatang: int 1–10,000,000, quantity: int 1–10, lineTotalSatang: int }`. `productId` is unique within `items` (lines are merged before insert, BR-04).

Indexes:

| Index | Purpose |
|---|---|
| `{ orderNumber: 1 }` unique | Lookup / display |
| `{ userId: 1, createdAt: -1 }` | "My orders" |
| `{ status: 1, createdAt: -1 }` | Admin order queue |
| `{ "items.productId": 1 }` | Admin report "orders containing product" |

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

**`idempotencyKeys`** (F02, ADR-002 D2): one document per accepted checkout.

| Field | Type | Req | Validation |
|---|---|:-:|---|
| `userId` | ObjectId → users | ✓ | |
| `key` | string | ✓ | UUID v4 from client |
| `fingerprint` | string | ✓ | hex SHA-256 of canonical JSON of the **normalized** request: items sorted by `productId` with merged quantities, `shippingAddress`, `note` |
| `orderId` | ObjectId → orders | ✓ | order created by this key |
| `createdAt` | Date | ✓ | |
| `expiresAt` | Date | ✓ | `createdAt + 24 h` |

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
    "required": ["sku","slug","name","brand","description","categoryId","priceSatang","currency","stock","images","isActive"],
    "properties": {
      "priceSatang": { "bsonType": "int", "minimum": 1, "maximum": 10000000 },
      "compareAtPriceSatang": { "bsonType": "int", "minimum": 1, "maximum": 10000000 },
      "stock":       { "bsonType": "int", "minimum": 0, "maximum": 1000000 },
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
| No lost stock updates | Admin stock changes are relative or preconditioned (§7.1) |
| Unique email | Unique index (case-insensitive collation) + email lowercased before save; duplicate key → `409 EMAIL_TAKEN` |
| No plaintext passwords | Hash in `AuthService` before insert; `passwordHash` `select:false`; never in responses or logs |
| No hardcoded products | Frontend reads `/api/products`; seed script is the only product source; CI lint rule bans product JSON under `apps/web/src` |
| Orders never reference missing products | No hard delete of products (§7.3) |

## 7. Write paths, transactions and concurrency

MongoDB transactions use snapshot isolation. Two transactions that **write the same document** conflict, and `withTransaction` retries the one that loses (`TransientTransactionError`). Reads take no locks. Every rule below therefore makes competing operations write a shared document (ADR-002). All multi-document writes use `session.withTransaction()` with read concern `snapshot` and write concern `majority`, and must finish within 1 s and at most 20 product updates.

### 7.1 Admin stock changes (F01)

| Operation | Filter | Update | No match → |
|---|---|---|---|
| `stockAdjust: n` (n ≠ 0, \|n\| ≤ 1,000,000) | `{ _id, stock: { $gte: -n, $lte: 1000000 - n } }` | `{ $inc: { stock: n } }` | `409 STOCK_CONFLICT` (result would leave 0–1,000,000), or `404` if the id doesn't exist |
| `stockSet: v, expectedStock: e` | `{ _id, stock: e }` | `{ $set: { stock: v } }` | `409 STOCK_CONFLICT` with `details.currentStock` |

There is no unconditional stock write. Manual inventory counts use `stockSet` with the value the admin last loaded. If a sale happened in between, the admin gets a conflict, reloads and re-enters the count. Each change writes an `auditLogs` entry with before and after values.

### 7.2 Checkout (F02, F05, R01)

Inside one transaction:

1. Normalize the lines (merge duplicates; merged qty 1–10; ≤ 20 products). This happens in the validator before the transaction, so a rejection writes nothing.
2. `idempotencyKeys.findOne({ userId, key })`. If found and not expired: same fingerprint → return the referenced order (`200`); different fingerprint → `422 IDEMPOTENCY_KEY_REUSED`. If found but expired: delete it.
3. Insert `idempotencyKeys { userId, key, fingerprint, orderId: <pre-generated ObjectId>, expiresAt }`. A concurrent duplicate gets a write conflict or duplicate key error and retries; on retry, step 2 finds the committed record.
4. Load the products; each must be `isActive: true`, otherwise `409 PRODUCT_UNAVAILABLE`.
5. For each line: `updateOne({ _id, isActive: true, stock: { $gte: qty } }, { $inc: { stock: -qty } })`. Zero matches → re-read the product to choose between `OUT_OF_STOCK` and `PRODUCT_UNAVAILABLE`, then abort.
6. Compute the money (§1.1) and insert the order with the pre-generated `_id`.

The stock update in step 5 writes the product document, and so does deactivation (§7.3). A concurrent checkout and deactivation therefore conflict, and exactly one serializes first.

### 7.3 Product and category deactivation (F06, R01, R05)

- **Product delete** = `findOneAndUpdate({ _id }, { $set: { isActive: false, deletedAt: now } })` in a transaction that, if the product was active, also runs `categories.updateOne({ _id: categoryId }, { $inc: { activeProductCount: -1 } })`. Already inactive → no change, same `200` response. No hard delete exists in the API. Ordered and unordered products are treated the same.
- **Product reactivation** (`PATCH isActive: true`) follows the §7.5 rule for joining a category.
- **Category delete** = `findOneAndUpdate({ _id, isActive: true, activeProductCount: 0 }, { $set: { isActive: false, deletedAt: now } })`. No match because of the count → `409 CATEGORY_HAS_ACTIVE_PRODUCTS`. Already inactive → `200`, idempotent.

### 7.4 Order status transitions and cancellation (R02)

Allowed transitions: `pending→confirmed|cancelled`, `confirmed→shipped|cancelled`, `shipped→delivered`. A customer may only do `pending→cancelled` on their own order.

```
withTransaction:
  order = orders.findOneAndUpdate(
     { orderNumber, status: { $in: allowedFrom(target) }, [userId if customer] },
     { $set: { status: target }, $push: { statusHistory: { status: target, at, by } } },
     { returnDocument: 'after' })
  if !order → re-read: missing/not owner → 404; else 409 INVALID_STATUS_TRANSITION {currentStatus}
  if target == 'cancelled':
     for item in order.items: products.updateOne({ _id: item.productId, stock: { $lte: 1000000 - item.quantity } }, { $inc: { stock: item.quantity } })
       no match → abort with 409 STOCK_CONFLICT (only possible if an admin set stock near the 1,000,000 cap)
```

Stock is restored only by the transaction whose conditional update matched. Two concurrent cancellations (or a cancel and a confirm) both write the order document, so one retries, its filter no longer matches, and it returns `409`. Restoration ignores `isActive`, so inactive products still get their stock back.

### 7.5 Product ↔ category coordination (R05)

Any product write that makes a product active in a category (create with `isActive:true`, reactivation, or a `categoryId` change while active) runs in a transaction that also does:

- `categories.updateOne({ _id: newCategoryId, isActive: true }, { $inc: { activeProductCount: 1 } })`. No match → `409 CATEGORY_UNAVAILABLE`, and the transaction aborts.
- For a move or deactivation: `$inc: { activeProductCount: -1 }` on the old category.

Because both this path and category deactivation (§7.3) write the category document, they serialize. A product can never become active in an inactive category, and a category can't be deactivated while it has active products. Category slug or name changes touch only the category, since products store only `categoryId`. `npm run db:verify` recomputes `activeProductCount` and reports drift; CI runs it after the seed and integration tests.

### 7.6 Replica set and Atlas limitations

- Transactions require a **replica set or sharded cluster**. Atlas clusters, including the free **M0**, are 3-node replica sets. A standalone local `mongod` does **not** support transactions, so local development uses the Docker single-node replica set from DEPLOYMENT_DESIGN §2 (or an Atlas dev cluster), and tests use `MongoMemoryReplSet`.
- Atlas **M0/Flex limits** to plan for: shared throughput caps, a connection limit (pool `maxPoolSize: 10`), 512 MB storage on M0, no managed backups on M0 (DEPLOYMENT_DESIGN §7), and some operators such as `$where` and server-side JavaScript are unavailable. Check current Atlas docs at setup time, because tier limits change.
- Default transaction lifetime limit is 60 s. Ours are far shorter.
- Without transactions the policies above don't hold, so the API refuses to start unless `hello` reports a replica set (`setName` present).

## 8. Seeding and migration

- `npm run db:migrate` → creates the collections, applies validators (`collMod`) and indexes, including the `idempotencyKeys` TTL index.
- `npm run db:seed` → idempotent upsert by `sku`/`slug`: ≥ 8 categories, **≥ 30 products** spread across them (realistic generic names; no real trademarks needed), with `activeProductCount` computed from the seeded products, plus one admin account whose email and password come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (never hardcoded).
- `npm run db:verify` → checks the `activeProductCount` invariants and the BSON `int` types (`$type`).
- A CI integration test asserts `products.countDocuments({isActive:true}) >= 30` after seeding (REQ-B02 traceability).
