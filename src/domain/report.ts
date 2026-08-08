/**
 * report.ts — ONE aggregation, full-outer-join semantics via $unionWith.
 * Plans and actuals are projected into a common {categoryId, month, plan, actual}
 * shape, summed per cell, then joined to category names. Variance math is NOT
 * here — it lives in lib/variance.ts (pure, unit-tested).
 *
 * Unbudgeted spend (actual with no plan) falls out of the union for free:
 * the symmetric edge case the assignment didn't test, surfaced as hasPlan:false.
 */
import { Types } from "mongoose";
import { M } from "./models";
import { toCsv } from "../lib/csv";
import { toMajor } from "../lib/money";
import { buildRow, rangeTotals, type VarianceRow } from "../lib/variance";
import type { ScopedRepo } from "./repo";

interface Cell {
  _id: { categoryId: Types.ObjectId; month: string };
  plan: number;
  actual: number;
  actualCount: number;
  planCount: number;
  categoryName: string;
}

export async function runReport(repo: ScopedRepo, from: string, to: string) {
  // One filter shape, both collections, both indexed for it:
  // plans   -> {userId:1, month:1, categoryId:1}
  // actuals -> {userId:1, month:1, categoryId:1}
  // userId equality then month range, with categoryId (the group key) trailing.
  // Aggregation $match is not touched by sanitizeFilter — `from`/`to` are
  // Zod-validated YYYY-MM strings, so there is nothing to sanitise.
  const match = { userId: repo.uid, month: { $gte: from, $lte: to } };

  const cells = await M.Plan.aggregate<Cell>([
    { $match: match },
    {
      $project: {
        categoryId: 1,
        month: 1,
        plan: "$amountMinor",
        actual: { $literal: 0 },
        planCount: { $literal: 1 },
        actualCount: { $literal: 0 },
      },
    },
    {
      $unionWith: {
        coll: M.Actual.collection.name,
        pipeline: [
          { $match: match },
          {
            $project: {
              categoryId: 1,
              month: 1,
              plan: { $literal: 0 },
              actual: "$amountMinor",
              planCount: { $literal: 0 },
              actualCount: { $literal: 1 },
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: { categoryId: "$categoryId", month: "$month" },
        plan: { $sum: "$plan" },
        actual: { $sum: "$actual" },
        planCount: { $sum: "$planCount" },
        actualCount: { $sum: "$actualCount" },
      },
    },
    // Scoped join: the ONE lookup in the domain layer, and it carries userId
    // too — a stray categoryId can never surface another tenant's name.
    {
      $lookup: {
        from: M.Category.collection.name,
        let: { cid: "$_id.categoryId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$cid"] }, userId: repo.uid } },
          { $project: { name: 1 } },
        ],
        as: "cat",
      },
    },
    { $set: { categoryName: { $first: "$cat.name" } } },
    { $unset: "cat" },
    { $sort: { categoryName: 1, "_id.month": 1 } },
  ]);

  const rows: VarianceRow[] = cells.map(c =>
    buildRow({
      categoryId: String(c._id.categoryId),
      categoryName: c.categoryName,
      month: c._id.month,
      plan: c.plan,
      actual: c.actual,
      hasActuals: c.actualCount > 0,
      hasPlan: c.planCount > 0,
    })
  );

  const locks = await repo.listLocks(from, to);
  return {
    rows,
    totals: rangeTotals(rows),
    lockedMonths: locks.map(l => l.month).sort(),
  };
}

export type Report = Awaited<ReturnType<typeof runReport>>;

/**
 * The report as a spreadsheet: the same rows, the same order, the same totals
 * line the table foots with — an export that disagrees with the screen is worse
 * than no export. Two deliberate differences, both for the reader on the other
 * end:
 *
 * - Amounts are MAJOR units, and stay NUMBERS rather than formatted strings.
 *   Minor units are the app's internal contract; a spreadsheet wants a cell it
 *   can sum. Number is also what keeps `-200` an amount: csv.ts defuses strings
 *   that open with `-` (formula injection) and skips numbers by type.
 * - A null variance % (plan = 0) is an empty cell, not the `—` the UI prints.
 *   Empty is what AVERAGE() skips; an em dash is text that poisons the column.
 *
 * `closed` carries the lock state, which the table shows as a badge — otherwise
 * the export loses the reason a row cannot be edited.
 */
export function reportCsv({ rows, totals, lockedMonths }: Report): string {
  const locked = new Set(lockedMonths);
  const money = (minor: number) => toMajor(minor);
  // Round the ratio, do not truncate the number: -9.120000000000001 is a float
  // artefact, not a figure anyone wants in a cell.
  const pct = (v: number | null) => (v === null ? null : Number(v.toFixed(2)));

  return toCsv(
    ["Category", "Month", "Plan", "Actual", "Variance", "Variance %", "Closed"],
    [
      ...rows.map(r => [
        r.categoryName,
        r.month,
        money(r.plan),
        money(r.actual),
        money(r.variance),
        pct(r.variancePct),
        locked.has(r.month) ? "yes" : "no",
      ]),
      [
        "Range total",
        "",
        money(totals.plan),
        money(totals.actual),
        money(totals.variance),
        pct(totals.variancePct),
        "",
      ],
    ]
  );
}
