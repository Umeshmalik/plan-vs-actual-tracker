/** Reads through the domain layer; the grid's mutations go back over REST. */
import { requireRepo } from "@/lib/auth";
import { monthRange } from "@/lib/month";
import { resolveRange, type SearchParams } from "@/lib/range";
import { getCategories, getLockedMonths, getPlans } from "@/lib/reads";
import { PlansGrid } from "./PlansGrid";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to } = resolveRange(sp);
  const repo = await requireRepo(); // authenticate first — the cache never decides who is asking
  const uid = String(repo.uid);

  const [categories, plans, lockedMonths] = await Promise.all([
    getCategories(uid),
    getPlans(uid, from, to),
    getLockedMonths(uid, from, to),
  ]);

  return (
    <PlansGrid
      months={monthRange(from, to)}
      categories={categories.map(c => ({ id: c._id, name: c.name }))}
      plans={plans}
      lockedMonths={lockedMonths}
    />
  );
}
