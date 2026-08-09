/**
 * users.ts — THE account module: the one place a password is hashed, and the
 * one definition of what a credential looks like. (DRY)
 *
 * It lives in `domain/` rather than `lib/auth.ts` on purpose. `auth.ts` calls
 * `NextAuth()` at module scope, which cannot be imported outside a Next build —
 * so `scripts/seed.ts` and the tests could not reach a hashing helper that
 * lived there, and the cost factor would drift into a second copy. Nothing in
 * this file imports Next or Auth.js: the sign-up server action, the credentials
 * provider, the seed script and the tests all import the same functions.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";
import { M } from "./models";
import { AppError } from "../lib/errors";
import { connectDb } from "../lib/db";
import { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrency } from "../lib/currency";
import { CALENDAR_YEAR_START, isFiscalStartMonth } from "../lib/fiscalYear";
import { passwordStrength } from "../lib/password";
import { allowAttempt } from "../lib/ratelimit";

/**
 * Cost factor 12, not bcrypt's old default of 10. A cost is a budget against
 * the attacker's hardware, and 10 was chosen for 2010's: a 2026 GPU rig walks a
 * cost-10 hash roughly four times faster than a cost-12 one, and the price of
 * the upgrade is ~230ms on a sign-in nobody perceives. Every hash this app
 * produces — sign-up, seed — comes from here, so there is one number to raise.
 */
export const BCRYPT_COST = 12;

/**
 * Sign-up and sign-in take the same pair, so they validate against the same
 * schema: an address normalised the same way both times (or an account created
 * as `Demo@Example.com` could never be signed into as `demo@example.com`), and
 * one length rule, quoted verbatim by the client-side form.
 *
 * `.email()` is deprecated in Zod 4; piping into `z.email()` keeps normalise-
 * then-check in that order.
 */
export const zCredentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * Sign-up only. The strength rule is deliberately NOT on `zCredentials`: an
 * account created before the policy tightened must still be able to sign in,
 * and applying it at the sign-in form would tell an attacker their guess was
 * well-formed but wrong. `lib/password.ts` owns the rule; the sign-up form
 * renders its meter from the same function, so the bar the user sees is the bar
 * the server holds.
 */
const zSignup = zCredentials.superRefine((value, ctx) => {
  const { hint } = passwordStrength(value.password, value.email);
  if (hint) ctx.addIssue({ code: "custom", path: ["password"], message: hint });
});

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

/**
 * Create an account. Throws AppError, so the route/action wrapper turns it into
 * the same envelope every other failure uses.
 *
 * Uniqueness is the unique `{email}` index, not a findOne-then-create: two
 * simultaneous sign-ups for one address race that check, and the database is
 * the only thing that can settle it. Duplicate key (11000) is the answer.
 *
 * ponytail: telling the caller "that address already has an account" is a user-
 * enumeration oracle — the exact leak `authorize()` goes out of its way to
 * close on the sign-in side. It is kept because the honest alternative is an
 * email-verification round trip ("check your inbox" either way), which the
 * README puts out of scope. Rate limiting below bounds how fast the oracle can
 * be read; the real fix is verification mail.
 */
/**
 * The user's own settings live here for the same reason createUser does:
 * `users` is the one collection with no tenant column, so ScopedRepo — which
 * exists to inject `userId` into every filter — is the wrong tool. The filter
 * here is `_id`, and this module is the only place allowed to write it.
 */
/**
 * Both fields are optional because each has its own control in the header and
 * each sends only what it changed. A PUT that named every setting would make
 * the currency picker quietly rewrite the fiscal year to whatever the page was
 * rendered with — the classic lost-update the moment two tabs are open.
 */
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
  // Only what was actually sent. An explicit `undefined` reaching $set writes a
  // BSON null over a perfectly good preference, which is the same trap the repo
  // guards against on the filter side.
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
  // Read the answer back and check it. Mongoose's strict mode DROPS an update
  // path the compiled schema does not know about, and it drops it silently: the
  // write answers 200, the value never moves, the screen looks broken and there
  // is nothing in the log to say why. That is exactly what a stale compiled
  // model produces (see models.ts), and it is the failure mode this whole file
  // is least able to notice. One comparison turns it into a real error.
  for (const [key, value] of Object.entries($set))
    if (saved[key as keyof typeof saved] !== value)
      throw new AppError("INTERNAL", `Could not save that setting. Reload the page and try again.`);

  return saved;
}

export async function createUser(raw: unknown) {
  const parsed = zSignup.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", parsed.error.issues[0].message);
  const { email, password } = parsed.data;

  // Same counter and window as sign-in, a separate key space: ten new accounts
  // per address per quarter hour caps both the enumeration probe above and a
  // script farming accounts off one form.
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
