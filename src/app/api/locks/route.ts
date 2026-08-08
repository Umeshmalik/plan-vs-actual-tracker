/**
 * Period locks — read the locked months in a range, or lock one.
 * Locking is idempotent (upsert), so a double-click is not an error.
 */
import { NextResponse } from "next/server";
import { zLockCreate } from "@/domain/schemas";
import { resolveRange } from "@/lib/range";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // per-user data, never cached

export const GET = withRoute(async (req, repo) => {
  // Same range resolution as every screen: valid from/to, else DEFAULT_RANGE.
  const { from, to } = resolveRange(Object.fromEntries(req.nextUrl.searchParams));
  const locks = await repo.listLocks(from, to);
  return NextResponse.json({ lockedMonths: locks.map(l => l.month).sort() });
});

export const POST = withRoute(async (req, repo) => {
  const body = zLockCreate.parse(await req.json());
  const lock = await repo.lock(body.month);
  return NextResponse.json({ month: body.month, lockedAt: lock?.lockedAt });
});
