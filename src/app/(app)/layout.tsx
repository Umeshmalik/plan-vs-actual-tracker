import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { currentUser, signOut } from "@/lib/auth";
import { fiscalYearLabel, fiscalYearOf } from "@/lib/fiscalYear";
import { DEFAULT_RANGE } from "@/lib/range";
import { getSettings } from "@/lib/reads";
import { SectionTabs } from "@/components/Tabs";
import { MonthRangePicker } from "@/components/MonthRangePicker";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // The wordmark used to print a hard-coded "fy 2026". It now names the fiscal
  // year the user's own start month puts us in, which is also the one the range
  // picker's FY buttons are anchored on.
  const { fiscalYearStartMonth } = await getSettings(user.id);
  const currentFy = fiscalYearLabel(
    fiscalYearOf(DEFAULT_RANGE.from, fiscalYearStartMonth),
    fiscalYearStartMonth
  );

  async function endSession() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen">
      {/* One sticky block, not two. The tabs have to pin under the header, and
          giving them their own `sticky top-[64px]` would hard-code the header's
          height into a second file — a number that goes wrong the first time the
          wordmark wraps on a narrow screen. Sticking the pair together means the
          browser does that arithmetic. The background and blur live here for the
          same reason: one surface scrolling under one edge. */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <header className="flex items-center gap-4 border-b px-6 py-3 max-sm:px-3">
          <Link href="/report" className="leading-tight">
            <span className="font-display text-base font-semibold tracking-tight">Plan vs Actual</span>
            <span className="block font-mono text-[0.65rem] tracking-[0.08em] text-muted-foreground uppercase">
              ledger · {currentFy}
            </span>
          </Link>

          <Suspense fallback={<Skeleton className="ml-auto h-8 w-44" />}>
            <MonthRangePicker fiscalYearStartMonth={fiscalYearStartMonth} />
          </Suspense>

          <RefreshButton />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="font-mono text-xs">
                <span className="max-sm:hidden">{user.email}</span>
                <span className="sm:hidden">Account</span>
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-xs text-muted-foreground">Signed in as</span>
                <span className="font-mono text-xs">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action={endSession}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full">
                    <LogOut className="size-4" aria-hidden />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <SectionTabs />
      </div>

      <main className="mx-auto max-w-275 p-6 max-sm:p-4">{children}</main>

      <footer className="mx-auto max-w-275 px-6 pb-8 font-mono text-[0.7rem] text-muted-foreground max-sm:px-4">
        Money is stored in integer minor units · months are YYYY-MM keys · locking is enforced by the API, not
        the UI
      </footer>
    </div>
  );
}
