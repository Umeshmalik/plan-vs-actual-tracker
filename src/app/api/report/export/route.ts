/**
 * The report as a downloadable CSV. A separate path rather than a `?format=csv`
 * branch on /api/report, so that route's JSON contract stays exactly what the
 * README documents and this one is free to own a different content type.
 *
 * It reads through the same cached `getReport`, so exporting the range you are
 * looking at costs zero extra Mongo round-trips — and cannot disagree with the
 * table, because it is the same rows.
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
      // charset matters: category names are free text, and Excel reads a
      // headerless byte stream as the local codepage.
      "content-type": "text/csv; charset=utf-8",
      // `attachment` is what makes the browser download instead of rendering,
      // and the range in the filename is what stops a downloads folder filling
      // with report.csv, report(1).csv, report(2).csv.
      "content-disposition": `attachment; filename="plan-vs-actual-${from}-to-${to}.csv"`,
    },
  });
});
