/**
 * Actuals — list (optionally filtered) and create. Money arrives in MAJOR
 * units and is converted with toMinor() here, at the boundary, nowhere else.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { zActualCreate, zMonth } from "@/domain/schemas";
import { assertPeriodUnlocked } from "@/domain/locking";
import { toMinor } from "@/lib/money";
import { getActuals } from "@/lib/reads";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // the response; the data is cached in lib/reads.ts

/** Both filters optional; absent keys stay absent so the repo filter stays clean. */
const zActualsQuery = z.object({
  month: zMonth.optional(),
  categoryId: z.string().min(1).optional(),
});

export const GET = withRoute(async (req, repo) => {
  const params = [...req.nextUrl.searchParams].filter(([, v]) => v !== "");
  const query = zActualsQuery.parse(Object.fromEntries(params));
  const actuals = await getActuals(String(repo.uid), query.month, query.categoryId);
  return NextResponse.json({ actuals });
});

export const POST = withRoute(async (req, repo) => {
  const body = zActualCreate.parse(await req.json());
  await repo.requireCategory(body.categoryId);
  await assertPeriodUnlocked(repo, body.month);
  const actual = await repo.createActual({
    categoryId: body.categoryId,
    month: body.month,
    amountMinor: toMinor(body.amount),
    note: body.note,
  });
  return NextResponse.json({ actual });
});
