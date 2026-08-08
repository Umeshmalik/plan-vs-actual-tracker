/**
 * THE reviewer test: seeds the assignment PDF's sample data and asserts
 * their exact variance table. If this is green, "Correctness" is green.
 *
 *   2026-01 Marketing  plan 5,000  actual 4,800  ->   -200 / -4.00%
 *   2026-01 Payroll    plan 20,000 actual 20,500 ->   +500 / +2.50%
 *   2026-02 Marketing  plan 5,000  (no actuals)  -> -5,000 / -100%   (missing = 0)
 *   2026-02 Payroll    plan 20,000 actual 19,800 ->   -200 / -1.00%
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { ScopedRepo } from "../src/domain/repo";
import { reportCsv, runReport } from "../src/domain/report";
import { toMinor } from "../src/lib/money";

let mongod: MongoMemoryReplSet;
let repo: ScopedRepo;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); // repl set: transactions work
  await mongoose.connect(mongod.getUri());
  repo = new ScopedRepo(new Types.ObjectId());

  const mkt = await repo.createCategory("Marketing");
  const pay = await repo.createCategory("Payroll");

  await repo.upsertPlan(String(mkt._id), "2026-01", toMinor(5000));
  await repo.upsertPlan(String(pay._id), "2026-01", toMinor(20000));
  await repo.upsertPlan(String(mkt._id), "2026-02", toMinor(5000));
  await repo.upsertPlan(String(pay._id), "2026-02", toMinor(20000));

  await repo.upsertActual({ categoryId: String(mkt._id), month: "2026-01", amountMinor: toMinor(4800) });
  await repo.upsertActual({ categoryId: String(pay._id), month: "2026-01", amountMinor: toMinor(20500) });
  // Marketing Feb intentionally omitted (matches the PDF)
  await repo.upsertActual({ categoryId: String(pay._id), month: "2026-02", amountMinor: toMinor(19800) });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("report matches the assignment's sample table", () => {
  it("produces the exact four variances from the PDF", async () => {
    const { rows } = await runReport(repo, "2026-01", "2026-03");
    const cell = (cat: string, month: string) => rows.find(r => r.categoryName === cat && r.month === month)!;

    expect(cell("Marketing", "2026-01")).toMatchObject({ variance: toMinor(-200), variancePct: -4 });
    expect(cell("Payroll", "2026-01")).toMatchObject({ variance: toMinor(500), variancePct: 2.5 });
    expect(cell("Marketing", "2026-02")).toMatchObject({
      variance: toMinor(-5000),
      variancePct: -100,
      hasActuals: false,
    });
    expect(cell("Payroll", "2026-02")).toMatchObject({ variance: toMinor(-200), variancePct: -1 });
    expect(rows).toHaveLength(4);
  });

  it("exports the same four rows, in major units, with a totals line", async () => {
    const csv = reportCsv(await runReport(repo, "2026-01", "2026-03"));

    // An export that disagrees with the screen is worse than no export, so this
    // asserts the whole file rather than a row of it. CRLF: Excel on Windows
    // reads a bare-LF file as one long row.
    expect(csv.split("\r\n")).toEqual([
      "Category,Month,Plan,Actual,Variance,Variance %,Closed",
      "Marketing,2026-01,5000,4800,-200,-4,no",
      "Marketing,2026-02,5000,0,-5000,-100,no",
      "Payroll,2026-01,20000,20500,500,2.5,no",
      "Payroll,2026-02,20000,19800,-200,-1,no",
      "Range total,,50000,45100,-4900,-9.8,",
    ]);
  });

  it("quotes a comma in a name and defuses a cell a spreadsheet would execute", async () => {
    // `=`-leading text is a live formula in Excel/Sheets/Numbers; a comma in a
    // category silently adds a column. Both come from user input.
    const hostile = await repo.createCategory('=HYPERLINK("evil"), Ops');
    await repo.upsertPlan(String(hostile._id), "2026-04", toMinor(10));

    const line = reportCsv(await runReport(repo, "2026-04", "2026-04")).split("\r\n")[1];
    expect(line).toBe('"\'=HYPERLINK(""evil""), Ops",2026-04,10,0,-10,-100,no');

    await repo.deletePlan(String(hostile._id), "2026-04");
  });
});
