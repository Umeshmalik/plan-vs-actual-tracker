// THE only place money converts or formats. Storage and math are integer minor
// units. Currency is the CALLER's to pass — a module-level default would be one
// process-wide value shared across tenants.
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "./currency";

export type MinorUnits = number; // integer

export function toMinor(major: number | string): MinorUnits {
  const n = typeof major === "string" ? Number(major) : major;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${major}`);
  return Math.round(n * 100);
}

export function toMajor(minor: MinorUnits): number {
  return minor / 100;
}

const GROUP = ",";
const DECIMAL = ".";

/**
 * Accounting display: ($1,200.00) for negatives. The separator pair is FIXED —
 * borrowing a locale's group mark while keeping the house "." decimal prints
 * 20.500.00. Only where the groups FALL comes from the locale, via formatToParts,
 * because en-IN groups at the lakh and crore.
 */
export function formatMoney(minor: MinorUnits, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  const { symbol, grouping } = CURRENCIES[currency] ?? CURRENCIES[DEFAULT_CURRENCY];
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = new Intl.NumberFormat(grouping)
    .formatToParts(major)
    .map(p => (p.type === "group" ? GROUP : p.value))
    .join("");
  const s = `${symbol}${grouped}${DECIMAL}${cents}`;
  return minor < 0 ? `(${s})` : s;
}

/** Signed variance % display: +2.50% / (4.00%) / — for null. */
export function formatPct(pct: number | null): string {
  if (pct === null) return "\u2014";
  const s = Math.abs(pct).toFixed(2) + "%";
  return pct < 0 ? `(${s})` : `+${s}`;
}
