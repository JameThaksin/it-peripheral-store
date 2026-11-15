# ADR-001: Technology Stack and Architecture Style

- Status: **Accepted as the M2 baseline** by the project owner (M1-003, 2026-11-15); formal sign-off by all four team members pending
- Date: 2026-11-14 (updated 2026-11-15)
- Task: M1-001, amended by M1-003 (R06)

## Context

The team (4 members) must deliver two university projects in one codebase: a Bootstrap startup landing page (Project A) and a MongoDB-backed IT peripheral store with customer/admin roles, product CRUD, search/filter, cart and persisted orders (Project B). The brief proposes React, Bootstrap, Node/Express, MongoDB Atlas, Mongoose, REST, server-side sessions, Zod, and a modular monolith. Bootstrap and MongoDB are assignment-mandated; the rest are proposals.

Constraints: student team, local-first development, free tiers, need for readable code that an independent reviewer (Codex) can audit, and strong security defaults.

## Decision

| Area | Decision | Mandated? |
|---|---|---|
| Architecture | Modular monolith: one SPA + one Express API, npm workspaces monorepo | Proposed, accepted |
| Frontend | React 18/19 + Vite + React Router + Bootstrap 5 (`react-bootstrap`) + TanStack Query | Bootstrap mandated |
| Backend | Node.js 22 LTS + Express 5 | Proposed, accepted |
| Language | **TypeScript** in all workspaces | Change from brief (unspecified) — see below |
| Database | MongoDB Atlas; Docker single-node replica set locally (DEPLOYMENT_DESIGN §2) | MongoDB mandated |
| Hosting topology | **Single same-origin Node service** serving SPA + `/api` (DEPLOYMENT_DESIGN §3); provider still open | Engineering (M1-003) |
| Consistency policies | See [ADR-002](ADR-002-DATA_CONSISTENCY.md) | Engineering (M1-003) |
| ODM | Mongoose 8 with `strict`, `sanitizeFilter` | Proposed, accepted |
| API style | REST + JSON, envelope `{data}` / `{error}` | Proposed, accepted |
| Auth | `express-session` + `connect-mongo`, HttpOnly cookie, CSRF synchronizer token | Proposed, accepted |
| Passwords | Argon2id (`argon2`); bcrypt cost 12 as fallback | Engineering |
| Validation | Zod schemas in `packages/shared`, used by API and web | Proposed, accepted |
| Money | Integer satang (THB × 100) | Engineering |
| Testing | Vitest (unit), Supertest + mongodb-memory-server (integration), Playwright (E2E) | Proposed, accepted |
| Logging | pino with redaction | Engineering |
| CI | GitHub Actions: lint, typecheck, test, build, audit, gitleaks | Engineering |

## Rationale and changes from the brief

1. **TypeScript instead of plain JavaScript.** Shared Zod schemas give inferred types to both web and API, catching contract drift at compile time. Cost: small learning curve. If the course requires plain JS, keep Zod + JSDoc and drop the `tsc` step; no architecture change.
2. **Server-side sessions instead of JWT.** Revocable (logout, lock, role change take effect immediately), no token storage in `localStorage` (XSS-safe), simpler to reason about. Cost: session store in MongoDB and CSRF protection required; both are designed in.
3. **Integer satang instead of Decimal128.** Exact arithmetic in JS without a decimal library, trivial validation, consistent across API and UI.
4. **Modular monolith instead of microservices.** One deployable, one DB, transactions across products and orders; module boundaries keep it splittable later.
5. **Native MongoDB text index instead of Atlas Search.** Works locally and on M0; Atlas Search remains a future option.
6. **Browser cart instead of server cart.** Satisfies "cart or purchase" with fewer moving parts; prices are always recomputed on the server, so no integrity loss. Server cart is REQ-F02.

## Alternatives considered

| Option | Why not (for v1) |
|---|---|
| Next.js full-stack | Mixes SSR concerns, less aligned with "React + Express" brief, harder separation for grading |
| JWT in `localStorage` | XSS exposure, hard revocation |
| Native MongoDB driver (no ODM) | More boilerplate for schema/validation; Mongoose is the brief's choice and familiar |
| Joi / Yup | Zod has better TS inference and works in browser + Node |
| Separate repos for web and api | Duplicated schemas and CI; brief asks for single workspace |

## Consequences

- Local MongoDB must run as a replica set for transactions (`docker-compose.yml` and steps in DEPLOYMENT_DESIGN §2).
- `argon2` needs a native build; Windows team members may need build tools, hence bcrypt fallback.
- Same-origin hosting is **selected** (DEPLOYMENT_DESIGN §3), which rules out split static-host + API-host setups such as GitHub Pages.
- All new endpoints must add a Zod schema in `packages/shared` and an authorization test.

## Open items

- Formal team sign-off (TypeScript confirmed as baseline by the project owner).
- Hosting provider for staging/production (topology fixed).
- Confirm against the original assignment PDFs (not available during M1-001).
