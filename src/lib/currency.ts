/**
 * currency.ts — THE currency list. (DRY)
 *
 * Display only. Choosing a currency RE-LABELS the ledger, it does not convert
 * it: 5 000 stored is 5 000 whether it is read as dollars or rupees. There are
 * no FX rates in this product and a stored amount carries no currency of its
 * own — the preference says how to render figures, nothing more. The picker
 * says so out loud, because a user who thinks switching converts their book is
 * a user with wrong numbers.
 *
 * Every code here has exactly TWO decimal places, and that is what lets
 * money.ts keep its "minor units are hundredths" contract untouched. Adding a
 * currency with a different exponent (JPY has 0, KWD has 3) is NOT a new row in
 * this table: it changes what a stored integer means, so toMinor/toMajor, the
 * CSV import, the seed and every document already written would all have to be
 * reckoned with first.
 *
 * `grouping` is a locale used for digit grouping ONLY — the decimal separator
 * stays "." everywhere, because the app's numerals are one house format and not
 * a localisation. It exists for INR, whose readers expect 2,05,000 rather than
 * 205,000; the rest group in threes.
 *
 * AED prints as "AED" rather than "د.إ" on purpose: an RTL glyph inside a
 * left-to-right accounting column reorders the line in some renderers, and a
 * misplaced minus sign in a ledger is not a cosmetic problem.
 */
export const CURRENCIES = {
  USD: { symbol: "$", label: "US dollar", grouping: "en-US" },
  EUR: { symbol: "€", label: "Euro", grouping: "en-US" },
  GBP: { symbol: "£", label: "Pound sterling", grouping: "en-US" },
  INR: { symbol: "₹", label: "Indian rupee", grouping: "en-IN" },
  // Non-breaking, and written as an escape: the gap is load-bearing (a letter
  // symbol needs separating from the first digit), it must never be the place a
  // line wraps, and a literal space here would read as a typo in review.
  AED: { symbol: "AED\u00a0", label: "UAE dirham", grouping: "en-US" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

/** What an account created before the preference existed reads as. */
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export function isCurrency(v: unknown): v is CurrencyCode {
  return typeof v === "string" && v in CURRENCIES;
}
