/**
 * DataTable — the green-bar ledger table used by the report, the actuals list
 * and the import preview. TanStack Table v9 owns the row model; shadcn's Table
 * primitives own the markup. Banded odd rows, one ink rule under the header,
 * right-aligned mono numerals, and the Table's own overflow-x-auto container so
 * a wide table scrolls instead of breaking the 360px floor.
 *
 * Two render paths, because `/report` is a Server Component and hooks are not:
 *
 *   - plain table (today's behaviour, every current caller) -> `constructTable`,
 *     the hook-free table-core constructor. Renders on the server, and on the
 *     client, unchanged.
 *   - `sortable` on a column, or `virtual` -> `DataTableInteractive`, the
 *     "use client" half, which drives the same `Shell` from `useTable` and
 *     `useVirtualizer`. Next refuses to let a Server Component module even
 *     *import* a hook, so those two live in a sibling file; everything they
 *     render comes from here.
 *
 * v9 note: `useReactTable`/`getCoreRowModel()` are the v8 API. v9 registers
 * behaviour through `tableFeatures` and builds with `useTable`/`constructTable`.
 */
import { type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import {
  constructTable,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type Row as ModelRow,
  type Table as TableModel,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { flexRender } from "@tanstack/react-table/flex-render";
import type { Virtualizer } from "@tanstack/react-virtual";
import { DataTableInteractive } from "@/components/DataTableInteractive";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  /** ReactNode so a Badge or chip can sit in a header cell. */
  header: ReactNode;
  numeric?: boolean;
  hideSm?: boolean;
  width?: string;
  /** Opt in to a click-to-sort header. Needs a client-component caller. */
  sortable?: boolean;
  /**
   * The comparable value behind the cell. `render` returns React elements,
   * which are not comparable; without this a sortable column falls back to the
   * rendered value only when it is already a string or a number.
   */
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  caption?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  /** e.g. locked rows -> "bg-bar-locked". A bg-* class replaces the banding. */
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  empty?: ReactNode;
  /** Virtualise the body inside a vertically scrolling container. */
  virtual?: boolean;
  /** Height cap of that container, px. Ignored unless `virtual`. */
  maxBodyHeight?: number;
}

/* ---------------------------------------------------------------- model --- */

const sorting = { rowSortingFeature, sortedRowModel: createSortedRowModel() };
/** `useTable` injects its own React reactivity, so this set stays hook-shaped. */
export const clientFeatures = tableFeatures(sorting);
/** `constructTable` has no adapter, so it needs the vanilla store bindings. */
const staticFeatures = tableFeatures({
  ...sorting,
  coreReactivityFeature: storeReactivityBindings(),
});

/**
 * TanStack constrains row data to `Record<string, any>`, which the callers'
 * interfaces do not structurally satisfy, and `DataTable<T>` must stay
 * unconstrained. So the machinery below is written against one opaque row type
 * and `DataTable` casts its props into it once, at the entry point.
 */
export type AnyRow = Record<string, unknown>;
type Feats = typeof clientFeatures;
export type Model = TableModel<Feats, AnyRow>;
type Def = ColumnDef<Feats, AnyRow>;

/**
 * Ascending only — the sorted row model flips it for descending, so reversing
 * here would cancel that out. Amounts are integer minor units, hence `a - b`.
 * `undefined` never reaches this: `sortUndefined: "last"` intercepts it, which
 * is what puts blanks last in both directions.
 */
function compare(a: ModelRow<Feats, AnyRow>, b: ModelRow<Feats, AnyRow>, columnId: string) {
  const x = a.getValue(columnId);
  const y = b.getValue(columnId);
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y));
}

