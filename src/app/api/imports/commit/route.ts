/**
 * Phase 2 — all-or-nothing. One bad row means nothing is written, and the whole
 * preview comes back in the error envelope so the UI can flag the exact lines.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { commitCsv, previewCsv } from "@/domain/importCsv";
import { assertMonthsUnlocked } from "@/domain/locking";
import { AppError } from "@/lib/errors";
import { withRoute } from "@/lib/route";

const zImportBody = z.object({
  csv: z.string().trim().min(1, "Add a CSV file or paste rows before importing."),
});

/** The one slow route: ~20k inserts in a transaction outruns Vercel's default budget. */
export const maxDuration = 60;

export const POST = withRoute(async (req, repo) => {
  const { csv } = zImportBody.parse(await req.json());
  const preview = await previewCsv(repo, csv);
  // Re-check at the write boundary: the preview may be minutes old.
  await assertMonthsUnlocked(
    repo,
    preview.flatMap(r => r.parsed?.month ?? [])
  );
  const out = await commitCsv(repo, csv);
  if (out.results.some(r => !r.ok))
    throw new AppError(
      "VALIDATION_FAILED",
      "Some rows are invalid. Nothing was imported — fix the flagged rows and retry.",
      { results: out.results }
    );
  return NextResponse.json(out);
});
