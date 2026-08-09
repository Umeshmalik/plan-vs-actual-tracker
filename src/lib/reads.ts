/**
 * THE cached read layer — both the RSC pages and the GET routes come through here.
 *
 * A cached function may not read cookies, so the CALLER authenticates and passes
 * `userId` in; it is part of every cache key. Values are serialized, so these
 * return plain JSON (ObjectId -> string, Date -> ISO), not Mongoose docs.
 *
 * ponytail: Next's default per-instance cache. Behind multiple containers one
 * instance's revalidateTag does not reach the others (the header's Reload button
 * covers it by hand). Upgrade to a shared cache handler if that day comes.
 */
import { Types } from "mongoose";
import { cacheLife, cacheTag } from "next/cache";
import { ScopedRepo } from "@/domain/repo";
import { runReport } from "@/domain/report";
import { getSettings as userSettings } from "@/domain/users";
import { connectDb } from "./db";

/** One tag per tenant: every read a user makes, expired by any write they make. */
export const userTag = (userId: string) => `user:${userId}`;

/** Tag-driven only — never a timer. lib/route.ts is the sole thing that expires an entry. */
function tenantCache(userId: string) {
  cacheTag(userTag(userId));
  cacheLife({ stale: 0, revalidate: Infinity, expire: Infinity });
}

async function scoped(userId: string) {
  await connectDb();
  return new ScopedRepo(new Types.ObjectId(userId));
}

export async function getReport(userId: string, from: string, to: string) {
  "use cache";
  tenantCache(userId);
  return runReport(await scoped(userId), from, to);
}

export async function getCategories(userId: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  return (await repo.listCategories()).map(c => ({ _id: String(c._id), name: c.name }));
}

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

export async function getLockedMonths(userId: string, from: string, to: string) {
  "use cache";
  tenantCache(userId);
  const repo = await scoped(userId);
  return (await repo.listLocks(from, to)).map(l => l.month).sort();
}

export async function getSettings(userId: string) {
  "use cache";
  tenantCache(userId);
  return userSettings(userId);
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
