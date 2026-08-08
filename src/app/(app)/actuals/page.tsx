/**
 * Actuals — entry form on the left, that category+month's drill-down on the right.
 * The form's own Category and Month controls are the selector: changing them
 * rewrites ?categoryId=&month= and the server re-reads. One control set, no
 * duplicate filter row.
 */
import Link from "next/link";
import { requireRepo } from "@/lib/auth";
import { formatMonthLabel, isMonth, monthRange } from "@/lib/month";
import { resolveRange, type SearchParams } from "@/lib/range";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ActualForm } from "./ActualForm";
import { ActualsList } from "./ActualsList";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams; // Next 16: searchParams is a Promise
  const { from, to } = resolveRange(sp);
  const repo = await requireRepo();

  const categories = (await repo.listCategories()).map(c => ({ id: String(c._id), name: c.name }));

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

  const [locked, actuals] = await Promise.all([
    repo.isLocked(month),
    repo.listActuals({ month, categoryId: category.id }),
  ]);

  return (
    <div className="flex flex-wrap items-start gap-6">
      <ActualForm
        categories={categories}
        categoryId={category.id}
        month={month}
        locked={Boolean(locked)}
        from={from}
        to={to}
      />
      <div className="min-w-80 flex-1">
        <ActualsList
          caption={`${category.name} · ${formatMonthLabel(month)}`}
          month={month}
          locked={Boolean(locked)}
          rows={actuals.map(a => ({
            id: String(a._id),
            date: a.createdAt.toISOString().slice(0, 10),
            note: a.note ?? "",
            amountMinor: a.amountMinor,
          }))}
        />
      </div>
    </div>
  );
}
