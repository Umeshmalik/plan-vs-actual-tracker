/** THE csv writer, so the export route and "download errored rows" quote identically. */

/** RFC 4180: quote on a delimiter, quote, newline or edge whitespace. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

// Formula injection: a category named `=HYPERLINK(...)` executes in Excel and
// Sheets. Numbers are exempt BY TYPE, which keeps -200.00 an amount.
const escapeFormula = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = escapeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvRow = (fields: (string | number | null | undefined)[]) => fields.map(field).join(",");

/** CRLF, because Excel on Windows reads a bare-LF file as one long row. */
export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]) =>
  [csvRow(header), ...rows.map(csvRow)].join("\r\n");
