/**
 * money.ts — THE only place money converts or formats. (DRY)
 * Storage & math: integer minor units. Display: derived here, nowhere else.
 *
 * Which currency to print is the caller's to say, never this module's: it is a
 * per-user preference (lib/currency.ts) and reading it from a module-level
 * default would be one process-wide value shared by every tenant. It arrives as
 * an argument or it falls back to USD.
 */
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

/** Comma groups, dot decimal \u2014 the separators everyone reads without effort. */
const GROUP = ",";
const DECIMAL = ".";

/**
 * Accounting display: currency symbol, comma grouping, two decimals, and
 * negatives in parentheses AROUND the symbol \u2014 ($1,200.00) \u2014 which is how a
 * ledger prints a credit.
 *
 * The plan's original thin-space grouping (`1 200.00`) is typographically the
 * nicer mark and is what a printed annual report uses, but on screen at 14px it
 * reads as a gap rather than a separator and people slow down counting digits.
 * A comma is unambiguous at a glance, which is the job here.
 *
 * The pair is FIXED rather than taken from the locale, and that is deliberate:
 * the two marks have to be chosen together or they collide. de-DE groups with
 * the dot it also uses as a decimal, so borrowing its group mark while keeping
 * the house "." decimal would print 20.500.00 \u2014 a number with two meanings.
 *
 * What the locale IS asked for is where the groups FALL, via `formatToParts`,
 * because that genuinely differs: en-IN puts them at the lakh and crore, so an
 * Indian reader gets 20,50,000.00 instead of the 2,050,000.00 they would have
 * to re-count. Reading the `group` parts by name (rather than string-replacing
 * whatever separator came out) is what keeps the two decisions independent.
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
