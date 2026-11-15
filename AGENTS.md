# AGENTS.md — Shared AI Development Rules

These rules apply to every AI agent (Claude, Codex, Copilot, etc.) and human contributor working in this repository.

## Source of truth

1. Read the relevant docs before changing code:
   - Requirements and business rules: `docs/requirements/SYSTEM_REQUIREMENTS.md`
   - Architecture: `docs/architecture/`
   - Decisions: `docs/decisions/`
2. University assignment requirements (labelled **[A]**) must not be removed or weakened.
3. Significant architecture changes need a new ADR in `docs/decisions/` and team approval.

## Git workflow

- Never push directly to `main`. Work on `feature/<task-id>-<short-name>` branches and open a pull request.
- Never force push to shared branches, rewrite `main` history, or merge your own PR without review.
- Keep commits focused on the task; do not modify unrelated files.
- Each task ends with a handoff file: `docs/handoffs/<TASK-ID>.md` (status, files changed, commands run with real results, known issues, PR link).

## Security rules

- Never commit secrets, credentials, tokens or real connection strings. Use environment variables; `.env.example` lists names only.
- The frontend must never connect to MongoDB or receive its connection string. Only `VITE_*` variables reach the browser, and they must never hold secrets.
- Enforce authentication and authorization in the API, never only in the UI. Admin operations require `role=admin` on the server.
- Validate all input on the server with the shared Zod schemas; reject unknown fields.
- The server computes all prices and totals; never trust client-supplied money values.
- Every write to stock, order status, product/category activation or idempotency records must follow the concurrency policies in `docs/decisions/ADR-002-DATA_CONSISTENCY.md` and `docs/architecture/DATABASE_DESIGN.md` §7 (conditional writes in transactions; no unconditional stock overwrite; no hard delete).
- Store money as integer satang. Store passwords only as Argon2id/bcrypt hashes.
- Products come from the database via the API; never hardcode products in the frontend.
- Do not deploy to production or modify other repositories.

## Quality rules

- Follow the layering: routes → controllers → services → repositories → models.
- Add or update tests with every behaviour change, including an authorization test for new endpoints.
- Run install, lint, typecheck, test and build before handing off. Report actual results only; never claim a check passed unless it ran and passed.
- Keep documentation concise and avoid duplicating content across documents.

## Asking for approval

Proceed with routine decisions. Stop and ask a human for destructive actions, significant architecture or scope changes, credentials that need user action, or any production deployment.
