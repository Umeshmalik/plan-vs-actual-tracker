// Every number comes from runReport(); the only arithmetic here is presentation
// scale (the shared bar axis).
import Link from "next/link";
import { Download, Lock, Minus, Receipt, Target, TrendingDown, TrendingUp } from "lucide-react";
import { requireRepo } from "@/lib/auth";
import { resolveRange, type SearchParams } from "@/lib/range";
import { formatMonthLabel, monthRange } from "@/lib/month";
import { formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getReport, getSettings } from "@/lib/reads";
import { labelIfFiscalYear } from "@/lib/fiscalYear";
import type { VarianceRow } from "@/lib/variance";
import { MoneyText } from "@/components/MoneyText";
import { VarianceBar, varianceTone as tone } from "@/components/VarianceBar";
import { DataTable, type Column } from "@/components/DataTable";
import { LockChip } from "@/components/LockChip";
import { EmptyState } from "@/components/EmptyState";
import { CategoryVarianceChart } from "@/components/CategoryVarianceChart";
import { MonthlyVarianceChart } from "@/components/MonthlyVarianceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";

/** The sign, said in words, so colour is never the only carrier. */
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
  const [{ rows, totals, lockedMonths }, { fiscalYearStartMonth, currency }] = await Promise.all([
    getReport(String(repo.uid), from, to),
    getSettings(String(repo.uid)),
  ]);
  const fyLabel = labelIfFiscalYear(from, to, fiscalYearStartMonth);

  const title = (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Variance report</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {formatMonthLabel(from)} - {formatMonthLabel(to)}
          {fyLabel && <span className="ml-2 text-foreground">{fyLabel}</span>}
        </p>
      </div>
      {rows.length > 0 && (
        // A plain link: the route already sends content-disposition: attachment,
        // so no client JS has to hold the file in memory.
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
  /** One shared zero axis for every bar in the column. */
  const maxVar = Math.max(...rows.map(r => Math.abs(r.variance)));
  // From the range, not the rows, so an untouched month keeps its slot.
  const months = monthRange(from, to);
  const showMonthly = from !== to;

  const VarianceIcon = totals.variance < 0 ? TrendingDown : totals.variance > 0 ? TrendingUp : Minus;

  /** The Actuals screen IS the detail view for one cell; from/to ride along so the range survives. */
  const drillDown = (r: VarianceRow) =>
    `/actuals?categoryId=${r.categoryId}&month=${r.month}&from=${from}&to=${to}`;

  const columns: Column<VarianceRow>[] = [
    {
      key: "category",
      header: "Category",
      render: r => (
        <Link
          href={drillDown(r)}
          className="underline-offset-4 hover:underline focus-visible:underline"
          aria-label={`${r.categoryName}, ${formatMonthLabel(r.month)} — open the entries behind this row`}
        >
          {r.categoryName}
        </Link>
      ),
    },
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
      // Badge BEFORE the figure so every numeral keeps the cell's right edge.
      render: r => (
        <span className="inline-flex items-center justify-end gap-2">
          {!r.hasPlan && (
            <Badge variant="secondary" className="font-sans font-normal">
              no target
            </Badge>
          )}
          <MoneyText currency={currency} minor={r.plan} showZero={r.hasPlan} />
        </span>
      ),
    },
    {
      key: "actual",
      header: "Actual",
      numeric: true,
      render: r => (
        <span className="inline-flex items-center justify-end gap-2">
          {!r.hasActuals && (
            <Badge variant="secondary" className="font-sans font-normal">
              no actuals
            </Badge>
          )}
          <MoneyText currency={currency} minor={r.actual} />
        </span>
      ),
    },
    {
      key: "variance",
      header: "Variance",
      numeric: true,
      width: "280px",
      // A grid, not flex justify-end: a numeral's width would otherwise push the
      // bar sideways and every row's zero axis would land somewhere else.
      render: r => (
        <span className="grid grid-cols-[auto_1fr] items-center gap-2.5">
          <VarianceBar variance={r.variance} max={maxVar} hasActuals={r.hasActuals} currency={currency} />
          <MoneyText currency={currency} minor={r.variance} className={cn("text-right", tone(r.variance))} />
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
          <MoneyText currency={currency} minor={totals.plan} className="text-base" />
        </SummaryCard>

        <SummaryCard label="Actual" icon={Receipt}>
          <MoneyText currency={currency} minor={totals.actual} className="text-base" />
        </SummaryCard>

        <SummaryCard label="Variance" icon={VarianceIcon}>
          <MoneyText
            currency={currency}
            minor={totals.variance}
            className={cn("text-base", tone(totals.variance))}
          />
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

      {/* items-start: a short category list must not stretch to the taller chart. */}
      <div className={cn("mb-5 grid items-start gap-3", showMonthly && "xl:grid-cols-2")}>
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Where the variance is</CardTitle>
            <CardDescription>
              Every category in the range, largest miss first — left of the axis is under plan, right of it is
              over.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryVarianceChart rows={rows} from={from} to={to} currency={currency} />
          </CardContent>
        </Card>

        {showMonthly && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Variance by month</CardTitle>
              <CardDescription>
                One segment per category, stacked from the axis: above it is over plan, below it is under. The
                two ends are the month&rsquo;s gross over and gross under — they are never netted against each
                other.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MonthlyVarianceChart rows={rows} months={months} currency={currency} />
            </CardContent>
          </Card>
        )}
      </div>

      <DataTable
        caption="Variance by category and month · select a category to see the entries behind its row"
        columns={columns}
        rows={rows}
        rowKey={r => `${r.categoryId}-${r.month}`}
        rowClassName={r => (locked.has(r.month) ? "bg-bar-locked hover:bg-bar-locked" : undefined)}
        footer={
          <TableRow>
            <TableCell colSpan={2}>Range total</TableCell>
            <TableCell className="text-right">
              <MoneyText currency={currency} minor={totals.plan} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText currency={currency} minor={totals.actual} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText currency={currency} minor={totals.variance} className={tone(totals.variance)} />
            </TableCell>
            <TableCell className={cn("text-right font-mono max-sm:hidden", tone(totals.variance))}>
              {formatPct(totals.variancePct)}
            </TableCell>
          </TableRow>
        }
      />
    </>
  );
}
