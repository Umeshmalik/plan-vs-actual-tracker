/**
 * csv.ts — THE csv writer. Pure and dependency-free, so the export route and
 * the import screen's "download errored rows" button quote identically. (DRY)
 *
 * Both used to join on commas by hand, which is correct right up until a
 * category is called "Marketing, EU" and the file silently gains a column.
 */

/** RFC 4180: quote when the field holds a delimiter, a quote, a newline or edge whitespace. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/**
 * Excel, Sheets and Numbers all execute a cell that opens with one of these, so
 * a category named `=HYPERLINK(...)` becomes a live formula in the reviewer's
 * spreadsheet. A leading apostrophe is the standard neutraliser: the cell reads
 * as text and shows the original characters.
 *
 * Numbers are exempt by type, not by inspection — that is what keeps `-200.00`
 * an amount instead of a defused formula.
 */
const escapeFormula = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = escapeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvRow = (fields: (string | number | null | undefined)[]) => fields.map(field).join(",");

/**
 * CRLF line endings, because Excel on Windows still treats a bare LF file as one
 * long row. Every other reader accepts CRLF.
 */
export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]) =>
  [csvRow(header), ...rows.map(csvRow)].join("\r\n");
