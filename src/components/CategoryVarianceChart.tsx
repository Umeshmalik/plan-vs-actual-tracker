/**
 * CategoryVarianceChart — the ranked half of the report's picture.
 *
 * The table below lists every category x month cell in alphabetical order,
 * which is the one order that hides the answer to "where did the money go
 * wrong": you have to read every row to find the biggest miss. This rolls the
 * range up to one line per category and sorts by |variance|, so the worst line
 * is the first line.
 *
 * The mark is the table's own VarianceBar on a shared zero axis, so the two
 * read as one chart at two granularities and there is no second bar geometry
 * to keep in agreement with the first.
 *
 * The rollup itself is `byCategory` in lib/variance.ts — pure and unit-tested
 * beside the rest of the variance math. This file only draws it.
 */
import { Fragment } from "react";
import Link from "next/link";
import { MoneyText } from "@/components/MoneyText";
import { VarianceBar, varianceTone } from "@/components/VarianceBar";
import { type CurrencyCode } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { byCategory, type CategoryVariance, type VarianceRow } from "@/lib/variance";

/** Past this the ranking stops being a glance — and the table is the full list. */
const TOP = 8;

/**
 * The bar's accessible name. It can be reached out of context by keyboard, so
 * it names the category rather than relying on the row it sits in.
 */
const words = (c: CategoryVariance, currency: CurrencyCode) =>
  !c.hasActuals
    ? `${c.categoryName}: no actuals recorded`
    : c.variance === 0
      ? `${c.categoryName}: on plan`
      : `${c.categoryName}: ${formatMoney(Math.abs(c.variance), currency)} ${c.variance > 0 ? "over" : "under"} plan`;

export function CategoryVarianceChart({
  rows,
  from,
  to,
  currency,
}: {
  rows: VarianceRow[];
  from: string;
  to: string;
  currency: CurrencyCode;
}) {
  const all = byCategory(rows);
  if (all.length === 0) return null;

  const shown = all.slice(0, TOP);
  const hidden = all.length - shown.length;
  // shown[0] holds the largest |variance| in the range, so this is the same
  // scale the full list would give — truncating the tail cannot rescale a bar.
  const max = Math.max(...shown.map(c => Math.abs(c.variance)));

  return (
    // One grid, rows spliced in as fragments rather than wrapper elements, so
    // the three columns line up across every row without `display:contents`
    // dropping list items out of the accessibility tree.
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5">
      {shown.map(c => (
        <Fragment key={c.categoryId}>
          <Link
            // No single month to open here — the range rides along and the
            // Actuals screen lands on its first month for this category.
            href={`/actuals?categoryId=${c.categoryId}&from=${from}&to=${to}`}
            className="block truncate underline-offset-4 hover:underline focus-visible:underline"
          >
            {c.categoryName}
          </Link>
          <VarianceBar
            variance={c.variance}
            max={max}
            hasActuals={c.hasActuals}
            currency={currency}
            label={words(c, currency)}
          />
          <MoneyText minor={c.variance} currency={currency} className={varianceTone(c.variance)} />
        </Fragment>
      ))}
      {hidden > 0 && (
        <p className="col-span-3 pt-1 text-xs text-muted-foreground">
          {hidden} smaller {hidden === 1 ? "category is" : "categories are"} not shown — every one of them is
          in the table below.
        </p>
      )}
    </div>
  );
}
