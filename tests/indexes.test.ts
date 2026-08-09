/**
 * Index regression guard, not a benchmark: the planner must still answer the
 * hot reads from an index, reading roughly as many keys as it returns rows.
 * The queries are the repo methods themselves, so a changed query shape fails
 * here as loudly as a dropped index.
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

// Two years x five categories against a 3-month window, so "scanned everything"
// and "seeked to the range" are different numbers.
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
  // explain() reports on the indexes that EXIST, so wait for the build.
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
    // By name: the unique {userId, categoryId, month} also reports IXSCAN while
    // scanning every key the user owns. Hence the key count too.
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
    // Drop the index's trailing createdAt and only this line fails.
    expect(plan).not.toContain('"stage":"SORT"');
    expect(nReturned).toBe(1);
    expect(totalKeysExamined).toBeLessThanOrEqual(2);
    expect(totalDocsExamined).toBeLessThanOrEqual(2);
  });

  it("the category-only drill-down seeks per month instead of scanning", async () => {
    // No {userId, categoryId} index and none needed: the planner turns the
    // equality into one interval per month. "Add an index" is the wrong answer.
    const { plan, nReturned, totalKeysExamined } = await explain(
      repo.listActuals({ categoryId: String(catIds[0]) })
    );

    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
    expect(nReturned).toBe(MONTHS.length);
    expect(totalKeysExamined).toBeLessThanOrEqual(nReturned * 2);
  });

  // The rule this collection deliberately does NOT carry, so "Plan is unique,
  // Actual should be too" cannot land silently.
  it("the database accepts several entries for one category x month, in order", async () => {
    const cell = { month: MONTHS[0], categoryId: String(catIds[0]) };
    const before = await repo.listActuals(cell);

    await repo.createActual({ ...cell, amountMinor: 700, note: "second invoice" });
    await repo.createActual({ ...cell, amountMinor: 300, note: "third invoice" });

    const after = await repo.listActuals(cell);
    expect(after).toHaveLength(before.length + 2);
    expect(after.map(a => a.amountMinor).slice(-2)).toEqual([700, 300]); // oldest first
    // The report sees the SUM for this cell, not the last write.
    expect(after.reduce((n, a) => n + a.amountMinor, 0)).toBe(1000 + 700 + 300);
  });

  it("listActuals caps an unfiltered read at its documented ceiling", async () => {
    const total = await M.Actual.countDocuments({ userId });
    expect(total).toBeLessThan(500);
    expect(await repo.listActuals({})).toHaveLength(total);
    expect(await repo.listActuals({}, 10)).toHaveLength(10);
  });
});

/**
 * A unique index that cannot be BUILT looks exactly like one that works —
 * mongoose builds in the background and swallows the failure. The neighbouring
 * app's documents lack normalizedName and all index as null, so the partial
 * filter is what makes the constraint buildable at all.
 */
describe("the category uniqueness constraint survives a shared collection", () => {
  it("builds over a neighbour's documents, and still refuses our duplicates", async () => {
    const other = new ScopedRepo(new Types.ObjectId());

    // Another app's shape: no userId, no normalizedName. A plain unique index dies here.
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
