/**
 * Settings round-trip. The currency preference is only worth anything if
 * writing it and reading it back agree, and if one setting cannot clobber the
 * other — the two header controls each send their own field.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { M } from "../src/domain/models";
import { createUser, getSettings, updateSettings } from "../src/domain/users";

let mongod: MongoMemoryReplSet;
let userId: string;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  const user = await createUser({ email: "settings@example.com", password: "correct-horse-42" });
  userId = user.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("the display currency preference", () => {
  it("defaults to USD, and a write is readable straight back", async () => {
    expect(await getSettings(userId)).toMatchObject({ currency: "USD" });
    await updateSettings(userId, { currency: "INR" });
    expect(await getSettings(userId)).toMatchObject({ currency: "INR" });
  });

  it("actually lands on the document — a schema that dropped the path would not", async () => {
    await updateSettings(userId, { currency: "GBP" });
    const raw = await M.User.findById(userId, { currency: 1 }).lean();
    expect(raw?.currency).toBe("GBP");
  });

  it("each control writes only its own field, so neither clobbers the other", async () => {
    await updateSettings(userId, { fiscalYearStartMonth: 4 });
    await updateSettings(userId, { currency: "AED" });
    expect(await getSettings(userId)).toMatchObject({ fiscalYearStartMonth: 4, currency: "AED" });
  });

  it("rejects a code the app cannot render, and an empty change", async () => {
    await expect(updateSettings(userId, { currency: "XYZ" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(updateSettings(userId, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // The rejected writes left the last good value alone.
    expect(await getSettings(userId)).toMatchObject({ currency: "AED" });
  });
});
