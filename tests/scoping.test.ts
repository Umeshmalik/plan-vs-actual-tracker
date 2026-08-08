/**
 * Tenant isolation, proven rather than asserted. Two ScopedRepos, one database:
 * everything user A owns is invisible and untouchable to user B, and the
 * uniqueness constraints are per-user, not global.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";
import { runReport } from "../src/domain/report";
import { toMinor } from "../src/lib/money";

let mongod: MongoMemoryReplSet;
let a: ScopedRepo;
let b: ScopedRepo;
let aCatId: string;
let aActualId: string;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // The "same name for another user" claim only means something if the unique
  // index is actually built, so wait for it instead of assuming autoIndex won.
  await M.Category.init();

  a = new ScopedRepo(new Types.ObjectId());
  b = new ScopedRepo(new Types.ObjectId());

  aCatId = String((await a.createCategory("Marketing"))._id);
  await a.createCategory("Payroll");
  await a.upsertPlan(aCatId, "2026-01", toMinor(5000));
  await a.upsertPlan(aCatId, "2026-02", toMinor(5000));
  aActualId = String(
    (await a.upsertActual({ categoryId: aCatId, month: "2026-01", amountMinor: toMinor(4800) }))._id
  );
  await a.lock("2026-01");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("ScopedRepo isolates tenants structurally", () => {
  it("user A's data is there (control)", async () => {
    expect(await a.listCategories()).toHaveLength(2);
    expect(await a.listPlans("2026-01", "2026-12")).toHaveLength(2);
    expect(await a.listActuals({})).toHaveLength(1);
    expect(await a.isLocked("2026-01")).toBeTruthy();
  });

  it("user B lists nothing of A's", async () => {
    expect(await b.listCategories()).toHaveLength(0);
    expect(await b.listPlans("2026-01", "2026-12")).toHaveLength(0);
    expect(await b.listActuals({})).toHaveLength(0);
  });

  it("user B cannot read A's category by id", async () => {
    await expect(b.requireCategory(aCatId)).rejects.toMatchObject({ code: "UNKNOWN_CATEGORY" });
    await expect(b.findCategoryByName("marketing")).resolves.toBeNull();
  });

  it("the report is empty for user B", async () => {
    expect(await runReport(b, "2026-01", "2026-03")).toMatchObject({
      rows: [],
      totals: { plan: 0, actual: 0, variance: 0, variancePct: null },
      lockedMonths: [],
    });
    expect((await runReport(a, "2026-01", "2026-03")).rows).toHaveLength(2);
  });

  it("user B cannot delete A's actual, and A still has it", async () => {
    await expect(b.deleteActual(aActualId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await a.listActuals({})).toHaveLength(1);
  });

  it("A's lock does not lock B's month", async () => {
    expect(await b.isLocked("2026-01")).toBeNull();
    expect(await b.listLocks("2026-01", "2026-12")).toHaveLength(0);
  });

  it("category names are unique per user, not globally", async () => {
    await expect(a.createCategory("Marketing")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(b.createCategory("Marketing")).resolves.toBeTruthy();
    expect(await b.listCategories()).toHaveLength(1);
    expect(await a.listCategories()).toHaveLength(2);
  });
});
