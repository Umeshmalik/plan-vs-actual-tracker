/**
 * Import — the two-phase CSV screen. This server component does auth, the page
 * title and the instructions card, including the user's real category names
 * (so "unknown category" is avoidable before the first upload). Every word of
 * row-level validation comes back from the server's previewCsv; the client
 * never judges a row.
 */
import { requireRepo } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportFlow } from "./ImportFlow";

const LEGEND = "font-mono text-[0.7rem] tracking-[0.07em] text-muted-foreground uppercase";
const SAMPLE = "bg-muted w-fit rounded-md px-2 py-1 font-mono text-xs";

export default async function Page() {
  const repo = await requireRepo();
  const names = (await repo.listCategories()).map(c => c.name);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Import actuals</h1>
        <p className="text-muted-foreground">
          Bring spend over from your accounting export in one step. Nothing is written until you import.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">What the file must contain</CardTitle>
          <CardDescription>
            One header row, then one row per actual. Preview checks every row on the server first.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className={LEGEND}>Header, exactly</span>
            <code className={SAMPLE}>month,category,amount</code>
            <span className={LEGEND}>Then one row per line</span>
            <code className={SAMPLE}>2026-02,Marketing,4100</code>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={LEGEND}>Category names must match yours</span>
            {names.length ? (
              <div className="flex flex-wrap gap-1.5">
                {names.map(name => (
                  <Badge key={name} variant="secondary" className="font-mono">
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                You have no categories yet — add one first, or every row comes back as an unknown category.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <ImportFlow />
    </section>
  );
}
