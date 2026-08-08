/**
 * money.ts — THE only place money converts or formats. (DRY)
 * Storage & math: integer minor units. Display: derived here, nowhere else.
 */

export type MinorUnits = number; // integer

export function toMinor(major: number | string): MinorUnits {
  const n = typeof major === "string" ? Number(major) : major;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${major}`);
  return Math.round(n * 100);
}

export function toMajor(minor: MinorUnits): number {
  return minor / 100;
}

/** Accounting display: thin-space grouping, negatives in parentheses. */
export function formatMoney(minor: MinorUnits): string {
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = major.toLocaleString("en-US").replace(/,/g, "\u2009");
  const s = `${grouped}.${cents}`;
  return minor < 0 ? `(${s})` : s;
}

/** Signed variance % display: +2.50% / (4.00%) / — for null. */
export function formatPct(pct: number | null): string {
  if (pct === null) return "\u2014";
  const s = Math.abs(pct).toFixed(2) + "%";
  return pct < 0 ? `(${s})` : `+${s}`;
}
