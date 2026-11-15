# ADR-002: Data Consistency and Concurrency Policies

- Status: **Accepted** for the M2 baseline (from M1-003 remediation of the Codex M1-002 audit)
- Date: 2026-11-15
- Resolves: F01, F02, F03, F05, F06, R01, R02, R03, R04, R05

## Context

The M1-002 audit found that several write paths could race with checkout (admin stock edits, product deletion, cancellation, category changes), that idempotency and validation rules contradicted each other, and that the BSON numeric representation was unspecified. MongoDB transactions give snapshot isolation: two transactions that **write the same document** conflict and one retries, but **reads take no locks**, so a "check then write different document" pattern can still race (write skew). Each policy below therefore makes competing operations write a shared document, or avoids the race entirely.

## Decisions

| # | Policy | Mechanism (details in DATABASE_DESIGN §7) |
|---|---|---|
| D1 | **Stock changes are relative or preconditioned** (F01) | Admins change stock with `stockAdjust` (atomic `$inc`, result ≥ 0) or with an absolute `stockSet` that requires `expectedStock`; the update filter includes `stock: expectedStock`, and a mismatch returns `409 STOCK_CONFLICT`. Plain `stock` is not accepted in PATCH. |
| D2 | **Idempotency via an expiring record written in the checkout transaction** (F02) | Collection `idempotencyKeys`, unique `(userId, key)`, SHA-256 fingerprint of the normalized request, 24 h retention. Same key + same fingerprint → replay the original order. Same key + different fingerprint → `422 IDEMPOTENCY_KEY_REUSED`. Concurrent duplicates collide on the unique index inside the transaction, so only one commits. After expiry the key is new again. `orders` no longer stores the key. |
| D3 | **Strict validation everywhere** (F03) | Every Zod object schema (body, query, params, nested) uses `.strict()`. Unknown keys → `400 VALIDATION_ERROR`. Nothing is stripped silently. Mongoose `strict: 'throw'` is a second line of defense. |
| D4 | **Normalize, then validate cart lines** (F05) | Duplicate `productId` lines are summed first. The merged quantity must be 1–10, and there can be at most 20 distinct products. The same function serves quote and checkout. |
| D5 | **Products and categories are never hard-deleted through the API** (F06, R01) | `DELETE` means deactivate (`isActive:false`, `deletedAt`). It is idempotent: 200 with the same body when already inactive, 404 when missing. Checkout's stock update filters on `isActive: true` and writes the same product document as deactivation, so the two conflict and serialize. An order can never reference a missing product. |
| D6 | **Status transitions are conditional writes** (R02) | Every order status change, cancellation included, uses `findOneAndUpdate({ _id, status: { $in: allowedFrom } })` inside a transaction. Stock is restored only by the transaction whose update matched. Concurrent requests conflict on the order document, and the loser gets `409 INVALID_STATUS_TRANSITION`. |
| D7 | **Integer money and stock stay within int32** (R03) | All money and stock values are bounded so every stored value, sum included, fits BSON `int` (≤ 2,147,483,647). Validators accept `int` only. The order total is capped at 1,000,000,000 satang (฿10 M). Each arithmetic step asserts `Number.isSafeInteger` and the cap. |
| D8 | **CSRF token bound to the session and rotated on regeneration** (R04) | `GET /api/auth/csrf` creates an anonymous session holding a token. Login and register require that token, then regenerate the session with a new token and return it in the response body. Logout destroys the session, so the client must fetch a new token. |
| D9 | **Category reference by id, with a counter for coordination** (R05) | Products store `categoryId` only; `categorySlug` was removed. The `?category=<slug>` filter resolves to an id first. Categories are flat, with no `parentId`, so cycles are impossible. Each category keeps `activeProductCount`, updated in the same transaction as any product change that affects it. Deactivating a category is conditional on `activeProductCount: 0`, and assigning a product requires `isActive: true` on the category. Both paths write the category document, so they serialize. |

## Alternatives rejected

| Alternative | Reason |
|---|---|
| Optimistic `__v` version on every product edit | Fixes F01 but makes every price or description edit conflict with checkout; D1 targets only stock. |
| Permanent idempotency keys on `orders` | Simple, but conflicts with the 24 h promise, and keys pile up forever. |
| Hard delete when a product has no orders | Needs cross-collection coordination with checkout (write skew). Soft delete is simpler and keeps history. |
| Category hierarchy | Not an assignment requirement; it adds cycle prevention and recursive queries. Deferred as REQ-F07. |
| `Decimal128` or `long` for money | Needs conversion layers in JS; int32 bounds are ample for a peripheral store. |

## Consequences

- Admin UI must send `expectedStock` (the value it displayed) for absolute corrections, and offer "add/remove N" as the default.
- One extra collection (`idempotencyKeys`) and one counter field (`categories.activeProductCount`). A maintenance script `db:verify` recomputes counters and reports drift.
- Clients must create a UUID v4 idempotency key per checkout attempt and reuse it on retry.
- The "deleted" products list for admins is a filter (`isActive=false`).
