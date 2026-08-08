/**
 * fiscalYear.ts — THE fiscal-year rule. Pure, no dependencies, so the header,
 * the range picker and the report title all derive their labels from the same
 * arithmetic instead of three near-copies. (DRY, same shape as month.ts.)
 *
 * A fiscal year here is twelve months starting at `startMonth`. `startMonth: 1`
 * IS the calendar year — which is why that is the default and why nothing about
 * the app changes for a user who never opens the setting.
 *
 * **Naming convention: a fiscal year is named by the calendar year it STARTS
 * in.** There is no universal answer — the UK and India name FY 2026-27 by its
 * start, the US federal government names FY2027 by its end — so the ambiguity
 * is resolved on screen rather than in the reader's head: a span is always
 * rendered "FY 2026/27", never a bare "FY 2026" that two people would read as
 * two different twelve-month windows.
 */
import { isMonth } from "./month";

/** startMonth 1 = January = the calendar year. The default, and the brief's. */
export const CALENDAR_YEAR_START = 1;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function isFiscalStartMonth(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 12;
}

/** The twelve `YYYY-MM` bounds of one fiscal year. */
export function fiscalYearRange(fyYear: number, startMonth: number): { from: string; to: string } {
  // Count 11 months on from the start and let the division carry the year, so
  // a December start rolls to the following November without a special case.
  const last = startMonth - 1 + 11;
  return {
    from: `${fyYear}-${pad(startMonth)}`,
    to: `${fyYear + Math.floor(last / 12)}-${pad((last % 12) + 1)}`,
  };
}

/** Which fiscal year a month falls in — i.e. the year that names it. */
export function fiscalYearOf(month: string, startMonth: number): number {
  const [year, m] = month.split("-").map(Number);
  return m >= startMonth ? year : year - 1;
}

/** "FY 2026" for a calendar year, "FY 2026/27" for anything that spans two. */
export function fiscalYearLabel(fyYear: number, startMonth: number): string {
  if (startMonth === CALENDAR_YEAR_START) return `FY ${fyYear}`;
  return `FY ${fyYear}/${pad((fyYear + 1) % 100)}`;
}

/**
 * The label for a range, but only when the range IS exactly one fiscal year —
 * otherwise null, and the caller prints the plain month span. This is what lets
 * the report title say "FY 2026/27" without ever mislabelling an arbitrary
 * selection that happens to be twelve months long.
 */
export function labelIfFiscalYear(from: string, to: string, startMonth: number): string | null {
  if (!isMonth(from) || !isMonth(to)) return null;
  const fyYear = fiscalYearOf(from, startMonth);
  const range = fiscalYearRange(fyYear, startMonth);
  return range.from === from && range.to === to ? fiscalYearLabel(fyYear, startMonth) : null;
}

/**
 * The fiscal years a selector should offer: the one containing `anchor`, and
 * the `back` years before it. Newest first, because that is the one being
 * closed.
 */
export function recentFiscalYears(anchor: string, startMonth: number, back = 3): number[] {
  const current = fiscalYearOf(anchor, startMonth);
  return Array.from({ length: back + 1 }, (_, i) => current - i);
}
