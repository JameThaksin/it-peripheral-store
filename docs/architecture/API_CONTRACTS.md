# API Contracts — IT Peripheral Store

Status: Draft v1 (M1-001). Base path `/api`. JSON only. Schemas live in `packages/shared/src/schemas` and are the source of truth; tables below summarise them.

## 1. Conventions

| Topic | Rule |
|---|---|
| Content type | `application/json; charset=utf-8`. Bodies > 100 kb rejected (`413`). |
| Auth | Session cookie `itps.sid` (HttpOnly, Secure in non-local, SameSite=Lax). See [SECURITY_MODEL.md](SECURITY_MODEL.md). |
| CSRF | All state-changing requests (`POST/PUT/PATCH/DELETE`) require header `X-CSRF-Token` matching the session token from `GET /api/auth/csrf`. |
| Success envelope | `{ "data": <object|array>, "meta"?: {...} }` |
| Error envelope | `{ "error": { "code": "STRING_CODE", "message": "human text", "details"?: [...], "requestId": "uuid" } }` |
| Money | Integer satang (`priceSatang`, `totalSatang`). Clients format for display. |
| IDs | 24-hex ObjectId strings; invalid → `400 INVALID_ID` |
| Unknown fields | Rejected on write (`.strict()`) → `400 VALIDATION_ERROR` |
| Versioning | Unversioned in v1; breaking changes require `/api/v2` |

### 1.1 Pagination, filtering, sorting

Query: `page` (int ≥ 1, default 1), `limit` (1–50, default 12 public / 20 admin), `sort` from an allowlist.

```json
{ "data": [ ... ], "meta": { "page": 1, "limit": 12, "total": 34, "totalPages": 3 } }
```

Offset pagination is acceptable at this scale (≤ thousands of docs). All filter values are parsed by Zod into primitives before reaching a query, so `?price[$gt]=0` style operator injection is impossible.

### 1.2 Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod failure; `details` = `[{path, message}]` |
| 400 | `INVALID_ID` | Bad ObjectId |
| 401 | `UNAUTHENTICATED` | No / expired session |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (same message for both) |
| 403 | `FORBIDDEN` | Role not allowed or not owner |
| 403 | `CSRF_INVALID` | Missing/wrong CSRF token |
| 404 | `NOT_FOUND` | Resource missing **or** not visible to caller (avoid ID probing) |
| 409 | `EMAIL_TAKEN`, `SKU_TAKEN`, `SLUG_TAKEN` | Unique conflicts |
| 409 | `OUT_OF_STOCK` | `details` = `[{productId, requested, available}]` |
| 409 | `PRODUCT_UNAVAILABLE` | Inactive / deleted product in cart |
| 409 | `INVALID_STATUS_TRANSITION` | Order status rule violated |
| 409 | `PRODUCT_HAS_ORDERS` | Hard delete blocked (BR-10) |
| 423 | `ACCOUNT_LOCKED` | Too many failed logins |
| 429 | `RATE_LIMITED` | Rate limit hit; `Retry-After` header |
| 500 | `INTERNAL_ERROR` | Unexpected; no internals leaked |

## 2. Endpoint index

