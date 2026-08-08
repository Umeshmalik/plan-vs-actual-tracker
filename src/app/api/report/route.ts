/**
 * Report — hands back runReport's output as-is: rows, totals, lockedMonths.
 * Variance maths lives in lib/variance.ts, the query in domain/report.ts.
 */
import { NextResponse } from "next/server";
import { zReportQuery } from "@/domain/schemas";
import { runReport } from "@/domain/report";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // per-user data, never cached

export const GET = withRoute(async (req, repo) => {
  const { from, to } = zReportQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json(await runReport(repo, from, to));
});
