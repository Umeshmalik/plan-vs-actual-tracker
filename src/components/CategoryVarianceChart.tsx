/**
 * The ranked half of the report's picture: the range rolled up to one line per
 * category, worst miss first — the alphabetical table below cannot show that.
 * The mark is the table's own VarianceBar, so there is no second bar geometry.
 */
import { Fragment } from "react";
import Link from "next/link";
import { MoneyText } from "@/components/MoneyText";
import { VarianceBar, varianceTone } from "@/components/VarianceBar";
import { type CurrencyCode } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { byCategory, type CategoryVariance, type VarianceRow } from "@/lib/variance";

const TOP = 8;

/** The bar is keyboard-reachable out of context, so its name carries the category. */
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
  // shown[0] is the largest |variance|, so truncating the tail cannot rescale a bar.
  const max = Math.max(...shown.map(c => Math.abs(c.variance)));

  return (
    // Fragments, not wrapper elements, so the columns line up without
    // `display:contents` dropping rows out of the accessibility tree.
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5">
      {shown.map(c => (
        <Fragment key={c.categoryId}>
          <Link
            // No single month here: the range rides along and Actuals lands on
            // its first month for this category.
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
