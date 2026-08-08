# Plan vs Actual Tracker

Monthly spending targets vs actuals, with variance reporting, CSV import and locked periods.

**Live URL:** _(added on deploy)_

| Demo login          | Password         | What it shows                                                            |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `demo@example.com`  | `review-me-2026` | The assignment's sample table, a locked January, an unbudgeted Tools row |
| `other@example.com` | `tenant-b-2026`  | A second tenant — different categories, January _not_ locked             |

Sign in as each to see tenant isolation: same database, no shared row, and the same month locked for one user and open for the other.

**Stack:** Next.js 16.3 App Router · React 19.2 · Node 24 · TypeScript 5.9 strict · MongoDB 8 + Mongoose 9 · Zod 4 · Auth.js 5 (credentials + bcryptjs 3, JWT cookie) · Tailwind v4 + shadcn/ui · TanStack Table / Query / Form / Virtual / Pacer · Recharts 3 · pino 10 · Vitest 4 + mongodb-memory-server 11 · deployed on Vercel + MongoDB Atlas M0 (free tier), Docker image for any container host.

## Prerequisites and setup

Node 24 (`.nvmrc`) and Docker. `docker-compose.yml` brings up the database, so no Atlas account is needed to review this.

```bash
npm ci
docker compose up -d mongo     # local MongoDB 8, single-node replica set
cp .env.example .env.local     # the MONGODB_URI in it already points at that container
                               # then set AUTH_SECRET: openssl rand -base64 32
npm run seed                   # both demo accounts + the assignment's sample data (idempotent)
npm run dev                    # http://localhost:3000
```

It is a **single-node replica set**, not a standalone `mongod`, because the CSV commit runs in a transaction and Mongo only offers those on a replica set. The health check performs the one-time `rs.initiate`, so there is no second command to forget. From the host the connection string needs `directConnection=true` — the set advertises itself as `mongo:27017`, which only resolves inside the compose network.

`docker compose up --build` runs the app too, in the same multi-stage production image any container host takes. Point `MONGODB_URI` at Atlas instead and nothing else changes.

## Deploying

Free tier, two accounts, no credit card: **Vercel Hobby** runs the app, **Atlas M0** stores the data.

```bash
npx vercel login && npx vercel link
npx vercel env add MONGODB_URI production   # the Atlas connection string
npx vercel env add AUTH_SECRET production   # openssl rand -base64 32
npx vercel --prod
MONGODB_URI='mongodb+srv://…/pva' npm run seed
```

`next.config.mjs` drops `output: "standalone"` when `VERCEL` is set, and `src/lib/db.ts` shrinks the connection pool to 3 with no idle sockets — a wide pool per function instance is how a 500-connection M0 cluster runs out. `infra/README.md` has the Atlas setup, the CI-gated deploy, and an honest list of what free tier gives up (no PITR backup, `0.0.0.0/0` network access, cold starts, a 60s function ceiling).

One command verifies everything, and it is the only thing CI runs before it is allowed to deploy:

```bash
npm run check     # typecheck + eslint + prettier --check + vitest
```

`npm run format` fixes what `format:check` flags; `prettier-plugin-tailwindcss` sorts Tailwind classes, so class order stops being a review topic.

## Tests

`npm test` (Vitest, real mongod via `mongodb-memory-server` — the first run downloads the binary). 55 tests, 8 files.

| File                                             | Proves                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `tests/report.sample.test.ts`                    | The PDF's exact table: −200/−4.00%, +500/+2.50%, −5,000/−100%, −200/−1.00%                                                      |
| `tests/variance.test.ts`                         | plan = 0, missing actual, unbudgeted spend, minor-unit totals, accounting formatting                                            |
| `tests/locking.test.ts`                          | `PERIOD_LOCKED` is enforced in the domain layer, not by hiding a button                                                         |
| `tests/importCsv.test.ts`                        | Bad month, unknown category, locked-month row, bad header, blank lines, commit atomicity                                        |
| `tests/scoping.test.ts` · `tests/routes.test.ts` | User B cannot list, read, report on or delete user A's rows; every route's status envelope                                      |
| `tests/security.test.ts`                         | The hardening below, each test named for the attack it closes                                                                   |
| `tests/indexes.test.ts`                          | `explain("executionStats")` on the repo's own queries: `IXSCAN` on `{userId, month, categoryId}`, keys examined ≈ rows returned |

