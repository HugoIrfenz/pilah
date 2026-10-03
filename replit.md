# PILAH

A single-owner personal WhatsApp priority inbox: “Don't read everything. Know what needs you.”

## Run & Operate

- Use managed workflows `artifacts/api-server: API Server` and `artifacts/pilah: web`; do not start duplicate servers or sockets.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle), Baileys server-only and externalized

## Where things live

- `lib/api-spec/openapi.yaml` — API contract; regenerate rather than editing generated hooks/schemas.
- `lib/pilah-core` — shared deterministic demo/live normalization and priority engine.
- `lib/db/src/schema/pilah.ts`, `lib/db/drizzle` — schema and migrations.
- `artifacts/api-server/src/lib/pilah` — encrypted storage, auth store, connector, lifetime control.
- `artifacts/pilah/src` — frontend; `README.md` has operation and verification details.

## Architecture decisions

- One owner/account, no public registration, no automation/chatbot/CRM/extra integrations.
- The demo is public and synthetic, with no live API calls, event streams, credentials or persistence.
- Rules are the functional baseline. Never label output AI unless a configured provider actually ran, with separate explicit live-text opt-in.
- Linking grants full linked-device access; application chat selection is not a WhatsApp permission boundary.
- WhatsApp pairing is enabled only on the published website (`PILAH_LIVE_RUNTIME=production`), not Preview, at the user's request. Development and production have separate databases; never copy live credentials between them.

## Product

Connect, choose chats, then inspect Read now / Read later / Low priority with exact source context. Important and reviewed are local preferences, not read receipts.

## User preferences

- This is a hackathon prototype. The user explicitly wants QR-only sign-in: no password screen, password setup, or manual encryption-key generation.
- The normal starting dashboard comes before demo or WhatsApp connection. Use the user's PILAH hero reference for this public home page; keep both entry points explicit and preserve the inbox UI.
- Successful phone pairing authorizes only the initiating browser. Keep other browsers out of live data; bind re-pairing to the original WhatsApp account.
- Follow the user's attached WhatsApp-style reference: green identity, warm paper, side navigation, chat list, messages and priority insights. No generic dashboard or AI chat bubble.
- Do not send messages, read receipts, presence, reactions or chat-management actions.
- Preserve all owner replies; a single reply must not resolve unrelated outstanding requests.
- Retain at most 50 messages per selected chat within 7 days; never persist/analyze unselected bodies, disappearing or view-once content.
- Pairing requires a human scan. Report live-account verification separately; never claim production-ready or ban-proof.
- Prepare a long-running backend for Reserved VM; no deployment purchase or publishing without approval.

## Gotchas

- Read installed Baileys v7 exports/types before modifying the adapter; don't mix older examples.
- Test storage only in an isolated schema. Never point full-erasure tests at application tables.
- `push` initialized development; initial migrations apply to fresh databases, not existing tables.
- Keep secrets and private message/QR/auth payloads out of source, frontend storage, URLs and logs.
- Managed encryption derives separate server keys from the stable session secret. Preserve existing dedicated-key installs; changing encryption source requires a migration.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
