"use client";

/**
 * The server action stays the submit path — Auth.js sets the cookie and issues
 * the redirect server-side. TanStack Form sits in front for field state, gating
 * on React's rule that a default-prevented submit skips the form action.
 *
 * Sign-up is the same form behind a `mode` prop, since domain/users.ts validates
 * both with the same rules.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { MIN_LENGTH, MIN_SCORE, passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const validEmail = ({ value }: { value: string }) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter a valid email address";

const longEnough = ({ value }: { value: string }) =>
  value.length >= MIN_LENGTH ? undefined : `Password must be at least ${MIN_LENGTH} characters`;

/** Calls the same function createUser validates with, so it cannot over-promise. */
function StrengthMeter({ password, email }: { password: string; email: string }) {
  const { score, label, hint } = passwordStrength(password, email);
  const ok = score >= MIN_SCORE;

  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex gap-1" role="img" aria-label={`Password strength: ${label}`}>
        {[1, 2, 3, 4].map(step => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full bg-muted transition-colors",
              password.length > 0 && step <= score && (ok ? "bg-ledger" : "bg-destructive")
            )}
          />
        ))}
      </div>
      {password.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className={cn("font-medium", ok ? "text-ledger" : "text-destructive")}>{label}</span>
          {hint && ` — ${hint}`}
        </p>
      )}
    </div>
  );
}

const COPY = {
  signin: {
    idle: "Sign in",
    busy: "Signing in",
    failure: "Sign-in failed",
    autoComplete: "current-password",
    defaultEmail: "demo@example.com",
  },
  signup: {
    idle: "Create account",
    busy: "Creating account",
    failure: "Could not create the account",
    autoComplete: "new-password",
    defaultEmail: "",
  },
} as const;

function Submit({ copy }: { copy: (typeof COPY)[keyof typeof COPY] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? copy.busy : copy.idle}
    </Button>
  );
}

export function LoginForm({
  action,
  mode = "signin",
}: {
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
  mode?: keyof typeof COPY;
}) {
  const copy = COPY[mode];
  const isSignup = mode === "signup";
  const [reveal, setReveal] = useState(false);
  const [error, formAction] = useActionState(action, null);
  // String() rather than the literal: COPY is `as const`, and a default typed
  // `"" | "demo@example.com"` would make handleChange refuse every other address.
  const form = useForm({ defaultValues: { email: String(copy.defaultEmail), password: "" } });

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
          <AlertTitle>{copy.failure}</AlertTitle>
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

      <form.Field
        name="password"
        // Sign-up gates on strength, sign-in only on length. onChangeListenTo
        // re-runs the rule when the EMAIL changes, so "alice@… / alice1234" is
        // caught whichever field was typed last.
        validators={{
          onMount: isSignup ? ({ value }) => passwordStrength(value).hint : longEnough,
          onChangeListenTo: isSignup ? ["email"] : [],
          onChange: isSignup
            ? ({ value, fieldApi }) =>
                passwordStrength(value, String(fieldApi.form.getFieldValue("email") ?? "")).hint
            : longEnough,
        }}
      >
        {field => {
          const issue = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined;
          return (
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name={field.name}
                  type={reveal ? "text" : "password"}
                  autoComplete={copy.autoComplete}
                  required
                  className="pr-9"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={issue ? true : undefined}
                  aria-describedby={issue ? "password-error" : undefined}
                />
                <Button
                  type="button" // never submits the form
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
                  aria-pressed={reveal}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  onClick={() => setReveal(r => !r)}
                >
                  {reveal ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </Button>
              </div>

              {isSignup && (
                <form.Subscribe selector={state => state.values.email}>
                  {email => <StrengthMeter password={field.state.value} email={email} />}
                </form.Subscribe>
              )}

              {issue && (
                <p id="password-error" role="alert" className="text-xs text-destructive">
                  {issue}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      <Submit copy={copy} />
    </form>
  );
}