| Method | Path | Auth | Purpose | Req |
|---|---|---|---|---|
| GET | `/api/health` | – | Liveness + DB ping (no details) | E |
| GET | `/api/auth/csrf` | – | Issue CSRF token | E |
| POST | `/api/auth/register` | – | Create customer | E01 |
| POST | `/api/auth/login` | – | Start session | B06 |
| POST | `/api/auth/logout` | session | End session | B06 |
| GET | `/api/auth/me` | session | Current user | B05 |
| PATCH | `/api/users/me` | customer/admin | Update own name/phone/addresses | E |
| PATCH | `/api/users/me/password` | customer/admin | Change password | E |
| GET | `/api/categories` | – | Active categories | B04 |
| GET | `/api/products` | – | List/search/filter active products | B03, B04 |
| GET | `/api/products/featured` | – | Featured products for landing | A07 |
| GET | `/api/products/:slug` | – | Product detail | B03 |
| POST | `/api/cart/quote` | – | Price a cart (server prices, stock check) — no persistence | B08 |
| POST | `/api/orders` | customer/admin | Checkout | B08, B09 |
| GET | `/api/orders` | customer/admin | Own orders | E02 |
| GET | `/api/orders/:orderNumber` | owner or admin | Order detail | E02 |
| POST | `/api/orders/:orderNumber/cancel` | owner (if `pending`) | Cancel own order | E |
| GET | `/api/admin/products` | admin | All products incl. inactive | B07 |
| POST | `/api/admin/products` | admin | Create | B07 |
| GET | `/api/admin/products/:id` | admin | Read | B07 |
| PATCH | `/api/admin/products/:id` | admin | Update | B07 |
| DELETE | `/api/admin/products/:id` | admin | Delete (soft if ordered) | B07 |
| GET/POST | `/api/admin/categories` | admin | List / create | E03 |
| PATCH/DELETE | `/api/admin/categories/:id` | admin | Update / delete (blocked if products) | E03 |
| GET | `/api/admin/orders` | admin | All orders, filter by status | E04 |
| GET | `/api/admin/orders/:orderNumber` | admin | Detail | E04 |
| PATCH | `/api/admin/orders/:orderNumber/status` | admin | Change status | E04 |
| GET | `/api/admin/audit-logs` | admin | Admin action log | E08 |

## 3. Contracts

### 3.1 Auth

**POST `/api/auth/register`** — rate limited (5/hour/IP)

```json
// request
{ "email": "a@example.com", "password": "correct horse battery 9", "name": "A Customer" }
// 201
{ "data": { "id": "…", "email": "a@example.com", "name": "A Customer", "role": "customer" } }
```

Rules: email lowercased, ≤ 254; password 10–128 chars, rejected if in a small common-password list; `role` not accepted (strict schema). Session is started on success (session ID regenerated). `409 EMAIL_TAKEN` on duplicate.

**POST `/api/auth/login`** — rate limited (10/15 min per IP+email)

```json
// request
{ "email": "a@example.com", "password": "…" }
// 200
{ "data": { "id": "…", "email": "a@example.com", "name": "A Customer", "role": "customer" } }
```

`401 INVALID_CREDENTIALS` (generic), `423 ACCOUNT_LOCKED` after 5 consecutive failures (15 min lock). Session ID regenerated on login.

**POST `/api/auth/logout`** → `204`. Destroys server session, clears cookie.

**GET `/api/auth/me`** → `200 { data: User }` or `401`.

### 3.2 Catalog

**GET `/api/products`**

| Query | Type | Notes |
|---|---|---|
| `q` | string 1–100 | Text search (name, brand, tags, description) |
| `category` | slug | Filter by `categorySlug` |
| `minPrice`, `maxPrice` | int satang | Range |
| `inStock` | `true` | Only `stock > 0` |
| `sort` | `newest` \| `price_asc` \| `price_desc` \| `name_asc` \| `relevance` | `relevance` only with `q` |
| `page`, `limit` | int | See §1.1 |

```json
{
  "data": [
    { "id": "…", "slug": "tkl-mechanical-keyboard-red-switch", "name": "TKL Mechanical Keyboard (Red Switch)",
      "brand": "GenericBrand", "categorySlug": "keyboards", "priceSatang": 189000, "currency": "THB",
      "inStock": true, "image": { "url": "/images/products/kb-mech-tkl-01.webp", "alt": "TKL mechanical keyboard" } }
  ],
  "meta": { "page": 1, "limit": 12, "total": 34, "totalPages": 3 }
}
```

List items expose `inStock` (bool), not exact stock. Inactive products return `404` on detail for non-admins.

**GET `/api/products/:slug`** → full product: adds `description`, `images[]`, `specs[]`, `stock` (capped display e.g. `"stock": 25`), `category {slug,name}`.

**GET `/api/categories`** → `[{ id, name, slug, description, productCount }]`.

### 3.3 Cart and checkout

The cart lives in the browser. Prices shown in cart and checkout always come from the server.

**POST `/api/cart/quote`**

```json
// request
{ "items": [ { "productId": "6740…720", "quantity": 2 } ] }
// 200
{ "data": {
  "items": [ { "productId": "6740…720", "name": "TKL Mechanical Keyboard (Red Switch)", "unitPriceSatang": 189000,
               "quantity": 2, "lineTotalSatang": 378000, "available": true } ],
  "subtotalSatang": 378000, "shippingFeeSatang": 0, "totalSatang": 378000, "currency": "THB" } }
```

