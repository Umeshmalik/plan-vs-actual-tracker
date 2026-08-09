/**
 * Index regression guard. Not a benchmark — it asserts the one thing that
 * silently rots: that the planner still answers the report's range query and
 * the actuals drill-down from an index, reading roughly as many keys as it
 * returns rows rather than walking everything the tenant owns.
 *
 * The queries here are the repo methods themselves (projection, sort and limit
 * included), so this fails if someone changes the query shape as well as if
 * someone drops the index.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types, trusted } from "mongoose";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";

let mongod: MongoMemoryReplSet;
let repo: ScopedRepo;
let userId: Types.ObjectId;
let catIds: Types.ObjectId[];

// Two years x five categories = 120 plans and 120 actuals, against a 3-month
// report window. Wide enough that "scanned the user's whole history" and
// "seeked to the range" are not the same number.
const MONTHS = Array.from(
  { length: 24 },
  (_, i) => `20${26 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`
);
const FROM = "2026-01";
const TO = "2026-03";

interface Explain {
  queryPlanner: { winningPlan: unknown };
  executionStats: { nReturned: number; totalKeysExamined: number; totalDocsExamined: number };
}

/** Run the repo's own query through explain() instead of a retyped copy. */
async function explain(query: unknown) {
  const ex = (await (query as { explain(v: string): Promise<Explain> }).explain("executionStats")) as Explain;
  return { plan: JSON.stringify(ex.queryPlanner.winningPlan), ...ex.executionStats };
}

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // explain() reports on the indexes that exist, so wait for them to be built
  // rather than trusting autoIndex to have won the race.
  await Promise.all([M.Plan.init(), M.Actual.init()]);

  userId = new Types.ObjectId();
  repo = new ScopedRepo(userId);
  catIds = Array.from({ length: 5 }, () => new Types.ObjectId());

  const cells = MONTHS.flatMap(month =>
    catIds.map(categoryId => ({ userId, categoryId, month, amountMinor: 1000 }))
  );
  await M.Plan.insertMany(cells);
  await M.Actual.insertMany(cells.map(c => ({ ...c, source: "manual" })));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("the hot reads are index seeks, not collection scans", () => {
  it("the report's plan range uses {userId, month, categoryId}", async () => {
    const { plan, nReturned, totalKeysExamined, totalDocsExamined } = await explain(repo.listPlans(FROM, TO));

    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
    // The specific index, so reordering its keys fails here and not in prod:
    // the unique {userId, categoryId, month} would also report IXSCAN while
    // scanning every key the user owns, because categoryId sits between the
    // equality and the range. Hence the key count, not just the stage name.
    expect(plan).toContain("userId_1_month_1_categoryId_1");
    expect(nReturned).toBe(3 * catIds.length);
    expect(totalKeysExamined).toBeLessThanOrEqual(nReturned * 2);
    expect(totalDocsExamined).toBeLessThanOrEqual(nReturned * 2);
  });

  it("the report's actual range uses {userId, month, categoryId}", async () => {
    // The same $match runReport sends to the actuals side of the $unionWith.
    const query = M.Actual.find({ userId, month: trusted({ $gte: FROM, $lte: TO }) }).lean();
    const { plan, nReturned, totalKeysExamined, totalDocsExamined } = await explain(query);

    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
    expect(plan).toContain("userId_1_month_1_categoryId_1");
    expect(nReturned).toBe(3 * catIds.length);
    expect(totalKeysExamined).toBeLessThanOrEqual(nReturned * 2);
    expect(totalDocsExamined).toBeLessThanOrEqual(nReturned * 2);
  });

  it("listActuals seeks the exact category x month cell, and never sorts it", async () => {
    const { plan, nReturned, totalKeysExamined, totalDocsExamined } = await explain(
      repo.listActuals({ month: FROM, categoryId: String(catIds[0]) })
    );

    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
    // The trailing createdAt key earns its place here: this is the one read
    // whose result set may reach ACTUALS_LIMIT, and a blocking SORT would
    // buffer every one of those rows before the limit applied. Drop createdAt
    // from the index and this line fails while every count below still passes.
    expect(plan).not.toContain('"stage":"SORT"');
    expect(nReturned).toBe(1);
    expect(totalKeysExamined).toBeLessThanOrEqual(2);
    expect(totalDocsExamined).toBeLessThanOrEqual(2);
  });

  it("the category-only drill-down seeks per month instead of scanning", async () => {
    // No {userId, categoryId} index exists, and none is needed: month carries a
    // couple of dozen distinct values, so the planner turns the categoryId
    // equality into one interval per month rather than a walk of the tenant's
    // whole history. Asserted because "add an index for it" is the tempting
    // wrong answer — this proves the read is already a seek.
    const { plan, nReturned, totalKeysExamined } = await explain(
      repo.listActuals({ categoryId: String(catIds[0]) })
    );

    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
    expect(nReturned).toBe(MONTHS.length);
    expect(totalKeysExamined).toBeLessThanOrEqual(nReturned * 2);
  });

  /**
   * The rule this collection deliberately does NOT carry, asserted so a
   * well-meaning "Plan has a unique index, Actual should too" cannot land
   * silently: a category and month is a ledger, and several spends in one month
   * is the normal case rather than the same figure written twice.
   *
   * The database is the layer that has to allow it — a unique index left behind
   * on an existing collection (Mongoose never drops one it stopped declaring)
   * fails the write with a duplicate-key error no line of app code explains.
   */
  it("the database accepts several entries for one category x month, in order", async () => {
    const cell = { month: MONTHS[0], categoryId: String(catIds[0]) };
    const before = await repo.listActuals(cell);

    await repo.createActual({ ...cell, amountMinor: 700, note: "second invoice" });
    await repo.createActual({ ...cell, amountMinor: 300, note: "third invoice" });

    const after = await repo.listActuals(cell);
    expect(after).toHaveLength(before.length + 2);
    // Oldest first, straight off the index's trailing createdAt key.
    expect(after.map(a => a.amountMinor).slice(-2)).toEqual([700, 300]);
    // What the report will see for this cell is the sum, not the last write.
    expect(after.reduce((n, a) => n + a.amountMinor, 0)).toBe(1000 + 700 + 300);
  });

  it("listActuals caps an unfiltered read at its documented ceiling", async () => {
    const total = await M.Actual.countDocuments({ userId });
    expect(total).toBeLessThan(500); // under the ceiling: nothing hidden yet
    expect(await repo.listActuals({})).toHaveLength(total);
    expect(await repo.listActuals({}, 10)).toHaveLength(10); // the ceiling is real
  });
});

