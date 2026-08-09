# Plan vs Actual Tracker

Monthly spending targets vs actuals, with variance reporting, CSV import and locked periods.

**Live URL:** <https://track-plan-vs-actual.vercel.app> — deployed from [`umeshmalik/plan-vs-actual-tracker`](https://github.com/umeshmalik/plan-vs-actual-tracker) on every push to `main`. Deployment Protection is off, so the link opens straight onto the app's own sign-in; sign in with either account below and everything in this README can be exercised against it. _(If a link ever bounces you to a Vercel sign-in instead, Protection has been re-enabled — see [Deploying](#deploying).)_

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
                               # it reads .env.local only — never .env — so a stray
                               # production URI cannot be what this script resets
npm run dev                    # http://localhost:3000
```

It is a **single-node replica set**, not a standalone `mongod`, because the CSV commit runs in a transaction and Mongo only offers those on a replica set. The health check performs the one-time `rs.initiate`, so there is no second command to forget. From the host the connection string needs `directConnection=true` — the set advertises itself as `mongo:27017`, which only resolves inside the compose network.

`docker compose up --build` runs the app too, in the same multi-stage production image any container host takes. Point `MONGODB_URI` at Atlas instead and nothing else changes.

## Deploying

Free tier, two accounts, no credit card: **Vercel Hobby** runs the app, **Atlas M0** stores the data.

Deploys come from **GitHub, not from a laptop**. The Vercel project is connected to [`umeshmalik/plan-vs-actual-tracker`](https://github.com/umeshmalik/plan-vs-actual-tracker), so:

| Event          | What Vercel does                                           |
| -------------- | ---------------------------------------------------------- |
| push to `main` | builds and promotes to production — nothing is run locally |
| pull request   | builds a preview deployment and comments the URL on the PR |
| anything else  | nothing                                                    |

There is no `vercel.json` and no `.vercel/` in the repo: the project is linked on Vercel's side, and `next.config.mjs` is the only build configuration. The two secrets live in **Vercel → Project → Settings → Environment Variables**, set once through the dashboard for the Production (and Preview) environments:

| Variable      | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `MONGODB_URI` | the Atlas connection string, ending in `/pva`            |
| `AUTH_SECRET` | `openssl rand -base64 32` — different from the local one |

Changing either takes effect on the **next** build, not immediately: redeploy from the Vercel dashboard (or push) after editing them.

The one step that is still local, because Atlas is reachable from anywhere and the seed is a script rather than a route:

```bash
MONGODB_URI='mongodb+srv://…/pva' npm run seed     # idempotent; safe to re-run
```

Then `curl https://track-plan-vs-actual.vercel.app/api/health` → `{"ok":true,"db":"up","version":"dev"}`. (`version` is `dev` because the Git integration builds without setting `GIT_SHA`; the CI deploy job sets it to the commit SHA.)

**Deployment Protection is on by default**, which sends anyone not signed into the Vercel account to Vercel SSO — including a reviewer opening the link. It has been turned off for the URL above (Vercel → Project → Settings → Deployment Protection → **Vercel Authentication: Disabled**), which is the step to repeat on any new project before sharing it. The app's own sign-in is the access control; Vercel's is a second, unrelated gate.

`next.config.mjs` drops `output: "standalone"` when `VERCEL` is set, and `src/lib/db.ts` shrinks the connection pool to 3 with no idle sockets — a wide pool per function instance is how a 500-connection M0 cluster runs out. `infra/README.md` has the Atlas setup, the deploy-gating options and an honest list of what free tier gives up (no PITR backup, `0.0.0.0/0` network access, cold starts, a 60s function ceiling).

### What CI does, and what it does not

One command verifies everything, and GitHub Actions runs it on every push and pull request:

```bash
npm run check     # typecheck + eslint + prettier --check + vitest
```

`npm run format` fixes what `format:check` flags; `prettier-plugin-tailwindcss` sorts Tailwind classes, so class order stops being a review topic.