**POST `/api/orders`** — requires session + CSRF; rate limited (20/hour/user)

```json
// request
{
  "items": [ { "productId": "6740…720", "quantity": 2 } ],
  "shippingAddress": { "recipient": "A Customer", "line1": "99 Example Rd.", "district": "Pathum Wan",
                       "province": "Bangkok", "postalCode": "10330", "phone": "0800000000" },
  "note": "Please call before delivery",
  "idempotencyKey": "6f1c6d6e-3c1e-4a8e-9b5b-0b9b3d7a2c11"
}
// 201
{ "data": { "orderNumber": "ORD-20261114-7K2M9Q", "status": "pending", "items": [ … ],
            "subtotalSatang": 378000, "shippingFeeSatang": 0, "totalSatang": 378000, "currency": "THB",
            "createdAt": "2026-11-14T06:10:00Z" } }
```

Schema: `items` 1–20, `quantity` int 1–10, duplicates merged; **no price, total, status or userId fields accepted**. Same `idempotencyKey` within 24 h returns the original order with `200`. Errors: `409 OUT_OF_STOCK`, `409 PRODUCT_UNAVAILABLE`.

**GET `/api/orders`** → own orders, newest first, paginated; summary fields only.
**GET `/api/orders/:orderNumber`** → `404` if not owner (and not admin).
**POST `/api/orders/:orderNumber/cancel`** → only while `pending`; restores stock in a transaction.

### 3.4 Admin

All `/api/admin/*` routes: `requireAuth` → `requireRole('admin')` → CSRF (writes) → validate. Every write creates an `auditLogs` entry.

**POST `/api/admin/products`**

```json
{
  "sku": "KB-MECH-TKL-01", "slug": "tkl-mechanical-keyboard-red-switch",
  "name": "TKL Mechanical Keyboard (Red Switch)", "brand": "GenericBrand",
  "description": "87-key tenkeyless mechanical keyboard…", "categoryId": "6740…710",
  "priceSatang": 189000, "compareAtPriceSatang": 219000, "stock": 25,
  "images": [ { "url": "/images/products/kb-mech-tkl-01.webp", "alt": "TKL mechanical keyboard" } ],
  "specs": [ { "key": "Switch", "value": "Linear Red" } ], "tags": ["mechanical"],
  "isActive": true, "isFeatured": false
}
```

→ `201 { data: Product }`. `slug` auto-generated from name if omitted. `categorySlug`, `currency`, `createdBy` are server-set (not accepted). `409 SKU_TAKEN | SLUG_TAKEN`.

**PATCH `/api/admin/products/:id`** — partial of the same schema. Stock changes via PATCH set an absolute value (admin restock); concurrent checkout uses atomic `$inc`, so admins should prefer `stockAdjust` (`{"stockAdjust": 10}` → `$inc`, result must stay ≥ 0).

**DELETE `/api/admin/products/:id`** → `204`. If the product appears in any order → sets `isActive:false` and returns `200 { data: { softDeleted: true } }`.

**GET `/api/admin/orders`** — query `status`, `q` (orderNumber or customer email), `from`, `to`, paging.

**PATCH `/api/admin/orders/:orderNumber/status`**

```json
{ "status": "confirmed", "note": "Stock checked" }
```

Allowed transitions (BR-07): `pending→confirmed|cancelled`, `confirmed→shipped|cancelled`, `shipped→delivered`. Otherwise `409 INVALID_STATUS_TRANSITION`. Cancellation restores stock.

## 4. Authorization matrix (enforced in API)

| Route group | Guest | Customer | Admin |
|---|:-:|:-:|:-:|
| `/auth/register`, `/auth/login`, catalog, `/cart/quote` | ✓ | ✓ | ✓ |
| `/auth/me`, `/auth/logout`, `/users/me*` | 401 | ✓ self | ✓ self |
| `/orders*` | 401 | ✓ own only | ✓ own (all via admin) |
| `/admin/*` | 401 | 403 | ✓ |

Ownership is enforced in the repository query (`{ orderNumber, userId: session.userId }`) rather than by fetching then comparing, so a missed check cannot leak data.
