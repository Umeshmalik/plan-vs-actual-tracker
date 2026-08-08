import Link from "next/link";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Plan vs Actual" };

async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  "use server";
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/report",
    });
    return null;
  } catch (err) {
    // signIn throws NEXT_REDIRECT on success — only swallow real auth errors.
    if (err instanceof AuthError) return "Email or password is incorrect.";
    throw err;
  }
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-xl">Plan vs Actual</CardTitle>
          <CardDescription>Sign in to see targets, actuals and variance.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={login} />
        </CardContent>
        <CardFooter className="block text-xs text-muted-foreground">
          <p>
            No account?{" "}
            <Link href="/signup" className="underline underline-offset-2">
              Create one
            </Link>
          </p>
          <p className="mt-1">
            Reviewing this? Use <span className="font-mono">demo@example.com</span> /{" "}
            <span className="font-mono">review-me-2026</span>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
