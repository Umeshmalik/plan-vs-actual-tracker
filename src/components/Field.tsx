/**
 * Field — Label + control slot + inline error, fed straight from the API's
 * VALIDATION_FAILED issues (`fieldErrors(error)[name]`). The server's wording
 * renders verbatim, so there is one error vocabulary end to end.
 *
 * The hint is `${htmlFor}-hint` and the error is `${htmlFor}-error`; point the
 * control's aria-describedby at whichever is showing.
 */
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3.5 grid max-w-[340px] gap-1", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
