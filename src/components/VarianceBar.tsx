/**
 * VarianceBar — the signature element (frontend-plan §3).
 *
 * One shared zero axis down the middle of the column: under plan extends LEFT
 * in ledger green, over plan extends RIGHT in accounting red, all rows scaled
 * by the same `max` so the column reads as a tornado chart. Rows without
 * actuals draw hollow — visibly provisional.
 *
 * Geometry is a 1:1 port of design/prototype.html `varianceBar()`.
 * The svg stays aria-hidden; the shape is wrapped in a Tooltip trigger that
 * carries the accessible name and says the value in words, so the bar is a
 * real control rather than decoration.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const W = 150;
const H = 14;
const MID = W / 2;

export function VarianceBar({
  variance,
  max,
  hasActuals,
  label,
}: {
  variance: number;
  max: number;
  hasActuals: boolean;
  /** Overrides the generated sentence in the tooltip and the accessible name. */
  label?: string;
}) {
  // max === 0 (a range with no variance at all) would divide by zero.
  const w = max > 0 ? Math.max(2, (Math.abs(variance) / max) * (MID - 4)) : 2;
  const x = variance > 0 ? MID : MID - w;
  const over = variance > 0;

  const words =
    label ??
    (!hasActuals
      ? "no actuals recorded"
      : variance === 0
        ? "on plan"
        : `${formatMoney(Math.abs(variance))} ${over ? "over" : "under"} plan`);

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={words}
        className="inline-flex rounded-md align-middle focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          className="h-3.5 w-[150px] shrink-0 max-sm:w-20"
          preserveAspectRatio="none"
        >
          <line x1={MID} y1={0} x2={MID} y2={H} className="stroke-ink/20 stroke-1" />
          <rect
            x={x}
            y={2.5}
            width={w}
            height={H - 5}
            className={cn(
              "transition-[width] duration-[120ms] ease-out",
              hasActuals
                ? over
                  ? "fill-acct"
                  : "fill-ledger"
                : cn("fill-none stroke-[1.5]", over ? "stroke-acct" : "stroke-ledger")
            )}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{words}</TooltipContent>
    </Tooltip>
  );
}
