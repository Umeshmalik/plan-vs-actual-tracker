/**
 * The report as a downloadable CSV — a separate path, so /api/report's JSON
 * contract is untouched. Reads the same cached getReport, so it cannot disagree
 * with the table on screen.
 */
import { NextResponse } from "next/server";
import { zReportQuery } from "@/domain/schemas";
import { reportCsv } from "@/domain/report";
import { getReport, getSettings } from "@/lib/reads";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (req, repo) => {
  const { from, to } = zReportQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const [report, { currency }] = await Promise.all([
    getReport(String(repo.uid), from, to),
    getSettings(String(repo.uid)),
  ]);

  return new NextResponse(reportCsv(report, currency), {
    headers: {
      // charset matters: names are free text, and Excel would otherwise read the
      // bytes as the local codepage.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="plan-vs-actual-${from}-to-${to}.csv"`,
    },
  });
});
