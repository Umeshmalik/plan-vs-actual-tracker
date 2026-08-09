"use client";

/**
 * The hook half of DataTable. Separate module only because a Server Component's
 * import graph may not mention `useRef`, and /report renders DataTable. Do not
 * import directly — DataTable picks it for `sortable`/`virtual`, which
 * consequently need a client-component caller.
 */
import { useRef } from "react";
import { useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Shell,
  clientFeatures,
  index,
  toColumnDefs,
  type AnyRow,
  type DataTableProps,
  type Model,
} from "@/components/DataTable";

export function DataTableInteractive({
  columns,
  rows,
  rowKey,
  virtual,
  maxBodyHeight = 480,
  ...rest
}: DataTableProps<AnyRow>) {
  const ref = useRef<HTMLDivElement>(null);
  const table = useTable({
    features: clientFeatures,
    columns: toColumnDefs(columns),
    data: rows,
    getRowId: rowKey,
  });
  const model = table as unknown as Model;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    // Virtualise the row model, not `rows` — sorting has already been applied.
    count: virtual ? model.getRowModel().rows.length : 0,
    getScrollElement: () => ref.current,
    // ponytail: rows are measured, but the table keeps `table-layout: auto`, so
    // scrolling to much wider content can nudge column widths. Set an explicit
    // `width` on the columns if that ever shows.
    estimateSize: () => 37,
    overscan: 8,
  });

  const shell = (
    <Shell
      table={model}
      byKey={index(columns)}
      colSpan={columns.length}
      virtualizer={virtual ? virtualizer : undefined}
      {...rest}
    />
  );

  // `*:overflow-visible` releases shadcn's own overflow-x-auto container so
  // this div is the only scroll parent — otherwise the sticky header would
  // stick to that inner container, which never scrolls.
  return virtual ? (
    <div ref={ref} className="overflow-auto *:overflow-visible" style={{ maxHeight: maxBodyHeight }}>
      {shell}
    </div>
  ) : (
    shell
  );
}
