"use client";

/**
 * MonthlyVarianceChart — variance per month as a DIVERGING STACKED bar.
 *
 * It used to net each month into a single bar, which is the one thing this
 * chart must not do: an overspend and an underspend of the same size cancel to
 * nothing, so a month where two categories both missed badly drew as a month
 * that landed on plan. Every category is now its own segment — over plan
 * stacks up in accounting red, under plan stacks down in ledger green, via
 * recharts `stackOffset="sign"`. The two ends read as the month's gross over
 * and gross under, the net is the distance between them, and nothing cancels.
 *
 * A month with no plans and no actuals is NOT a zero bar. Zero means "landed
 * exactly on plan", and the two have to stay distinguishable — the same
 * distinction the table draws with `hasActuals`. Those months carry
 * `hasData:false`, which the tooltip, the accessible summary and a note under
 * the plot all say out loud rather than drawing an empty slot and hoping.
 *
 * Segments read their value through a function dataKey rather than a string:
 * recharts treats a dataKey containing dots as a nested path, and a category
 * may well be called "R&D. Misc".
 *
 * The grouping itself is `byMonth`/`byCategory` in lib/variance.ts — pure and
 * unit-tested beside the rest of the variance math. This file only draws it.
 *
 * On shadcn's ChartContainer so it inherits the theme instead of restyling
 * recharts by hand. Ink axes, flat token fills, zero reference line, no
 * animation, no gradient. Values arrive as minor units and are formatted by
 * lib/money like every other figure.
 */
