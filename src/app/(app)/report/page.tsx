/**
 * Report — the hero screen. Every number on it comes from runReport(); the page
 * does no money or variance math. The only arithmetic here is presentation
 * scale: the shared bar axis (max |variance|) for the table's variance column.
 *
 * Reading order is headline -> shape -> detail: the summary tiles, then the two
 * charts, then the ledger. The charts used to sit under a table that can run to
 * hundreds of rows, which is the same as not shipping them.
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
  // Only when the range IS exactly one fiscal year — an arbitrary twelve-month
  // selection must not be labelled as one.
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
  // Months come from the range, not from the rows, so a month nobody touched
  // still gets its slot on the axis. The page hands the chart the rows and
  // does no aggregation of its own: netting a month is exactly what used to
  // let an overspend and an underspend cancel each other out of the picture.
  const months = monthRange(from, to);
  // A one-month range is already its own picture — the ranked chart shows the
  // same categories, and a single stacked bar would only restate the Variance
  // tile three inches above it.
  const showMonthly = from !== to;

  const VarianceIcon = totals.variance < 0 ? TrendingDown : totals.variance > 0 ? TrendingUp : Minus;

  /**
   * Drill-down. The Actuals screen already IS the detail view for one
   * category x month — it reads `?categoryId=&month=` and shows that cell's
   * entry, its note and its provenance beside the form that edits it. So the
   * feature is a link to it, not a second screen that would have to be kept in
   * agreement with the first.
   *
   * `from`/`to` ride along so the header's range survives the trip and the
   * back button lands on the same report.
   */
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
          // The row already says the month; a screen reader arriving at the
          // link out of context should hear which cell it opens.
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
      // showZero=false is exactly the "—" the prototype prints for no target.
      // The badge sits BEFORE the figure so the figure keeps the cell's right
      // edge: trailing it pushed the numeral left on exactly the rows that have
      // one, and a ledger column whose numerals do not share an edge is unreadable.
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
      // A grid, not `flex justify-end`: right-justifying the pair let the width
      // of the numeral push the bar sideways, so every row's zero axis landed
      // somewhere else and the column stopped being a tornado chart. Fixed
      // first column = one shared axis; the numeral right-aligns in the rest.
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

      {/* items-start: a short category list must not be stretched into a tall
          card of white space just because the chart beside it is taller. */}
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
        // hover: pinned too, so a closed period keeps its tint under the cursor
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
