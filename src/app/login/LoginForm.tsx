"use client";

/**
 * LoginForm — the server action stays the submit path, because Auth.js sets the
 * session cookie and issues the redirect on the server; a client fetch cannot.
 * TanStack Form sits in front of it and owns field state and client validation,
 * so a mistyped address is caught before the round-trip instead of after it.
 *
 * The gate works because React skips a form action when the submit event was
 * default-prevented, so an invalid form never reaches the server, and a valid
 * one submits natively — `useActionState` and `useFormStatus` keep working
 * exactly as they did. The wording matches the server's own credentials schema
 * so the client never invents an error the server would not have given.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const validEmail = ({ value }: { value: string }) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter a valid email address";

const longEnough = ({ value }: { value: string }) =>
  value.length >= 8 ? undefined : "Password must be at least 8 characters";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? "Signing in" : "Sign in"}
    </Button>
  );
}

export function LoginForm({
  action,
}: {
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
}) {
  const [error, formAction] = useActionState(action, null);
  // onMount as well as onChange, so validity is known on the very first submit
  // and not only after the user has typed into a field.
  const form = useForm({ defaultValues: { email: "demo@example.com", password: "" } });

  return (
    <form
      action={formAction}
      onSubmit={e => {
        if (form.state.isValid) return; // let the server action run
        e.preventDefault();
        void form.handleSubmit(); // touches every field, so the errors show
      }}
      className="grid gap-4"
    >
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Sign-in failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form.Field name="email" validators={{ onMount: validEmail, onChange: validEmail }}>
        {field => {
          const issue = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined;
          return (
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name={field.name}
                type="email"
                autoComplete="username"
                required
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? "email-error" : undefined}
              />
              {issue && (
                <p id="email-error" role="alert" className="text-xs text-destructive">
                  {issue}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      <form.Field name="password" validators={{ onMount: longEnough, onChange: longEnough }}>
        {field => {
          const issue = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined;
          return (
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name={field.name}
                type="password"
                autoComplete="current-password"
                required
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? "password-error" : undefined}
              />
              {issue && (
                <p id="password-error" role="alert" className="text-xs text-destructive">
                  {issue}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      <Submit />
    </form>
  );
}
