"use client";

/**
 * Every entry logged against one category+month, oldest first. The footer sums
 * THESE rows rather than taking a total in, so it cannot disagree with the screen.
 */
import { Trash2 } from "lucide-react";
import { useApiMutation } from "@/lib/useApiMutation";
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
  currency,
}: {
  rows: Row[];
  caption: string;
  month: string;
  locked: boolean;
  currency: CurrencyCode;
}) {
  // A function url means the id is a path param, so nothing is sent as a body.
  const removeEntry = useApiMutation<{ deleted: number }, { id: string }>({
    url: vars => `/api/actuals/${vars.id}`,
    method: "DELETE",
    success: "Entry removed",
  });

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Recorded",
      width: "6.5rem",
      render: r => <span className="font-mono text-xs">{r.date}</span>,
    },
    { key: "note", header: "Note", render: r => r.note || <span className="text-muted-foreground">—</span> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: r => <MoneyText currency={currency} minor={r.amountMinor} />,
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
                Removing this entry of <MoneyText currency={currency} minor={r.amountMinor} /> takes it off{" "}
                {caption}, so the report counts that much less against the plan. The other entries for this
                category and month are untouched. Log it again if you need it back.
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
          body={`No spend recorded for ${caption}. Log it with the form beside this list.`}
        />
      ) : (
        <Card>
          <CardContent>
            <DataTable
              caption={caption}
              columns={columns}
              rows={rows}
              rowKey={r => r.id}
              footer={
                <TableRow>
                  <TableCell colSpan={2}>
                    {rows.length === 1 ? "1 entry" : `${rows.length} entries`}
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText currency={currency} minor={rows.reduce((sum, r) => sum + r.amountMinor, 0)} />
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
