<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

**Plan vs Actual Tracker** — monthly spending targets vs actuals, with variance reporting, CSV import and locked periods. Next.js 16 App Router · React 19 · TypeScript strict · MongoDB + Mongoose · Zod · Auth.js (credentials). Multi-tenant: every row belongs to a user, and isolation is enforced structurally rather than by convention.

This file is the single source of agent guidance for this repo. `CLAUDE.md` is one line that imports it, so edit **this** file, not that one. `README.md` holds the full API surface, the decisions table and the deployment guide — read it for anything not covered here.

## Commands

```bash
npm run check          # typecheck + eslint + prettier --check + vitest — the CI gate
npm run dev            # http://localhost:3000
npm test               # vitest run (all files)
npx vitest run tests/indexes.test.ts        # one file
npx vitest run -t "user B cannot"           # one test by name
npm run seed           # idempotent; both demo users + the sample ledger
npm run dedupe:actuals # one-off migration, see "One entry per cell" below
npm run format         # fixes what format:check flags
```

Node 24 (`.nvmrc`). Tests boot a real `mongod` via `mongodb-memory-server`, one file at a time (`fileParallelism: false`) — the first run downloads the binary, so a cold `npm test` is slow, not hung.

Local DB: `docker compose up -d mongo`. It is a **single-node replica set**, not a standalone `mongod`, because the CSV commit runs in a transaction. The Compose _healthcheck_ does the one-time `rs.initiate` (`docker-compose.yml`), so there is no second command to run; from the host the URI needs `directConnection=true`.

**Run `npm run check` and read its output before reporting work as done.** It is the same command CI runs, and it takes well under a minute. A claim that something passes is only worth making with the output in hand.

## Architecture

Every rule has exactly one implementation, and the design is chokepoints: things are enforced where they _cannot_ be forgotten rather than repeated per call site. When adding a feature, find the chokepoint and extend it — do not add a parallel path.

**`src/lib/route.ts` — `withRoute`.** Every API handler is wrapped in it or `withPublicRoute` (the one exception is `api/auth/[...nextauth]/route.ts`, which re-exports Auth.js `handlers`). It owns auth (hands the handler a `ScopedRepo`, never a session), the error envelope, the 1 MB body guard, `cache-control: no-store` + `x-request-id`, the one structured log line, _and_ cache invalidation. Handlers are `parse → guard → repo → respond` with no try/catch, no logging, no `revalidateTag`.

**`src/domain/repo.ts` — `ScopedRepo`.** Tenant isolation is structural: `userId` is injected into every filter and insert by the private `scope()`. No route handler or page ever touches the raw models — every tenant-scoped collection is reachable only through the repo, so a handler _cannot_ forget the filter. `tests/scoping.test.ts` proves it. New queries go through the repo, including one-offs. (`M` from `models.ts` _is_ imported directly by `src/lib/auth.ts` for `M.User` — the one collection with no tenant — and by `scripts/` and `tests/`. Nowhere else.)

**`src/lib/auth.ts` — `requireRepo()`** is the only door from a session to data. Server components use it or `currentUser()`; `withRoute` calls it for routes.

**`src/lib/reads.ts` — the cached read layer.** Both doors into data come through it: the RSC pages and the `GET` routes. Three constraints follow from `"use cache"`:

- A cached function may not read cookies, so **the caller authenticates first and passes `userId` in**. `userId` is part of every cache key, so one tenant's entry cannot be served to another.
- Cached values are serialized — these functions return plain JSON (`ObjectId` → string, `Date` → ISO string), not Mongoose docs.
- Freshness is a **tag, not a timer**: `cacheLife({stale: 0, revalidate: Infinity, expire: Infinity})`, and `invalidateReads()` in `route.ts` expires `user:<id>` on any non-GET that returns under 400. Never add a TTL, and never call `revalidateTag` from a handler.

**Reads stay in RSC; writes go through the API.** Pages call `src/lib/reads.ts` directly. Client writes go through the one `useApiMutation` hook (TanStack Query), which fires `router.refresh()` — the write already expired the tag, so the re-render sees it.

**One-implementation modules** (`src/lib/`): `money.ts` (the only converter/formatter) · `month.ts` (`YYYY-MM` logic, no `Date`) · `variance.ts` (pure math) · `errors.ts` (`AppError` + the only envelope producer) · `range.ts` (`searchParams` → validated range) · `db.ts` (connection singleton) · `ratelimit.ts`. In `src/domain/`: `models.ts` (schemas + all indexes) · `locking.ts` (the guard) · `report.ts` (the one `$unionWith`) · `importCsv.ts` · `schemas.ts` (Zod = validation **and** types via `z.infer` — no parallel interfaces).

## Invariants that break quietly

These are the ones where a wrong change still compiles, still passes a casual smoke test, and is wrong in production. Treat each as a constraint on any edit nearby.

**Money is integer minor units end to end.** Requests take major units (`amount: 5000` = 5,000.00); everything stored and returned is minor. Only `money.ts` converts, only at the route boundary; the UI never does arithmetic.

