/**
 * Import phase 1 — validate every row and report back. Nothing is written.
 * Turns "upload and pray" into a reviewable diff.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { previewCsv } from "@/domain/importCsv";
import { withRoute } from "@/lib/route";

const zImportBody = z.object({
  csv: z.string().trim().min(1, "Add a CSV file or paste rows before importing."),
});

export const POST = withRoute(async (req, repo) => {
  const { csv } = zImportBody.parse(await req.json());
  const results = await previewCsv(repo, csv);
  const okCount = results.filter(r => r.ok).length;
  return NextResponse.json({ results, okCount, errorCount: results.length - okCount });
});