Be precise about the gate, because the Git integration changes it: **Vercel builds on push without waiting for GitHub Actions**, so a red `npm run check` does not stop a production deploy today — it only turns the commit's check red next to it. Three ways to make tests an actual gate, in ascending order of effort:

1. **Branch protection** — require the `verify` check on `main` and merge through PRs. Nothing lands on `main` unverified, so nothing unverified deploys. Cheapest, and the one that matches the PR-preview workflow above.
2. **Ignored Build Step** — Vercel → Settings → Git → Ignored Build Step, pointed at a command that exits 0 only when the commit's checks passed. Keeps push-to-`main` working.
3. **Deploy from CI instead** — turn auto-deploy off on Vercel and set `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repo secrets; the `deploy` job already in `.github/workflows/ci.yml` `needs: verify` and ships the prebuilt output. Leave the Git integration on as well and both paths deploy the same commit twice.

The `deploy` job is dormant today — the secrets are not set, and the Git integration is doing the deploying.

## Tests

`npm test` (Vitest, real mongod via `mongodb-memory-server` — the first run downloads the binary). 99 tests, 11 files.

| File                                             | Proves                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/report.sample.test.ts`                    | The PDF's exact table: −200/−4.00%, +500/+2.50%, −5,000/−100%, −200/−1.00% — and that the CSV export prints the same figures, quoted and formula-safe                    |
| `tests/variance.test.ts`                         | plan = 0, missing actual, unbudgeted spend, minor-unit totals, accounting formatting in each currency — and that the report's two chart groupings never net a month away |
| `tests/settings.test.ts`                         | The currency preference round-trips, actually lands on the document, and neither header control clobbers the other's field                                               |
| `tests/chartGeometry.test.ts`                    | A stacked segment below the axis draws its full block — recharts hands those back with a negative height, and the naive inset collapsed them to a hairline               |
| `tests/locking.test.ts`                          | `PERIOD_LOCKED` is enforced in the domain layer, not by hiding a button                                                                                                  |
| `tests/importCsv.test.ts`                        | Bad month, unknown category, locked-month row, bad header, blank lines, commit atomicity — plus that a 200-row file costs the same reads as a 2-row one                  |
| `tests/scoping.test.ts` · `tests/routes.test.ts` | User B cannot list, read, report on or delete user A's rows; every route's status envelope; and that a write — only a write — expires that tenant's cached reads         |
| `tests/security.test.ts`                         | The hardening below, each test named for the attack it closes, plus sign-up: address normalising, the duplicate refusal, and the weak-password gate                      |
| `tests/indexes.test.ts`                          | `explain("executionStats")` on the repo's own queries: `IXSCAN` on `{userId, month, categoryId}`, no blocking `SORT`, keys examined ≈ rows returned                      |

The index test exists because that second Plan index is the one thing that rots silently. The unique `{userId, categoryId, month}` cannot serve the report — `categoryId` sits between the equality and the month range, so Mongo walks every key the tenant owns while still reporting `IXSCAN`. `{userId, month, categoryId}` turns the range back into an index bound and puts the group key in the index; the test asserts the index _by name_ and counts keys, so reordering it fails here rather than in production.

Actuals carry only the second of that pair — `{userId, month, categoryId, createdAt}` — and deliberately **no** unique index, because a category and month holds a whole month of spend rather than a single figure (see the decisions below). The fourth key, `createdAt`, is for the sort rather than the filter: `listActuals` orders by `{month, createdAt}` and caps at 500, so without it the read allowed to return 500 rows ends in a blocking `SORT` that buffers all 500 before the limit applies. It is also what puts a busy cell's entries on screen oldest-first for free. `tests/indexes.test.ts` asserts the plan contains no `SORT` stage — drop the key and that line fails while every count still passes. The same test pins the category-only drill-down as a seek, because "add a `{userId, categoryId}` index for it" is the tempting wrong answer: month has a couple of dozen distinct values, so the planner already walks one interval per month.

