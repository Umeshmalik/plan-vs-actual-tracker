"use client";

/**
 * ImportFlow — preview then commit. The server's RowResult[] is the single
 * source of truth for row status and wording: this component decides nothing
 * about a row, it only renders what previewCsv said. Preview writes nothing;
 * commit is all-or-nothing, so the button stays disabled while any row errors
 * and sits behind an AlertDialog because one click writes every row.
 *
 * Two useApiMutation calls, not one, so "checking rows" and "importing" are
 * separate pending states: a preview in flight swaps the table for a skeleton,
 * a commit in flight leaves the table on screen. The mutations also hold the
 * only copy of the preview — `preview.data.results` and `preview.variables.csv`
 * are the results and the exact text they were taken from, so there is no
 * second copy in useState to keep in sync.
 *
 * Toasts confirm; the Banner persists. A toast fades, but a rejected commit's
 * detail has to stay on screen, so both are rendered — never one instead of
 * the other. Server messages are shown verbatim in both.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDebouncedCallback } from "@tanstack/react-pacer";
import { AlertCircle, Check, Download, Loader2, Table as TableIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { useApiMutation } from "@/lib/useApiMutation";
import type { RowResult } from "@/domain/importCsv";
import { Banner } from "@/components/Banner";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { LockChip } from "@/components/LockChip";
import { MoneyText } from "@/components/MoneyText";
import { type CurrencyCode } from "@/lib/currency";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DASH = "—";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const needFixing = (n: number) => `${n} row${n === 1 ? " needs" : "s need"} fixing`;
/** The domain writes "2026-01 is locked. …" — pull the month out for the chip. */
const lockedMonth = (r: RowResult) => r.error?.match(/^(\d{4}-\d{2}) is locked/)?.[1];

/** A 1 MB export is ~20k rows; the preview body scrolls instead of laying them all out. */
const PREVIEW_BODY_HEIGHT = 480;
/** Long enough that a paste-and-keep-typing run costs one request, not ten. */
const AUTO_PREVIEW_WAIT = 800;

type Csv = { csv: string };

