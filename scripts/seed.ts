/**
 * Two demo accounts, so tenant isolation can be seen by logging in as each:
 *   demo@example.com  / review-me-2026   — the sample data, Jan locked
 *   other@example.com / tenant-b-2026    — a different tenant, nothing shared
 *
 * Idempotent: re-running resets each user's plans/actuals/locks first.
 */
import mongoose, { Types } from "mongoose";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";
import { hashPassword } from "../src/domain/users";
import { connectDb } from "../src/lib/db";
import { toMinor } from "../src/lib/money";

/** Upsert the user, then wipe their transactional data so re-runs are clean. */
async function resetUser(email: string, password: string): Promise<ScopedRepo> {
  const passwordHash = await hashPassword(password);
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
  // connectDb, not a second mongoose.connect: same pool settings as the app, and
  // a named error when MONGODB_URI is missing.
  await connectDb();

  // -- demo@example.com — the assignment's sample table ----------------------
  const demo = await resetUser("demo@example.com", "review-me-2026");
  const mkt = await categoryId(demo, "Marketing");
  const pay = await categoryId(demo, "Payroll");
  const tools = await categoryId(demo, "Tools");

  await demo.upsertPlan(mkt, "2026-01", toMinor(5000));
  await demo.upsertPlan(pay, "2026-01", toMinor(20000));
  await demo.upsertPlan(mkt, "2026-02", toMinor(5000));
  await demo.upsertPlan(pay, "2026-02", toMinor(20000));

  // TWO entries summing to 4,800: a cell holds a month of spend, not one figure.
  await demo.createActual({
    categoryId: mkt,
    month: "2026-01",
    amountMinor: toMinor(3100),
    note: "Ads",
  });
  await demo.createActual({
    categoryId: mkt,
    month: "2026-01",
    amountMinor: toMinor(1700),
    note: "Events",
  });
  await demo.createActual({ categoryId: pay, month: "2026-01", amountMinor: toMinor(20500) });
  await demo.createActual({ categoryId: pay, month: "2026-02", amountMinor: toMinor(19800) });
  // Marketing Feb has no actual on purpose (missing actual = 0, -5,000 / -100%).
  // Tools has no plan: unbudgeted spend, hasPlan:false in the report.
  await demo.createActual({
    categoryId: tools,
    month: "2026-01",
    amountMinor: toMinor(340),
    note: "Figma seats",
  });

  await demo.lock("2026-01");

  // -- other@example.com — a second tenant, entirely separate data -----------
  const other = await resetUser("other@example.com", "tenant-b-2026");
  const contractors = await categoryId(other, "Contractors");

  await other.upsertPlan(contractors, "2026-01", toMinor(8000));
  await other.upsertPlan(contractors, "2026-02", toMinor(8000));
  await other.createActual({
    categoryId: contractors,
    month: "2026-01",
    amountMinor: toMinor(8400),
    note: "Two retainers",
  });
  await other.createActual({ categoryId: contractors, month: "2026-02", amountMinor: toMinor(7900) });
  // No lock: January is closed for demo@ and open for other@.

  console.log("Seeded demo@example.com / review-me-2026 and other@example.com / tenant-b-2026");
  await mongoose.disconnect();
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