The index test exists because that second Plan index is the one thing that rots silently. The unique `{userId, categoryId, month}` cannot serve the report — `categoryId` sits between the equality and the month range, so Mongo walks every key the tenant owns while still reporting `IXSCAN`. `{userId, month, categoryId}` turns the range back into an index bound and puts the group key in the index; the test asserts the index _by name_ and counts keys, so reordering it fails here rather than in production.

## Security

Nothing below was added by weakening anything above it; `tests/security.test.ts` asserts each one.

- **CSP** in `next.config.mjs` — `default-src 'self'` holds because the app has no third-party origin at all (`next/font` self-hosts, Recharts draws inline SVG).
- **Timing-safe sign-in** — an unknown email is compared against a fixed dummy hash, so a miss costs the same bcrypt round as a wrong password and the form is not a user-enumeration oracle.
- **Rate limiting** — `src/lib/ratelimit.ts`, ten tries per address per 15 minutes, checked before the database is touched; a successful sign-in re-opens the window.
- **`sanitizeFilter`** — set at module scope in `src/lib/db.ts`, so `{$ne: null}` arriving as a value is wrapped in `$eq` and matches nothing. The two deliberate month-range filters mark themselves with `mongoose.trusted()`.
- **1 MB body guard** and **`cache-control: no-store` + `x-request-id`** on every response — all three live in the one `withRoute` wrapper in `src/lib/route.ts`, not in each handler.

## API surface

Money in responses is **integer minor units**; requests take major units (`amount: 5000` = 5,000.00). Every error is the one envelope from `src/lib/errors.ts`.

| Method + path               | Request                                | 200 response                                                    |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `GET /api/categories`       | —                                      | `{ categories: [{ _id, name }] }`                               |
| `POST /api/categories`      | `{ name }`                             | `{ category }`                                                  |
| `PUT /api/plans`            | `{ categoryId, month, amount }`        | `{ plan }`                                                      |
| `DELETE /api/plans`         | `{ categoryId, month }`                | `{ deleted }`                                                   |
| `GET /api/actuals`          | `?month=&categoryId=` (both optional)  | `{ actuals }`                                                   |
| `POST /api/actuals`         | `{ categoryId, month, amount, note? }` | `{ actual }`                                                    |
| `DELETE /api/actuals/:id`   | —                                      | `{ deleted: 1 }`                                                |
| `GET /api/report`           | `?from=&to=` (YYYY-MM)                 | `{ rows, totals, lockedMonths }`                                |
| `GET /api/locks`            | `?from=&to=`                           | `{ lockedMonths: string[] }`                                    |
| `POST /api/locks`           | `{ month }`                            | `{ month, lockedAt }`                                           |
| `DELETE /api/locks/:month`  | —                                      | `{ month, unlocked: true }`                                     |
| `POST /api/imports/preview` | `{ csv }`                              | `{ results, okCount, errorCount }` — nothing written            |
| `POST /api/imports/commit`  | `{ csv }`                              | `{ committed, importBatchId, results }` — 422 if any row is bad |
| `GET /api/health`           | —                                      | `{ ok, db, version }` — the deploy health check                 |

Codes → status: `VALIDATION_FAILED` 422 · `PERIOD_LOCKED` 409 · `UNKNOWN_CATEGORY` 422 · `DUPLICATE_PLAN` 409 · `UNAUTHORIZED` 401 · `NOT_FOUND` 404.

## Variance % when plan is zero

`variance = actual − plan` (negative = under plan = favourable). When `plan === 0`, `variancePct` is **`null`** — never `NaN`, never `Infinity` — and the UI renders `—`. The rule lives in one pure function, `variancePct()` in `src/lib/variance.ts`, and is unit-tested there. Nothing else in the codebase divides by a plan.

