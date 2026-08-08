/**
 * Two-phase CSV import. Preview never writes; commit is all-or-nothing.
 * Every row-level rejection the UI can show is asserted here, plus the
 * atomicity that makes "upload and pray" a reviewable diff instead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { ScopedRepo } from "../src/domain/repo";
import { previewCsv, commitCsv } from "../src/domain/importCsv";

let mongod: MongoMemoryReplSet;
let repo: ScopedRepo;

const HEADER = "month,category,amount";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const countActuals = async () => (await repo.listActuals({})).length;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  repo = new ScopedRepo(new Types.ObjectId());
  await repo.createCategory("Marketing");
  await repo.createCategory("Payroll");
  await repo.lock("2026-01"); // January is closed
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("previewCsv reports every problem and writes nothing", () => {
  it("rejects a malformed header before looking at any row", async () => {
    const results = await previewCsv(repo, "date,category,amount\n2026-02,Marketing,100");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ line: 0, ok: false });
    expect(results[0].error).toContain("month,category,amount");
  });

  it("flags a bad month format", async () => {
    const [row] = await previewCsv(repo, csv("2026-1,Marketing,100"));
    expect(row).toMatchObject({ line: 1, ok: false });
    expect(row.error).toContain("YYYY-MM");
  });

  it("flags an unknown category", async () => {
    const [row] = await previewCsv(repo, csv("2026-02,Rent,100"));
    expect(row).toMatchObject({ line: 1, ok: false });
    expect(row.error).toContain('Unknown category "Rent"');
  });

  it("flags a row that lands in a locked month", async () => {
    const [row] = await previewCsv(repo, csv("2026-01,Marketing,100"));
    expect(row).toMatchObject({ line: 1, ok: false });
    expect(row.error).toContain("2026-01 is locked");
  });

  it("skips blank lines without renumbering the rows around them", async () => {
    const results = await previewCsv(repo, csv("2026-02,Marketing,100", "", "2026-02,Payroll,200"));
    expect(results.map(r => r.line)).toEqual([1, 3]);
    expect(results.every(r => r.ok)).toBe(true);
  });

  it("previews a good file as all-ok and writes nothing", async () => {
    const before = await countActuals();
    const results = await previewCsv(repo, csv("2026-02,Marketing,1250.55", "2026-03,Payroll,900"));
    expect(results).toEqual([
      {
        line: 1,
        ok: true,
        parsed: expect.objectContaining({ month: "2026-02", categoryName: "Marketing", amountMinor: 125055 }),
      },
      {
        line: 2,
        ok: true,
        parsed: expect.objectContaining({ month: "2026-03", categoryName: "Payroll", amountMinor: 90000 }),
      },
    ]);
    expect(await countActuals()).toBe(before);
  });
});

describe("commitCsv is all-or-nothing", () => {
  it("writes nothing when any single row is bad", async () => {
    const before = await countActuals();
    const res = await commitCsv(
      repo,
      csv("2026-02,Marketing,100", "2026-01,Marketing,100", "2026-02,Rent,100")
    );
    expect(res.committed).toBe(0);
    expect(res.importBatchId).toBeUndefined();
    expect(res.results.filter(r => !r.ok)).toHaveLength(2);
    expect(await countActuals()).toBe(before);
  });

  it("writes every row atomically, tagged with one shared batch id", async () => {
    const before = await countActuals();
    const res = await commitCsv(
      repo,
      csv("2026-02,Marketing,100", "2026-02,Payroll,200", "2026-03,Payroll,300")
    );
    expect(res.committed).toBe(3);
    expect(res.importBatchId).toBeTruthy();

    const written = (await repo.listActuals({})).filter(a => a.importBatchId === res.importBatchId);
    expect(written).toHaveLength(3);
    expect(written.every(a => a.source === "import")).toBe(true);
    expect(written.map(a => a.amountMinor).sort((x, y) => x - y)).toEqual([10000, 20000, 30000]);
    expect(await countActuals()).toBe(before + 3);
  });
});
