# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability). Include what you found, how to reproduce it and what an attacker could do with it. You will get an acknowledgement, and credit in the fix's release notes if you want it.

## Security model

### Tenancy

Every business record carries an `organizationId`. Every query made on behalf of a caller is filtered by the caller's organization, which comes from their verified session or API key and never from the request. A record in another organization is indistinguishable from one that does not exist (`404`). Ids supplied in a request body (a customer on an order, a vehicle on a plan) are checked to belong to the caller's organization before use.

This is enforced in application code and verified by `tests/integration/security.test.ts`. It is **not** additionally enforced by database row-level security; anyone deploying against a database that other applications can reach should add it.

### Authentication

- **Passwords**: bcrypt, cost 12, minimum 10 characters. Hashes are never returned by the API.
- **Sessions**: an HS256-signed token in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production, valid for 7 days. `AUTH_SECRET` must be at least 32 characters; the app refuses to sign or verify without it.
- **API keys**: 24 random bytes. Only a SHA-256 hash is stored; the key is shown once. Keys can be revoked and take effect immediately.
- **Login** gives the same response and takes similar time for a wrong password and an unknown email, and is rate-limited per IP and email (10 attempts per 15 minutes). Registration is rate-limited per IP.

There is no session revocation list: signing out clears the cookie, but a copied token stays valid until it expires or the member is removed.

### Authorization

Seven roles map to seventeen permissions ([lib/rbac.ts](lib/rbac.ts)); every route names the permission it requires. The role is read from the database on each request, so a role change or removal applies to the person's next request. An organization cannot remove or demote its last admin.

### Request safety

- **Input validation**: every body and query string is parsed by a Zod schema before use; unknown enum values and out-of-range numbers are rejected with field-level errors.
- **SQL injection**: all queries go through Prisma's parameterised API. The one raw query (the rate limiter) uses tagged-template parameters.
- **CSRF**: state-changing requests authenticated by cookie must present an `Origin` matching the host. `SameSite=Lax` is the second layer.
- **File uploads**: 5 MB limit; an allow-list of types (PDF, PNG, JPEG, WebP, TXT, CSV) checked against the file's leading bytes, not just its declared type; file names sanitised; downloads always sent as attachments with `nosniff`, so an uploaded file is never rendered in the app's origin.
- **Headers**: Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff`, a restrictive Permissions-Policy and Referrer-Policy on every response ([next.config.js](next.config.js)). The CSP allows inline scripts and styles, which Next.js and the map library currently need; tightening it with nonces is open work.
- **Open redirects**: the post-login `next` parameter is only followed when it is a same-site path.

### Audit

Changes to operational and administrative records are written to an audit log with actor, time, before/after values and reason. The application has no endpoint that edits or deletes audit entries, tracking events or domain events.

### Secrets

Secrets come from environment variables. `.env` is git-ignored; `.env.example` contains no real values. The demo seed refuses to run with `NODE_ENV=production` unless explicitly overridden, because it creates accounts with a known password.

## Known gaps

- No row-level security in the database (see above).
- No multi-factor authentication, password reset flow or OIDC.
- No session revocation before expiry.
- The CSP permits `unsafe-inline` and `unsafe-eval`.
- Rate limiting covers login and registration only, not the API as a whole.
- Uploaded files are not scanned for malware.
- Encryption in transit and at rest is the deployer's responsibility (TLS termination, database encryption).
- **The Docker Compose file ships a default `AUTH_SECRET` and database password so it works out of the box. Change both before exposing a deployment to anyone.**
- No independent security review has been done.