## Locking behavior and granularity

Granularity is **one month per user** (`periodLocks` is unique on `{userId, month}`). One guard, `assertPeriodUnlocked()` in `src/domain/locking.ts`, is called from every mutating path: plan upsert, plan delete, actual create, actual delete, and CSV commit (once per distinct month in the batch). The UI also disables locked controls, but the API is the enforcement point:

```
$ curl -i -X PUT https://<app>/api/plans -b cookies.txt \
    -H 'content-type: application/json' \
    -d '{"categoryId":"6797a1c0f3b2a41d9c0e5511","month":"2026-01","amount":5000}'

HTTP/1.1 409 Conflict
content-type: application/json

{"error":{"code":"PERIOD_LOCKED","message":"2026-01 is locked. Unlock the period before editing.","details":{"month":"2026-01"}}}
```

The frontend renders `message` verbatim next to a lock badge — one wording, one source. Unlock with `DELETE /api/locks/2026-01` and the same request succeeds.

## How missing actuals are displayed

A category×month with a plan and no actuals is treated as **actual = 0** everywhere — in the row, in the totals, and in the chart — so the sample data's Feb Marketing row reads −5,000 / −100%. The row also carries `hasActuals: false`, which the UI shows as a _hollow_ variance bar plus text (never colour alone), so "spent nothing" is visibly different from "we have no data". The symmetric case — an actual with no plan (unbudgeted spend, seeded as the Tools row) — falls out of the report's `$unionWith` for free and is flagged `hasPlan: false`; its variance % is `null` by the same zero-plan rule.

## Project structure

Every rule has exactly one implementation, imported everywhere it is needed: `src/lib/money.ts` (minor units + accounting display) · `month.ts` (`YYYY-MM` logic, no `Date`, no timezones) · `variance.ts` (the math, pure) · `errors.ts` (`AppError` + `toResponse`, the only producer of the envelope) · `route.ts` (the wrapper: auth, logging, body limit, headers) · `src/domain/models.ts` (schemas and every index) · `repo.ts` (`ScopedRepo`) · `locking.ts` (the guard) · `report.ts` (the one `$unionWith`) · `importCsv.ts` (preview / transactional commit) · `schemas.ts` (Zod = validation **and** the types).

Route handlers hold no business logic — parse, guard, call the domain, return.

## Design and client architecture

`design/prototype.html` is the visual contract; the deliberate deviations are listed at the end of `frontend-plan.md` §11. The UI is **shadcn/ui** (`src/components/ui/`, style `radix-nova`, Radix primitives, lucide icons) with `src/app/globals.css` binding shadcn's semantic tokens to the ledger palette — so Table, Card, Alert, Badge, Select and the rest come out in the product's voice instead of being imitated with utility classes.

The client machinery is TanStack: **Table** drives `DataTable` (opt-in sorting, virtualised rows for the CSV preview), **Query** owns every mutation through the one `useApiMutation` hook, **Form** owns field state and validates with the server's own Zod schemas via Standard Schema, **Virtual** renders the preview, **Pacer** debounces the plans-grid cell save and the import paste box. **Reads stay in React Server Components** — they go straight to the domain layer, which is one hop fewer than a client round-trip; `router.refresh()` after a successful mutation re-renders the server tree. Router, Start, DB, Store and Ranger are deliberately not used: each replaces something this app already has (Next's App Router, the server as source of truth, Query + React state, a calendar rather than a slider).

## Assumptions and tradeoffs