**Months are `YYYY-MM` strings**, never `Date`. Lexicographic order is chronological, so ranges are plain `$gte`/`$lte` and there are no timezones anywhere.

**`variancePct` is `null` when `plan === 0`** — never `NaN`, never `Infinity`. One function, `variancePct()`. Nothing else in the codebase divides by a plan.

**One entry per category × month.** `Actual` carries a unique `{userId, categoryId, month}` index, so every write upserts: `repo.upsertActual()` for a single cell, `repo.createActuals()` (one `bulkWrite`) for an import. There is no plain insert — posting the same cell twice replaces the figure rather than adding a row the report would silently sum. Two consequences: `previewCsv` rejects a second row for a cell already claimed earlier in the same file, and a database written before this rule needs `npm run dedupe:actuals` **before** the unique index ships — Mongoose builds indexes in the background and a unique build over existing duplicates fails silently, leaving no constraint and nothing on screen to say so.

**`normalizeName()` in `repo.ts` is the only definition of "same name"** (NFC + collapse whitespace + case-fold). It is what the unique category index sees, and the CSV import resolves rows through the same function. Two definitions is how look-alike duplicate categories get in.

**`sanitizeFilter` is on globally** (`db.ts`, module scope). A filter that deliberately uses operators must say so with `mongoose.trusted()` or it gets wrapped in `$eq` and silently matches nothing. The two month-range reads in `repo.ts` are the only ones.

**Never pass an explicit `undefined` into a repo filter.** The driver serializes `undefined` as BSON `null`, so `{categoryId: undefined}` asks for a null `categoryId` and matches nothing instead of meaning "don't filter on it". `scope()` strips undefined values for exactly this reason; callers should still spread keys in conditionally (`...(categoryId ? {categoryId} : {})` in `reads.ts`, `.optional()` in the actuals route query schema).

**Locks are enforced in the domain, not the UI.** `assertPeriodUnlocked()` must be called from every mutating path: plan upsert, plan delete, actual create, actual delete, CSV commit (per distinct month). Disabling a button is not enforcement.

**The Mongo indexes are load-bearing and pinned by name** in `tests/indexes.test.ts` via `explain("executionStats")`. Two are easy to "tidy" and break:

- Plan needs both `{userId, categoryId, month}` (unique) _and_ `{userId, month, categoryId}`. The unique one cannot serve the report — `categoryId` sits between the equality and the month range, so Mongo walks every key the tenant owns while still reporting `IXSCAN`. The test asserts `userId_1_month_1_categoryId_1` by name.
- The Actual index's trailing `createdAt` is for the **sort**, not the filter. `listActuals` orders by `{month, createdAt}` and caps at `ACTUALS_LIMIT` (500); the test asserts the plan contains no `SORT` stage.

**CSV import cost must stay flat in file size.** Categories and locks are read **once per file** (`categoriesByName()`, `lockedMonths()`), and commit is one `bulkWrite` inside the transaction. `tests/importCsv.test.ts` counts driver commands: 200 rows must preview in the same 2 finds as 2 rows and commit in exactly 1 write. An `await` inside the row loop fails that test.

**Errors:** throw `AppError(code, message)`. `code` → status is the map in `errors.ts` (`VALIDATION_FAILED` 422 · `PERIOD_LOCKED` 409 · `UNKNOWN_CATEGORY` 422 · `DUPLICATE_PLAN` 409 · `UNAUTHORIZED` 401 · `NOT_FOUND` 404). The frontend renders `message` verbatim, so the wording _is_ the user-facing string — write it that way.

**Missing actual = 0 everywhere** (row, totals, chart), with `hasActuals: false` on the row so "spent nothing" stays visibly distinct from "no data". The symmetric case, an actual with no plan, is `hasPlan: false` and falls out of the report's `$unionWith` for free.

## Config notes

`next.config.mjs` holds the CSP (`default-src 'self'` holds because there are zero third-party origins) and `experimental: { useCache: true }`. Do not "upgrade" that to `cacheComponents: true` — it is not a rename: it also switches on partial prerendering, which rejects the `dynamic = "force-dynamic"` on the API routes and wants a Suspense boundary above every page reading cookies or `searchParams`, which is all of them.

`output: "standalone"` is dropped when `VERCEL` is set; `db.ts` shrinks the pool to 3 with no idle sockets there, because a wide pool per function instance exhausts a 500-connection Atlas M0.

UI is shadcn/ui in `src/components/ui/` (style `radix-nova`, `lucide` icons) with `globals.css` binding the semantic tokens to the ledger palette. Compose those components rather than imitating them with utility classes. `design/prototype.html` is the visual contract. `src/components/ui` and `globals.css` are prettier-ignored on purpose — shadcn owns them, and reformatting only makes the next `shadcn add` diff noisy.

`ponytail:` comments mark deliberate shortcuts with a named ceiling and upgrade path — read one before "fixing" what it describes.
