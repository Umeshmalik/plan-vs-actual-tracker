"use client";

/**
 * Re-fetch the server tree on demand — for changes this app cannot see (another
 * tab, another device, the API directly). There is no polling or websocket.
 *
 * The toast fires on the way OUT of the transition, not on click: a reload
 * usually changes nothing on screen, so without a timestamped confirmation the
 * button is indistinguishable from a dead one.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const clockTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Only true for a transition this button started, so an unrelated one is silent. */
  const requested = useRef(false);
  const [lastReloaded, setLastReloaded] = useState<Date | null>(null);

  useEffect(() => {
    if (pending || !requested.current) return;
    requested.current = false;
    const at = new Date();
    setLastReloaded(at);
    // In the TITLE, not a description: sonner renders those at reduced contrast.
    toast.success(`Up to date · re-read at ${clockTime(at)}`);
  }, [pending]);

  const label = pending
    ? "Reloading"
    : lastReloaded
      ? `Last reloaded ${clockTime(lastReloaded)}`
      : "Reload the latest data";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reload the latest data"
          disabled={pending}
          onClick={() => {
            requested.current = true;
            startTransition(() => router.refresh());
          }}
        >
          <RotateCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
      {/* The tooltip text is never read while focus stays on the button. */}
      <span aria-live="polite" className="sr-only">
        {pending ? "Reloading data" : lastReloaded ? `Data reloaded at ${clockTime(lastReloaded)}` : ""}
      </span>
    </Tooltip>
  );
}
