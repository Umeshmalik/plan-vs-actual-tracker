/**
 * Unlock a period. Idempotent: unlocking an open month is a no-op, not a 404 —
 * the caller's intent ("this month is editable") is satisfied either way.
 */
import { NextResponse } from "next/server";
import { zLockCreate } from "@/domain/schemas";
import { withRoute } from "@/lib/route";

export const DELETE = withRoute(async (req, repo, { params }: { params: Promise<{ month: string }> }) => {
  const { month } = zLockCreate.parse(await params); // same zMonth rule as POST /api/locks
  await repo.unlock(month);
  return NextResponse.json({ month, unlocked: true });
});
