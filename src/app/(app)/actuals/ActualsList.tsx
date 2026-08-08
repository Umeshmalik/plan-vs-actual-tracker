"use client";

/**
 * ActualsList — the drill-down for one category+month. DataTable renders the
 * rows inside a Card; each row's Remove is an icon Button behind a Tooltip and
 * an AlertDialog, because a deleted entry does not come back.
 *
 * The removal is a `useApiMutation` with a path-param url, so the row id is the
 * variable and no body is sent; pending, the toast and the refresh are the
 * hook's.
 */
import { Trash2 } from "lucide-react";
import { useApiMutation } from "@/lib/useApiMutation";
import { Banner } from "@/components/Banner";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { LockChip } from "@/components/LockChip";
import { MoneyText } from "@/components/MoneyText";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Row {
  id: string;
  date: string;
  note: string;
  amountMinor: number;
}

export function ActualsList({
  rows,
  caption,
  month,
  locked,
}: {
  rows: Row[];
  caption: string;
  month: string;
  locked: boolean;
}) {
  // A function url means the id is a path param, so nothing is sent as a body.
  const removeEntry = useApiMutation<{ deleted: number }, { id: string }>({
    url: vars => `/api/actuals/${vars.id}`,
    method: "DELETE",
    success: "Entry removed",
  });

  // The one place the UI adds money up: the month total, summed from the
  // server's own minor units and rendered by MoneyText. Nothing else here does arithmetic.
  const total = rows.reduce((sum, r) => sum + r.amountMinor, 0);

  const columns: Column<Row>[] = [
    // sortValue, not the rendered node: `render` returns React elements, and
    // amounts must compare as integer minor units rather than as "1 200.00".
    {
      key: "date",
      header: "Date",
      width: "6.5rem",
      sortable: true,
      sortValue: r => r.date,
      render: r => <span className="font-mono text-xs">{r.date}</span>,
    },
    { key: "note", header: "Note", render: r => r.note || <span className="text-muted-foreground">—</span> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      sortable: true,
      sortValue: r => r.amountMinor,
      render: r => <MoneyText minor={r.amountMinor} />,
    },
    {
      key: "remove",
      header: "Remove",
      width: "1%",
      render: r => (
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={locked || (removeEntry.isPending && removeEntry.variables.id === r.id)}
                  aria-label={`Remove the ${r.date} entry`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {locked ? "Closed period — entries are read-only" : "Remove this entry"}
            </TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
              <AlertDialogDescription>
                Removing the {r.date} entry of <MoneyText minor={r.amountMinor} /> drops the month total for{" "}
                {caption}. Log it again if you need it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => removeEntry.mutate({ id: r.id })}>
                Remove entry
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
  ];

  return (
    <>
      <Banner error={removeEntry.envelope} onDismiss={() => removeEntry.reset()} />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing logged here yet"
          body={`No spend recorded for ${caption}. Log the first entry with the form beside this list.`}
        />
      ) : (
        <Card>
          {/* DataTable's caption is the section title, so the Card adds the
              status line under the table instead of a second heading. */}
          <CardContent>
            <DataTable
              caption={caption}
              columns={columns}
              rows={rows}
              rowKey={r => r.id}
              footer={
                <TableRow>
                  <TableCell colSpan={2}>Month total</TableCell>
                  <TableCell className="text-right font-mono">
                    <MoneyText minor={total} />
                  </TableCell>
                  <TableCell />
                </TableRow>
              }
            />
          </CardContent>

          {locked && (
            <CardFooter className="flex-wrap gap-2 text-muted-foreground">
              <LockChip month={month} />
              <span>Entries stay visible and read-only. The API rejects removals for a closed period.</span>
            </CardFooter>
          )}
        </Card>
      )}
    </>
  );
}
