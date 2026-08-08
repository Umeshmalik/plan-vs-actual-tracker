/**
 * Report — hands back runReport's output as-is: rows, totals, lockedMonths.
 * Variance maths lives in lib/variance.ts, the query in domain/report.ts.
 */
import { NextResponse } from "next/server";
import { zReportQuery } from "@/domain/schemas";
import { getReport } from "@/lib/reads";
import { withRoute } from "@/lib/route";

// The RESPONSE is never cached (it is one tenant's data behind a cookie, and
// withRoute stamps no-store on it). The DATA behind it is — see lib/reads.ts.
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req, repo) => {
  const { from, to } = zReportQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json(await getReport(String(repo.uid), from, to));
});
