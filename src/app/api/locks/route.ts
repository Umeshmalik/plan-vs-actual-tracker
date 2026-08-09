/** Locking is idempotent (upsert), so a double-click is not an error. */
import { NextResponse } from "next/server";
import { zLockCreate } from "@/domain/schemas";
import { resolveRange } from "@/lib/range";
import { getLockedMonths } from "@/lib/reads";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // the response; the data is cached in lib/reads.ts

export const GET = withRoute(async (req, repo) => {
  const { from, to } = resolveRange(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ lockedMonths: await getLockedMonths(String(repo.uid), from, to) });
});

export const POST = withRoute(async (req, repo) => {
  const body = zLockCreate.parse(await req.json());
  const lock = await repo.lock(body.month);
  return NextResponse.json({ month: body.month, lockedAt: lock?.lockedAt });
});
