# ADR-002: Data Consistency and Concurrency Policies

- Status: **Proposed**. Pending team approval (AGENTS.md requires team approval for significant architecture changes). Revised in M1-005 (Codex M1-004), M1-007 (Codex M1-006) and M1-009 (Codex M1-008).
- Date: 2026-11-15
- Resolves: F01, F02, F03, F05, F06, R01, R02, R03, R04, R05 (M1-002); N02, N03, N04, N05, N06 (M1-004); G01, G02, G03, G04 (M1-006); R1, R2 (M1-008)

## Context

The M1-002 audit found that several write paths could race with checkout (admin stock edits, product deletion, cancellation, category changes), that idempotency and validation rules contradicted each other, and that the BSON numeric representation was unspecified. MongoDB transactions give snapshot isolation: two transactions that **write the same document** conflict and one retries, but **reads take no locks**, so a "check then write different document" pattern can still race (write skew). Each policy below therefore makes competing operations write a shared document, or avoids the race entirely.

## Decisions

| # | Policy | Mechanism (details in DATABASE_DESIGN §7) |
|---|---|---|
| D1 | **Inventory revision on every stock mutation; admin changes relative or revision-preconditioned** (F01, N02, G04) | `products.inventoryRevision` is a BSON `long` (int64), never reset, exposed in the API as a decimal string. It is incremented by every write that changes `stock` (checkout, cancellation, `stockAdjust`, `stockSet`). Admins use `stockAdjust` (atomic `$inc`) or `stockSet` with `expectedRevision`; the filter matches the revision, not the stock value, so any intervening change, including one that returns stock to the same number, yields `409 STOCK_CONFLICT`. Plain `stock` is not accepted in PATCH. |
| D2 | **Idempotency via an expiring record written in the checkout transaction** (F02) | Collection `idempotencyKeys`, unique `(userId, key)`, SHA-256 fingerprint of the normalized request, 24 h retention. Same key + same fingerprint → replay the original order. Same key + different fingerprint → `422 IDEMPOTENCY_KEY_REUSED`. Concurrent duplicates collide on the unique index, so only one commits. `withTransaction` retries only transient errors; duplicate-key errors, unresolved commit results and exhausted retries are handled **outside** the aborted transaction. Each attempt is Committed, Not committed or **Unknown**; an absent key record never proves failure. Unknown → bounded majority-read reconciliation → `201`/`200`/`422`, else `503 CHECKOUT_RETRY` ("outcome unknown"), never a business error (G01). **Expiry (R1):** replay is guaranteed for 24 h after commit. A key (UUID v7) can create an order only within 24 h of its issue time, and `orders` keeps the key under a permanent unique `(userId, idempotencyKey)` index. After the window a key returns `409`/`422 IDEMPOTENCY_KEY_EXPIRED` and never creates a new order. Clients with an unresolved checkout older than 23 h reconcile via `GET /api/orders?idempotencyKey=` and require explicit user review. |
| D3 | **Strict validation everywhere** (F03) | Every Zod object schema (body, query, params, nested) uses `.strict()`. Unknown keys → `400 VALIDATION_ERROR`. Nothing is stripped silently. Mongoose `strict: 'throw'` is a second line of defense. |
| D4 | **Normalize, then validate cart lines** (F05) | Duplicate `productId` lines are summed first. The merged quantity must be 1–10, and there can be at most 20 distinct products. The same function serves quote and checkout. |
| D5 | **Products and categories are never hard-deleted through the API** (F06, R01) | `DELETE` means deactivate (`isActive:false`, `deletedAt`). It is idempotent: 200 with the same body when already inactive, 404 when missing. Checkout's stock update filters on `isActive: true` and writes the same product document as deactivation, so the two conflict and serialize. An order can never reference a missing product. |
| D6 | **Status transitions are conditional writes** (R02) | Every order status change, cancellation included, uses `findOneAndUpdate({ _id, status: { $in: allowedFrom } })` inside a transaction. Stock is restored only by the transaction whose update matched. Concurrent requests conflict on the order document; a retried request is re-evaluated against the new status, so any serializable sequence may succeed (e.g. `pending→confirmed→cancelled`) while a now-invalid one gets `409 INVALID_STATUS_TRANSITION`. Tests accept every serializable outcome and assert at most one restoration (N05). |
| D7 | **Integer money and stock stay within int32** (R03, N04) | All money and stock values are bounded so every stored value, sum included, fits BSON `int` (≤ 2,147,483,647). Validators accept `int` only. The order total is capped at 1,000,000,000 satang (฿10 M). Each arithmetic step asserts `Number.isSafeInteger` and the cap. Stock has an **admin cap** of 1,000,000 that applies only to admin increases; cancellation restores are exempt from it. The int32 hard limit **can** block a cancellation: the restore is conditional on `stock <= 2147483647 - qty`, and if that fails the transaction aborts with `409 INVENTORY_LIMIT` (order and stock unchanged, no unit discarded) until an admin lowers stock. `inventoryRevision` is int64, so it doesn't share this limit (G04). |
| D8 | **CSRF token bound to the session and rotated on regeneration** (R04) | `GET /api/auth/csrf` creates an anonymous session holding a token. Login and register require that token, then regenerate the session with a new token and return it in the response body. Logout destroys the session, so the client must fetch a new token. |
| D9 | **Category reference by id, with a counter for coordination** (R05) | Products store `categoryId` only; `categorySlug` was removed. The `?category=<slug>` filter resolves to an id first. Categories are flat, with no `parentId`, so cycles are impossible. Each category keeps `activeProductCount`, updated in the same transaction as any product change that affects it. Deactivating a category is conditional on `activeProductCount: 0` and has **one** write path (DELETE); category PATCH rejects `isActive`, and reactivation is a separate idempotent operation (N06). Making a product active in a category requires `isActive: true` on the category. Both paths write the category document, so they serialize. Inactive products may reference inactive categories but cannot be reactivated until the category is active. Product **creation** is a separate insert-if-absent `createProduct` (never reads a before-state; counter `+1` only if actually inserted, R2). Product **updates**, including combined category + activation changes, go through one transition computed from the persisted before-state and the after-state (G03). |
| D10 | **Insert-only, repeatable seeding** (G02) | The seed uses `$setOnInsert` only and creates products through the same transition as the API, incrementing category counters only for documents it actually inserted. It never modifies existing products, categories or users. Counter repair is a separate transactional maintenance command, and destructive reset is restricted to dev/test databases. |

