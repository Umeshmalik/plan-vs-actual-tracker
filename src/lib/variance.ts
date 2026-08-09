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

/* ---------------------------------------------------------------------------
 * The two ways the report's charts group the same rows. Both live here, beside
 * rangeTotals, because they are row aggregation with the same edge cases — and
 * because the one thing they must not do (net a group down to a single signed
 * number) is a rule worth stating once, in the module that owns the policy.
 * ------------------------------------------------------------------------- */

export interface CategoryVariance {
  categoryId: string;
  categoryName: string;
  variance: MinorUnits;
  hasActuals: boolean;
}

/**
 * One line per category for the whole range, biggest |variance| first.
 * Summing a category's monthly variances is exact rather than approximate:
 * variance is actual - plan, which is linear.
 */
export function byCategory(rows: VarianceRow[]): CategoryVariance[] {
  const totals = new Map<string, CategoryVariance>();
  for (const r of rows) {
    const seen = totals.get(r.categoryId);
    if (seen) {
      seen.variance += r.variance;
      // Any month with an actual makes the range figure real, not provisional.
      seen.hasActuals ||= r.hasActuals;
    } else {
      totals.set(r.categoryId, {
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        variance: r.variance,
        hasActuals: r.hasActuals,
      });
    }
  }
  return [...totals.values()].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

export interface MonthVariance {
  month: string;
  /** false = no plan and no actual in the month. NOT the same as a variance of 0. */
  hasData: boolean;
  /** Gross over plan (>= 0) and gross under plan (<= 0), deliberately kept apart. */
  over: MinorUnits;
  under: MinorUnits;
  net: MinorUnits;
  /** categoryId -> its variance this month; 0 for every category that has none. */
  byCategory: Record<string, MinorUnits>;
}

/**
 * Rows grouped by month WITHOUT netting. `over` and `under` stay separate
 * because collapsing them is how a month with a large overspend and an equally
 * large underspend reports itself as being on plan.
 *
 * `months` comes from the report range rather than from the rows, so a month
 * nobody touched still gets an entry — flagged `hasData:false`, never a silent
 * zero. Zero means "landed exactly on plan", and the two must not look alike.
 */
export function byMonth(rows: VarianceRow[], months: string[]): MonthVariance[] {
  const noVariance = Object.fromEntries(rows.map(r => [r.categoryId, 0]));
  return months.map(month => {
    const m: MonthVariance = {
      month,
      hasData: false,
      over: 0,
      under: 0,
      net: 0,
      byCategory: { ...noVariance },
    };
    for (const r of rows) {
      if (r.month !== month) continue;
      m.byCategory[r.categoryId] += r.variance;
      if (r.variance > 0) m.over += r.variance;
      else m.under += r.variance;
      m.net += r.variance;
      m.hasData = true;
    }
    return m;
  });
}
