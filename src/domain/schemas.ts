/**
 * schemas.ts — single source for validation AND types. (DRY)
 * Zod schema -> z.infer gives the TS type; no separate interface drift.
 */
import { z } from "zod";
import { isMonth } from "../lib/month";

export const zMonth = z.string().refine(isMonth, {
  error: "Month must be YYYY-MM (e.g. 2026-01)",
});

/**
 * Money enters the API as major units (string or number), stored as minor.
 * Zod 4 rejects NaN and Infinity as part of the number type itself, so the
 * wording that used to hang off `.finite()` (a no-op since v4) now sits on the
 * type check where those inputs actually land.
 */
export const zAmountMajor = z.coerce
  .number({ error: "Amount must be a number" })
  .nonnegative("Amount must be ≥ 0");

export const zCategoryCreate = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});

export const zPlanUpsert = z.object({
  categoryId: z.string().min(1),
  month: zMonth,
  amount: zAmountMajor, // converted with toMinor() at the boundary
});

export const zActualCreate = z.object({
  categoryId: z.string().min(1),
  month: zMonth,
  amount: zAmountMajor.refine(v => v > 0, "Amount must be greater than 0"),
  note: z.string().trim().max(280).optional(),
});

export const zLockCreate = z.object({ month: zMonth });

export const zReportQuery = z
  .object({ from: zMonth, to: zMonth })
  .refine(q => q.from <= q.to, { error: "'from' must be ≤ 'to'" });

/** One CSV row: month,category,amount */
export const zCsvRow = z.object({
  month: zMonth,
  category: z.string().trim().min(1, "Category is required"),
  amount: zAmountMajor.refine(v => v > 0, "Amount must be greater than 0"),
});

export type PlanUpsert = z.infer<typeof zPlanUpsert>;
export type ActualCreate = z.infer<typeof zActualCreate>;
export type ReportQuery = z.infer<typeof zReportQuery>;
export type CsvRow = z.infer<typeof zCsvRow>;
