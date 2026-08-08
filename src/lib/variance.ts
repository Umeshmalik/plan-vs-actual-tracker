/**
 * variance.ts — pure variance math. Owns ALL edge cases. (DRY)
 * Policy (documented in README):
 *  - variance = actual - plan (negative = under plan = favorable)
 *  - plan === 0  -> variancePct is null (UI renders "—"); never NaN/Infinity
 *  - missing actual -> treated as 0 everywhere, row flagged hasActuals:false
 */
import type { MinorUnits } from "./money";

export interface VarianceRow {
  categoryId: string;
  categoryName: string;
  month: string;
  plan: MinorUnits;
  actual: MinorUnits;
  hasActuals: boolean;
  hasPlan: boolean; // false = unbudgeted spend (actual with no plan)
  variance: MinorUnits;
  variancePct: number | null;
}

export function variance(plan: MinorUnits, actual: MinorUnits): MinorUnits {
  return actual - plan;
}

export function variancePct(plan: MinorUnits, actual: MinorUnits): number | null {
  if (plan === 0) return null;
  return ((actual - plan) / plan) * 100;
}

export function buildRow(base: Omit<VarianceRow, "variance" | "variancePct">): VarianceRow {
  return {
    ...base,
    variance: variance(base.plan, base.actual),
    variancePct: variancePct(base.plan, base.actual),
  };
}

export function rangeTotals(rows: VarianceRow[]) {
  const plan = rows.reduce((s, r) => s + r.plan, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  return { plan, actual, variance: variance(plan, actual), variancePct: variancePct(plan, actual) };
}
