/**
 * models.ts — Mongoose schemas + THE index definitions from the plan.
 * Uniqueness (dup plan, dup category, dup lock) is enforced by the DB,
 * not by application checks that race. (KISS + correctness)
 *
 * Every schema is generic-typed so `.lean()` hands callers a real shape —
 * the type story is single-sourced here, exactly like Zod single-sources
 * request validation in schemas.ts.
 */
import mongoose, { Schema, model, models, type Model, type Types } from "mongoose";

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface CategoryDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  normalizedName: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlanDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  categoryId: Types.ObjectId;
  month: string;
  amountMinor: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ActualDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  categoryId: Types.ObjectId;
  month: string;
  amountMinor: number;
  note?: string;
  source: "manual" | "import";
  importBatchId?: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface PeriodLockDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  month: string;
  lockedAt: Date;
}

const User = new Schema<UserDoc>(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);
User.index({ email: 1 }, { unique: true });

const Category = new Schema<CategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    normalizedName: { type: String, required: true }, // lower/trim — set in repo
  },
  { timestamps: true }
);
// Serves: the dup-name constraint, findCategoryByName({userId, normalizedName}),
// and the userId-equality prefix that listCategories()/requireCategory() scan.
// No {userId,name} index for listCategories' sort by name: a user holds tens of
// categories, so the sort is an in-memory pass over a handful of already-indexed
// keys. An index there would earn nothing and cost a write on every create.
//
// The constraint is only as good as what goes into normalizedName: see
// repo.normalizeName, which folds case, unicode form and runs of whitespace so
// "Marketing  Ops" cannot sit next to "Marketing Ops" as two categories that
// render identically.
Category.index({ userId: 1, normalizedName: 1 }, { unique: true });

const Plan = new Schema<PlanDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true }, // YYYY-MM
    amountMinor: { type: Number, required: true }, // integer
  },
  { timestamps: true }
);
// Serves: one target per cell (the constraint itself), plus every single-cell
// write that names a category — upsertPlan/deletePlan filter on exactly
// {userId, categoryId, month}, three equalities, an index seek.
Plan.index({ userId: 1, categoryId: 1, month: 1 }, { unique: true });
// Serves: report.ts's $match on plans, and repo.listPlans(from, to) behind the
// plans grid — both {userId, month: {$gte, $lte}}.
// The unique index above cannot answer that: after the equality on userId its
// next key is categoryId, which the filter does not name, so `month` is no
// longer a usable range bound and Mongo walks every key the user owns. Putting
// month directly after userId turns the range back into an index bound, and
// keeping categoryId as the trailing field means the report's group key is read
// straight from the index. One extra index on the collection's cheapest writes
// (one plan per category per month) for the app's hottest read.
Plan.index({ userId: 1, month: 1, categoryId: 1 });

const Actual = new Schema<ActualDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true },
    amountMinor: { type: Number, required: true },
    note: String,
    source: { type: String, enum: ["manual", "import"], default: "manual" },
    importBatchId: String,
  },
  { timestamps: true }
);
// One entry per category x month — the same rule Plan carries, for the same
// reason: a second entry for a cell is the same spend recorded twice, not a
// second line item. Without it nothing stops a double-submitted form, a CSV
// that repeats a row, or the same file being imported again from doubling a
// month's spend, and the report sums whatever it finds. Writes upsert onto the
// cell (repo.upsertActual), so obeying it is the only thing a caller can do.
Actual.index({ userId: 1, categoryId: 1, month: 1 }, { unique: true });
// Matches the report's query shape exactly: filter userId+month range, group by category.
// Serves the drill-down too — repo.listActuals({month, categoryId}) is three
// equalities against this same prefix order, and the {categoryId}-only variant
// still seeks: month has a couple of dozen distinct values, so the planner walks
// one interval per month rather than the whole collection (measured in
// tests/indexes.test.ts — 264 keys read to return 240 rows).
//
// createdAt is the trailing key, and it is there for the sort, not the filter.
// listActuals orders by {month, createdAt} and caps at ACTUALS_LIMIT; with the
// three equalities pinned, month is constant and createdAt is the only thing
// left to order by, so the index supplies it rather than the plan ending in a
// blocking SORT. A single cell now holds one entry, so that sort is short — but
// the category-only drill-down still walks a row per month in order, and the
// unfiltered read still reaches ACTUALS_LIMIT. The report's range $match is
// untouched: it uses the {userId, month, categoryId} prefix exactly as before.
Actual.index({ userId: 1, month: 1, categoryId: 1, createdAt: 1 });

const PeriodLock = new Schema<PeriodLockDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  month: { type: String, required: true },
  lockedAt: { type: Date, default: Date.now },
});
// Serves: one lock per month (the constraint), isLocked/lock/unlock's exact
// {userId, month} match, and listLocks' {userId, month range} — month sits
// directly after userId, so the range is an index bound with nothing to scan.
PeriodLock.index({ userId: 1, month: 1 }, { unique: true });

export const M = {
  User: (models.User as Model<UserDoc>) ?? model<UserDoc>("User", User),
  Category: (models.Category as Model<CategoryDoc>) ?? model<CategoryDoc>("Category", Category),
  Plan: (models.Plan as Model<PlanDoc>) ?? model<PlanDoc>("Plan", Plan),
  Actual: (models.Actual as Model<ActualDoc>) ?? model<ActualDoc>("Actual", Actual),
  PeriodLock: (models.PeriodLock as Model<PeriodLockDoc>) ?? model<PeriodLockDoc>("PeriodLock", PeriodLock),
};
export type Db = typeof mongoose;
