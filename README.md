# Exhibit A

An agency intelligence workspace where good ideas come with receipts.

- [Product requirements](docs/PRD.md)
- [Technical requirements](docs/TRD.md)
- [Design guidelines](docs/design-guidelines.md)

## Layout

```text
apps/web          Next.js interface and thin API proxy (Vercel)
apps/api          Fastify API, background jobs, tools (Railway)
packages/contracts  Shared Zod schemas
packages/database   SQL migrations and Postgres access (Neon, no ORM)
fixtures          Fictional clients and evaluation cases
```

## Local development

Requires Node 22+ and pnpm 11 (`corepack enable` or `npm i -g pnpm@11.9.0`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in Neon, OpenRouter, and a random proxy secret
cp apps/web/.env.example apps/web/.env.local   # use the same BACKEND_PROXY_SECRET
pnpm migrate
pnpm dev     # API on :8080, web on :3000
```

Checks (run locally before pushing; there is no CI): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Deployment: Vercel (root `apps/web`) and Railway (repo root, see `railway.json`) both deploy directly from GitHub pushes.

Never commit real credentials. Only `.env.example` files are tracked.
