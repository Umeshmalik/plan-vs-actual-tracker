/**
 * THE fiscal-year rule: twelve months from `startMonth`, named by the calendar
 * year it STARTS in. Since that convention is not universal, a span always
 * renders as "FY 2026/27" rather than a bare "FY 2026".
 */
import { isMonth } from "./month";

/** startMonth 1 = January = the calendar year. */
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
  // Let the division carry the year so a December start rolls to November.
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

/** Null unless the range is EXACTLY one fiscal year; the caller then prints the month span. */
export function labelIfFiscalYear(from: string, to: string, startMonth: number): string | null {
  if (!isMonth(from) || !isMonth(to)) return null;
  const fyYear = fiscalYearOf(from, startMonth);
  const range = fiscalYearRange(fyYear, startMonth);
  return range.from === from && range.to === to ? fiscalYearLabel(fyYear, startMonth) : null;
}

/** The year containing `anchor` plus the `back` before it, newest first. */
export function recentFiscalYears(anchor: string, startMonth: number, back = 3): number[] {
  const current = fiscalYearOf(anchor, startMonth);
  return Array.from({ length: back + 1 }, (_, i) => current - i);
}
