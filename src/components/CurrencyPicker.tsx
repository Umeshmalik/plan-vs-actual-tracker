"use client";

/**
 * CurrencyPicker — the one global currency control, in the header beside the
 * range picker, because both are the same kind of thing: a saved preference
 * about how this book is read, not a parameter of the look you are taking at
 * it. Saving re-renders the server tree, so every figure on the page follows in
 * one hop — the write expires the tenant's cache tag and `useApiMutation` fires
 * `router.refresh()`.
 *
 * It sends ONLY `currency`. The fiscal-year control sends only its own field,
 * and settings that each write their own key cannot overwrite one another.
 *
 * The note in the menu is not decoration: a user who believes switching to INR
 * converted their ledger is a user reading wrong numbers off a right screen.
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
      {/* An explicit width, because the widest row ("Pound sterling") and the
          note below would otherwise negotiate one between them and lose: the
          menu collapsed to the note's measure and wrapped every label. */}
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
            {/* The symbol is what the ledger will actually print, so it leads —
                fixed width and centred, or "AED" shunts the codes out of line. */}
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
