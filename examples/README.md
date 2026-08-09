# Example CSVs

Drop these on the **Import** tab while signed in as `demo@example.com`. They
assume the seeded state: categories `Marketing`, `Payroll`, `Tools`, and
**January 2026 closed**.

Every message below was captured from the running app, not written by hand.

| File                        | What it proves                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actuals-valid.csv`         | The happy path — 5 rows ready, 0 errors, commit enabled. Each row is a new entry that adds to whatever that category and month already holds, and March is empty in the seed, so the report visibly changes afterwards. Import it twice: the second run replaces what the first wrote instead of doubling it, because the batch id is a hash of the file. |
| `actuals-mixed-errors.csv`  | Every validation path at once, and that a partly-bad file writes **nothing** — 2 ready, 5 errored, commit disabled.                                                                                                                                                                                                                                       |
| `actuals-locked-period.csv` | Server-side locking. All 3 rows target closed January, so nothing is written no matter what the UI would let you click.                                                                                                                                                                                                                                   |

## What each row of `actuals-mixed-errors.csv` returns

Line numbers exclude the header, exactly as the preview table shows them.

| Line | Row                            | Server's verdict                                          |
| ---- | ------------------------------ | --------------------------------------------------------- |
| 1    | `2026-03,Marketing,1200`       | Ready                                                     |
| 2    | `2026-13,Payroll,900`          | Month must be YYYY-MM (e.g. 2026-01)                      |
| 3    | `2026-03,Rent,4500`            | Unknown category "Rent". Create it first or fix the name. |
| 4    | `2026-01,Marketing,500`        | 2026-01 is locked. Unlock the period or remove this row.  |
| 5    | `2026-03,Tools,0`              | Amount must be greater than 0                             |
| 6    | `2026-03,Payroll,not-a-number` | Amount must be a number                                   |
| 7    | `2026-03,Marketing,880`        | Ready                                                     |

Every one of those strings is produced by `previewCsv` on the server. The client
never judges a row — it renders the verdict it was given, verbatim.

Forcing the commit anyway (`POST /api/imports/commit` with the locked file)
returns **422** and writes nothing:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some rows are invalid. Nothing was imported — fix the flagged rows and retry."
  }
}
```

**A file that names one cell twice** — add `2026-03,Marketing,999` under the
existing `2026-03,Marketing,5200` in `actuals-valid.csv`. Both lines come back
ready, and both are written: a category is spent against several times in a
month, so that file describes 6,199 of March marketing spend across two entries.
The Actuals tab lists them separately with their own notes and their own Remove;
the report counts the sum. `actuals-mixed-errors.csv` shows the same thing —
lines 1 and 7 are both `2026-03,Marketing` and both read **Ready**.

## Two more cases worth trying by hand

**Bad header** — change the first line to `month,category,total`. The whole file
is rejected with one message and no row is even inspected:
`Header must be exactly "month,category,amount".`

**A large file, to see the virtualized preview table** — the preview renders a
scrolling window rather than 20,000 DOM rows. The rows walk months rather than
repeating one cell, so the report's range query is exercised as well as the
table (20,000 copies of `2026-03,Marketing` would import fine too — it would
just be one very busy cell):

```bash
{ echo "month,category,amount";
  for i in $(seq 0 19999); do
    printf '%04d-%02d,Marketing,%d\n' $((2026 + i / 12)) $((i % 12 + 1)) $((RANDOM % 900 + 100));
  done
} > /tmp/big.csv
```

The server side is flat in file size too: the categories a user owns and the
months they have closed are each read **once per file**, not once per row, and
the commit is a single `insertMany` inside the transaction.
`tests/importCsv.test.ts` counts driver commands to hold that — 200 rows must
preview in the same 2 reads as 2 rows.

Anything over 1 MB is rejected by the upload guard, with the limit stated in the
message.

Committing also expires that user's cached reads (`user:<id>`), so the Report
tab shows the imported rows on the next render with no refresh dance — see the
caching section of the root `README.md`.
