/** Create the account, then sign straight into it — createUser just validated this pair. */
import Link from "next/link";
import { AuthError } from "next-auth";
import { createUser } from "@/domain/users";
import { AppError } from "@/lib/errors";
import { signIn } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "../login/LoginForm";

export const metadata = { title: "Create account · Plan vs Actual" };

async function register(_prev: string | null, formData: FormData): Promise<string | null> {
  "use server";
  const credentials = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  try {
    await createUser(credentials);
    await signIn("credentials", { ...credentials, redirectTo: "/report" });
    return null;
  } catch (err) {
    if (err instanceof AppError) return err.message;
    // The account exists by now, so a failure here is the sign-in, not the sign-up.
    if (err instanceof AuthError) return "Account created, but sign-in failed. Try signing in.";
    throw err; // NEXT_REDIRECT on success
  }
}

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-xl">Create your ledger</CardTitle>
          <CardDescription>
            Email and a password of at least 8 characters. You start with no categories — add them on the
            Plans tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={register} mode="signup" />
        </CardContent>
        <CardFooter className="block text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-2">
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
