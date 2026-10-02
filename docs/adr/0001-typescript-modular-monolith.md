# ADR 0001: A TypeScript modular monolith on Next.js

Date: 2026-10-02 · Status: accepted

## Context

The product brief preferred a Python/FastAPI backend with PostgreSQL/PostGIS, Redis, a job queue and Google OR-Tools, behind a Next.js frontend. The repository had already been set up as a Next.js + Prisma application intended for deployment on Vercel with a Supabase database. The two could not both be kept.

## Decision

Keep a single TypeScript codebase: Next.js for both UI and REST API, Prisma on PostgreSQL, domain logic in `modules/`. No Redis, no broker, no worker in the MVP.

## Consequences

Good:

- One runtime, one deployable, one language. Validation schemas and types are shared by API and UI.
- Runs as a container (`docker compose up`) or serverless.
- Fewer moving parts for a small operator to run.

Bad:

- **No OR-Tools.** Route optimization is an in-house insertion + local-search heuristic. It handles capacity, precedence and time windows and is tested, but it will be outperformed by a real solver on large or tightly constrained problems.
- **No background worker.** Work that should happen on a schedule (stale-tender checks, lost-signal detection, webhook retries) either runs lazily on read or is not built.
- **PostGIS is not used.** Coordinates are plain columns; Prisma has no native geometry support.
- Serverless deployment limits request duration, which caps how large an optimization can run in a request.

## How to reverse or extend

- The optimizer is one pure function (`optimize(problem)`). A solver service in any language can replace it behind the same input and output.
- Modules do not import from the HTTP layer, so a module can be moved behind a network boundary.
- A worker can be added as a second process that imports the same modules.
