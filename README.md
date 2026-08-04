# Senditto Database Studio

Standalone operator console for the **Senditto product** PostgreSQL database.

This project is **completely separate** from the Senditto Platform (email product UI).

## Security

- **Never display server IPs, public hosts, or raw API endpoints in the UI.**
- Connection details live only in local env / operator secrets (not committed).
- `.env.local` is gitignored.

## Production

Set these environment variables for the API service (e.g. via a root-only
`EnvironmentFile` — see `deploy/server-setup.sh`):

```
SEED_DEMO=0            # seed only the owner account, no demo data
OWNER_EMAIL=...        # real owner login
OWNER_PASSWORD=...     # real owner password (never commit this)
```

With `SEED_DEMO=0` the database starts with a single owner account and empty
collections. The demo accounts below exist **only** in local dev mode.

## Run (full local stack)

```bash
npm install

# 1. Start the local dev API (seeded, DEV ONLY — port 5181)
npm run api

# 2. In another terminal, start the studio (port 5180)
npm run dev
```

Create `.env.local` (not committed):

```
VITE_DB_API_BASE=http://localhost:5181
VITE_DEFAULT_EMAIL=owner@senditto.dev
VITE_DEFAULT_PASSWORD=senditto-owner
```

Open `http://localhost:5180` and sign in with the dev owner account above.

## Local dev API (`server/`)

`server/index.mjs` is a zero-dependency Node server that implements the full
Senditto control-plane contract the studio expects — auth + sessions, `/api/stats`,
`/api/db/realtime` (SSE), Postgres-style table introspection, and CRUD for users,
workspaces, domains, API keys, messages, suppressions, audit, rights requests,
contacts, templates, campaigns, webhooks, internal messages and both role
matrices. State persists to `server/data/db.json` (gitignored) and is seeded
with realistic sample data on first boot.

It is the **executable specification** for the production backend
(Node + PostgreSQL) — same routes, same payloads, real database behind it.
Grant-role and matrix edits accept any 6-digit code in dev.

## Pages

- **Core** — Overview (live stats + SSE feed), Tables (schema explorer)
- **Platform** — User workspaces, Users, Matrix (platform roles), Workspace roles,
  Domains, API keys, Messages
- **Product** — Contacts, Templates, Campaigns, Webhooks, Operator inbox
- **Compliance** — Suppressions (incl. “record user opt-out” support flow),
  Audit log, Rights requests
- **Ops** — Server health, Sessions, Settings (theme, refresh interval)
