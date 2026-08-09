/**
 * importCsv.ts — two-phase import: preview (nothing written) then commit
 * (all-or-nothing in a transaction). Converts "upload and pray" into a
 * reviewable diff. Locked-month rows are rejected at validation time; a file
 * that names the same category and month on several lines is a normal file,
 * because a category-month holds a whole month of spend.
 */
import { createHash } from "crypto";
import mongoose from "mongoose";
import { zCsvRow } from "./schemas";
import { toMinor } from "../lib/money";
import { normalizeName, type ScopedRepo } from "./repo";

export interface RowResult {
  line: number; // 1-based, excluding header
  ok: boolean;
  error?: string;
  parsed?: { month: string; categoryId: string; categoryName: string; amountMinor: number };
}

/** Validate every row against schema + known categories + lock state. */
export async function previewCsv(repo: ScopedRepo, csvText: string): Promise<RowResult[]> {
  const lines = csvText.trim().split(/\r?\n/);
  const [header, ...body] = lines;
  if (!/^month\s*,\s*category\s*,\s*amount$/i.test(header ?? ""))
    return [{ line: 0, ok: false, error: 'Header must be exactly "month,category,amount".' }];

  // Two reads for the whole file, not two per row. Both answers are the same
  // for every line — the categories a user owns and the months they have
  // closed do not change mid-file — so a 20k-row import used to spend 40,000
  // round trips re-asking two questions it had already answered.
  const [categoriesByName, lockedMonths] = await Promise.all([repo.categoriesByName(), repo.lockedMonths()]);

  const results: RowResult[] = [];
  for (let i = 0; i < body.length; i++) {
    const line = i + 1;
    const raw = body[i].trim();
    if (!raw) continue;
    const [month, category, amount] = raw.split(",").map(s => s?.trim());
    const parsed = zCsvRow.safeParse({ month, category, amount });
    if (!parsed.success) {
      results.push({ line, ok: false, error: parsed.error.issues[0].message });
      continue;
    }
    const cat = categoriesByName.get(normalizeName(parsed.data.category));
    if (!cat) {
      results.push({
        line,
        ok: false,
        error: `Unknown category "${parsed.data.category}". Create it first or fix the name.`,
      });
      continue;
    }
    if (lockedMonths.has(parsed.data.month)) {
      results.push({
        line,
        ok: false,
        error: `${parsed.data.month} is locked. Unlock the period or remove this row.`,
      });
      continue;
    }
    results.push({
      line,
      ok: true,
      parsed: {
        month: parsed.data.month,
        categoryId: String(cat._id),
        categoryName: cat.name,
        amountMinor: toMinor(parsed.data.amount),
      },
    });
  }
  return results;
}

/** Re-validate, then write every ok row atomically. Any bad row aborts. */
export async function commitCsv(repo: ScopedRepo, csvText: string) {
  const results = await previewCsv(repo, csvText);
  const bad = results.filter(r => !r.ok);
  if (bad.length) return { committed: 0, results }; // caller maps to VALIDATION_FAILED envelope

  // ponytail: the lock is re-checked by previewCsv above, just outside the
  // transaction — a lock landing in that millisecond window would be missed.
  // Single-user editing makes it unreachable in practice; the real fix is a
  // unique {userId, month} guard document written inside the transaction.

  // The batch id is the FILE, not the click: rows append now, so a random id per
  // run would let a double-click or a nervous re-upload stack a second copy of
  // every line and the report would sum both. Hashing the content means the same
  // file always lands on the same batch, which the commit below clears before it
  // writes — importing twice is importing once.
  //
  // ponytail: exact-match only. A file edited between imports is a different
  // batch, so its unchanged lines are written a second time; the user removes
  // the old batch's rows by hand. The upgrade is a per-row identity (a reference
  // column in the CSV) the day anyone re-uploads amended files routinely.
  const importBatchId = createHash("sha256").update(csvText).digest("hex");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // One insertMany, not an await per row: the transaction holds its locks
      // for a single round trip instead of one per line of the file.
      await repo.deleteActualsByBatch(importBatchId, session);
      await repo.createActuals(
        results.map(r => ({ ...r.parsed!, source: "import" as const, importBatchId })),
        session
      );
    });
  } finally {
    await session.endSession();
  }
  return { committed: results.length, importBatchId, results };
}
