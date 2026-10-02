# Contributing

Thanks for considering it. Bug reports, fixes, tests, documentation and features on the [roadmap](docs/PRODUCT.md#roadmap) are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed before you spend time on it.
- Set up locally with [DEVELOPMENT.md](DEVELOPMENT.md).

## What a good pull request looks like

- One change, explained: what it does and why.
- Tests for new behaviour, and for any bug fixed in domain logic.
- `npm run typecheck`, `npm test` and `npm run build` all pass.
- New endpoints are added to `lib/openapi.ts`; new resources get a tenant-isolation test.
- No placeholder features. If a button is on screen, it works. If a number is on screen, it comes from the database. Simulated or estimated values are labelled.
- User-facing text is plain and specific: say what happened and what to do next.

## Ground rules

- **Clean-room.** Do not contribute anything taken from proprietary logistics software: code, database schemas, screens, documentation or distinctive terminology. See [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md).
- **Security issues** go through private reporting, not public issues. See [SECURITY.md](SECURITY.md).
- By contributing you agree your contribution is licensed under the [Apache License 2.0](LICENSE).
- Be decent to each other. See the [Code of Conduct](CODE_OF_CONDUCT.md).