## Alternatives rejected

| Alternative | Reason |
|---|---|
| Optimistic `__v` version on every product edit | Fixes F01 but makes every price or description edit conflict with checkout; `inventoryRevision` (D1) versions only stock. |
| `expectedStock` value precondition | Misses intervening changes that return stock to the same value (ABA problem, M1-004 N02). |
| Hard stock ceiling on cancellation restore | Can block a valid cancellation after a restock to the cap (M1-004 N04). |
| Relying on `withTransaction` to replay duplicate keys | It retries only labelled transient errors; duplicate key aborts (M1-004 N03). |
| Category `isActive` editable via PATCH | Second deactivation path that could bypass the counter guard (M1-004 N06). |
| Treating an absent key record as "not committed" | The commit may be unapplied or not yet majority-visible (M1-006 G01). |
| Upsert-with-`$set` seeding | Can reset stock, revision and counters on rerun (M1-006 G02). |
| int32 `inventoryRevision` | Shares the stock limit and could block cancellation (M1-006 G04). |
| Rejecting combined category + activation PATCH | Workable, but one before/after transition is simpler for clients and equally safe (M1-006 G03). |
| Keys reusable after 24 h | Lets an unresolved checkout create a duplicate order after expiry (M1-008 R1). Now superseded: keys are retired, not reused. |
| Server-issued keys (extra endpoint) | Equally safe, but adds a round trip and a key-issuing state machine; UUID v7 age plus the unique `orders` index gives the same guarantee. |
| Hard delete when a product has no orders | Needs cross-collection coordination with checkout (write skew). Soft delete is simpler and keeps history. |
| Category hierarchy | Not an assignment requirement; it adds cycle prevention and recursive queries. Deferred as REQ-F07. |
| `Decimal128` or `long` for money | Needs conversion layers in JS; int32 bounds are ample for a peripheral store. |

## Consequences

- Admin UI must send `expectedRevision` (the revision it displayed) for absolute corrections, and offer "add/remove N" as the default.
- One extra collection (`idempotencyKeys`) and one counter field (`categories.activeProductCount`). A maintenance script `db:verify` recomputes counters and reports drift.
- Clients must create a UUID v7 idempotency key (server-adjusted time) per checkout attempt, reuse it on retries within 23 h, and reconcile via `GET /api/orders?idempotencyKey=` after that.
- The "deleted" products list for admins is a filter (`isActive=false`).
