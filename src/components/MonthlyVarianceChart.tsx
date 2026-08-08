"use client";

/**
 * MonthlyVarianceChart — the one Recharts chart in the product: net variance
 * per month, on shadcn's ChartContainer so it inherits the theme instead of
 * restyling recharts by hand. Ink axes, flat token fills (green under plan,
 * red over), zero reference line, no animation, no gradient. Values arrive as
 * minor units and are formatted by lib/money like every other figure.
 */
import { Bar, BarChart, type BarShapeProps, Rectangle, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatMoney } from "@/lib/money";
import { formatMonthLabel, isMonth } from "@/lib/month";

const chartConfig = {
  net: { label: "Net variance", color: "var(--color-ink)" },
} satisfies ChartConfig;

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)" };
const monthLabel = (m: unknown) => (isMonth(m) ? formatMonthLabel(m) : String(m));

/**
 * Per-datum fill. `<Cell>` is deprecated in recharts 3.10 (removed in 4.0); the
 * supported replacement is Bar's `shape`, which gets the same datum on `payload`.
 */
const varianceBar = (props: BarShapeProps) => {
  const net = (props.payload as { net: number } | undefined)?.net ?? 0;
  return <Rectangle {...props} fill={net > 0 ? "var(--color-acct)" : "var(--color-ledger)"} />;
};

export function MonthlyVarianceChart({ data }: { data: { month: string; net: number }[] }) {
  if (data.length === 0) return null;

  const summary = data
    .map(d => {
      const label = formatMonthLabel(d.month);
      if (d.net === 0) return `${label} on plan`;
      return `${label} ${d.net > 0 ? "over" : "under"} plan by ${formatMoney(Math.abs(d.net))}`;
    })
    .join("; ");

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-40 w-full"
      role="img"
      aria-label={`Net variance by month. ${summary}.`}
    >
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          tickFormatter={(v: number) => formatMoney(v)}
        />
        <ReferenceLine y={0} stroke="var(--color-ink)" />
        <ChartTooltip
          cursor={{ fill: "var(--color-bar)" }}
          content={
            <ChartTooltipContent
              labelFormatter={monthLabel}
              formatter={value => (
                <span className="flex flex-1 justify-between gap-3">
                  <span className="text-muted-foreground">Net variance</span>
                  <span className="font-mono tabular-nums">
                    {formatMoney(typeof value === "number" ? value : 0)}
                  </span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="net" isAnimationActive={false} maxBarSize={48} shape={varianceBar} />
      </BarChart>
    </ChartContainer>
  );
}
