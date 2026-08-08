/**
 * reads.ts — THE cached read layer.
 *
 * Both doors into this app's data come through here: the server components
 * that render the four screens, and the GET routes that are the REST contract.
 * So one Mongo round-trip now answers every repeat of the same read — four
 * tabs over the same range, a router.refresh(), the back button, a second
 * device — instead of one round-trip per render.
 *
 * Freshness is a TAG, not a timer. Every entry is tagged `user:<id>` and
 * cacheLife() switches time-based expiry off entirely, so nothing here ever
 * goes stale on a clock. lib/route.ts expires that tag the instant any non-GET
 * request for that user succeeds, which means a write is visible on the very
 * next read: the cache cannot hand back a value older than that user's last
 * write, and that is the only staleness a single-tenant ledger can notice.
 *
 * Two constraints shape the return types:
 *  - a cached value is serialized on the way in and out, so these hand back
 *    plain JSON (ObjectId -> string, Date -> ISO string) rather than Mongoose
 *    documents. The wire format is unchanged: JSON.stringify was already doing
 *    exactly that conversion at the response boundary.
 *  - a cached function may not read cookies, so the caller passes the userId it
 *    has already authenticated. requireRepo() is still the ONE door from a
 *    session to data; this layer never decides who is asking, and userId is
 *    part of every cache key, so one tenant's entry cannot be served to another.
 *
 * ponytail: the store is Next's default per-instance cache. On Vercel the Data
 * Cache is shared, so one instance's revalidateTag reaches the rest; behind a
 * multi-container App Runner service it is not, and a write served by container
 * A leaves container B's copy in place until B serves a write of its own. The
 * header's Reload button already covers that gap by hand. The upgrade is a
 * shared cache handler (Redis) the day this runs more than one container.
 */
import { Types } from "mongoose";
import { cacheLife, cacheTag } from "next/cache";
import { ScopedRepo } from "@/domain/repo";
import { runReport } from "@/domain/report";
import { connectDb } from "./db";

/** One tag per tenant: every read a user makes, expired by any write they make. */
export const userTag = (userId: string) => `user:${userId}`;

/**
 * Tag-driven only. `revalidate`/`expire: Infinity` means no entry is ever
 * dropped on a clock, and `stale: 0` means no client holds one either — the
 * write path in lib/route.ts is the sole thing that makes an entry old.
 */
function tenantCache(userId: string) {
  cacheTag(userTag(userId));
  cacheLife({ stale: 0, revalidate: Infinity, expire: Infinity });
}

/** The same scoped repo the routes get, rebuilt from the id inside the cache. */
async function scoped(userId: string) {
  await connectDb();
  return new ScopedRepo(new Types.ObjectId(userId));
}

/** The hero read: the whole variance report, aggregation and locks together. */
export async function getReport(userId: string, from: string, to: string) {
  "use cache";
  tenantCache(userId);
  return runReport(await scoped(userId), from, to);
}

/** {_id, name} — the same shape GET /api/categories has always returned. */
export async function getCategories(userId: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  return (await repo.listCategories()).map(c => ({ _id: String(c._id), name: c.name }));
}

/** One cell per category x month, for the plans grid. */
export async function getPlans(userId: string, from: string, to: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  return (await repo.listPlans(from, to)).map(p => ({
    categoryId: String(p.categoryId),
    month: p.month,
    amountMinor: p.amountMinor,
  }));
}

/** Sorted, deduped by the unique index — pass the same month twice to ask about one. */
export async function getLockedMonths(userId: string, from: string, to: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  return (await repo.listLocks(from, to)).map(l => l.month).sort();
}

/** Scalars, not a filter object, so the same query is always the same cache key. */
export async function getActuals(userId: string, month?: string, categoryId?: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  const rows = await repo.listActuals({
    ...(month ? { month } : {}),
    ...(categoryId ? { categoryId } : {}),
  });
  return rows.map(a => ({
    _id: String(a._id),
    categoryId: String(a.categoryId),
    month: a.month,
    amountMinor: a.amountMinor,
    note: a.note,
    source: a.source,
    importBatchId: a.importBatchId,
    createdAt: a.createdAt.toISOString(),
  }));
}
