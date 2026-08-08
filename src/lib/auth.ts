/**
 * auth.ts — Auth.js credentials + bcrypt, JWT in an httpOnly cookie.
 * The assignment says email+password is sufficient, so the time goes into
 * authorization instead: `requireRepo()` is the ONE door from a session to
 * data, and it hands back a ScopedRepo that cannot read another tenant.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { connectDb } from "./db";
import { AppError } from "./errors";
import { allowAttempt, clearAttempts } from "./ratelimit";
import { M } from "@/domain/models";
import { ScopedRepo } from "@/domain/repo";
// Sign-up and sign-in share one definition of a credential, so an address
// normalised at sign-up is normalised identically here. domain/users.ts owns it
// (and the hashing) because this module cannot be imported outside a Next build.
import { zCredentials } from "@/domain/users";

/**
 * A real cost-12 hash of a discarded random string, compared against whenever
 * the email is unknown. Returning early on "no such user" answers in
 * microseconds while a wrong password costs a full bcrypt round, and that gap
 * is a user-enumeration oracle: anyone can map which addresses hold an account
 * by timing the sign-in form. Hashing either way removes the signal.
 */
const DUMMY_HASH = "$2a$12$37o.S.T7RUWid.msxbtmJubEEyFf5VaTrm1hXXxBLXZoj2LOF5QB6";

/**
 * Exported so the security tests can drive it directly — the provider below is
 * the only production caller. Returns null for every failure, with the same
 * wording upstream (Auth.js turns null into the one credentials error the
 * login form already renders); a rate-limited attempt is indistinguishable
 * from a wrong password, which is the point.
 */
export async function authorize(raw: unknown) {
  const parsed = zCredentials.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  // Credential stuffing: cap tries per address before touching the database,
  // so a list replay costs an attacker 10 tries per account per 15 minutes.
  if (!allowAttempt(email)) return null;

  await connectDb();
  const user = await M.User.findOne({ email }).lean();
  // Always compare — a miss must cost the same as a wrong password.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return null;

  clearAttempts(email); // a real sign-in re-opens the window
  return { id: String(user._id), email: user.email };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // behind App Runner's proxy
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});

/** Session -> ScopedRepo. Throws UNAUTHORIZED. The only way in. */
export async function requireRepo(): Promise<ScopedRepo> {
  await connectDb();
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
  return new ScopedRepo(new Types.ObjectId(uid));
}

/** Same, but for server components: null instead of a thrown error. */
export async function currentUser() {
  const session = await auth();
  return session?.user?.id ? { id: session.user.id, email: session.user.email ?? "" } : null;
}
