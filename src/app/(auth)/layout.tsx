/**
 * The mirror of `(app)/layout.tsx`: that one bounces signed-out visitors to
 * /login, this one bounces signed-in visitors away from /login and /signup.
 * It lives in the layout rather than in each page for the same reason —
 * a new auth screen inherits the guard instead of having to remember it.
 */
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect("/report");
  return children;
}
