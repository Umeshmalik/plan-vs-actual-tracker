/**
 * ONE aggregation with full-outer-join semantics via $unionWith. Unbudgeted
 * spend (an actual with no plan) falls out of the union for free as hasPlan:false.
 * Variance math lives in lib/variance.ts, not here.
 */
import { Types } from "mongoose";
import { M } from "./models";
import { toCsv } from "../lib/csv";
import { type CurrencyCode } from "../lib/currency";
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
  // One filter shape, both collections, both indexed {userId:1, month:1, categoryId:1}.
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
    // Scoped join: carries userId, so a stray categoryId cannot surface another
    // tenant's category name.
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
 * The report as a spreadsheet. Deliberately unlike the screen in three ways, all
 * so the cells stay summable: amounts are MAJOR units and stay numbers, a null
 * variance % is an empty cell rather than the UI's em dash, and the currency is
 * named in the header rather than printed beside each figure.
 */
export function reportCsv({ rows, totals, lockedMonths }: Report, currency: CurrencyCode): string {
  const locked = new Set(lockedMonths);
  const money = (minor: number) => toMajor(minor);
  const pct = (v: number | null) => (v === null ? null : Number(v.toFixed(2)));

  return toCsv(
    [
      "Category",
      "Month",
      `Plan (${currency})`,
      `Actual (${currency})`,
      `Variance (${currency})`,
      "Variance %",
      "Closed",
    ],
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