/** `null` is folded into `undefined` so `sortUndefined` catches both. */
function sortKey(column: Column<AnyRow>, row: AnyRow) {
  const value = column.sortValue ? column.sortValue(row) : column.render(row);
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/**
 * Column<T> -> ColumnDef<T>. `header`/`render` become the header and cell
 * templates flexRender calls; presentation flags (numeric, hideSm, width) stay
 * out of the model and are looked up by column id at render time. A sortable
 * column additionally gets an `accessorFn` — the value the comparator sees —
 * so the table never has to compare React elements.
 */
export function toColumnDefs(columns: Column<AnyRow>[]): Def[] {
  return columns.map(column => {
    const def: Def = {
      id: column.key,
      header: () => column.header,
      cell: ({ row }) => column.render(row.original),
      enableSorting: column.sortable === true,
    };
    return column.sortable
      ? {
          ...def,
          accessorFn: row => sortKey(column, row),
          sortUndefined: "last" as const,
          sortFn: compare,
        }
      : def;
  });
}

/* --------------------------------------------------------------- render --- */

const HEAD = "h-auto px-3 py-2 text-[0.7rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase";

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export function Shell({
  table,
  byKey,
  caption,
  footer,
  empty,
  rowClassName,
  colSpan,
  virtualizer,
}: {
  table: Model;
  byKey: Map<string, Column<AnyRow>>;
  caption?: string;
  footer?: ReactNode;
  empty?: ReactNode;
  rowClassName?: (row: AnyRow) => string | undefined;
  colSpan: number;
  /** Present only while virtualised; the scroll container is the caller's. */
  virtualizer?: Virtualizer<HTMLDivElement, HTMLTableRowElement>;
}) {
  const rows = table.getRowModel().rows;

  function bodyRow(row: ModelRow<Feats, AnyRow>, index: number) {
    const extra = rowClassName?.(row.original);
    // Banding and a caller's row tint are both background-color, so emitting
    // one class is the only order-independent way to let the caller's
    // (e.g. bg-bar-locked) win.
    const band = extra?.includes("bg-") ? undefined : index % 2 === 0 && "bg-bar";
    return (
      <TableRow
        key={row.id}
        className={cn(band, extra)}
        // Only meaningful while virtualised: the measurer keys off data-index,
        // and aria-rowindex keeps the announced position honest when most rows
        // are not in the DOM.
        data-index={virtualizer ? index : undefined}
        aria-rowindex={virtualizer ? index + 2 : undefined}
        ref={virtualizer?.measureElement}
      >
        {row.getAllCells().map(cell => {
          const column = byKey.get(cell.column.id);
          return (
            <TableCell
              key={cell.id}
              className={cn(
                "px-3 py-2 align-middle text-[0.83rem]",
                column?.numeric && "text-right font-mono",
                column?.hideSm && "max-sm:hidden"
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext()) as ReactNode}
            </TableCell>
          );
        })}
      </TableRow>
    );
  }

  /** Pads the unrendered range so the body keeps its true scroll height. */
  const spacer = (height: number) => (
    <tr aria-hidden>
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );

  const items = virtualizer?.getVirtualItems();
  const first = items?.[0];
  const last = items?.[items.length - 1];

  return (
    <Table
      className="caption-top border-collapse border border-ink/20 bg-white"
      aria-rowcount={virtualizer ? rows.length + 1 : undefined}
    >
      {caption && (
        <TableCaption className="mt-0 mb-3 pt-0.5 text-left font-display text-[1.15rem] font-semibold text-foreground">
          {caption}
        </TableCaption>
      )}

      <TableHeader
        className={cn(
          // border-collapse drops a sticky row's own border, so the ink rule is
          // painted as an inset shadow while the body scrolls under it.
          virtualizer && "sticky top-0 z-10 bg-white [&_th]:shadow-[inset_0_-1px_0_var(--color-ink)]"
        )}
      >
        {table.getHeaderGroups().map(group => (
          <TableRow
            key={group.id}
            className="border-ink hover:bg-transparent"
            aria-rowindex={virtualizer ? 1 : undefined}
          >
            {group.headers.map(header => {
              const column = byKey.get(header.column.id);
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              const label = header.isPlaceholder
                ? null
                : (flexRender(header.column.columnDef.header, header.getContext()) as ReactNode);
              const Icon = sorted === "asc" ? ChevronUp : sorted === "desc" ? ChevronDown : ChevronsUpDown;
              return (
                <TableHead
                  key={header.id}
                  scope="col"
                  style={column?.width ? { width: column.width } : undefined}
                  aria-sort={canSort ? (sorted ? ARIA_SORT[sorted] : "none") : undefined}
                  className={cn(
                    HEAD,
                    column?.numeric ? "text-right" : "text-left",
                    column?.hideSm && "max-sm:hidden"
                  )}
                >
                  {canSort ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "-my-1 h-auto px-1.5 py-1 text-[0.7rem] font-semibold tracking-[0.07em] uppercase",
                        column?.numeric && "-mr-1.5 ml-auto"
                      )}
                    >
                      {label}
                      <Icon aria-hidden />
                    </Button>
                  ) : (
                    label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>

      <TableBody>
        {rows.length === 0 && empty ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="px-3 py-2 whitespace-normal">
              {empty}
            </TableCell>
          </TableRow>
        ) : items && first && last && virtualizer ? (
          <>
            {first.start > 0 && spacer(first.start)}
            {items.map(item => bodyRow(rows[item.index], item.index))}
            {virtualizer.getTotalSize() > last.end && spacer(virtualizer.getTotalSize() - last.end)}
          </>
        ) : (
          rows.map((row, i) => bodyRow(row, i))
        )}
      </TableBody>

      {footer && (
        <TableFooter className="border-t-0 bg-transparent text-foreground [&_td]:border-t [&_td]:border-ink [&_td]:px-3 [&_td]:py-2.5 [&_td]:font-medium">
          {footer}
        </TableFooter>
      )}
    </Table>
  );
}

/* ---------------------------------------------------------------- entry --- */

/** No hooks: renders in a Server Component exactly as the old version did. */
function StaticDataTable({ columns, rows, rowKey, ...rest }: DataTableProps<AnyRow>) {
  const table = constructTable({
    features: staticFeatures,
    columns: toColumnDefs(columns),
    data: rows,
    getRowId: rowKey,
  }) as unknown as Model;
  return <Shell table={table} byKey={index(columns)} colSpan={columns.length} {...rest} />;
}

export const index = (columns: Column<AnyRow>[]) => new Map(columns.map(c => [c.key, c]));

export function DataTable<T>(props: DataTableProps<T>) {
  const p = props as unknown as DataTableProps<AnyRow>;
  return p.virtual || p.columns.some(c => c.sortable) ? (
    <DataTableInteractive {...p} />
  ) : (
    <StaticDataTable {...p} />
  );
}
