/**
 * MoneyText — THE money renderer. Minor units in, accounting display out.
 * No screen calls formatMoney itself; every figure in the app goes through here
 * so grouping, cents and parenthesised negatives can only be defined once.
 *
 * It is a primitive: mono, tabular, non-wrapping, and deliberately colourless —
 * the caller decides whether a figure is `text-ledger`, `text-acct` or plain ink.
 *
 * `currency` is required rather than defaulted. It is a per-user preference, so
 * a call site that forgets it would print one tenant's figures in another's
 * symbol — the kind of miss worth spending a compiler error on.
 */
import { type CurrencyCode } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function MoneyText({
  minor,
  currency,
  className,
  showZero = true,
}: {
  minor: number;
  currency: CurrencyCode;
  className?: string;
  /** false renders an em dash for 0 — for "no target" / "no actuals" cells. */
  showZero?: boolean;
}) {
  return (
    <span className={cn("font-mono whitespace-nowrap tabular-nums", className)}>
      {minor === 0 && !showZero ? "—" : formatMoney(minor, currency)}
    </span>
  );
}
