/**
 * Plans — the editable target grid (category rows × month columns).
 * Server component: reads through the domain layer, hands plain JSON to the
 * client grid. Mutations go back over REST so the error envelope stays the
 * one contract — including the PERIOD_LOCKED 409 the API, not the UI, enforces.
 */
import { requireRepo } from "@/lib/auth";
import { monthRange } from "@/lib/month";
import { resolveRange, type SearchParams } from "@/lib/range";
import { PlansGrid } from "./PlansGrid";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams; // Next 16: searchParams is a Promise
  const { from, to } = resolveRange(sp);
  const repo = await requireRepo();

  const [categories, plans, locks] = await Promise.all([
    repo.listCategories(),
    repo.listPlans(from, to),
    repo.listLocks(from, to),
  ]);

  return (
    <PlansGrid
      months={monthRange(from, to)}
      categories={categories.map(c => ({ id: String(c._id), name: c.name }))}
      plans={plans.map(p => ({
        categoryId: String(p.categoryId),
        month: p.month,
        amountMinor: p.amountMinor,
      }))}
      lockedMonths={locks.map(l => l.month)}
    />
  );
}
