"use client";

/**
 * Variance per month as a DIVERGING STACKED bar — one segment per category, so
 * an overspend and an equal underspend cannot cancel into a month that looks
 * on plan. A month with no data is not a zero bar; `hasData:false` is said in
 * words instead. Grouping is byMonth/byCategory in lib/variance.ts.
 *
 * Segments use a FUNCTION dataKey: recharts reads a dot in a string key as a
 * nested path, and a category may be called "R&D. Misc".
 */
import { Bar, BarChart, type BarShapeProps, Rectangle, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { varianceTone } from "@/components/VarianceBar";
import { type CurrencyCode } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { formatMonthLabel, isMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { byCategory, byMonth, type MonthVariance, type VarianceRow } from "@/lib/variance";

/** Empty on purpose: no named series, and both poles are already tokens. */
const chartConfig = {} satisfies ChartConfig;

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)" };
const GAP = 2;
const TOOLTIP_ROWS = 6;
const NAME_EMPTY_UP_TO = 3;

const monthLabel = (m: unknown) => (isMonth(m) ? formatMonthLabel(m) : String(m));

/**
 * A bar rect inset by the surface gap. Recharts hands back a NEGATIVE height for
 * a segment below the axis, so the min/abs normalisation is load-bearing —
 * insetting naively draws every under-plan segment as a 1px hairline.
 * Exported for tests/chartGeometry.test.ts.
 */
export function segmentRect(y: number, height: number, gap = GAP) {
  return {
    y: Math.min(y, y + height) + gap / 2,
    height: Math.max(Math.abs(height) - gap, 1),
  };
}

/** `<Cell>` is deprecated in recharts 3.10; Bar's `shape` is the replacement. */
const segment = (id: string) =>
  function Segment(props: BarShapeProps) {
    const v = (props.payload as MonthVariance | undefined)?.byCategory[id] ?? 0;
    // Without this the gap inset draws a zero segment as a rule on the axis.
    if (v === 0) return <g />;
    return (
      <Rectangle
        {...props}
        {...segmentRect(props.y, props.height)}
        fill={v > 0 ? "var(--color-acct)" : "var(--color-ledger)"}
      />
    );
  };

// Recharts clones this with active/payload, hence the optionals. Figures come
// off the datum: under stackOffset="sign" an entry may carry the stacked range.
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

/** The plot in words. Never claims "on plan" for a month with no data. */
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
  // By |range variance|, so the stacking order is stable across renders.
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
        // An empty slot looks exactly like a month that landed on plan.
        <p className="pt-2 text-xs text-muted-foreground">
          {empty.length <= NAME_EMPTY_UP_TO
            ? `No plans or actuals in ${empty.map(d => formatMonthLabel(d.month)).join(", ")}.`
            : `${empty.length} of the ${data.length} months in this range have no plans or actuals.`}
        </p>
      )}
    </>
  );
}
