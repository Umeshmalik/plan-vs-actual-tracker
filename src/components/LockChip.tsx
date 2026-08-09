/** THE closed-period indicator. Locked state is always chip + text, never colour alone. */
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMonthLabel, isMonth } from "@/lib/month";
import { cn } from "@/lib/utils";

export function LockChip({
  month,
  label,
  className,
}: {
  month?: string;
  label?: string;
  className?: string;
}) {
  const text = label ?? (month ? `Closed · ${isMonth(month) ? formatMonthLabel(month) : month}` : "Closed");
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 rounded-md px-1.5 font-mono text-[0.65rem] tracking-[0.08em] uppercase",
        className
      )}
    >
      <Lock aria-hidden />
      {text}
    </Badge>
  );
}
