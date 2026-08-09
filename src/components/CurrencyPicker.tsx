"use client";

/**
 * The one global currency control. It sends ONLY `currency` — settings that each
 * write their own key cannot overwrite one another.
 */
import { Check, Coins } from "lucide-react";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from "@/lib/currency";
import { useApiMutation } from "@/lib/useApiMutation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CurrencyPicker({ currency }: { currency: CurrencyCode }) {
  const save = useApiMutation<{ currency: CurrencyCode }, { currency: CurrencyCode }>({
    url: "/api/settings",
    method: "PUT",
    success: vars => `Figures now shown in ${vars.currency}`,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="font-mono"
          aria-label={`Display currency: ${CURRENCIES[currency].label}. Change it`}
        >
          <Coins className="size-4 text-muted-foreground" aria-hidden />
          <span>{currency}</span>
        </Button>
      </DropdownMenuTrigger>
      {/* Explicit width, or the note's measure wins and every label wraps. */}
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Display currency
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CURRENCY_CODES.map(code => (
          <DropdownMenuItem
            key={code}
            disabled={save.isPending}
            onSelect={() => {
              if (code !== currency) save.mutate({ currency: code });
            }}
            className="gap-2.5"
          >
            {/* Fixed width and centred, or "AED" shunts the codes out of line. */}
            <span className="w-7 shrink-0 text-center font-mono">{CURRENCIES[code].symbol.trim()}</span>
            <span className="w-9 shrink-0 font-mono text-xs">{code}</span>
            <span className="truncate text-muted-foreground">{CURRENCIES[code].label}</span>
            {code === currency && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">
          Relabels every figure. Amounts already recorded are not converted.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
