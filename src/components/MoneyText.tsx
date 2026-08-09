/**
 * THE money renderer: minor units in, accounting display out. Deliberately
 * colourless — the caller picks the tone. `currency` is required rather than
 * defaulted, so a forgetful call site cannot print another tenant's symbol.
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
