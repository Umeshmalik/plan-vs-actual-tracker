# Deploying — free tier, about 10 minutes

Two accounts, no credit card, no cloud bill: **Vercel Hobby** runs the app,
**MongoDB Atlas M0** stores the data. Both free forever at this size.

## 1. Database — Atlas M0

1. <https://cloud.mongodb.com> → create a free **M0** cluster. Pick the region
   closest to the Vercel region you will choose in step 2 — the report
   aggregation crosses this link on every page load.
2. **Database Access** → add user `pva-app` with **Read and write to any
   database** scoped to the `pva` database only. Least privilege: this user can
   never create another database or read `admin`.
3. **Network Access** → Vercel functions have no static egress IPs on Hobby, so
   allow `0.0.0.0/0`. The credential is the control here, not the IP.
   _(Paid Vercel adds static IPs; then narrow this to them.)_
4. Copy the connection string and append the database name:
   `mongodb+srv://pva-app:<password>@<cluster>.mongodb.net/pva`

M0 gives 512 MB and caps the cluster at 500 connections — which is why
`src/lib/db.ts` uses a 3-socket pool with no idle minimum when it detects
Vercel. A wide pool per function instance is how a free cluster runs out.

## 2. App — Vercel, connected to the GitHub repo

This is how the live app is wired: **Vercel builds from GitHub**, not from a
laptop. No `vercel` CLI, no `vercel.json`, no `.vercel/` in the repo.

1. <https://vercel.com/new> → **Import Git Repository** →
   `umeshmalik/plan-vs-actual-tracker`. Next 16 is auto-detected; leave the
   build and output settings alone.
2. **Settings → Environment Variables**, for Production _and_ Preview:

   | Variable      | Value                                          |
   | ------------- | ---------------------------------------------- |
   | `MONGODB_URI` | the Atlas string from step 1, ending in `/pva` |
   | `AUTH_SECRET` | `openssl rand -base64 32` — not the local one  |

   These are read at build and at runtime, so a change needs a redeploy to
   take effect. Editing a variable does not trigger one.

3. **Settings → Deployment Protection → Vercel Authentication: Disabled.** On by
   default, and it redirects anyone outside the Vercel account to SSO — a
   reviewer opening the link never reaches the app's own sign-in page.
4. Push to `main` → production. Open a PR → a preview deployment, with its URL
   commented on the PR and the same environment variables if you set Preview
   above.

Nothing else to configure: `next.config.mjs` drops `output: "standalone"` when
`VERCEL` is set, and the security headers ship with the app rather than living
in platform config.

Then seed the demo data against the same cluster, from your machine — Atlas is
reachable from anywhere, and the seed is a script, not a route:

```bash
MONGODB_URI='mongodb+srv://…/pva' npm run seed
```

Check it: `curl https://<your-app>.vercel.app/api/health` → `{"ok":true,"db":"up"}`

## 3. Making tests gate the deploy

The Git integration builds **on push, without waiting for GitHub Actions** — so
today `npm run check` reports on a commit that is already deploying. Pick one:

| Option                                                                                             | Effort | Keeps push-to-deploy |
| -------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| **Branch protection**: require the `verify` check on `main`, merge via PRs                         | none   | yes                  |
| **Ignored Build Step** (Settings → Git): a command that exits 0 only if the commit's checks passed | small  | yes                  |
| **Deploy from CI**: turn auto-deploy off, add the three secrets below                              | medium | no (CI deploys)      |

The third uses the `deploy` job already in `.github/workflows/ci.yml`, which
`needs: verify` and ships the prebuilt output:

| Secret              | Where                                                    |
| ------------------- | -------------------------------------------------------- |
| `VERCEL_TOKEN`      | Vercel → Account Settings → Tokens                       |
| `VERCEL_ORG_ID`     | Vercel → Project → Settings → General (or `vercel link`) |
| `VERCEL_PROJECT_ID` | same place                                               |

Set those **and** leave the Git integration on and every commit deploys twice.
The job is dormant while the secrets are absent, so CI stays green either way.

## What this trades away

Free tier is genuinely enough for a reviewer, and dishonest to pretend it is
production. What is missing, and what it would take:

| Gap                                                              | Cost of closing it                       |
| ---------------------------------------------------------------- | ---------------------------------------- |
| M0 has **no point-in-time backup** and no restore drill          | M10+ with continuous backup              |
| Atlas is open to `0.0.0.0/0` because Hobby has no static egress  | Vercel Pro static IPs, then an allowlist |
| Cold starts: an idle function pays a connection handshake        | Any always-on tier                       |
| Secrets live in Vercel's env store, unrotated                    | A secrets manager with rotation          |
| One region; no failover                                          | Multi-region cluster + edge config       |
| The 60s function ceiling caps a very large CSV commit            | A queue and a worker, not a request      |
| The auth rate-limit counter is per-instance and resets on deploy | A shared store (Redis) behind it         |

## The Docker path is still there

`Dockerfile` and `docker-compose.yml` are unchanged and still build the small
non-root standalone image. Anything that runs a container — AWS App Runner,
Fly.io, Render, Railway, a VPS — takes it as-is with the same two environment
variables. Vercel is the free default, not a lock-in.

**One caveat if you run more than one container.** Every read goes through
`src/lib/reads.ts`, whose entries are expired by tag (`user:<id>`) from the
write path in `src/lib/route.ts`. On Vercel the Data Cache is shared, so one
instance's `revalidateTag` reaches the rest. Behind a multi-container service it
is not: a write served by container A leaves container B's copy in place until B
serves a write of its own — the header's Reload button is the manual escape
today. Run a single instance (App Runner min 1 / max 2 → min 1 / max 1), or
configure a shared Next cache handler backed by Redis. Nothing else about the
container path changes.