## Security

Nothing below was added by weakening anything above it; `tests/security.test.ts` asserts each one.

- **CSP** in `next.config.mjs` — `default-src 'self'` holds because the app has no third-party origin at all (`next/font` self-hosts, Recharts draws inline SVG).
- **Timing-safe sign-in** — an unknown email is compared against a fixed dummy hash, so a miss costs the same bcrypt round as a wrong password and the form is not a user-enumeration oracle.
- **Rate limiting** — `src/lib/ratelimit.ts`, ten tries per address per 15 minutes, checked before the database is touched; a successful sign-in re-opens the window.
- **`sanitizeFilter`** — set at module scope in `src/lib/db.ts`, so `{$ne: null}` arriving as a value is wrapped in `$eq` and matches nothing. The two deliberate month-range filters mark themselves with `mongoose.trusted()`.
- **CSV formula injection**, closed in `src/lib/csv.ts` — a category called `=HYPERLINK(…)` is a live formula when the export is opened in Excel, Sheets or Numbers, so a text field opening with `= + - @` is prefixed with an apostrophe. Amounts are exempt by _type_, not by inspection, which is what keeps `-200` an amount.
- **1 MB body guard** and **`cache-control: no-store` + `x-request-id`** on every response — all three live in the one `withRoute` wrapper in `src/lib/route.ts`, not in each handler.

## API surface

Money in responses is **integer minor units**; requests take major units (`amount: 5000` = 5,000.00). Every error is the one envelope from `src/lib/errors.ts`.

