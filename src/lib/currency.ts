/**
 * THE currency list. Display ONLY — choosing one re-labels the ledger, it never
 * converts, and there are no FX rates in this product.
 *
 * Every code here has exactly TWO decimals, which is what lets money.ts keep its
 * "minor units are hundredths" contract. Adding one with a different exponent
 * (JPY 0, KWD 3) is NOT a new row here: it changes what every stored integer means.
 *
 * `grouping` is a locale for digit grouping only (INR groups at the lakh); the
 * decimal separator stays "." everywhere. AED prints as letters rather than د.إ
 * because an RTL glyph reorders a left-to-right accounting column.
 */
export const CURRENCIES = {
  USD: { symbol: "$", label: "US dollar", grouping: "en-US" },
  EUR: { symbol: "€", label: "Euro", grouping: "en-US" },
  GBP: { symbol: "£", label: "Pound sterling", grouping: "en-US" },
  INR: { symbol: "₹", label: "Indian rupee", grouping: "en-IN" },
  // Non-breaking, and written as an escape so it does not read as a typo.
  AED: { symbol: "AED\u00a0", label: "UAE dirham", grouping: "en-US" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

/** What an account created before the preference existed reads as. */
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export function isCurrency(v: unknown): v is CurrencyCode {
  return typeof v === "string" && v in CURRENCIES;
}
