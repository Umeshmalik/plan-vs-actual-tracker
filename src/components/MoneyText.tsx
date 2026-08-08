/**
 * MoneyText — THE money renderer. Minor units in, accounting display out.
 * No screen calls formatMoney itself; every figure in the app goes through here
 * so grouping, cents and parenthesised negatives can only be defined once.
 *
 * It is a primitive: mono, tabular, non-wrapping, and deliberately colourless —
 * the caller decides whether a figure is `text-ledger`, `text-acct` or plain ink.
 */
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function MoneyText({
  minor,
  className,
  showZero = true,
}: {
  minor: number;
  className?: string;
  /** false renders an em dash for 0 — for "no target" / "no actuals" cells. */
  showZero?: boolean;
}) {
  return (
    <span className={cn("font-mono whitespace-nowrap tabular-nums", className)}>
      {minor === 0 && !showZero ? "—" : formatMoney(minor)}
    </span>
  );
}
