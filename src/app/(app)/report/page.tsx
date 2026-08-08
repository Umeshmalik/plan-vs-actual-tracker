/**
 * Report — the hero screen. Every number on it comes from runReport(); the page
 * does no money or variance math. The only arithmetic here is presentation
 * scale: the shared bar axis (max |variance|) and the per-month net for the
 * chart, both sums of server-computed values.
 *
 * Construction is shadcn: Card for the summary and the chart panel, DataTable
 * (shadcn Table) for the ledger, Badge for row provisos, Button for the one
 * action on the empty state. Nothing here imitates a component with utilities.
 */
import Link from "next/link";
import { Download, Lock, Minus, Receipt, Target, TrendingDown, TrendingUp } from "lucide-react";
import { requireRepo } from "@/lib/auth";
import { resolveRange, type SearchParams } from "@/lib/range";
import { formatMonthLabel, monthRange } from "@/lib/month";
import { formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getReport } from "@/lib/reads";
import type { VarianceRow } from "@/lib/variance";
import { MoneyText } from "@/components/MoneyText";
import { VarianceBar } from "@/components/VarianceBar";
import { DataTable, type Column } from "@/components/DataTable";
import { LockChip } from "@/components/LockChip";
import { EmptyState } from "@/components/EmptyState";
import { MonthlyVarianceChart } from "@/components/MonthlyVarianceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";

/** Sign colour — semantic only: negative variance = under plan = favourable. */
const tone = (v: number) => (v < 0 ? "text-ledger" : v > 0 ? "text-acct" : undefined);

/** The same sign, said in words, so colour is never the only carrier. */
const direction = (v: number) => (v < 0 ? "under plan" : v > 0 ? "over plan" : "on plan");

function SummaryCard({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-sans text-[0.7rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to } = resolveRange(sp);
  const repo = await requireRepo(); // authenticate first — the cache never decides who is asking
  const { rows, totals, lockedMonths } = await getReport(String(repo.uid), from, to);

  const title = (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Variance report</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {formatMonthLabel(from)} – {formatMonthLabel(to)}
        </p>
      </div>
      {rows.length > 0 && (
        // A plain link, not a fetch-then-blob: the route already answers with
        // `content-disposition: attachment`, so the browser downloads it and no
        // client JavaScript has to hold the file in memory. `download` keeps the
        // filename if a browser ever ignores the header.
        <Button asChild variant="outline" size="sm">
          <a href={`/api/report/export?from=${from}&to=${to}`} download>
            <Download aria-hidden />
            <span className="max-sm:hidden">Export CSV</span>
          </a>
        </Button>
      )}
    </div>
  );

  if (rows.length === 0) {
    return (
      <>
        {title}
        <EmptyState
          title="No targets for this range yet"
          body="Set a monthly target per category, then log spend against it to see variance here."
          action={
            <Button asChild>
              <Link href={`/plans?from=${from}&to=${to}`}>Set {formatMonthLabel(from)} targets</Link>
            </Button>
          }
        />
      </>
    );
  }

  const locked = new Set(lockedMonths);
  // Presentation scale: one shared zero axis for every bar in the column.
  const maxVar = Math.max(...rows.map(r => Math.abs(r.variance)));
  // Presentation only: net of server variances per month; months come from the
  // range so a month with no rows still gets a slot on the axis.
  const chart = monthRange(from, to).map(month => ({
    month,
    net: rows.reduce((sum, r) => (r.month === month ? sum + r.variance : sum), 0),
  }));

  const VarianceIcon = totals.variance < 0 ? TrendingDown : totals.variance > 0 ? TrendingUp : Minus;

  const columns: Column<VarianceRow>[] = [
    { key: "category", header: "Category", render: r => r.categoryName },
    {
      key: "month",
      header: "Month",
      render: r => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="font-mono">{r.month}</span>
          {locked.has(r.month) && <LockChip label="closed" />}
        </span>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      numeric: true,
      // showZero=false is exactly the "—" the prototype prints for no target.
      render: r => (
        <span className="inline-flex items-center justify-end gap-2">
          <MoneyText minor={r.plan} showZero={r.hasPlan} />
          {!r.hasPlan && (
            <Badge variant="secondary" className="font-sans font-normal">
              no target
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "actual",
      header: "Actual",
      numeric: true,
      render: r => (
        <span className="inline-flex items-center justify-end gap-2">
          <MoneyText minor={r.actual} />
          {!r.hasActuals && (
            <Badge variant="secondary" className="font-sans font-normal">
              no actuals
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      width: "280px",
      render: r => (
        <span className="flex items-center justify-end gap-2.5">
          <VarianceBar variance={r.variance} max={maxVar} hasActuals={r.hasActuals} />
          <MoneyText minor={r.variance} className={tone(r.variance)} />
        </span>
      ),
    },
    {
      key: "variancePct",
      header: "Var %",
      numeric: true,
      hideSm: true,
      render: r => <span className={tone(r.variance)}>{formatPct(r.variancePct)}</span>,
    },
  ];

  return (
    <>
      {title}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Plan" icon={Target}>
          <MoneyText minor={totals.plan} className="text-base" />
        </SummaryCard>

        <SummaryCard label="Actual" icon={Receipt}>
          <MoneyText minor={totals.actual} className="text-base" />
        </SummaryCard>

        <SummaryCard label="Variance" icon={VarianceIcon}>
          <MoneyText minor={totals.variance} className={cn("text-base", tone(totals.variance))} />
          <p className="text-xs text-muted-foreground">{direction(totals.variance)}</p>
        </SummaryCard>

        <SummaryCard label="Closed periods" icon={Lock}>
          {lockedMonths.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {lockedMonths.map(m => (
                <LockChip key={m} month={m} />
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">no closed periods</span>
          )}
        </SummaryCard>
      </div>

      <DataTable
        caption="Variance by category and month"
        columns={columns}
        rows={rows}
        rowKey={r => `${r.categoryId}-${r.month}`}
        // hover: pinned too, so a closed period keeps its tint under the cursor
        rowClassName={r => (locked.has(r.month) ? "bg-bar-locked hover:bg-bar-locked" : undefined)}
        footer={
          <TableRow>
            <TableCell colSpan={2}>Range total</TableCell>
            <TableCell className="text-right">
              <MoneyText minor={totals.plan} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText minor={totals.actual} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText minor={totals.variance} className={tone(totals.variance)} />
            </TableCell>
            <TableCell className={cn("text-right font-mono max-sm:hidden", tone(totals.variance))}>
              {formatPct(totals.variancePct)}
            </TableCell>
          </TableRow>
        }
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display">Monthly net variance</CardTitle>
          <CardDescription>
            Each bar nets that month&rsquo;s variances: below the axis is under plan, above it is over plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyVarianceChart data={chart} />
        </CardContent>
      </Card>
    </>
  );
}