- **Tenant isolation is structural, not disciplinary.** `ScopedRepo` takes the `userId` in its constructor; the raw Mongoose models are never exported past the domain layer, so a handler _cannot_ forget the filter. `tests/scoping.test.ts` proves it rather than claiming it.
- **Many actual entries per category×month**, not one aggregate row — that is how bookkeeping actually arrives, and the report aggregates anyway. Drill-down comes free.
- **Category CRUD is create + list.** Rename/delete are out of scope (a delete would need a policy for orphaned plans and actuals, which the brief does not ask for).
- **Auth is email + password only** — no reset, no verification, no roles. The brief says that is sufficient, so the time went into authorization instead.
- **CSV import needs a replica set** because the commit is a transaction. Atlas is one by default; a bare local `mongod` is not — hence the `--replSet` flag in `docker-compose.yml`.
- **Money is integer minor units end to end.** Nothing but `src/lib/money.ts` converts, and the UI never does arithmetic — it renders numbers the server computed.
- Sized for one bookkeeper's ledger, not a data warehouse: ranges are capped at 10 years and an unfiltered actuals read is capped at 500 rows.

## What I'd improve before production

Idempotency keys on `POST /api/imports/commit` so a retried upload cannot double-post · an append-only audit log for lock, plan and actual changes (who closed January, and when) · the rate limiter behind a shared store, since today's counter is per-instance and resets on deploy · a per-request CSP nonce instead of `'unsafe-inline'` on scripts · secret rotation (Vercel's env store holds them unrotated today) · Atlas M10+ with continuous backup and a rehearsed restore drill (M0 has no PITR) · index review against real query distributions rather than assumed ones · a narrowed Atlas network allowlist once there are static egress IPs (Hobby has none, so it is open to `0.0.0.0/0` today) · Terraform for the console steps in `infra/README.md` · an E2E smoke test in CI against the deployed URL.

## Decisions

| Decision                                        | Why                                                                                                                       | Tradeoff                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Integer minor units                             | Exact sums, no float drift                                                                                                | One conversion boundary to police (`toMinor`/`toMajor`)                                                              |
| `YYYY-MM` string month keys                     | Lexicographic order = chronological; `$gte/$lte` ranges; zero timezone bugs                                               | Not a `Date` in the DB, so no day-level reporting later without a migration                                          |
| Month-level locks                               | One guard function; matches the sample data and the brief                                                                 | No quarter or year locks — would need a period→months mapping for no rubric payoff                                   |
| Missing actual = 0                              | Totals, rows and chart stay internally consistent                                                                         | Feb Marketing reads −100%, which needs the `hasActuals` flag to stay honest                                          |
| Many actuals per cell                           | Matches real bookkeeping; drill-down is free                                                                              | The report must aggregate — it does, in one pipeline                                                                 |
| Unbudgeted spend surfaced (`hasPlan: false`)    | Actual-with-no-plan is the edge case the spec did not test, and the one a finance reviewer cares about                    | An extra flag through the row type and the UI                                                                        |
| `PUT /api/plans` upsert instead of POST + PUT   | One idempotent endpoint for "set this cell"; retries are safe                                                             | No 201-vs-200 distinction                                                                                            |
| Two-phase CSV (preview → commit)                | Turns "upload and pray" into a reviewable diff; locked rows rejected before anything is written                           | Commit re-validates, so the file is parsed twice                                                                     |
| `ScopedRepo` over per-handler filters           | Isolation cannot be forgotten by construction                                                                             | Every new query goes through the repo, even one-offs                                                                 |
| Second Plan index `{userId, month, categoryId}` | The unique index cannot bound the report's month range; this one can                                                      | One extra index on the collection's cheapest writes                                                                  |
| shadcn/ui over hand-rolled class recipes        | Real components bring focus management, ARIA and keyboard behaviour that utility classes only imitate                     | Generated code lives in the repo and is ours to maintain                                                             |
| TanStack for client machinery only              | Query/Form/Table/Virtual/Pacer each replace code we would otherwise hand-roll and get subtly wrong                        | Five small libraries instead of none; reads deliberately stay in RSC                                                 |
| Vercel + Atlas M0 over a cloud account          | Free forever at this size, HTTPS and CI-gated deploys with no bill and no credit card; the Dockerfile still runs anywhere | Cold starts, a 60s function ceiling, no PITR backup, and Atlas open to `0.0.0.0/0` — all listed in `infra/README.md` |
