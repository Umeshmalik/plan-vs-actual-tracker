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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { formatMonthLabel, isMonth } from "@/lib/month";
import { DEFAULT_RANGE } from "@/lib/range";

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

export function MonthRangePicker() {
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

  function commit(next: DateRange | undefined) {
    if (!next?.from || !next?.to) return;
    const a = toMonth(startOfMonth(next.from));
    const b = toMonth(startOfMonth(next.to));
    setOpen(false);
    setDraft(undefined);
    router.push(`${pathname}?from=${a <= b ? a : b}&to=${a <= b ? b : a}`);
  }

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
            {formatMonthLabel(from)} – {formatMonthLabel(to)}
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
