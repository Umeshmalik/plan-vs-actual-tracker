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
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reload the latest data"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RotateCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{pending ? "Reloading" : "Reload the latest data"}</TooltipContent>
    </Tooltip>
  );
}
