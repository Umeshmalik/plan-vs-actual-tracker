/**
 * EmptyState — an invitation with one action, in the house voice.
 * Bitter headline, sentence case, no illustration, no apology.
 *
 * It fills the region it stands in rather than floating as a narrow card in
 * the middle of the page: an empty state is the content, not an aside. The
 * prose inside is width-capped for readability, the card is not.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  /** Override when a more specific lucide icon says more than an inbox. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <Card className="w-full border-dashed py-12 text-center">
      <CardHeader className="justify-items-center gap-1.5">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
        <CardTitle className="font-display text-[1.1rem] font-semibold">{title}</CardTitle>
        <CardDescription className="max-w-prose text-balance">{body}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}
