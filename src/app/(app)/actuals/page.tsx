/**
 * Actuals — entry form on the left, that category+month's entry on the right.
 * The form's own Category and Month controls are the selector: changing them
 * rewrites ?categoryId=&month= and the server re-reads. One control set, no
 * duplicate filter row.
 *
 * A cell holds one entry, so the form is seeded with whatever is already there
 * and saving replaces it — the screen cannot produce a second row for the same
 * category and month, and neither can the API.
 */
import Link from "next/link";
import { requireRepo } from "@/lib/auth";
import { formatMonthLabel, isMonth, monthRange } from "@/lib/month";
import { resolveRange, type SearchParams } from "@/lib/range";
import { getActuals, getCategories, getLockedMonths, getSettings } from "@/lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ActualForm } from "./ActualForm";
import { ActualsList } from "./ActualsList";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams; // Next 16: searchParams is a Promise
  const { from, to } = resolveRange(sp);
  const repo = await requireRepo(); // authenticate first — the cache never decides who is asking
  const uid = String(repo.uid);

  const categories = (await getCategories(uid)).map(c => ({ id: c._id, name: c.name }));

  // Default inside the range; a month typed outside it still works, it just is not the default.
  const wanted = one(sp.month);
  const month = isMonth(wanted) ? wanted : monthRange(from, to)[0];
  const wantedCategory = one(sp.categoryId);
  const category = categories.find(c => c.id === wantedCategory) ?? categories[0];

  if (!category) {
    return (
      <EmptyState
        title="No categories yet"
        body="Spend is logged against a category. Add one on the Plans tab, then come back."
        action={
          <Button asChild>
            <Link href={`/plans?from=${from}&to=${to}`}>Add a category</Link>
          </Button>
        }
      />
    );
  }

  // A one-month range IS the lock question, so it reuses the cached read the
  // report and the plans grid already fill rather than a second exists() query.
  const [lockedMonths, actuals, { currency }] = await Promise.all([
    getLockedMonths(uid, month, month),
    getActuals(uid, month, category.id),
    getSettings(uid),
  ]);
  const locked = lockedMonths.length > 0;
  // One entry per category x month, so this read returns nothing or one row.
  const current = actuals[0];

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* Remount when the cell changes: the form is seeded from `current`, and
          defaults are read once. */}
      <ActualForm
        key={`${category.id}:${month}`}
        categories={categories}
        categoryId={category.id}
        month={month}
        locked={locked}
        current={current && { amountMinor: current.amountMinor, note: current.note }}
        from={from}
        to={to}
      />
      <div className="min-w-80 flex-1">
        <ActualsList
          currency={currency}
          caption={`${category.name} · ${formatMonthLabel(month)}`}
          month={month}
          locked={locked}
          rows={actuals.map(a => ({
            id: a._id,
            date: a.createdAt.slice(0, 10), // already an ISO string out of the cache
            note: a.note ?? "",
            amountMinor: a.amountMinor,
          }))}
        />
      </div>
    </div>
  );
}
