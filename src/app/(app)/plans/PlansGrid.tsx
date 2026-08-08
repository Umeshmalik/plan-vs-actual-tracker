"use client";

/**
 * PlansGrid — the target matrix (category rows × month columns) on shadcn
 * Table + Input, inside a Card.
 *
 * The UI never computes money: it sends the string the user typed and shows the
 * server's minor units back through toMajor(). Locking is mirrored here
 * (read-only column, chip in the header) but enforced by the API — a
 * PERIOD_LOCKED 409 lands in the Banner verbatim, which is the proof. A toast
 * confirms; the Banner is what stays on screen.
 *
 * Client machinery: every write is a `useApiMutation` (pending + toast +
 * refresh), the add-category popover is a TanStack Form validated by
 * `zCategoryCreate`, and cells save while you type on a TanStack Pacer
 * debouncer that blur and Enter flush.
 */
import { useRef, useState } from "react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useDebouncer } from "@tanstack/react-pacer";
import { Loader2, Plus } from "lucide-react";
import { zCategoryCreate } from "@/domain/schemas";
import { fieldErrors } from "@/lib/api";
import { formatMonthLabel } from "@/lib/month";
import { toMajor } from "@/lib/money";
import { useApiMutation } from "@/lib/useApiMutation";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/Banner";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LockChip } from "@/components/LockChip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Category {
  id: string;
  name: string;
}
interface Plan {
  categoryId: string;
  month: string;
  amountMinor: number;
}
interface CellVars {
  categoryId: string;
  month: string;
}

const cellKey = (categoryId: string, month: string) => `${categoryId}:${month}`;

/** Full month name for the lock controls ("Lock February"), UTC-pinned so no local timezone gets a vote. */
const monthName = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

const HEAD = "text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground";

/** ~600ms after the last keystroke a cell saves itself; blur and Enter flush it early. */
const CELL_DEBOUNCE_MS = 600;

