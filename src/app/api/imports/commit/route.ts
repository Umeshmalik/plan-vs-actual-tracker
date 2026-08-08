/**
 * Import phase 2 — all-or-nothing. commitCsv re-validates and writes inside a
 * transaction; one bad row means nothing is written and the whole preview comes
 * back in the error envelope so the UI can flag the exact lines.
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

/**
 * The one slow route: a 1 MB CSV is ~20k inserts inside a transaction, and on
 * Vercel a function defaults to a far shorter budget than that can need over a
 * network hop to Atlas. Every other route answers in milliseconds and keeps the
 * default. (Ignored outside Vercel — the container has no such limit.)
 */
export const maxDuration = 60;

export const POST = withRoute(async (req, repo) => {
  const { csv } = zImportBody.parse(await req.json());
  const preview = await previewCsv(repo, csv);
  // Re-check the batch's distinct months at the write boundary: the user's
  // preview may be minutes old, and the lock is THE server-side rule.
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
