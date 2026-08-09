// Auth.js credentials + bcrypt, JWT in an httpOnly cookie. requireRepo() is the
// ONE door from a session to data.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { connectDb } from "./db";
import { AppError } from "./errors";
import { allowAttempt, clearAttempts } from "./ratelimit";
import { M } from "@/domain/models";
import { ScopedRepo } from "@/domain/repo";
import { zCredentials } from "@/domain/users";

// Compared against when the email is unknown, so a miss costs the same bcrypt
// round as a wrong password — otherwise the timing gap enumerates accounts.
const DUMMY_HASH = "$2a$12$37o.S.T7RUWid.msxbtmJubEEyFf5VaTrm1hXXxBLXZoj2LOF5QB6";

/** Null for every failure, so a rate-limited attempt looks like a wrong password. */
export async function authorize(raw: unknown) {
  const parsed = zCredentials.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  // Cap tries per address BEFORE touching the database.
  if (!allowAttempt(email)) return null;

  await connectDb();
  const user = await M.User.findOne({ email }).lean();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return null;

  clearAttempts(email);
  return { id: String(user._id), email: user.email };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
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
