// In domain/ rather than lib/auth.ts because auth.ts calls NextAuth() at module
// scope, which scripts/ and tests/ cannot import.
import bcrypt from "bcryptjs";
import { z } from "zod";
import { M } from "./models";
import { AppError } from "../lib/errors";
import { connectDb } from "../lib/db";
import { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrency } from "../lib/currency";
import { CALENDAR_YEAR_START, isFiscalStartMonth } from "../lib/fiscalYear";
import { passwordStrength } from "../lib/password";
import { allowAttempt } from "../lib/ratelimit";

export const BCRYPT_COST = 12;

/** Sign-up and sign-in share it, so an address normalises the same way both times. */
export const zCredentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Sign-up only: an account predating the policy must still be able to sign in,
// and enforcing strength at sign-in would confirm a guess was well-formed.
const zSignup = zCredentials.superRefine((value, ctx) => {
  const { hint } = passwordStrength(value.password, value.email);
  if (hint) ctx.addIssue({ code: "custom", path: ["password"], message: hint });
});

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

// Both fields optional: each control sends only what it changed, so the currency
// picker cannot lost-update the fiscal year of a stale second tab.
export const zSettings = z.object({
  fiscalYearStartMonth: z.coerce
    .number({ error: "Pick a month" })
    .int()
    .min(1, "Month must be 1-12")
    .max(12, "Month must be 1-12")
    .optional(),
  currency: z.enum(CURRENCY_CODES, { error: "Pick a supported currency" }).optional(),
});

/** Never throws on a missing or pre-migration document: absent = the defaults. */
export async function getSettings(userId: string) {
  await connectDb();
  const user = await M.User.findById(userId, { fiscalYearStartMonth: 1, currency: 1 }).lean();
  return {
    fiscalYearStartMonth: isFiscalStartMonth(user?.fiscalYearStartMonth)
      ? user.fiscalYearStartMonth
      : CALENDAR_YEAR_START,
    currency: isCurrency(user?.currency) ? user.currency : DEFAULT_CURRENCY,
  };
}

export async function updateSettings(userId: string, raw: unknown) {
  const parsed = zSettings.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", parsed.error.issues[0].message);
  // An explicit undefined reaching $set writes BSON null over a good preference.
  const $set = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys($set).length === 0) throw new AppError("VALIDATION_FAILED", "No settings were supplied.");

  await connectDb();
  const user = await M.User.findByIdAndUpdate(
    userId,
    { $set },
    { returnDocument: "after", projection: { fiscalYearStartMonth: 1, currency: 1 } }
  ).lean();
  if (!user) throw new AppError("NOT_FOUND", "That account no longer exists.");

  const saved = { fiscalYearStartMonth: user.fiscalYearStartMonth, currency: user.currency };
  // Read back: strict mode silently DROPS an update path a stale compiled schema
  // lacks (see models.ts) — 200 OK, value unchanged, nothing in the log.
  for (const [key, value] of Object.entries($set))
    if (saved[key as keyof typeof saved] !== value)
      throw new AppError("INTERNAL", `Could not save that setting. Reload the page and try again.`);

  return saved;
}

export async function createUser(raw: unknown) {
  const parsed = zSignup.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", parsed.error.issues[0].message);
  const { email, password } = parsed.data;

  // ponytail: the duplicate-email message below is an enumeration oracle, kept
  // because the honest fix is verification mail (out of scope). This bounds it.
  if (!allowAttempt(`signup:${email}`))
    throw new AppError("VALIDATION_FAILED", "Too many attempts. Wait a few minutes and try again.");

  await connectDb();
  try {
    const user = await M.User.create({ email, passwordHash: await hashPassword(password) });
    return { id: String(user._id), email: user.email };
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000)
      throw new AppError("VALIDATION_FAILED", "That email already has an account. Sign in instead.");
    throw e;
  }
}
