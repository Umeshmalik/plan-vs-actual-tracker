"use client";

/**
 * RefreshButton — re-fetch the server tree on demand.
 *
 * Every screen reads through React Server Components, and a mutation made here
 * already calls router.refresh() for you. This is for the case the app cannot
 * see: the same account changing data in another tab, on another device, or
 * straight against the API. There is no polling and no websocket, so this is
 * the affordance that closes that gap — one control in the header, all four
 * tabs, rather than a stale-data problem nobody can act on.
 *
 * The confirmation matters more here than for a mutation. A save changes
 * something on screen, so it is its own receipt; a reload usually changes
 * nothing — the common, healthy case is "you were already up to date" — and a
 * spinner that finishes in 200ms is indistinguishable from a dead button. So
 * the toast fires on the way OUT of the transition, not on click: React keeps
 * the transition pending until the re-rendered server tree has been applied, so
 * by the time it clears, the data on screen really has been re-read. A time
 * stamp is what makes a second click feel different from the first.
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
    // One line, in the toast's TITLE. Sonner renders a description at reduced
    // contrast — correct for a subtitle nobody has to read, wrong for the only
    // sentence here, where the timestamp IS the confirmation. "Nothing changed"
    // is the honest answer most of the time, and saying it is the whole point:
    // silence reads as a button that did not work.
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
      {/* Screen readers get the same confirmation the toast gives sighted users;
          sonner's own region announces the toast, this covers the tooltip text
          never being read because focus stayed on the button. */}
      <span aria-live="polite" className="sr-only">
        {pending ? "Reloading data" : lastReloaded ? `Data reloaded at ${clockTime(lastReloaded)}` : ""}
      </span>
    </Tooltip>
  );
}
