"use client";

/**
 * MonthRangePicker — THE range control. Lives in the app header and drives
 * every tab through ?from=&to=.
 *
 * It is a real calendar (react-day-picker in range mode, two months visible),
 * not a pair of text boxes: you drag across the period you want. The ledger
 * works in whole months, so whichever days you touch are snapped outward to
 * month boundaries before they become the `YYYY-MM` keys lib/month.ts owns —
 * the highlight always covers entire months, which is what actually gets
 * reported on.
 */
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DateRange } from "react-day-picker";
import {
  endOfMonth,
  endOfQuarter,
  format,
  parse,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
} from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  CALENDAR_YEAR_START,
  MONTH_NAMES,
  fiscalYearLabel,
  fiscalYearRange,
  recentFiscalYears,
} from "@/lib/fiscalYear";
import { formatMonthLabel, isMonth } from "@/lib/month";
import { DEFAULT_RANGE } from "@/lib/range";
import { useApiMutation } from "@/lib/useApiMutation";

const toDate = (month: string) => parse(month, "yyyy-MM", new Date());
const toMonth = (date: Date) => format(date, "yyyy-MM");

/** The periods a finance user actually asks for, relative to the current range. */
function presets(anchor: Date) {
  return [
    { label: "This quarter", from: startOfQuarter(anchor), to: endOfQuarter(anchor) },
    { label: "Last 6 months", from: startOfMonth(subMonths(anchor, 5)), to: endOfMonth(anchor) },
    { label: "Year to date", from: startOfYear(anchor), to: endOfMonth(anchor) },
  ];
}

export function MonthRangePicker({ fiscalYearStartMonth }: { fiscalYearStartMonth: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const fromParam = params.get("from");
  const toParam = params.get("to");
  const from = isMonth(fromParam) ? fromParam : DEFAULT_RANGE.from;
  const to = isMonth(toParam) ? toParam : DEFAULT_RANGE.to;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const selected = draft ?? { from: startOfMonth(toDate(from)), to: endOfMonth(toDate(to)) };

  /**
   * Where the fiscal year starts is a saved preference, not a URL parameter:
   * it describes the business, not this particular look at the report. Saving
   * it re-renders the server tree, so the header's label and the FY buttons
   * below both follow in one hop.
   */
  const saveFiscalStart = useApiMutation<{ fiscalYearStartMonth: number }, { fiscalYearStartMonth: number }>({
    url: "/api/settings",
    method: "PUT",
    success: vars => `Fiscal year now starts in ${MONTH_NAMES[vars.fiscalYearStartMonth - 1]}`,
  });

  function commit(next: DateRange | undefined) {
    if (!next?.from || !next?.to) return;
    const a = toMonth(startOfMonth(next.from));
    const b = toMonth(startOfMonth(next.to));
    setOpen(false);
    setDraft(undefined);
    router.push(`${pathname}?from=${a <= b ? a : b}&to=${a <= b ? b : a}`);
  }

  /** A fiscal year is just a range, so it goes through the same commit path. */
  function commitFiscalYear(fyYear: number) {
    const { from: a, to: b } = fiscalYearRange(fyYear, fiscalYearStartMonth);
    setOpen(false);
    setDraft(undefined);
    router.push(`${pathname}?from=${a}&to=${b}`);
  }

  // Anchored on the range in view, not on today's date: scrolling back to 2024
  // should offer 2024's fiscal years, not this year's.
  const fiscalYears = recentFiscalYears(to, fiscalYearStartMonth);

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto font-mono"
          aria-label="Change the report range"
        >
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="max-sm:hidden">
            {formatMonthLabel(from)} - {formatMonthLabel(to)}
          </span>
          <span className="sm:hidden">Range</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex max-sm:flex-col">
          <div className="flex flex-col gap-1 p-2 max-sm:flex-row max-sm:flex-wrap">
            {presets(toDate(to)).map(p => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => commit({ from: p.from, to: p.to })}
              >
                {p.label}
              </Button>
            ))}

            <Separator className="my-1 max-sm:hidden" />

            {fiscalYears.map(fy => (
              <Button
                key={fy}
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => commitFiscalYear(fy)}
              >
                {fiscalYearLabel(fy, fiscalYearStartMonth)}
              </Button>
            ))}

            <div className="mt-1 grid gap-1 border-t pt-2 max-sm:w-full">
              <Label htmlFor="fy-start" className="text-[0.7rem] text-muted-foreground">
                Fiscal year starts
              </Label>
              <Select
                value={String(fiscalYearStartMonth)}
                disabled={saveFiscalStart.isPending}
                onValueChange={v => saveFiscalStart.mutate({ fiscalYearStartMonth: Number(v) })}
              >
                <SelectTrigger id="fy-start" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                      {i + 1 === CALENDAR_YEAR_START && " (calendar year)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator orientation="vertical" className="max-sm:hidden" />

          <div>
            <Calendar
              autoFocus
              mode="range"
              captionLayout="dropdown"
              numberOfMonths={2}
              defaultMonth={toDate(from)}
              selected={selected}
              onSelect={next => {
                setDraft(next);
                if (next?.from && next?.to) commit(next);
              }}
              className="max-sm:[--cell-size:--spacing(8)]"
            />
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Any day picks its whole month. Reporting is monthly.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