import { Bar, BarChart, type BarShapeProps, Rectangle, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { varianceTone } from "@/components/VarianceBar";
import { type CurrencyCode } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { formatMonthLabel, isMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { byCategory, byMonth, type MonthVariance, type VarianceRow } from "@/lib/variance";

/**
 * Empty on purpose. ChartContainer wants a config to inject CSS variables for
 * named series; this chart has no named series — it has one measure and two
 * poles, and both are already tokens. Nothing to declare.
 */
const chartConfig = {} satisfies ChartConfig;

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)" };
/** Surface gap between stacked segments — a rule between fills, never a border. */
const GAP = 2;
/** A twenty-row tooltip is unreadable; the rest of the month is in the table. */
const TOOLTIP_ROWS = 6;
/** Past this, naming every empty month is longer than the chart it explains. */
const NAME_EMPTY_UP_TO = 3;

const monthLabel = (m: unknown) => (isMonth(m) ? formatMonthLabel(m) : String(m));

/**
 * A recharts bar rect, inset by the surface gap.
 *
 * The normalisation is the whole point. Recharts computes a segment as
 * `y = scale(end)` and `height = scale(start) - scale(end)` (Bar.js), and pixel
 * y grows DOWNWARD — so for a segment below the axis the height comes back
 * NEGATIVE and `y` is its bottom edge, not its top. Insetting that naively
 * (`height - GAP`) drives an already-negative number further negative, the
 * `Math.max(…, 1)` floor catches it, and every under-plan segment draws as a
 * 1px hairline parked at the far end of the block it should have filled —
 * which reads on screen as a stray line with a large gap above it.
 *
 * Taking `min(y, y + height)` for the top and `abs(height)` for the size is
 * correct under both sign conventions, so it stays right if recharts ever
 * normalises this itself.
 *
 * Exported for `tests/chartGeometry.test.ts`: this is sign arithmetic that
 * fails silently and looks like a data problem rather than a drawing one.
 */
export function segmentRect(y: number, height: number, gap = GAP) {
  return {
    y: Math.min(y, y + height) + gap / 2,
    // A segment thinner than the gap still has to be visible, hence the floor.
    height: Math.max(Math.abs(height) - gap, 1),
  };
}

/**
 * Per-segment fill and geometry. `<Cell>` is deprecated in recharts 3.10
 * (removed in 4.0); Bar's `shape` is the supported replacement and gets the
 * whole datum on `payload`, so a segment can read its own signed value and pick
 * its pole.
 */
const segment = (id: string) =>
  function Segment(props: BarShapeProps) {
    const v = (props.payload as MonthVariance | undefined)?.byCategory[id] ?? 0;
    // A zero segment has no height. Without this guard the gap inset would
    // still draw it as a 1px rule sitting on the axis.
    if (v === 0) return <g />;
    return (
      <Rectangle
        {...props}
        {...segmentRect(props.y, props.height)}
        fill={v > 0 ? "var(--color-acct)" : "var(--color-ledger)"}
      />
    );
  };

/**
 * Recharts clones the element it is handed with `active`/`payload`, which is
 * why those two are optional. Figures are read off the datum rather than off
 * the payload entries: under `stackOffset="sign"` an entry can carry the
 * stacked range instead of the value, and the datum always has the value.
 */
function MonthTooltip({
  active,
  payload,
  names,
  currency,
}: {
  active?: boolean;
  payload?: { payload?: unknown }[];
  names: { categoryId: string; categoryName: string }[];
  currency: CurrencyCode;
}) {
  const datum = payload?.[0]?.payload as MonthVariance | undefined;
  if (!active || !datum) return null;

  const items = names
    .map(c => ({ name: c.categoryName, v: datum.byCategory[c.categoryId] ?? 0 }))
    .filter(i => i.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const hidden = items.length - TOOLTIP_ROWS;

  return (
    <div className="grid min-w-44 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{formatMonthLabel(datum.month)}</div>
      {!datum.hasData ? (
        <div className="text-muted-foreground">no plans or actuals</div>
      ) : (
        <>
          <div className="grid gap-1">
            {items.slice(0, TOOLTIP_ROWS).map(i => (
              <div key={i.name} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{i.name}</span>
                <span className={cn("font-mono tabular-nums", varianceTone(i.v))}>
                  {formatMoney(i.v, currency)}
                </span>
              </div>
            ))}
            {hidden > 0 && <div className="text-muted-foreground">+ {hidden} more</div>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-1">
            <span>Net</span>
            <span className={cn("font-mono tabular-nums", varianceTone(datum.net))}>
              {formatMoney(datum.net, currency)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** The plot in words. It must never claim "on plan" for a month with no data. */
const describe = (data: MonthVariance[], currency: CurrencyCode) =>
  data
    .map(d => {
      const label = formatMonthLabel(d.month);
      if (!d.hasData) return `${label} no plans or actuals`;
      const net =
        d.net === 0
          ? "on plan"
          : `${formatMoney(Math.abs(d.net), currency)} ${d.net > 0 ? "over" : "under"} plan`;
      return `${label} ${formatMoney(d.over, currency)} over and ${formatMoney(Math.abs(d.under), currency)} under, net ${net}`;
    })
    .join("; ");

export function MonthlyVarianceChart({
  rows,
  months,
  currency,
}: {
  rows: VarianceRow[];
  months: string[];
  currency: CurrencyCode;
}) {
  if (months.length === 0) return null;

  const data = byMonth(rows, months);
  // Ordered by |range variance|, so the biggest contributor sits nearest the
  // axis and the stacking order is the same on every render.
  const names = byCategory(rows);
  const empty = data.filter(d => !d.hasData);

  return (
    <>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-56 w-full"
        role="img"
        aria-label={`Variance by month and category. ${describe(data, currency)}.`}
      >
        <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="month"
            stroke="var(--color-ink)"
            tick={TICK}
            tickLine={false}
            tickFormatter={monthLabel}
          />
          <YAxis
            stroke="var(--color-ink)"
            tick={TICK}
            tickLine={false}
            width={72}
            tickFormatter={(v: number) => formatMoney(v, currency)}
          />
          <ReferenceLine y={0} stroke="var(--color-ink)" />
          <ChartTooltip
            cursor={{ fill: "var(--color-bar)" }}
            content={<MonthTooltip names={names} currency={currency} />}
          />
          {names.map(c => (
            <Bar
              key={c.categoryId}
              dataKey={(d: MonthVariance) => d.byCategory[c.categoryId] ?? 0}
              stackId="variance"
              isAnimationActive={false}
              maxBarSize={48}
              shape={segment(c.categoryId)}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {empty.length > 0 && (
        // An empty slot on the axis is indistinguishable from a month that
        // landed exactly on plan, so the difference is said in words. Naming
        // every one of them stops helping once the list is longer than a line.
        <p className="pt-2 text-xs text-muted-foreground">
          {empty.length <= NAME_EMPTY_UP_TO
            ? `No plans or actuals in ${empty.map(d => formatMonthLabel(d.month)).join(", ")}.`
            : `${empty.length} of the ${data.length} months in this range have no plans or actuals.`}
        </p>
      )}
    </>
  );
}
