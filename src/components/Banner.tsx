/**
 * Banner — the API error envelope made visible, as a shadcn Alert. The
 * server's `message` renders VERBATIM (one error vocabulary end to end);
 * PERIOD_LOCKED additionally shows the lock chip for the month it names.
 * `ok` is the success counterpart.
 *
 * No "use client": this module is server-renderable, and any caller that
 * passes `onDismiss` is already a client component, which pulls it into the
 * client bundle on its own.
 */
import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { LockChip } from "./LockChip";

export function Banner({
  error,
  ok,
  onDismiss,
}: {
  error?: ApiError | null;
  ok?: string | null;
  onDismiss?: () => void;
}) {
  if (!error && !ok) return null;

  const dismiss = onDismiss && (
    <AlertAction>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </AlertAction>
  );

  if (error) {
    return (
      <Alert variant="destructive" className="mb-4 max-w-[560px]">
        <CircleAlert aria-hidden />
        <AlertTitle className="font-mono text-xs tracking-[0.07em] uppercase">
          {error.code === "PERIOD_LOCKED" ? (
            <LockChip month={error.details?.month} className="border-destructive text-destructive" />
          ) : (
            error.code.toLowerCase().replace(/_/g, " ")
          )}
        </AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
        {dismiss}
      </Alert>
    );
  }

  return (
    <Alert role="status" className="mb-4 max-w-[560px] text-ledger">
      <CircleCheck aria-hidden />
      <AlertTitle>{ok}</AlertTitle>
      {dismiss}
    </Alert>
  );
}
