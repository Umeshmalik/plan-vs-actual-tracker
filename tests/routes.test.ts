/**
 * The REST layer, end to end against a real mongod: every endpoint's status
 * code, response shape and error code, the lock guard on every mutating path,
 * and the one structured log line withRoute emits per request.
 * Auth is the only thing stubbed — requireRepo hands back a fixed ScopedRepo.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { NextRequest } from "next/server";
import { ScopedRepo } from "../src/domain/repo";

const state = vi.hoisted(() => ({
  repo: null as unknown as ScopedRepo,
  lines: [] as Record<string, unknown>[],
}));
vi.mock("../src/lib/auth", () => ({ requireRepo: async () => state.repo }));
// Capture the request log instead of printing it — the log line is a contract here.
vi.mock("../src/lib/logger", () => ({
  log: { info: () => {} },
  logRequest: (fields: Record<string, unknown>) => void state.lines.push(fields),
}));

import * as categories from "../src/app/api/categories/route";
import * as plans from "../src/app/api/plans/route";
import * as actuals from "../src/app/api/actuals/route";
import * as actualById from "../src/app/api/actuals/[id]/route";
import * as report from "../src/app/api/report/route";
import * as locks from "../src/app/api/locks/route";
import * as lockByMonth from "../src/app/api/locks/[month]/route";
import * as preview from "../src/app/api/imports/preview/route";
import * as commit from "../src/app/api/imports/commit/route";
import * as health from "../src/app/api/health/route";

let mongod: MongoMemoryReplSet;
let catId: string;

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://t${url}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
const json = async (r: Response) => [r.status, await r.json()] as const;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  state.repo = new ScopedRepo(new Types.ObjectId());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("REST layer", () => {
  it("categories: create + list", async () => {
    const [s, b] = await json(await categories.POST(req("/api/categories", "POST", { name: "Marketing" })));
    expect(s).toBe(200);
    catId = String(b.category._id);
    const [s2, b2] = await json(await categories.GET(req("/api/categories")));
    expect([s2, b2.categories.length]).toEqual([200, 1]);
  });

  it("categories: blank name -> 422 VALIDATION_FAILED", async () => {
    const [s, b] = await json(await categories.POST(req("/api/categories", "POST", { name: "" })));
    expect([s, b.error.code]).toEqual([422, "VALIDATION_FAILED"]);
  });

  it("plans: PUT converts major -> minor, DELETE reports the count", async () => {
    const [s, b] = await json(
      await plans.PUT(req("/api/plans", "PUT", { categoryId: catId, month: "2026-02", amount: 5000 }))
    );
    expect([s, b.plan.amountMinor]).toEqual([200, 500000]);
    const [s2, b2] = await json(
      await plans.DELETE(req("/api/plans", "DELETE", { categoryId: catId, month: "2026-02" }))
    );
    expect([s2, b2.deleted]).toEqual([200, 1]);
  });

  it("plans: unknown category -> 422 UNKNOWN_CATEGORY, bad month -> 422", async () => {
    const [s, b] = await json(
      await plans.PUT(
        req("/api/plans", "PUT", { categoryId: new Types.ObjectId().toString(), month: "2026-02", amount: 1 })
      )
    );
    expect([s, b.error.code]).toEqual([422, "UNKNOWN_CATEGORY"]);
    const [s2] = await json(
      await plans.PUT(req("/api/plans", "PUT", { categoryId: catId, month: "2026-13", amount: 1 }))
    );
    expect(s2).toBe(422);
  });

  it("actuals: create, filter, delete", async () => {
    const [s, b] = await json(
      await actuals.POST(
        req("/api/actuals", "POST", { categoryId: catId, month: "2026-02", amount: 12.34, note: "n" })
      )
    );
    expect([s, b.actual.amountMinor, b.actual.source]).toEqual([200, 1234, "manual"]);
    const id = String(b.actual._id);

    expect((await (await actuals.GET(req("/api/actuals"))).json()).actuals.length).toBe(1);
    expect((await (await actuals.GET(req("/api/actuals?month=2026-02"))).json()).actuals.length).toBe(1);
    expect((await (await actuals.GET(req("/api/actuals?month=2026-09"))).json()).actuals.length).toBe(0);
    expect(
      (await (await actuals.GET(req(`/api/actuals?month=&categoryId=${catId}`))).json()).actuals.length
    ).toBe(1);
    expect(await (await actuals.GET(req("/api/actuals?month=nope"))).status).toBe(422);

    const [s2, b2] = await json(
      await actualById.DELETE(req(`/api/actuals/${id}`, "DELETE"), { params: Promise.resolve({ id }) })
    );
    expect([s2, b2.deleted]).toEqual([200, 1]);
  });

  it("actuals: junk id -> 404, not 500 (no CastError escapes the repo)", async () => {
    const [s, b] = await json(
      await actualById.DELETE(req("/api/actuals/junk", "DELETE"), { params: Promise.resolve({ id: "junk" }) })
    );
    expect([s, b.error.code]).toEqual([404, "NOT_FOUND"]);
    // a well-formed id that isn't ours is the same answer
    const gone = new Types.ObjectId().toString();
    expect(
      (
        await actualById.DELETE(req(`/api/actuals/${gone}`, "DELETE"), {
          params: Promise.resolve({ id: gone }),
        })
      ).status
    ).toBe(404);
  });

  it("locks: POST, GET range, DELETE", async () => {
    const [s, b] = await json(await locks.POST(req("/api/locks", "POST", { month: "2026-01" })));
    expect([s, b.month, typeof b.lockedAt]).toEqual([200, "2026-01", "string"]);
    const [s2, b2] = await json(await locks.GET(req("/api/locks?from=2026-01&to=2026-03")));
    expect([s2, b2.lockedMonths]).toEqual([200, ["2026-01"]]);
    expect((await (await locks.GET(req("/api/locks"))).json()).lockedMonths).toEqual(["2026-01"]); // DEFAULT_RANGE
  });

  it("every mutating path on a locked month is 409 PERIOD_LOCKED", async () => {
    const cases = [
      () => plans.PUT(req("/api/plans", "PUT", { categoryId: catId, month: "2026-01", amount: 1 })),
      () => plans.DELETE(req("/api/plans", "DELETE", { categoryId: catId, month: "2026-01" })),
      () => actuals.POST(req("/api/actuals", "POST", { categoryId: catId, month: "2026-01", amount: 1 })),
    ];
    for (const c of cases) {
      const [s, b] = await json(await c());
      expect([s, b.error.code, b.error.details.month]).toEqual([409, "PERIOD_LOCKED", "2026-01"]);
    }
  });

  it("deleting an actual inside a month locked afterwards is 409", async () => {
    const made = await state.repo.createActual({ categoryId: catId, month: "2026-03", amountMinor: 100 });
    await state.repo.lock("2026-03");
    const id = String(made._id);
    const [s, b] = await json(
      await actualById.DELETE(req(`/api/actuals/${id}`, "DELETE"), { params: Promise.resolve({ id }) })
    );
    expect([s, b.error.code, b.error.details.month]).toEqual([409, "PERIOD_LOCKED", "2026-03"]);
    await state.repo.unlock("2026-03");
  });

  it("locks: DELETE /api/locks/:month unlocks; bad month -> 422", async () => {
    const [s, b] = await json(
      await lockByMonth.DELETE(req("/api/locks/2026-01", "DELETE"), {
        params: Promise.resolve({ month: "2026-01" }),
      })
    );
    expect([s, b]).toEqual([200, { month: "2026-01", unlocked: true }]);
    expect(
      (await lockByMonth.DELETE(req("/api/locks/x", "DELETE"), { params: Promise.resolve({ month: "x" }) }))
        .status
    ).toBe(422);
  });

  it("report: from/to required, returns runReport as-is", async () => {
    expect((await report.GET(req("/api/report"))).status).toBe(422);
    expect((await report.GET(req("/api/report?from=2026-03&to=2026-01"))).status).toBe(422);
    const [s, b] = await json(await report.GET(req("/api/report?from=2026-01&to=2026-03")));
    expect(s).toBe(200);
    expect(Object.keys(b).sort()).toEqual(["lockedMonths", "rows", "totals"]);
  });

  it("imports: preview counts, commit writes, bad row 422 with results", async () => {
    const good = "month,category,amount\n2026-02,Marketing,10\n2026-02,Marketing,20";
    const bad = "month,category,amount\n2026-02,Nope,10\n2026-02,Marketing,20";

    const [s, b] = await json(await preview.POST(req("/api/imports/preview", "POST", { csv: bad })));
    expect([s, b.okCount, b.errorCount]).toEqual([200, 1, 1]);
    expect((await state.repo.listActuals({ month: "2026-02" })).length).toBe(0); // preview wrote nothing

    const [s2, b2] = await json(await commit.POST(req("/api/imports/commit", "POST", { csv: bad })));
    expect([s2, b2.error.code, b2.error.details.results.length]).toEqual([422, "VALIDATION_FAILED", 2]);
    expect((await state.repo.listActuals({ month: "2026-02" })).length).toBe(0); // nothing written

    const [s3, b3] = await json(await commit.POST(req("/api/imports/commit", "POST", { csv: good })));
    expect([s3, b3.committed, typeof b3.importBatchId]).toEqual([200, 2, "string"]);
    expect((await state.repo.listActuals({ month: "2026-02" })).length).toBe(2);

    expect((await commit.POST(req("/api/imports/commit", "POST", { csv: "" }))).status).toBe(422);
  });

  it("imports: commit into a month locked after preview is 409", async () => {
    await state.repo.lock("2026-02");
    const [s, b] = await json(
      await commit.POST(
        req("/api/imports/commit", "POST", { csv: "month,category,amount\n2026-02,Marketing,10" })
      )
    );
    expect([s, b.error.code]).toEqual([422, "VALIDATION_FAILED"]); // previewCsv flags the row first
    await state.repo.unlock("2026-02");
  });

  it("health: real DB check", async () => {
    const [s, b] = await json(await health.GET(req("/api/health")));
    expect([s, b.ok, b.db]).toEqual([200, true, "up"]);
  });

  it("logs exactly one line per request, honouring an inbound x-request-id", async () => {
    state.lines.length = 0;
    await categories.GET(
      new NextRequest("http://t/api/categories", { headers: { "x-request-id": "req-42" } })
    );
    expect(state.lines).toEqual([
      {
        requestId: "req-42",
        route: "/api/categories",
        method: "GET",
        status: 200,
        ms: expect.any(Number),
        userId: String(state.repo.uid),
      },
    ]);

    // failures are logged too, with the status the caller actually got
    await categories.POST(req("/api/categories", "POST", { name: "" }));
    expect(state.lines).toHaveLength(2);
    expect(state.lines[1]).toMatchObject({ method: "POST", status: 422 });
    expect(String(state.lines[1].requestId)).toMatch(/^[0-9a-f-]{36}$/); // minted when none came in
  });
});
