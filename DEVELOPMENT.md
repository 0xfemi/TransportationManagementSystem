# Development

## Setup

Requires Node 20 or newer and Docker.

```bash
cp .env.example .env
# set AUTH_SECRET in .env:  openssl rand -hex 32
docker compose up -d db
npm install
npx prisma db push
npm run db:seed        # optional: NorthStar Distribution demo data
npm run dev            # http://localhost:3000
```

The database listens on host port **5433** (not 5432, to avoid clashing with a local PostgreSQL). Change it with `DB_PORT`.

Integration tests need a second database:

```bash
docker compose exec db psql -U tms -d tms -c "CREATE DATABASE tms_test"
```

## Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | All tests (wipes the test database) |
| `npm run typecheck` | TypeScript only |
| `npm run db:push` | Apply `prisma/schema.prisma` to the database |
| `npm run db:seed` | Load demo data (no-op if already loaded) |
| `npx prisma studio` | Browse the database |

To start again from an empty database: `npx prisma db push --force-reset`.

## Where things go

- A new endpoint: a route file under `app/api/v1/`, wrapped in `api(permission, handler)` from `lib/http.ts`. Validate input with a schema in `lib/schemas.ts`, call a function in `modules/`, and add the operation to `lib/openapi.ts`.
- Domain rules: `modules/<area>/`. Keep calculation code free of database access so it can be unit-tested.
- Anything a browser imports must not pull in server code. Shared constants live in `lib/constants.ts`.
- Every query must filter by `organizationId`. Add a case to `tests/integration/security.test.ts` for any new resource.
- A state change that matters to operations should write an audit entry (`audit`) and, if integrations would care, a domain event (`emitEvent`), in the same transaction.

## Configuration

See `.env.example`. Notable settings:

- `ROUTING_PROVIDER=osrm` with `OSRM_URL` for road distances instead of straight-line estimates.
- `NEXT_PUBLIC_MAP_TILE_URL` to use a different map tile source. Check the usage policy of whichever source you use; the public OpenStreetMap tile servers are not meant for heavy production traffic.

## Deploying

**Container:** `docker compose up` builds the image, applies the schema, optionally seeds, and serves on port 3000.

**Vercel + Supabase:** set `DATABASE_URL` (transaction pooler, port 6543), `DIRECT_URL` (session pooler, port 5432) and `AUTH_SECRET` in the Vercel project, then apply the schema once from your machine with `DIRECT_URL` pointing at the Supabase database: `npx prisma db push`. The build does not change the database schema.
