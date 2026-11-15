# IT Peripheral Store

A responsive e-commerce web application for IT peripherals, built as a university team project covering:

- **Project A — Startup Landing Page** (Bootstrap landing page, features, About Team page, social links, resume links)
- **Project B — Database & Big Data** (MongoDB-backed store with customer/admin roles, product CRUD, search and filtering, cart and persisted orders)

## Status

Architecture and design phase (M1) complete. Application code has not been scaffolded yet.

## Planned stack

React + Bootstrap · Node.js + Express · MongoDB Atlas (Mongoose) · Zod · REST API with server-side sessions. See [ADR-001](docs/decisions/ADR-001-TECH_STACK.md).

## Documentation

| Document | Purpose |
|---|---|
| [System requirements](docs/requirements/SYSTEM_REQUIREMENTS.md) | Assignment requirements, roles, business rules |
| [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md) | Modular monolith layout and layering |
| [Database design](docs/architecture/DATABASE_DESIGN.md) | MongoDB collections, indexes, transactions |
| [API contracts](docs/architecture/API_CONTRACTS.md) | REST endpoints and authorization |
| [Security model](docs/architecture/SECURITY_MODEL.md) | Threat model and controls |
| [Deployment design](docs/architecture/DEPLOYMENT_DESIGN.md) | Environments, configuration, backups |
| [Handoffs](docs/handoffs/) | Task handoff notes |

## Team

| Member | Resume |
|---|---|
| Sirapat Chuaysong | https://nussirapat.github.io/My_Resume/ |
| CHONTIDAPORN BOONBANJOB | https://slowlifejg-star.github.io/Punch_Resume/ |
| NATTAWU TSAEDIAW | https://nussirapat.github.io/Resume_Nattawut/ |
| THAKSIN SAARDAIAM | https://jamethaksin.github.io/resume/ |

## Contributing

Work happens on `feature/*` branches and lands in `main` through pull requests. Read [AGENTS.md](AGENTS.md) before contributing. Never commit secrets: copy `.env.example` (added in M0) to `.env` locally.
