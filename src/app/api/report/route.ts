import { NextResponse } from "next/server";
import { zReportQuery } from "@/domain/schemas";
import { getReport } from "@/lib/reads";
import { withRoute } from "@/lib/route";

// The RESPONSE is never cached; the DATA behind it is — see lib/reads.ts.
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req, repo) => {
  const { from, to } = zReportQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json(await getReport(String(repo.uid), from, to));
});
