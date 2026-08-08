import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { currentUser, signOut } from "@/lib/auth";
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

  async function endSession() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 max-sm:px-3">
        <Link href="/report" className="leading-tight">
          <span className="font-display text-base font-semibold tracking-tight">Plan vs Actual</span>
          <span className="block font-mono text-[0.65rem] tracking-[0.08em] text-muted-foreground uppercase">
            ledger · fy 2026
          </span>
        </Link>

        <Suspense fallback={<Skeleton className="ml-auto h-8 w-44" />}>
          <MonthRangePicker />
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

      <main className="mx-auto max-w-[1100px] p-6 max-sm:p-4">{children}</main>

      <footer className="mx-auto max-w-[1100px] px-6 pb-8 font-mono text-[0.7rem] text-muted-foreground max-sm:px-4">
        Money is stored in integer minor units · months are YYYY-MM keys · locking is enforced by the API, not
        the UI
      </footer>
    </div>
  );
}
