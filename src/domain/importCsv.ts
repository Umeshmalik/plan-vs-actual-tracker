/**
 * Two-phase import: preview (nothing written) then commit (all-or-nothing in a
 * transaction). Repeated category+month lines are normal — a cell is a ledger.
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

  // Two reads for the whole FILE, not two per row. tests/importCsv.test.ts
  // counts driver commands, so an await inside the row loop fails it.
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
  if (bad.length) return { committed: 0, results };

  // ponytail: previewCsv re-checks locks just OUTSIDE the transaction, so a lock
  // landing in that window is missed. Upgrade: a guard document written inside it.

  // The batch id is the FILE, not the click, so a re-upload replaces its own rows
  // rather than stacking a second copy of every line.
  // ponytail: exact-match only — an EDITED file is a different batch and its
  // unchanged lines are written again. Upgrade: a per-row reference column.
  const importBatchId = createHash("sha256").update(csvText).digest("hex");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
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
