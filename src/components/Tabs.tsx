"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileSpreadsheet, ReceiptText, Target, Upload } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SECTIONS = [
  { href: "/report", label: "Report", Icon: FileSpreadsheet },
  { href: "/plans", label: "Plans", Icon: Target },
  { href: "/actuals", label: "Actuals", Icon: ReceiptText },
  { href: "/import", label: "Import", Icon: Upload },
] as const;

export function SectionTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  // The range travels with the user across tabs — it is the app's one filter.
  const from = params.get("from");
  const to = params.get("to");
  const range = from && to ? `?from=${from}&to=${to}` : "";
  const current = SECTIONS.find(s => pathname.startsWith(s.href))?.href ?? "/report";

  return (
    <Tabs value={current} className="border-b px-6 max-sm:px-3">
      <TabsList className="h-auto gap-1 bg-transparent p-0">
        {SECTIONS.map(({ href, label, Icon }) => (
          <TabsTrigger
            key={href}
            value={href}
            asChild
            className="rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2.5 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Link href={`${href}${range}`} aria-current={current === href ? "page" : undefined}>
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