| Method + path               | Request                                       | 200 response                                                    |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/categories`       | —                                             | `{ categories: [{ _id, name }] }`                               |
| `POST /api/categories`      | `{ name }`                                    | `{ category }`                                                  |
| `PUT /api/plans`            | `{ categoryId, month, amount }`               | `{ plan }`                                                      |
| `DELETE /api/plans`         | `{ categoryId, month }`                       | `{ deleted }`                                                   |
| `GET /api/actuals`          | `?month=&categoryId=` (both optional)         | `{ actuals }`                                                   |
| `POST /api/actuals`         | `{ categoryId, month, amount, note? }`        | `{ actual }`                                                    |
| `DELETE /api/actuals/:id`   | —                                             | `{ deleted: 1 }`                                                |
| `GET /api/report`           | `?from=&to=` (YYYY-MM)                        | `{ rows, totals, lockedMonths }`                                |
| `GET /api/report/export`    | `?from=&to=` (YYYY-MM)                        | the same rows as `text/csv`, as a download                      |
| `GET /api/locks`            | `?from=&to=`                                  | `{ lockedMonths: string[] }`                                    |
| `POST /api/locks`           | `{ month }`                                   | `{ month, lockedAt }`                                           |
| `DELETE /api/locks/:month`  | —                                             | `{ month, unlocked: true }`                                     |
| `POST /api/imports/preview` | `{ csv }`                                     | `{ results, okCount, errorCount }` — nothing written            |
| `POST /api/imports/commit`  | `{ csv }`                                     | `{ committed, importBatchId, results }` — 422 if any row is bad |
| `GET /api/settings`         | —                                             | `{ fiscalYearStartMonth, currency }`                            |
| `PUT /api/settings`         | `{ fiscalYearStartMonth? }` / `{ currency? }` | the settings after the write                                    |
| `GET /api/health`           | —                                             | `{ ok, db, version }` — the deploy health check                 |

Both settings fields are optional and each header control sends only its own, so the two cannot overwrite one another when two tabs are open. `PUT` re-reads the document it just wrote and fails loudly if the value did not land — Mongoose's `strict` mode drops an update to a path the compiled schema does not know, and it drops it silently, which is a 200 that changes nothing.

Codes → status: `VALIDATION_FAILED` 422 · `PERIOD_LOCKED` 409 · `UNKNOWN_CATEGORY` 422 · `DUPLICATE_PLAN` 409 · `UNAUTHORIZED` 401 · `NOT_FOUND` 404 · `INTERNAL` 500.

Every response carries `cache-control: no-store` and an `x-request-id`; the caching described below is server-side only, so the wire contract is byte-identical to what it was before it existed.

## Caching and read cost

Every read in the app — the four server-rendered screens and the five `GET` routes alike — goes through one module, `src/lib/reads.ts`, so a repeated read is one Mongo round-trip instead of one per render (four tabs on the same range, a `router.refresh()`, the back button, a second device).

**Freshness is a tag, not a timer.** Each entry is tagged `user:<id>` and `cacheLife({ stale: 0, revalidate: Infinity, expire: Infinity })` switches clock-based expiry off entirely. `invalidateReads()` in `src/lib/route.ts` expires that tag once, centrally, whenever a non-`GET` request for that user returns under 400 — so the cache can never hand back a value older than that user's last write, and a route added tomorrow cannot forget to invalidate. `tests/routes.test.ts` asserts both directions: a read never expires the tag, a failed write never expires it, a successful `POST` or `DELETE` always does. The one deliberate false positive is `POST /api/imports/preview`, which writes nothing and still drops the tag — one rebuilt entry on a screen whose whole purpose is to write next, in exchange for a rule with no exceptions.

Two constraints shape the module: a cached function may not read cookies, so the caller passes the `userId` it has already authenticated (`requireRepo()` remains the one door from a session to data, and `userId` is part of every cache key, so one tenant's entry cannot be served to another); and cached values are serialized, so these functions return plain JSON — `ObjectId` → string, `Date` → ISO string — which is exactly what `JSON.stringify` was already doing at the response boundary.

`experimental: { useCache: true }` in `next.config.mjs` turns on the `"use cache"` directive and nothing else. The eventual upgrade is `cacheComponents: true`, but that is not a rename: it also switches the app to partial prerendering, which rejects the `dynamic = "force-dynamic"` on the API routes and wants a Suspense boundary above every page that reads cookies or `searchParams` — here, all of them. Every screen sits behind a session, so there is no static shell to prerender and the migration would buy skeletons, not speed.

**CSV import cost is flat in file size.** Preview used to ask two questions per row — does this category exist, is this month locked — whose answers cannot change mid-file; at the 1 MB body limit that is ~40,000 round-trips to learn two things. Both are read once up front (`repo.categoriesByName()`, `repo.lockedMonths()`), and the commit is one `bulkWrite` inside the transaction instead of an `await` per row, so the transaction holds its locks for a single round-trip. Those writes are upserts, which is what makes re-importing a file land on the same figures rather than doubling the month. `tests/importCsv.test.ts` counts commands off the driver rather than timing them: 200 rows must preview in the same 2 reads as 2 rows, and commit in exactly 1 write command.

## Currency and number formatting

The display currency is a **per-user preference** — the picker sits in the header beside the range picker, and USD, EUR, GBP, INR and AED are supported (`src/lib/currency.ts`). It is a **label, not a conversion**: nothing stored is ever re-valued, there are no FX rates in the product, and the picker says so where it is chosen. Every supported code has exactly two decimal places, which is what leaves the minor-units contract untouched; adding one with a different exponent (JPY has 0, KWD has 3) would change what every integer already in the database means, so it is a migration rather than a new row in that table.

It reaches figures as an explicit `currency` prop — required on `MoneyText` and `VarianceBar`, threaded from each page's `getSettings` — rather than a module-level default in `money.ts`, which would be one process-wide value shared by every tenant. Required, so a display site that forgets it is a compile error rather than another tenant's symbol.

Figures print as `$50,000.00` — symbol, comma groups, dot decimal, negatives in parentheses **around** the symbol (`($200.00)`), which is how a ledger prints a credit. The separator pair is fixed rather than taken from the locale, because the two marks have to be chosen together: de-DE groups with the same dot it uses as a decimal, so borrowing its group mark while keeping the house decimal would print `20.500.00`. What the locale _is_ asked for is where the groups fall, so an INR reader gets `₹20,50,000.00` rather than a figure they have to re-count. The CSV export names the currency in its money **headers** (`Plan (INR)`) instead of printing a symbol per cell, so every amount stays a number a spreadsheet can sum.

## The report's two charts

The report leads with the summary tiles, then the charts, then the ledger — headline, shape, detail.

**Where the variance is** ranks every category in the range by `|variance|`, drawn with the same `VarianceBar` mark the table's variance column uses, so the two read as one chart at two granularities. The table is sorted by category name, which is the one order that hides the biggest miss.

**Variance by month** is a diverging **stacked** bar: one segment per category, over plan stacking up and under plan stacking down. It is deliberately not a net-per-month bar. Netting is lossy in exactly the way that matters here — an overspend and an equal underspend cancel, so a month where two categories both missed badly draws as a month that landed on plan. Stacking keeps the month's gross over and gross under both on screen and leaves the net readable as the distance between the two ends. A month with no plans and no actuals is flagged rather than drawn as a zero, because zero means "landed exactly on plan" and the two must not look alike — the same distinction the rows make with `hasActuals`. `byMonth()` and `byCategory()` in `src/lib/variance.ts` own both groupings, pure and unit-tested beside the rest of the math.

## Variance % when plan is zero

`variance = actual − plan` (negative = under plan = favourable). When `plan === 0`, `variancePct` is **`null`** — never `NaN`, never `Infinity` — and the UI renders `—`. The rule lives in one pure function, `variancePct()` in `src/lib/variance.ts`, and is unit-tested there. Nothing else in the codebase divides by a plan.

## Locking behavior and granularity

Granularity is **one month per user** (`periodLocks` is unique on `{userId, month}`). One guard, `assertPeriodUnlocked()` in `src/domain/locking.ts`, is called from every mutating path: plan upsert, plan delete, actual create, actual delete, and CSV commit (once per distinct month in the batch). The UI also disables locked controls, but the API is the enforcement point:

Signed in as `demo@example.com`, whose January is closed — `cookies.txt` is the jar from the sign-in, and the id comes from `GET /api/categories`, because an unknown category is rejected by `requireCategory()` one line earlier and answers `422 UNKNOWN_CATEGORY` instead:

```
$ curl -i -X PUT https://track-plan-vs-actual.vercel.app/api/plans -b cookies.txt \
    -H 'content-type: application/json' \
    -d '{"categoryId":"6a77980c443dd6363ed7525c","month":"2026-01","amount":5000}'

