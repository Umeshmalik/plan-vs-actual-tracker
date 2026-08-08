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

## 2. App — Vercel

```bash
npx vercel login
npx vercel link          # creates the project
npx vercel env add MONGODB_URI production      # paste the Atlas string
npx vercel env add AUTH_SECRET production      # openssl rand -base64 32
npx vercel --prod        # deploy
```

Nothing else to configure: Next 16 is auto-detected, `next.config.mjs` drops
`output: "standalone"` when `VERCEL` is set, and the security headers ship with
the app rather than living in platform config.

Then seed the demo data against the same cluster, from your machine:

```bash
MONGODB_URI='mongodb+srv://…/pva' npm run seed
```

Check it: `curl https://<your-app>.vercel.app/api/health` → `{"ok":true,"db":"up"}`

## 3. Deploys gated on tests (optional)

Connecting the repo in the Vercel dashboard gives you push-to-deploy with no
secrets — but Vercel builds immediately and does not wait for CI, so a red test
run can still ship. To make tests the gate, add three repo secrets and
`.github/workflows/ci.yml` takes over:

| Secret              | Where                                      |
| ------------------- | ------------------------------------------ |
| `VERCEL_TOKEN`      | Vercel → Account Settings → Tokens         |
| `VERCEL_ORG_ID`     | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | same file                                  |

The deploy job is a no-op until `VERCEL_TOKEN` exists, so CI stays green either
way.

## What this trades away

Free tier is genuinely enough for a reviewer, and dishonest to pretend it is
production. What is missing, and what it would take:

| Gap                                                             | Cost of closing it                       |
| --------------------------------------------------------------- | ---------------------------------------- |
| M0 has **no point-in-time backup** and no restore drill         | M10+ with continuous backup              |
| Atlas is open to `0.0.0.0/0` because Hobby has no static egress | Vercel Pro static IPs, then an allowlist |
| Cold starts: an idle function pays a connection handshake       | Any always-on tier                       |
| Secrets live in Vercel's env store, unrotated                   | A secrets manager with rotation          |
| One region; no failover                                         | Multi-region cluster + edge config       |
| The 60s function ceiling caps a very large CSV commit           | A queue and a worker, not a request      |

## The Docker path is still there

`Dockerfile` and `docker-compose.yml` are unchanged and still build the small
non-root standalone image. Anything that runs a container — AWS App Runner,
Fly.io, Render, Railway, a VPS — takes it as-is with the same two environment
variables. Vercel is the free default, not a lock-in.
