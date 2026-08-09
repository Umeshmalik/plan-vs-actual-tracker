"use client";

/**
 * ActualForm — one spend entry against a category+month, on shadcn Select /
 * Popover+Calendar / Input inside a Card. Category and Month double as the
 * selector (they rewrite the query string), so they stay enabled even when the
 * period is closed: you must still be able to look at a locked month.
 *
 * The form APPENDS: a category-month holds a whole month of spend, so submitting
 * adds a row to the list beside it rather than replacing what is there. Amount
 * and note clear on success and the selection stays put, which is what makes
 * logging four March invoices four submits instead of four navigations.
 *
 * Field state and client validation are TanStack Form's, using the server's own
 * `zActualCreate` rules through Standard Schema. The write is a
 * `useApiMutation`. Field errors come from the server's VALIDATION_FAILED
 * issues, envelope errors from the Banner — one error vocabulary, rendered
 * verbatim.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { revalidateLogic, useForm, type StandardSchemaV1 } from "@tanstack/react-form";
import { format, parse, startOfMonth } from "date-fns";
import { CalendarDays, Loader2 } from "lucide-react";
import { zActualCreate } from "@/domain/schemas";
import { fieldErrors, type ApiError } from "@/lib/api";
import { formatMonthLabel } from "@/lib/month";
import { useApiMutation } from "@/lib/useApiMutation";
import { Banner } from "@/components/Banner";
import { Field } from "@/components/Field";
import { LockChip } from "@/components/LockChip";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const toDate = (month: string) => parse(month, "yyyy-MM", new Date());

/**
 * `zActualCreate.shape.*` are the server's own rules, reused verbatim. Their
 * declared Standard Schema *input* still is not the `string` a text input holds
 * — Zod 4 widened the coercing amount from `number` to `unknown`, and the
 * optional note is `string | undefined` — while at runtime both take exactly
 * that string. Only the declared input type is narrowed here; not one rule is
 * restated.
 */
const forTypedText = (schema: unknown) => schema as StandardSchemaV1<string, unknown>;

/** The API's own wording for a closed period, shown before the API has to say it. */
const lockedError = (month: string): ApiError => ({
  code: "PERIOD_LOCKED",
  message: `${month} is locked. Unlock the period before editing.`,
  details: { month },
});

export function ActualForm({
  categories,
  categoryId,
  month,
  locked,
  from,
  to,
}: {
  categories: { id: string; name: string }[];
  categoryId: string;
  month: string;
  locked: boolean;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [monthOpen, setMonthOpen] = useState(false);

  const logSpend = useApiMutation<
    { actual: unknown },
    { categoryId: string; month: string; amount: string; note?: string }
  >({
    url: "/api/actuals",
    method: "POST",
    success: "Spend logged",
  });

  const form = useForm({
    defaultValues: { amount: "", note: "" },
    // Nothing turns red until the first submit, then the fields correct
    // themselves as you type — the same moment the server used to speak up.
    validationLogic: revalidateLogic(),
    // Typed strings go straight to the server; Zod owns amount validity.
    // mutateAsync, so the clear waits for the write to land: a rejected one
    // leaves the figures where the user can fix them, and the hook has already
    // said why in a toast and the Banner.
    onSubmit: ({ value, formApi }) =>
      logSpend
        .mutateAsync({
          categoryId,
          month,
          amount: value.amount,
          note: value.note.trim() || undefined,
        })
        .then(
          () => formApi.reset(),
          () => {}
        ),
  });

  // Field-level issues land under the input they name; anything that maps to no
  // field is left to the Banner.
  const fe = fieldErrors(logSpend.envelope);

  function select(next: { categoryId?: string; month?: string }) {
    const q = new URLSearchParams({
      from,
      to,
      categoryId: next.categoryId ?? categoryId,
      month: next.month ?? month,
    });
    router.replace(`/actuals?${q}`, { scroll: false });
  }

  return (
    <Card className="w-85 max-sm:w-full">
      <CardHeader>
        <CardTitle className="font-display text-[1.15rem] font-semibold">Log spend</CardTitle>
        <CardDescription>
          Each submit adds an entry, so a category can hold as many spends as the month had. Category and
          month also choose the list shown beside this form.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={e => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {logSpend.envelope ? (
            <Banner error={logSpend.envelope} onDismiss={() => logSpend.reset()} />
          ) : locked ? (
            <Banner error={lockedError(month)} />
          ) : null}

          <Field label="Category" htmlFor="a-cat" error={fe.categoryId}>
            <Select value={categoryId} onValueChange={next => select({ categoryId: next })}>
              <SelectTrigger
                id="a-cat"
                className="w-full"
                aria-describedby={fe.categoryId ? "a-cat-error" : undefined}
              >
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Month" htmlFor="a-month" error={fe.month} hint="Any day picks its whole month.">
            <Popover open={monthOpen} onOpenChange={setMonthOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="a-month"
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-mono"
                  aria-describedby={fe.month ? "a-month-error" : "a-month-hint"}
                >
                  <CalendarDays className="text-muted-foreground" aria-hidden />
                  {formatMonthLabel(month)}
                  {locked && <LockChip label="Closed" className="ml-auto" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  autoFocus
                  mode="single"
                  className="w-full"
                  captionLayout="dropdown"
                  defaultMonth={toDate(month)}
                  selected={toDate(month)}
                  onSelect={day => {
                    if (!day) return;
                    setMonthOpen(false);
                    select({ month: format(startOfMonth(day), "yyyy-MM") });
                  }}
                />
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Any day picks its whole month. Spend is logged monthly.
                </p>
              </PopoverContent>
            </Popover>
          </Field>

          <form.Field name="amount" validators={{ onDynamic: forTypedText(zActualCreate.shape.amount) }}>
            {field => {
              const error = field.state.meta.errors[0]?.message ?? fe.amount;
              return (
                <Field label="Amount" htmlFor="a-amt" error={error}>
                  <Input
                    id="a-amt"
                    name={field.name}
                    className="text-right font-mono"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={field.state.value}
                    disabled={locked}
                    aria-describedby={error ? "a-amt-error" : undefined}
                    onBlur={field.handleBlur}
                    onChange={e => field.handleChange(e.target.value)}
                  />
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="note" validators={{ onDynamic: forTypedText(zActualCreate.shape.note) }}>
            {field => {
              const error = field.state.meta.errors[0]?.message ?? fe.note;
              return (
                <Field label="Note" htmlFor="a-note" error={error} hint="Optional">
                  <Input
                    id="a-note"
                    name={field.name}
                    placeholder="What was this spend?"
                    value={field.state.value}
                    disabled={locked}
                    aria-describedby={error ? "a-note-error" : "a-note-hint"}
                    onBlur={field.handleBlur}
                    onChange={e => field.handleChange(e.target.value)}
                  />
                </Field>
              );
            }}
          </form.Field>

          <Button type="submit" disabled={locked || logSpend.isPending}>
            {logSpend.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Log spend
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
