/** The mirror of (app)/layout.tsx: signed-in visitors are bounced away from /login. */
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect("/report");
  return children;
}
