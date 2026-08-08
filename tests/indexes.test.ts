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
   * The constraint the app leans on, asserted at the layer that enforces it:
   * upsertActual and the import's bulkWrite both aim at one entry per cell, but
   * this is the thing that holds when a race, a script or a mongosh session
   * goes around them.
   */
  it("the database refuses a second entry for one category x month", async () => {
    await expect(
      M.Actual.create({
        userId,
        categoryId: catIds[0],
        month: MONTHS[0],
        amountMinor: 1,
        source: "manual",
      })
    ).rejects.toMatchObject({ code: 11000 });

    // Same cell, different tenant, is not a duplicate — the index is scoped.
    await expect(
      M.Actual.create({
        userId: new Types.ObjectId(),
        categoryId: catIds[0],
        month: MONTHS[0],
        amountMinor: 1,
        source: "manual",
      })
    ).resolves.toBeTruthy();
  });

  it("listActuals caps an unfiltered read at its documented ceiling", async () => {
    const all = await repo.listActuals({});
    expect(all).toHaveLength(MONTHS.length * catIds.length); // 120, under the 500 ceiling: nothing hidden yet
    expect(await repo.listActuals({}, 10)).toHaveLength(10); // the ceiling is real
  });
});
