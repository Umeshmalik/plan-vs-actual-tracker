# Example CSVs

Drop these on the **Import** tab while signed in as `demo@example.com`. They
assume the seeded state: categories `Marketing`, `Payroll`, `Tools`, and
**January 2026 closed**.

Every message below was captured from the running app, not written by hand.

| File                        | What it proves                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actuals-valid.csv`         | The happy path — 5 rows ready, 0 errors, commit enabled. February adds to existing entries (many actuals per category×month is by design); March is empty in the seed, so the report visibly changes afterwards. |
| `actuals-mixed-errors.csv`  | Every validation path at once, and that a partly-bad file writes **nothing** — 2 ready, 5 errored, commit disabled.                                                                                              |
| `actuals-locked-period.csv` | Server-side locking. All 3 rows target closed January, so nothing is written no matter what the UI would let you click.                                                                                          |

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

## Two more cases worth trying by hand

**Bad header** — change the first line to `month,category,total`. The whole file
is rejected with one message and no row is even inspected:
`Header must be exactly "month,category,amount".`

**A large file, to see the virtualized preview table** — the preview renders a
scrolling window rather than 20,000 DOM rows:

```bash
{ echo "month,category,amount";
  for i in $(seq 1 20000); do echo "2026-03,Marketing,$((RANDOM % 900 + 100))"; done
} > /tmp/big.csv
```

Anything over 1 MB is rejected by the upload guard, with the limit stated in the
message.