/**
 * The regression this file exists to catch second: a unique index that cannot
 * be BUILT is indistinguishable, from the app's side, from one that is working.
 * Mongoose builds in the background and swallows the failure, so the app comes
 * up with no constraint and nothing on screen to say so — which is exactly how
 * production ended up with three categories called "Marketing".
 *
 * The trigger was a shared collection: a neighbouring application's documents
 * have no `normalizedName`, so they all index as (null, null) and collide with
 * each other. The partialFilterExpression is what makes the constraint apply to
 * this app's rows only, and therefore buildable at all.
 */
describe("the category uniqueness constraint survives a shared collection", () => {
  it("builds over a neighbour's documents, and still refuses our duplicates", async () => {
    const other = new ScopedRepo(new Types.ObjectId());

    // Two foreign documents, of the shape another app would write: no userId,
    // no normalizedName. A plain unique index dies here.
    await M.Category.collection.insertMany([
      { title: "not ours", slug: "a" },
      { title: "not ours either", slug: "b" },
    ]);

    await M.Category.createIndexes(); // throws if the build fails
    const idx = (await M.Category.collection.indexes()).find(i => i.name === "userId_1_normalizedName_1");
    expect(idx?.unique).toBe(true);
    expect(idx?.partialFilterExpression).toEqual({ normalizedName: { $type: "string" } });

    // The constraint still bites for rows that ARE ours…
    await other.createCategory("Marketing");
    await expect(other.createCategory("  marketing ")).rejects.toThrow(/already exists/);
    expect(await M.Category.countDocuments({ userId: other.uid })).toBe(1);

    // …and the neighbour's rows are untouched by any of it.
    expect(await M.Category.collection.countDocuments({ slug: { $exists: true } })).toBe(2);
  });
});
