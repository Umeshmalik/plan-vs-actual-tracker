/**
 * seed.ts — two demo accounts so a reviewer can click straight in, and see
 * tenant isolation by logging in as each. Credentials are in the README.
 *   demo@example.com  / review-me-2026   — the PDF's sample data, Jan locked
 *   other@example.com / tenant-b-2026    — a different tenant, nothing shared
 *
 * Idempotent: re-running resets each user's plans/actuals/locks first, so
 * `npm run seed` twice does not double the actuals.
 */
import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";
import { toMinor } from "../src/lib/money";

/**
 * Cost factor 12, not bcrypt's old default of 10. A cost is a budget against
 * the attacker's hardware, and 10 was chosen for 2010's: a 2026 GPU rig walks
 * a cost-10 hash roughly four times faster than a cost-12 one, and the price
 * of the upgrade here is ~230ms on a sign-in nobody perceives. Any other place
 * that ever produces a hash must use this same constant.
 */
const BCRYPT_COST = 12;

/** Upsert the user, then wipe their transactional data so re-runs are clean. */
async function resetUser(email: string, password: string): Promise<ScopedRepo> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await M.User.findOneAndUpdate(
    { email },
    { $setOnInsert: { passwordHash } },
    { upsert: true, returnDocument: "after" }
  );
  const userId = user._id as Types.ObjectId;
  await M.Actual.deleteMany({ userId });
  await M.Plan.deleteMany({ userId });
  await M.PeriodLock.deleteMany({ userId });
  return new ScopedRepo(userId);
}

/** Categories survive re-runs (unique per user), so create-or-find. */
async function categoryId(repo: ScopedRepo, name: string): Promise<string> {
  const cat = await repo.createCategory(name).catch(() => repo.findCategoryByName(name));
  return String(cat!._id);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  // -- demo@example.com — the assignment's sample table ----------------------
  const demo = await resetUser("demo@example.com", "review-me-2026");
  const mkt = await categoryId(demo, "Marketing");
  const pay = await categoryId(demo, "Payroll");
  const tools = await categoryId(demo, "Tools");

  await demo.upsertPlan(mkt, "2026-01", toMinor(5000));
  await demo.upsertPlan(pay, "2026-01", toMinor(20000));
  await demo.upsertPlan(mkt, "2026-02", toMinor(5000));
  await demo.upsertPlan(pay, "2026-02", toMinor(20000));

  await demo.upsertActual({
    categoryId: mkt,
    month: "2026-01",
    amountMinor: toMinor(4800),
    note: "Ads + events",
  });
  await demo.upsertActual({ categoryId: pay, month: "2026-01", amountMinor: toMinor(20500) });
  await demo.upsertActual({ categoryId: pay, month: "2026-02", amountMinor: toMinor(19800) });
  // Marketing Feb has no actual on purpose (missing actual = 0, -5,000 / -100%).
  // Unbudgeted spend demo (hasPlan:false in the report):
  await demo.upsertActual({
    categoryId: tools,
    month: "2026-01",
    amountMinor: toMinor(340),
    note: "Figma seats",
  });

  await demo.lock("2026-01"); // demo the closed period

  // -- other@example.com — a second tenant, entirely separate data -----------
  const other = await resetUser("other@example.com", "tenant-b-2026");
  const contractors = await categoryId(other, "Contractors");

  await other.upsertPlan(contractors, "2026-01", toMinor(8000));
  await other.upsertPlan(contractors, "2026-02", toMinor(8000));
  await other.upsertActual({
    categoryId: contractors,
    month: "2026-01",
    amountMinor: toMinor(8400),
    note: "Two retainers",
  });
  await other.upsertActual({ categoryId: contractors, month: "2026-02", amountMinor: toMinor(7900) });
  // No lock here: January is closed for demo@ and open for other@ — same month,
  // different tenant, different answer.

  console.log("Seeded demo@example.com / review-me-2026 and other@example.com / tenant-b-2026");
  await mongoose.disconnect();
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
