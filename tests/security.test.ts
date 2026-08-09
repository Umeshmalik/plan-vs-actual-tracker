/**
 * The hardening pass, asserted: enumeration by timing, credential stuffing,
 * query-selector injection, unbounded bodies. Nothing asserts wall-clock — the
 * timing fix is proven by COUNTING the bcrypt round that equalises both answers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { M } from "../src/domain/models";
import { ScopedRepo } from "../src/domain/repo";

const state = vi.hoisted(() => ({ repo: null as unknown as ScopedRepo }));

// Auth.js's ESM entry cannot resolve next/server outside a Next build, and it is
// not what is under test — `authorize` is.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: async () => null, signIn: async () => {}, signOut: async () => {} }),
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));

// Stubbed requireRepo so the import routes get a repo without a session.
vi.mock("../src/lib/auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/lib/auth")>()),
  requireRepo: async () => state.repo,
}));
vi.mock("../src/lib/logger", () => ({ log: { info: () => {} }, logRequest: () => {} }));
// No Next request store out here. See routes.test.ts.
vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

import { authorize } from "../src/lib/auth";
import { createUser } from "../src/domain/users";
import { MIN_SCORE, passwordStrength } from "../src/lib/password";
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
  // autoIndex builds the unique {email} index in the background — wait for it.
  await Promise.all(Object.values(M).map(model => model.init()));

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

    // Unknown address: compared against the dummy hash, not returned early.
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

describe("sign-up creates an account the sign-in path accepts", () => {
  it("normalises the address, and authorize takes it straight away", async () => {
    clearAttempts();
    // If sign-up and sign-in normalised differently, this account would be lost.
    await expect(
      createUser({ email: "  New.User@Example.COM ", password: "a-good-password" })
    ).resolves.toMatchObject({ email: "new.user@example.com" });

    await expect(
      authorize({ email: "new.user@example.com", password: "a-good-password" })
    ).resolves.toMatchObject({ email: "new.user@example.com" });
  });

  it("refuses a second account for the same address", async () => {
    clearAttempts();
    await createUser({ email: "taken@example.com", password: "a-good-password" });
    await expect(createUser({ email: "TAKEN@example.com", password: "another-password" })).rejects.toThrow(
      /already has an account/
    );
    expect(await M.User.countDocuments({ email: "taken@example.com" })).toBe(1);
  });

  it("refuses a short password and a malformed address, writing nothing", async () => {
    clearAttempts();
    await expect(createUser({ email: "short@example.com", password: "1234567" })).rejects.toThrow(
      /at least 8 characters/
    );
    await expect(createUser({ email: "not-an-email", password: "a-good-password" })).rejects.toThrow(
      /valid email/
    );
    expect(await M.User.countDocuments({ email: "short@example.com" })).toBe(0);
  });

  it("refuses a weak password server-side, not just in the form", async () => {
    clearAttempts();
    // Each one passes the 8-character floor and still must not become an account.
    for (const password of ["password", "12345678", "aaaaaaaa", "abcdefgh"]) {
      await expect(createUser({ email: `weak-${password}@example.com`, password })).rejects.toThrow();
    }
    // …and the address itself is not a password.
    await expect(createUser({ email: "alice@example.com", password: "alice12345" })).rejects.toThrow(
      /email address/
    );
    expect(await M.User.countDocuments({ email: /^weak-/ })).toBe(0);
  });

  it("the seeded demo passwords still clear the bar the sign-up form holds", () => {
    // The README hands these out; a policy rejecting them makes the documented
    // logins unreproducible through the UI.
    for (const password of ["review-me-2026", "tenant-b-2026"]) {
      expect(passwordStrength(password).score).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(passwordStrength(password).hint).toBeUndefined();
    }
  });

  it("caps how fast one address can be probed for existing accounts", async () => {
    clearAttempts();
    // The duplicate error is an enumeration oracle; this bounds how fast it reads.
    for (let i = 0; i < AUTH_LIMIT; i++) {
      await createUser({ email: "probe@example.com", password: "a-good-password" }).catch(() => {});
    }
    await expect(createUser({ email: "probe@example.com", password: "a-good-password" })).rejects.toThrow(
      /Too many attempts/
    );
    clearAttempts();
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
    await state.repo.createActual({
      categoryId: String(new Types.ObjectId()),
      month: "2026-02",
      amountMinor: 100,
    });
    const injected = { $ne: null } as unknown as string;

    // Unguarded, $ne:null matches every document.
    mongoose.set("sanitizeFilter", false);
    expect(await M.Actual.find({ userId, month: injected }).lean()).toHaveLength(1);

    // Guarded, it is wrapped in $eq and can only match a document whose month
    // literally IS that object — i.e. none.
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
    // Without trusted(), $gte/$lte are sanitised and these return nothing.
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
