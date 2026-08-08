/**
 * Delete one actual entry. The lock guard runs against the entry's OWN month,
 * so the entry has to be read before it is deleted.
 */
import { NextResponse } from "next/server";
import { assertPeriodUnlocked } from "@/domain/locking";
import { withRoute } from "@/lib/route";

export const DELETE = withRoute(async (req, repo, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const entry = await repo.findActual(id); // scoped; 404s on a junk id too
  await assertPeriodUnlocked(repo, entry.month);
  await repo.deleteActual(id);
  return NextResponse.json({ deleted: 1 });
});
