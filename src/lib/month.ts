/**
 * month.ts — THE only month logic. (DRY)
 * Months are "YYYY-MM" strings: lexicographic order == chronological order,
 * so range queries are plain $gte/$lte with zero timezone handling.
 */

const RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && RE.test(v);
}

export function assertMonth(v: string): string {
  if (!isMonth(v)) throw new Error(`Invalid month "${v}" — expected YYYY-MM`);
  return v;
}

export function compareMonths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01" -> "Jan 2026". THE month label, no Date/timezone involved. */
export function formatMonthLabel(month: string): string {
  assertMonth(month);
  const [y, m] = month.split("-");
  return `${NAMES[Number(m) - 1]} ${y}`;
}

/** Inclusive list of months from..to, e.g. for report column axes. */
export function monthRange(from: string, to: string): string[] {
  assertMonth(from);
  assertMonth(to);
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  while (true) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    out.push(cur);
    if (cur === to) break;
    if (out.length > 120) throw new Error("Range exceeds 10 years");
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
