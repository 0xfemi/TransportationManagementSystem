# Testing

```bash
docker compose up -d db     # tests need PostgreSQL
npm test
```

Integration tests run against the database in `TEST_DATABASE_URL` and **wipe it at the start of every run**. The setup refuses any database whose name does not contain "test".

## What exists

| Layer | Where | What it proves |
|---|---|---|
| Unit | `tests/unit/optimizer.test.ts` | Route constraints: pickup before delivery, weight/volume capacity never exceeded, capacity reused after a drop, time windows honoured, waiting for a window, unassignable orders reported with a reason, priority, cheaper vehicle chosen for cost, determinism, better than entry order |
| Unit | `tests/unit/domain.test.ts` | Distance maths, freight rating (itemisation, minimum charge, repeatability), role permissions, ETA projection and delay calculation, time-zone day bounds |
| Integration | `tests/integration/flow.test.ts` | The release's 19 success criteria end to end through the real route handlers and database, plus multi-order planning, tender rejection, cancellation, document upload checks and search |
| Integration | `tests/integration/security.test.ts` | Authentication, tenant isolation (read, write, cross-tenant ids, tracking), role enforcement, immediate effect of role changes, last-admin protection, CSRF, API keys and revocation, login rate limiting, validation, SQL metacharacters |

Integration tests call the exported route handlers with real `NextRequest` objects. That exercises authentication, authorization, validation, services and SQL together, without a running server.

## What does not exist yet

- **Browser end-to-end tests.** The UI was checked by loading every page in a headless browser against seeded data and looking for console and network errors, but that check is not an automated test in this repository.
- **Load tests** for tracking ingestion.
- **Tests against a live OSRM server.** The OSRM provider is untested.
- **Docker image test in CI.**

## Principles

- Test behaviour a user or integrator depends on, not implementation details.
- Every bug fix in domain logic comes with a test that fails without the fix.
- Constraint logic (optimizer, rating, state transitions) is tested as pure functions wherever possible.
- No coverage target; a meaningful assertion beats a covered line.