HTTP/2 409
content-type: application/json

{"error":{"code":"PERIOD_LOCKED","message":"2026-01 is locked. Unlock the period before editing.","details":{"month":"2026-01"}}}
```

The frontend renders `message` verbatim next to a lock badge — one wording, one source. Unlock with `DELETE /api/locks/2026-01` and the same request succeeds.

## How missing actuals are displayed

A category×month with a plan and no actuals is treated as **actual = 0** everywhere — in the row, in the totals, and in the charts — so the sample data's Feb Marketing row reads −5,000 / −100%. The row also carries `hasActuals: false`, which the UI shows as a _hollow_ variance bar plus text (never colour alone), so "spent nothing" is visibly different from "we have no data". The monthly chart carries the same distinction one level up as `hasData`: a month nobody has entered anything for is named in words under the plot and in the chart's accessible summary, never drawn as a zero bar that would read as "on plan". The symmetric case — an actual with no plan (unbudgeted spend, seeded as the Tools row) — falls out of the report's `$unionWith` for free and is flagged `hasPlan: false`; its variance % is `null` by the same zero-plan rule.

## Project structure

Every rule has exactly one implementation, imported everywhere it is needed: `src/lib/money.ts` (minor units + accounting display) · `currency.ts` (the supported currencies, display only) · `month.ts` (`YYYY-MM` logic, no `Date`, no timezones) · `variance.ts` (the math, pure — plus the two groupings the report's charts read) · `errors.ts` (`AppError` + `toResponse`, the only producer of the envelope) · `route.ts` (the wrapper: auth, logging, body limit, headers, cache invalidation) · `reads.ts` (the cached read layer both the screens and the `GET` routes call) · `auth.ts` (`requireRepo`, the one door from a session to data) · `ratelimit.ts` · `range.ts` (`searchParams` → a validated month range) · `db.ts` (connection singleton + `sanitizeFilter`) · `src/domain/models.ts` (schemas and every index) · `repo.ts` (`ScopedRepo`) · `locking.ts` (the guard) · `report.ts` (the one `$unionWith`) · `importCsv.ts` (preview / transactional commit) · `schemas.ts` (Zod = validation **and** the types).

Route handlers hold no business logic — parse, guard, call the domain, return.

## Design and client architecture

`design/prototype.html` is the visual contract; the deliberate deviations are listed at the end of `frontend-plan.md` §11. The UI is **shadcn/ui** (`src/components/ui/`, style `radix-nova`, Radix primitives, lucide icons) with `src/app/globals.css` binding shadcn's semantic tokens to the ledger palette — so Table, Card, Alert, Badge, Select and the rest come out in the product's voice instead of being imitated with utility classes.

The client machinery is TanStack: **Table** drives `DataTable` (opt-in sorting, virtualised rows for the CSV preview), **Query** owns every mutation through the one `useApiMutation` hook, **Form** owns field state and validates with the server's own Zod schemas via Standard Schema, **Virtual** renders the preview, **Pacer** debounces the plans-grid cell save and the import paste box. **Reads stay in React Server Components** — they call `src/lib/reads.ts` directly, which is one hop fewer than a client round-trip and usually zero Mongo round-trips; `router.refresh()` after a successful mutation re-renders the server tree, and the write that preceded it has already expired that tenant's cache tag. Router, Start, DB, Store and Ranger are deliberately not used: each replaces something this app already has (Next's App Router, the server as source of truth, Query + React state, a calendar rather than a slider).

The favicon (`src/app/icon.svg`) is the signature element shrunk to 16px: variance bars on a shared zero axis, in the same three tokens the report uses — chunky bars with the axis on top, because at that size the silhouette is all that survives.

## Assumptions and tradeoffs

- **Tenant isolation is structural, not disciplinary.** `ScopedRepo` takes the `userId` in its constructor; the raw Mongoose models are never exported past the domain layer, so a handler _cannot_ forget the filter. `tests/scoping.test.ts` proves it rather than claiming it.
- **A plan is a cell; spend is a ledger.** Every collection carries a unique index for its own notion of "the same thing twice" — `{userId, normalizedName}` on categories, `{userId, categoryId, month}` on plans, `{userId, month}` on locks, `{email}` on users — and **actuals deliberately carry none**. A category is spent against several times in a month (three ad invoices, two tool renewals), so each spend is its own row with its own note and its own delete, and the report's `$sum` per cell is what adds them up. Correcting a figure is remove-then-log rather than an overwrite, which is why the entries list shows every row and totals them in its footer. The categories index is `partialFilterExpression`-scoped to rows that carry a `normalizedName`, because that collection turned out to be shared with another application whose documents have neither key: they all indexed as null, collided with each other, and aborted the build — which Mongoose swallows, so the app ran with no constraint and nothing on screen to say so.
- **Duplicate protection moved from the database to where duplicates come from.** Losing the unique index means a double-submitted form and a re-uploaded file are no longer caught by Mongo, so each is handled at its own source: the manual form appends a row the user can see and remove, and `commitCsv` derives `importBatchId` as a SHA-256 of the CSV text and clears that batch inside the transaction before writing, so the same file imported twice is imported once. An edited file is a different batch and its unchanged lines are written again — the ceiling, marked `ponytail:` in `importCsv.ts`. One operational note: Mongoose only ever _creates_ the indexes a schema declares and never drops one it stopped declaring, so a database that predates this change keeps the old unique index and the second entry for a cell fails with a duplicate-key error that has no line of code to blame. The deployed cluster has already had it dropped; any other database needs `db.actuals.dropIndex("userId_1_categoryId_1_month_1")` once, by hand — never `syncIndexes()`, which would drop the neighbouring application's indexes too.
- **"Same name" is `repo.normalizeName`, not string equality.** Case, unicode form and runs of whitespace are folded before the unique index sees a category name, so "Marketing", "marketing " and "Marketing Ops" cannot become rows that render identically in every list. One definition, used by category creation and by the CSV import's row lookup.
- **Category CRUD is create + list.** Rename/delete are out of scope (a delete would need a policy for orphaned plans and actuals, which the brief does not ask for).
- **Auth is email + password only** — sign up at `/signup`, sign in at `/login`, and no reset, no verification, no roles. The brief says that is sufficient, so the time went into authorization instead.
- **The password policy is one function, enforced server-side.** `src/lib/password.ts` scores a candidate (length first, character variety as a single bonus, a blocklist of the most-guessed passwords, and a check that the address is not inside its own password), `createUser` refuses anything below "Fair", and the sign-up form's meter renders **the same function** — so the bar the user sees is the bar the server holds. Sign-IN never applies it: an account made under an older policy has to keep working, and refusing at the sign-in form would tell an attacker their guess was well-formed but wrong. Telling a new user "that address already has an account" is a deliberate enumeration leak, rate-limited on the same counter as sign-in; closing it properly needs verification mail, which is out of scope.
- **CSV import needs a replica set** because the commit is a transaction. Atlas is one by default; a bare local `mongod` is not — hence the `--replSet` flag in `docker-compose.yml`.
- **Money is integer minor units end to end.** Nothing but `src/lib/money.ts` converts, and the UI never does arithmetic — it renders numbers the server computed.
- Sized for one bookkeeper's ledger, not a data warehouse: ranges are capped at 10 years and an unfiltered actuals read is capped at 500 rows.
- **The read cache is per-instance by default.** On Vercel the Data Cache is shared, so one instance's `revalidateTag` reaches the rest. Behind a multi-container host it is not: a write served by container A leaves container B's copy in place until B serves a write of its own. The header's Reload button covers that gap by hand today; the fix is a shared cache handler (Redis) the day this runs more than one container.

## What I'd improve before production

Idempotency keys on `POST /api/imports/commit` so a retried upload cannot double-post · an append-only audit log for lock, plan and actual changes (who closed January, and when) · the rate limiter **and** the read cache behind a shared store (Redis), since both are per-instance today — the counter resets on deploy, and a second container would not see the first's `revalidateTag` · a per-request CSP nonce instead of `'unsafe-inline'` on scripts · secret rotation (Vercel's env store holds them unrotated today) · Atlas M10+ with continuous backup and a rehearsed restore drill (M0 has no PITR) · index review against real query distributions rather than assumed ones · a narrowed Atlas network allowlist once there are static egress IPs (Hobby has none, so it is open to `0.0.0.0/0` today) · Terraform for the console steps in `infra/README.md` · an E2E smoke test in CI against the deployed URL.

## Decisions

| Decision                                        | Why                                                                                                                         | Tradeoff                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Integer minor units                             | Exact sums, no float drift                                                                                                  | One conversion boundary to police (`toMinor`/`toMajor`)                                                              |
| `YYYY-MM` string month keys                     | Lexicographic order = chronological; `$gte/$lte` ranges; zero timezone bugs                                                 | Not a `Date` in the DB, so no day-level reporting later without a migration                                          |
| Month-level locks                               | One guard function; matches the sample data and the brief                                                                   | No quarter or year locks — would need a period→months mapping for no rubric payoff                                   |
| Missing actual = 0                              | Totals, rows and charts stay internally consistent                                                                          | Feb Marketing reads −100%, which needs the `hasActuals` flag to stay honest                                          |
| Monthly chart stacks, never nets                | A netted bar draws a month with equal-and-opposite misses as a month on plan — it can hide exactly what the app is for      | One rect per category per month instead of one per month, and a custom tooltip to keep it readable                   |
| Currency is a label, not a conversion           | A ledger's figures mean what was entered; re-valuing them would need rates, a rate date, and an answer for locked periods   | Two-decimal currencies only, or the stored minor-unit integers change meaning                                        |
| `currency` is a required prop, not a default    | A per-tenant value read from module scope is one process-wide value; required makes a missed display site a compile error   | Threaded through every page and money component instead of read from context (RSC cannot read client context)        |
| One actual per category×month                   | The same spend cannot be recorded twice by a double submit, a repeated CSV row, or a re-import; every write is idempotent   | No per-receipt line items — a cell holds one figure and one note, and the CSV has to arrive pre-aggregated           |
| Unbudgeted spend surfaced (`hasPlan: false`)    | Actual-with-no-plan is the edge case the spec did not test, and the one a finance reviewer cares about                      | An extra flag through the row type and the UI                                                                        |
| `PUT /api/plans` upsert instead of POST + PUT   | One idempotent endpoint for "set this cell"; retries are safe                                                               | No 201-vs-200 distinction                                                                                            |
| Two-phase CSV (preview → commit)                | Turns "upload and pray" into a reviewable diff; locked rows rejected before anything is written                             | Commit re-validates, so the file is parsed twice                                                                     |
| `ScopedRepo` over per-handler filters           | Isolation cannot be forgotten by construction                                                                               | Every new query goes through the repo, even one-offs                                                                 |
| Second Plan index `{userId, month, categoryId}` | The unique index cannot bound the report's month range; this one can                                                        | One extra index on the collection's cheapest writes                                                                  |
| Trailing `createdAt` on the Actual index        | `listActuals` sorts by `{month, createdAt}`; without the key the 500-row read ends in a blocking `SORT`                     | A wider index key on the app's busiest collection                                                                    |
| No unique index on actuals (unlike plans)       | A category is spent against several times a month; each spend is a row with its own note and delete, and the report sums    | Mongo no longer catches a double submit or a re-import — both are handled at their own source instead                |
| Import idempotency keyed on the file's hash     | Rows append now, so a nervous re-upload would double a month; the same bytes are the same batch and replace what they wrote | An edited file is a new batch, so its unchanged lines write again                                                    |
| Tag-based read cache, no TTL                    | A ledger's only visible staleness is "older than my own last write" — a tag expiry says exactly that; a timer only guesses  | Per-instance store by default, so multi-container needs a shared cache handler                                       |
| Invalidate in `withRoute`, not per handler      | One gate for every write means a new route cannot forget it                                                                 | `POST /api/imports/preview` invalidates although it writes nothing                                                   |
| Import reads categories and locks once per file | Two questions whose answers cannot change mid-file; a 20k-row file was 40k round-trips to re-ask them                       | The whole category map and lock set are held in memory for the parse (kilobytes)                                     |
| shadcn/ui over hand-rolled class recipes        | Real components bring focus management, ARIA and keyboard behaviour that utility classes only imitate                       | Generated code lives in the repo and is ours to maintain                                                             |
| TanStack for client machinery only              | Query/Form/Table/Virtual/Pacer each replace code we would otherwise hand-roll and get subtly wrong                          | Five small libraries instead of none; reads deliberately stay in RSC                                                 |
| Vercel + Atlas M0 over a cloud account          | Free forever at this size, HTTPS and CI-gated deploys with no bill and no credit card; the Dockerfile still runs anywhere   | Cold starts, a 60s function ceiling, no PITR backup, and Atlas open to `0.0.0.0/0` — all listed in `infra/README.md` |
