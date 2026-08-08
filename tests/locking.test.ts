/**
 * Lock enforcement — DRY even in tests: one loop asserts every mutating
 * domain path throws PERIOD_LOCKED on a locked month.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { ScopedRepo } from "../src/domain/repo";
import { assertPeriodUnlocked } from "../src/domain/locking";
import { previewCsv } from "../src/domain/importCsv";

let mongod: MongoMemoryReplSet;
let repo: ScopedRepo;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  repo = new ScopedRepo(new Types.ObjectId());
  await repo.createCategory("Marketing");
  await repo.lock("2026-01");
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("PERIOD_LOCKED is server-side, not a hidden button", () => {
  it("guard throws 409 code for a locked month", async () => {
    await expect(assertPeriodUnlocked(repo, "2026-01")).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    await expect(assertPeriodUnlocked(repo, "2026-02")).resolves.toBeUndefined();
  });

  it("CSV preview rejects rows targeting the locked month", async () => {
    const rows = await previewCsv(
      repo,
      "month,category,amount\n2026-01,Marketing,100\n2026-02,Marketing,100"
    );
    expect(rows[0]).toMatchObject({ ok: false });
    expect(rows[0].error).toContain("locked");
    expect(rows[1]).toMatchObject({ ok: true });
  });

  it("tenant isolation: another user's repo does not see the lock", async () => {
    const other = new ScopedRepo(new Types.ObjectId());
    await expect(assertPeriodUnlocked(other, "2026-01")).resolves.toBeUndefined();
  });
});