export function PlansGrid({
  categories,
  months,
  plans,
  lockedMonths,
}: {
  categories: Category[];
  months: string[];
  plans: Plan[];
  lockedMonths: string[];
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);

  // Which cell holds the caret. A save that lands while the user is still
  // typing must not pull the draft out from under them.
  const focused = useRef<string | null>(null);
  // The raw string each cell last handed to the server. Blur can then tell
  // "already saved, just unformatted" from "changed", so it settles the cell
  // instead of re-sending it.
  const sent = useRef<Record<string, string>>({});
  // Cells with a request in the air. A ref, not state, because blur reads it in
  // the same tick the debounce flush fired the request.
  const inFlight = useRef(new Set<string>());

  const savePlan = useApiMutation<{ plan: Plan }, CellVars & { amount: string }>({
    url: "/api/plans",
    method: "PUT",
    success: vars => `${monthName(vars.month)} target saved`,
  });
  const clearPlan = useApiMutation<{ deleted: number }, CellVars>({
    url: "/api/plans",
    method: "DELETE",
    success: vars => `${monthName(vars.month)} target removed`,
  });
  const lockMonth = useApiMutation<{ month: string; lockedAt: string }, { month: string }>({
    url: "/api/locks",
    method: "POST",
    success: vars => `${monthName(vars.month)} locked`,
  });
  // A function url means the variables are path params, so no body is sent.
  const unlockMonth = useApiMutation<{ month: string; unlocked: true }, { month: string }>({
    url: vars => `/api/locks/${vars.month}`,
    method: "DELETE",
    success: vars => `${monthName(vars.month)} unlocked`,
  });
  const addCategory = useApiMutation<{ category: Category }, { name: string }>({
    url: "/api/categories",
    method: "POST",
    success: "Category added",
  });

  const categoryForm = useForm({
    defaultValues: { name: "" },
    // Nothing turns red until the first submit, then it corrects itself as you
    // type — the same moment the server used to speak up.
    validationLogic: revalidateLogic(),
    validators: { onDynamic: zCategoryCreate },
    onSubmit: ({ value, formApi }) =>
      addCategory.mutate(value, {
        onSuccess: () => {
          formApi.reset();
          setAddOpen(false);
        },
      }),
  });

  const saved: Record<string, string> = {};
  for (const p of plans) saved[cellKey(p.categoryId, p.month)] = toMajor(p.amountMinor).toFixed(2);
  const isLocked = (month: string) => lockedMonths.includes(month);

  /**
   * One Banner, five mutations: show whichever write failed most recently. Each
   * envelope is the server's own wording, and the hook has already toasted it.
   */
  const writes = [savePlan, clearPlan, lockMonth, unlockMonth, addCategory];
  const failed = writes.filter(m => m.envelope).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  // VALIDATION_FAILED issues from POST /api/categories render under the input
  // they name; anything that maps to no field is left to the Banner.
  const serverCategoryError = fieldErrors(addCategory.envelope).name;

  const clearDraft = (key: string) =>
    setDraft(d => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  /** The debounce, blur and Enter all land here. Untouched cells and unchanged values send nothing — and toast nothing. */
  function saveCell(categoryId: string, month: string) {
    const key = cellKey(categoryId, month);
    const raw = draft[key];
    if (raw === undefined || inFlight.current.has(key)) return;
    const amount = raw.trim();

    // Covers every no-op: an empty cell that was already empty (pointless
    // DELETE), a value retyped exactly as it stands, and a value the debounce
    // already saved that only differs from the server's formatting.
    if (amount === (saved[key] ?? "") || amount === sent.current[key]) return clearDraft(key);

    inFlight.current.add(key);
    sent.current[key] = amount;
    const settle = {
      // Keep the typed text while the caret is still in the cell; once the user
      // has left, drop the draft so the server's formatting shows through.
      onSuccess: () => {
        if (focused.current !== key) clearDraft(key);
      },
      // Keeps the draft so the typed value stays beside the banner, and lets the
      // same value be retried.
      onError: () => {
        delete sent.current[key];
      },
      onSettled: () => {
        inFlight.current.delete(key);
      },
    };

    // The typed string goes to the server as-is; Zod owns "is this a number".
    if (amount === "") clearPlan.mutate({ categoryId, month }, settle);
    else savePlan.mutate({ categoryId, month, amount }, settle);
  }

  const cellSaver = useDebouncer(saveCell, { wait: CELL_DEBOUNCE_MS });

  const cellOf = (vars: CellVars) => cellKey(vars.categoryId, vars.month);
  const busyCell =
    (savePlan.isPending ? cellOf(savePlan.variables) : null) ??
    (clearPlan.isPending ? cellOf(clearPlan.variables) : null);
  const lockBusy = (month: string) =>
    (lockMonth.isPending && lockMonth.variables.month === month) ||
    (unlockMonth.isPending && unlockMonth.variables.month === month);

  function focusCell(row: number, col: number) {
    const el = document.getElementById(`plan-${row}-${col}`) as HTMLInputElement | null;
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  }

  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    if (e.key === "Enter") {
      e.preventDefault();
      cellSaver.flush(); // don't make Enter wait out the debounce
      // Moving focus fires onBlur, which settles the cell; on the last row, blur explicitly.
      if (!focusCell(row + 1, col)) el.blur();
      return;
    }
    const moved =
      e.key === "ArrowUp"
        ? focusCell(row - 1, col)
        : e.key === "ArrowDown"
          ? focusCell(row + 1, col)
          : e.key === "ArrowLeft" && atStart
            ? focusCell(row, col - 1)
            : e.key === "ArrowRight" && atEnd
              ? focusCell(row, col + 1)
              : false;
    if (moved) e.preventDefault();
  }

  function toggleLock(month: string) {
    if (isLocked(month)) unlockMonth.mutate({ month });
    else lockMonth.mutate({ month });
  }

  const addCategoryControl = (
    <Popover open={addOpen} onOpenChange={setAddOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          Add category
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <form
          className="text-left"
          onSubmit={e => {
            e.preventDefault();
            e.stopPropagation();
            void categoryForm.handleSubmit();
          }}
        >
          <categoryForm.Field name="name">
            {field => {
              const error = field.state.meta.errors[0]?.message ?? serverCategoryError;
              return (
                <Field
                  label="Category name"
                  htmlFor="new-category"
                  error={error}
                  hint="Spend and targets are grouped by it."
                >
                  <Input
                    id="new-category"
                    name={field.name}
                    value={field.state.value}
                    autoComplete="off"
                    placeholder="Marketing"
                    aria-describedby={error ? "new-category-error" : "new-category-hint"}
                    onBlur={field.handleBlur}
                    onChange={e => field.handleChange(e.target.value)}
                  />
                </Field>
              );
            }}
          </categoryForm.Field>
          <Button type="submit" size="sm" disabled={addCategory.isPending}>
            {addCategory.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Add category
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );

  const banner = <Banner error={failed?.envelope} onDismiss={() => failed?.reset()} />;

  if (categories.length === 0) {
    return (
      <>
        {banner}
        <EmptyState
          title="No categories yet"
          body="Add a category, then set a monthly target for each month in the range."
          action={addCategoryControl}
        />
      </>
    );
  }

  return (
    <>
      {banner}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-[1.15rem] font-semibold">Monthly targets</CardTitle>
          <CardDescription>
            These are the targets you plan to spend, not what was spent — a CSV import adds spend, so imported
            rows appear on Actuals and Report, never here. Arrow keys move between cells, Enter saves the cell
            and moves down, and leaving a cell saves it too. Clear a cell to remove its target. Closed months
            are read-only here, and the API rejects writes to them regardless of what this screen allows.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-0">
          <Table>
            <TableCaption className="px-(--card-spacing) text-left">
              Targets in major units ·{" "}
              {months.length > 1
                ? `${formatMonthLabel(months[0])} - ${formatMonthLabel(months[months.length - 1])}`
                : formatMonthLabel(months[0])}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className={cn(HEAD, "pl-(--card-spacing)")}>Category</TableHead>
                {months.map(month => (
                  <TableHead key={month} className={cn(HEAD, "text-right last:pr-(--card-spacing)")}>
                    <span className="inline-flex items-center gap-1.5">
                      {formatMonthLabel(month)}
                      {isLocked(month) && <LockChip label="Closed" />}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category, row) => (
                <TableRow key={category.id} className="odd:bg-bar">
                  <TableCell className="pl-(--card-spacing) font-medium">{category.name}</TableCell>
                  {months.map((month, col) => {
                    const locked = isLocked(month);
                    const key = cellKey(category.id, month);
                    const saving = busyCell === key;
                    return (
                      <TableCell
                        key={month}
                        className={cn("text-right last:pr-(--card-spacing)", locked && "bg-bar-locked")}
                      >
                        <span className="relative inline-block">
                          <Input
                            id={`plan-${row}-${col}`}
                            className="w-28 text-right font-mono"
                            inputMode="decimal"
                            placeholder={locked ? "—" : "0.00"}
                            readOnly={locked}
                            aria-busy={saving}
                            value={draft[key] ?? saved[key] ?? ""}
                            aria-label={`${category.name} target for ${formatMonthLabel(month)}${locked ? ", locked" : ""}`}
                            onChange={e => {
                              setDraft(d => ({ ...d, [key]: e.target.value }));
                              cellSaver.maybeExecute(category.id, month);
                            }}
                            onKeyDown={e => onCellKeyDown(e, row, col)}
                            onFocus={() => {
                              focused.current = key;
                            }}
                            onBlur={() => {
                              focused.current = null;
                              cellSaver.flush(); // a pending debounce runs now
                              saveCell(category.id, month); // …or settle the cell if there was none
                            }}
                          />
                          {saving && (
                            <Loader2
                              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
                              aria-hidden
                            />
                          )}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>

        <CardFooter className="flex-wrap gap-2">
          {months.map(month =>
            isLocked(month) ? (
              <AlertDialog key={month}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={lockBusy(month)}>
                    Unlock {monthName(month)}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reopen {monthName(month)}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {formatMonthLabel(month)} is closed: its targets and spend are final. Unlocking reopens
                      the period for edits and imports, so figures already reported for it can change. Lock it
                      again once the corrections are in.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it closed</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => toggleLock(month)}>
                      Unlock {monthName(month)}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                key={month}
                variant="outline"
                size="sm"
                disabled={lockBusy(month)}
                onClick={() => toggleLock(month)}
              >
                Lock {monthName(month)}
              </Button>
            )
          )}
          <span className="ml-auto">{addCategoryControl}</span>
        </CardFooter>
      </Card>
    </>
  );
}
