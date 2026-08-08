/**
 * The canonical handler shape (auth -> parse -> guard -> repo -> respond).
 * Every route in the app is this same composition — no business logic here,
 * and no try/catch or logging by hand: withRoute supplies the ScopedRepo,
 * the error envelope and the one structured log line per request.
 */
import { NextResponse } from "next/server";
import { zPlanUpsert } from "@/domain/schemas";
import { assertPeriodUnlocked } from "@/domain/locking";
import { toMinor } from "@/lib/money";
import { withRoute } from "@/lib/route"; // session -> ScopedRepo (401s on its own)

/** DELETE takes the same cell key as PUT, minus the amount. (DRY) */
const zPlanDelete = zPlanUpsert.pick({ categoryId: true, month: true });

export const PUT = withRoute(async (req, repo) => {
  const body = zPlanUpsert.parse(await req.json());
  await repo.requireCategory(body.categoryId);
  await assertPeriodUnlocked(repo, body.month);
  const plan = await repo.upsertPlan(body.categoryId, body.month, toMinor(body.amount));
  return NextResponse.json({ plan });
});

export const DELETE = withRoute(async (req, repo) => {
  const body = zPlanDelete.parse(await req.json());
  await assertPeriodUnlocked(repo, body.month);
  const { deletedCount } = await repo.deletePlan(body.categoryId, body.month);
  return NextResponse.json({ deleted: deletedCount });
});