export function ImportFlow({ currency }: { currency: CurrencyCode }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Preview writes nothing, so there is no server tree to refresh, and the
  // summary line plus the toast below already report the outcome.
  const preview = useApiMutation<{ results: RowResult[] }, Csv>({
    url: "/api/imports/preview",
    success: null,
    refresh: false,
    onDone: data => {
      const bad = data.results.filter(r => !r.ok).length;
      if (bad) toast.warning(needFixing(bad));
      else if (data.results.length) toast.success(`${plural(data.results.length, "row")} ready to import`);
      else toast.warning("That CSV has a header and no rows");
    },
  });

  // `success` stays null because this toast carries an action, which the hook's
  // string form cannot express — the wording is identical, fired here instead.
  const commit = useApiMutation<{ committed: number }, Csv>({
    url: "/api/imports/commit",
    success: null,
    onDone: data => {
      const message = `${plural(data.committed, "row")} imported`;
      // The banner says where they landed; the toast stays short. An import
      // writes spend, so nothing shows up on Plans — that is the one thing
      // worth stating outright.
      setOk(
        `${message} as actuals, replacing any figure those cells already held. They show on Report and Actuals; Plans holds targets only.`
      );
      toast.success(message, {
        action: { label: "See the report", onClick: () => router.push("/report") },
      });
      setCsv("");
      setFileName(null);
    },
  });

  const busy = preview.isPending || commit.isPending;
  // A rejected commit carries a fresh preview (a month may have been locked
  // since ours) — render the server's newer verdict over the one we hold.
  const rejected = commit.envelope?.details?.results as RowResult[] | undefined;
  const results = rejected ?? preview.data?.results ?? [];
  const errorCount = results.filter(r => !r.ok).length;
  const okCount = results.length - errorCount;
  // The table only stands for the text it was taken from; edit the box or drop
  // a new file and it goes away until the next preview.
  const previewedCsv = preview.variables?.csv ?? "";
  const showPreview = preview.data != null && csv === previewedCsv;

  // Errored rows come back without `parsed`, so month/category echo the user's
  // own text from the CSV the preview was taken from (display, not validation).
  const bodyLines = previewedCsv.trim().split(/\r?\n/).slice(1);
  const cell = (line: number, i: number) => bodyLines[line - 1]?.split(",")[i]?.trim() || DASH;

  function runPreview(text: string) {
    commit.reset(); // an earlier rejection must not outrank the new verdict
    setOk(null);
    preview.mutate({ csv: text });
  }

  /**
   * Paste and the preview follows on its own. Every guard is read when the
   * timer fires, not when the key was pressed: nothing empty, nothing while a
   * commit is writing, and nothing for text the server has already judged.
   */
  const autoPreview = useDebouncedCallback(
    (text: string) => {
      if (!text.trim() || commit.isPending || text === preview.variables?.csv) return;
      runPreview(text);
    },
    { wait: AUTO_PREVIEW_WAIT }
  );

  async function load(file: File) {
    setFileName(file.name);
    setCsv(await file.text());
    preview.reset();
    commit.reset();
    setOk(null);
    if (fileRef.current) fileRef.current.value = ""; // so the same file re-fires change
  }

  function downloadErrored() {
    const rows = results
      .filter(r => !r.ok)
      .map(r => bodyLines[r.line - 1])
      .filter(Boolean);
    const url = URL.createObjectURL(
      new Blob([["month,category,amount", ...rows].join("\n")], { type: "text/csv" })
    );
    Object.assign(document.createElement("a"), { href: url, download: "errored-rows.csv" }).click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<RowResult>[] = [
    { key: "line", header: "Line", numeric: true, width: "3.5rem", render: r => r.line || DASH },
    {
      key: "month",
      header: "Month",
      hideSm: true,
      render: r => <span className="font-mono">{r.parsed?.month ?? cell(r.line, 0)}</span>,
    },
    { key: "category", header: "Category", render: r => r.parsed?.categoryName ?? cell(r.line, 1) },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: r => (r.parsed ? <MoneyText currency={currency} minor={r.parsed.amountMinor} /> : DASH),
    },
    {
      key: "status",
      header: "Status",
      render: r => (
        <span className="flex flex-wrap items-center gap-1.5">
          {r.ok ? (
            <Badge variant="secondary">
              <Check aria-hidden />
              Ready
            </Badge>
          ) : (
            <>
              <Badge variant="destructive">
                <AlertCircle aria-hidden />
                Needs fixing
              </Badge>
              {lockedMonth(r) && <LockChip month={lockedMonth(r)} />}
              <span className="text-muted-foreground">{r.error}</span>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Banner
        error={commit.envelope ?? preview.envelope}
        ok={ok}
        onDismiss={() => {
          setOk(null);
          preview.reset();
          commit.reset();
        }}
      />
      {ok && (
        <Button variant="link" size="sm" className="w-fit px-0" asChild>
          <Link href="/report">See the rows in the report</Link>
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Choose the CSV</CardTitle>
          <CardDescription>
            Drop a file, pick one, or paste the rows. Preview runs on the server and writes nothing.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {/* The drop zone IS the label: the real file input lives inside it,
              sr-only so it stays focusable and Enter opens the picker. */}
          <label
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void load(file);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
              dragging ? "border-primary bg-muted" : "border-input bg-background",
              "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50"
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">Drop a CSV here, or</span>
            {/* asChild + span: a real <button> inside a <label> is invalid markup
                and would swallow the click that opens the picker. */}
            <Button asChild variant="outline" size="sm">
              <span>Choose a CSV</span>
            </Button>
            {fileName && (
              <Badge variant="secondary" className="max-w-full font-mono">
                {fileName}
              </Badge>
            )}
            <input
              id="csv-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void load(file);
              }}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="csv-text">Or paste the rows</Label>
            <Textarea
              id="csv-text"
              rows={6}
              value={csv}
              onChange={e => {
                setCsv(e.target.value);
                autoPreview(e.target.value);
              }}
              placeholder={"month,category,amount\n2026-02,Marketing,4100"}
              className="font-mono text-xs leading-relaxed"
            />
          </div>
        </CardContent>

        <CardFooter className="gap-3">
          <Button variant="outline" disabled={busy || !csv.trim()} onClick={() => runPreview(csv)}>
            {preview.isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Checking rows
              </>
            ) : (
              "Preview rows"
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            Pasted rows preview on their own — this is for a dropped file.
          </span>
        </CardFooter>
      </Card>

      {preview.isPending ? (
        <Card aria-busy="true">
          <CardHeader>
            <CardTitle className="font-display">Checking rows</CardTitle>
            <CardDescription>The server is validating every row. Nothing is written yet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-5 w-48" />
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : showPreview ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Preview</CardTitle>
            <CardDescription>
              Every verdict below comes from the server. Fix the file and preview again — the screen never
              re-judges a row on its own.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <div aria-live="polite" className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <Check aria-hidden />
                {plural(okCount, "row")} ready
              </Badge>
              {errorCount > 0 && (
                <Badge variant="destructive">
                  <AlertCircle aria-hidden />
                  {needFixing(errorCount)}
                </Badge>
              )}
            </div>

            <DataTable
              caption={`Preview — ${okCount} of ${plural(results.length, "row")} ready`}
              columns={columns}
              rows={results}
              rowKey={r => String(r.line)}
              rowClassName={r => (lockedMonth(r) ? "bg-bar-locked" : undefined)}
              empty={<>That CSV has a header and no rows. Add at least one line under it.</>}
              virtual
              maxBodyHeight={PREVIEW_BODY_HEIGHT}
            />
          </CardContent>

          <CardFooter className="flex-col items-start gap-2">
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy || errorCount > 0 || results.length === 0}>
                    {commit.isPending && <Loader2 className="animate-spin" aria-hidden />}
                    Import {plural(results.length, "row")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Import {plural(results.length, "row")}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This writes {plural(results.length, "row")} as actuals in one transaction. Each row
                      replaces whatever that category and month already holds, so importing the same file
                      twice lands on the same figures rather than doubling them. Commits are all-or-nothing:
                      if the server rejects any row, nothing is written.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => commit.mutate({ csv })}>
                      Import {plural(results.length, "row")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {errorCount > 0 && (
                <Button variant="outline" onClick={downloadErrored}>
                  <Download aria-hidden />
                  Download errored rows
                </Button>
              )}
            </div>

            <CardDescription>
              {errorCount
                ? `Fix the ${plural(errorCount, "errored row")}, then import — commits are all-or-nothing.`
                : `${plural(results.length, "row")} ready. Nothing is written until you import.`}
            </CardDescription>
          </CardFooter>
        </Card>
      ) : csv.trim() ? null : (
        // This stands in for the preview table, so it speaks about the preview.
        // Repeating "Choose a CSV" here would be the same action twice on one
        // screen — the drop zone is directly above it.
        <EmptyState
          icon={TableIcon}
          title="Nothing to preview yet"
          body="Drop a file or paste rows above. Every row is checked on the server before anything is written."
        />
      )}
    </div>
  );
}
