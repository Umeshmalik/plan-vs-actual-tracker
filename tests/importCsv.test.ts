/**
 * Two-phase CSV import. Preview never writes; commit is all-or-nothing.
 * Every row-level rejection the UI can show is asserted here, plus the
 * atomicity that makes "upload and pray" a reviewable diff instead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";
import { previewCsv, commitCsv } from "../src/domain/importCsv";

let mongod: MongoMemoryReplSet;
let repo: ScopedRepo;

const HEADER = "month,category,amount";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const countActuals = async () => (await repo.listActuals({})).length;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // monitorCommands is what lets the last test below count round trips.
  await mongoose.connect(mongod.getUri(), { monitorCommands: true });
  // The read index is what keeps listActuals' {month, createdAt} sort out of a
  // blocking SORT stage; wait for the build rather than racing the first write.
  await M.Actual.init();
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

  it("accepts several lines for one category+month — that is a month of spend", async () => {
    const results = await previewCsv(
      repo,
      csv("2026-02,Marketing,100", "2026-02,Payroll,200", "2026-02,marketing,300")
    );
    expect(results.map(r => r.ok)).toEqual([true, true, true]);
    // The third line resolves to the SAME category as the first: normalizeName
    // is what makes "marketing" and "Marketing" one category rather than two.
    expect(results[0].parsed!.categoryId).toBe(results[2].parsed!.categoryId);
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

  /**
   * Rows append, so the failure to stop is a nervous re-upload writing every
   * line a second time and the report quietly doubling the month. The batch id
   * is a hash of the file rather than a fresh uuid per run, and the commit
   * clears that batch before it writes — so the same file is the same import
   * however many times it is sent.
   */
  it("re-importing the same file replaces what it wrote instead of doubling it", async () => {
    const file = csv("2026-04,Marketing,111", "2026-04,Payroll,222");
    const first = await commitCsv(repo, file);
    const before = await countActuals();

    const again = await commitCsv(repo, file);
    expect(again.committed).toBe(2);
    expect(again.importBatchId).toBe(first.importBatchId); // same file, same batch
    expect(await countActuals()).toBe(before); // no new rows

    const cell = await repo.listActuals({ month: "2026-04" });
    expect(cell.map(a => a.amountMinor).sort((x, y) => x - y)).toEqual([11100, 22200]);
  });

  /**
   * The other half of that rule, and the reason it is scoped to a batch rather
   * than to a cell: a DIFFERENT file naming the same category and month is more
   * spend in that month, not a correction of what is already there.
   */
  it("a different file adds to the same cell rather than overwriting it", async () => {
    await commitCsv(repo, csv("2026-05,Marketing,100"));
    await commitCsv(repo, csv("2026-05,Marketing,250"));
    const cell = await repo.listActuals({ month: "2026-05" });
    expect(cell.map(a => a.amountMinor)).toEqual([10000, 25000]);
  });
});

/**
 * The import used to ask the database two questions per row — "does this
 * category exist?" and "is this month locked?" — whose answers cannot change
 * mid-file. At the 1 MB body limit that is ~40,000 round trips to learn two
 * things. Both are read once up front now, and the commit is a single
 * insertMany rather than an await per row.
 *
 * Counting round trips rather than timing them: a wall-clock assertion would be
 * flaky, and the thing that actually regresses is a query moving back inside
 * the loop, which shows up here immediately and at any file size.
 */
describe("import cost does not scale with file size", () => {
  const countRoundTrips = async (commands: string[], run: () => Promise<unknown>) => {
    const client = mongoose.connection.getClient();
    let n = 0;
    const tally = (e: { commandName: string }) => void (commands.includes(e.commandName) && n++);
    client.on("commandStarted", tally);
    try {
      await run();
    } finally {
      client.off("commandStarted", tally);
    }
    return n;
  };

  // The rows walk months rather than repeating one, so this measures a wide
  // file rather than one deep cell — both are legal now, and a per-month spread
  // is what the report's range query has to survive. Started well past the
  // months the tests above use so nothing collides.
  const rows = (n: number) =>
    csv(
      ...Array.from(
        { length: n },
        (_, i) => `20${30 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")},Marketing,${i + 1}`
      )
    );

  it("previews 200 rows with the same number of reads as 2", async () => {
    const two = await countRoundTrips(["find"], () => previewCsv(repo, rows(2)));
    const twoHundred = await countRoundTrips(["find"], () => previewCsv(repo, rows(200)));

    expect(two).toBe(2); // one for the categories, one for the locked months
    expect(twoHundred).toBe(two);
  });

  it("commits 200 rows in one write command, not 200", async () => {
    const before = await countActuals();
    const writes = await countRoundTrips(["update", "insert"], () => commitCsv(repo, rows(200)));

    expect(writes).toBe(1);
    expect(await countActuals()).toBe(before + 200);
  });
});
