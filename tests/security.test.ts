/**
 * The hardening pass, asserted. Each test names the attack it closes:
 * user enumeration by timing, credential stuffing, query-selector injection,
 * and an unbounded request body. Nothing here asserts wall-clock — timing
 * tests are flaky by construction, so the timing fix is proven by counting
 * the bcrypt round that makes both answers cost the same.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";

const state = vi.hoisted(() => ({ repo: null as unknown as ScopedRepo }));

// Auth.js itself is stubbed: its ESM entry cannot resolve `next/server` outside
// a Next build, and it is not what is under test — `authorize`, the function it
// calls, is. The provider factory hands the config straight back so the real
// authorize below is the real one.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: async () => null, signIn: async () => {}, signOut: async () => {} }),
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));

// Real `authorize` (that is the thing under test), stubbed `requireRepo` so the
// import routes get a repo without a session — same trick as routes.test.ts.
vi.mock("../src/lib/auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/lib/auth")>()),
  requireRepo: async () => state.repo,
}));
vi.mock("../src/lib/logger", () => ({ log: { info: () => {} }, logRequest: () => {} }));
// No Next request store out here, so next/cache has nothing to hang off — and
// the reads under test should hit Mongo anyway. (See routes.test.ts.)
vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

import { authorize } from "../src/lib/auth";
import { allowAttempt, clearAttempts, AUTH_LIMIT } from "../src/lib/ratelimit";
import { MAX_BODY_BYTES } from "../src/lib/route";
import "../src/lib/db"; // importing it is what turns sanitizeFilter on
import * as preview from "../src/app/api/imports/preview/route";
import * as commit from "../src/app/api/imports/commit/route";
import * as categories from "../src/app/api/categories/route";

let mongod: MongoMemoryReplSet;
let userId: Types.ObjectId;

const EMAIL = "demo@example.com";
const PASSWORD = "review-me-2026";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());

  userId = new Types.ObjectId();
  state.repo = new ScopedRepo(userId);
  await M.User.create({ _id: userId, email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 12) });
  await state.repo.createCategory("Marketing");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("sign-in does not leak which addresses exist", () => {
  it("still signs a real user in", async () => {
    clearAttempts();
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toMatchObject({ email: EMAIL });
  });

  it("an unknown email costs the same bcrypt round as a wrong password", async () => {
    clearAttempts();
    const compare = vi.spyOn(bcrypt, "compare");

    // Unknown address: compared against the fixed dummy hash, not returned early.
    compare.mockClear();
    await expect(
      authorize({ email: "nobody@example.com", password: "not-the-password" })
    ).resolves.toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);

    // Known address, wrong password: the same single comparison.
    compare.mockClear();
    await expect(authorize({ email: EMAIL, password: "not-the-password" })).resolves.toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);

    compare.mockRestore();
  });
});

describe("credential stuffing is capped", () => {
  it("blocks the 11th attempt in a window and recovers after it", async () => {
    clearAttempts();
    const key = "stuffing@example.com";
    const window = 60; // ms — the same code path, a window short enough to wait out

    for (let i = 0; i < AUTH_LIMIT; i++) expect(allowAttempt(key, AUTH_LIMIT, window)).toBe(true);
    expect(allowAttempt(key, AUTH_LIMIT, window)).toBe(false); // the 11th
    expect(allowAttempt(key, AUTH_LIMIT, window)).toBe(false); // and it stays shut

    await sleep(window + 20);
    expect(allowAttempt(key, AUTH_LIMIT, window)).toBe(true); // window rolled over
  });

  it("authorize stops doing work once an address is over the limit", async () => {
    clearAttempts();
    const email = "victim@example.com";
    for (let i = 0; i < AUTH_LIMIT; i++) {
      await expect(authorize({ email, password: "wrong-password" })).resolves.toBeNull();
    }

    const compare = vi.spyOn(bcrypt, "compare");
    compare.mockClear();
    // Same null, same wording upstream — refused before the DB or bcrypt is touched.
    await expect(authorize({ email, password: "wrong-password" })).resolves.toBeNull();
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
    clearAttempts();
  });

  it("a successful sign-in re-opens the account's window", async () => {
    clearAttempts();
    for (let i = 0; i < AUTH_LIMIT - 1; i++) await authorize({ email: EMAIL, password: "wrong-password" });
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toMatchObject({ email: EMAIL });
    await expect(authorize({ email: EMAIL, password: "wrong-password" })).resolves.toBeNull(); // counter reset, not blocked
    clearAttempts();
  });
});

describe("query-selector injection cannot reach a filter", () => {
  it("sanitizeFilter turns an operator-shaped value into a value", async () => {
    await state.repo.upsertActual({
      categoryId: String(new Types.ObjectId()),
      month: "2026-02",
      amountMinor: 100,
    });
    const injected = { $ne: null } as unknown as string;

    // Unguarded, this is the classic bypass: $ne:null matches every document.
    mongoose.set("sanitizeFilter", false);
    expect(await M.Actual.find({ userId, month: injected }).lean()).toHaveLength(1);

    // Guarded, it is wrapped in $eq — it can only ever match a document whose
    // month literally IS that object, i.e. none. (Mongoose rejects the cast,
    // which is the same outcome from the caller's side: no data comes back.)
    mongoose.set("sanitizeFilter", true);
    const leaked = await M.Actual.find({ userId, month: injected })
      .lean()
      .then(
        r => r,
        () => []
      );
    expect(leaked).toHaveLength(0);
  });

  it("the deliberate month-range reads still work under sanitizeFilter", async () => {
    // trusted() is what keeps $gte/$lte from being sanitised into nonsense —
    // without it these two return nothing and the whole app goes blank.
    const cat = await state.repo.findCategoryByName("marketing");
    await state.repo.upsertPlan(String(cat!._id), "2026-02", 5000);
    await state.repo.lock("2026-02");

    expect(await state.repo.listPlans("2026-01", "2026-03")).toHaveLength(1);
    expect(await state.repo.listLocks("2026-01", "2026-03")).toHaveLength(1);
    expect(await state.repo.listPlans("2026-05", "2026-06")).toHaveLength(0);
    await state.repo.unlock("2026-02");
  });
});

describe("an oversized upload is refused before anything is written", () => {
  it("rejects a CSV over 1 MB on both import routes", async () => {
    const csv = "month,category,amount\n" + "2026-02,Marketing,10\n".repeat(60_000);
    const body = JSON.stringify({ csv });
    expect(body.length).toBeGreaterThan(MAX_BODY_BYTES);

    const before = (await state.repo.listActuals({})).length;
    const big = (path: string) =>
      new NextRequest(`http://t${path}`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "content-length": String(body.length) },
      });

    for (const [path, handler] of [
      ["/api/imports/preview", preview.POST],
      ["/api/imports/commit", commit.POST],
    ] as const) {
      const res = await handler(big(path));
      expect(res.status).toBe(422);
      const { error } = await res.json();
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.message).toContain("1 MB");
    }

    expect(await state.repo.listActuals({})).toHaveLength(before); // nothing written
  });

  it("a normal-sized import is untouched by the guard", async () => {
    const res = await preview.POST(
      new NextRequest("http://t/api/imports/preview", {
        method: "POST",
        body: JSON.stringify({ csv: "month,category,amount\n2026-04,Marketing,10" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).okCount).toBe(1);
  });
});

describe("every response carries the no-store and trace headers", () => {
  it("stamps cache-control and echoes the request id", async () => {
    const res = await categories.GET(
      new NextRequest("http://t/api/categories", { headers: { "x-request-id": "req-42" } })
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe("req-42");

    // Errors are stamped too, with a minted id when nobody upstream sent one.
    const bad = await categories.POST(
      new NextRequest("http://t/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(bad.status).toBe(422);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(bad.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
