/** Idempotent: unlocking an open month is a no-op, not a 404. */
import { NextResponse } from "next/server";
import { zLockCreate } from "@/domain/schemas";
import { withRoute } from "@/lib/route";

export const DELETE = withRoute(async (req, repo, { params }: { params: Promise<{ month: string }> }) => {
  const { month } = zLockCreate.parse(await params); // same zMonth rule as POST /api/locks
  await repo.unlock(month);
  return NextResponse.json({ month, unlocked: true });
});
