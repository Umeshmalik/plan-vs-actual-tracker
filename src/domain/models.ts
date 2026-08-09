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
import { CURRENCY_CODES, DEFAULT_CURRENCY, type CurrencyCode } from "../lib/currency";
import { CALENDAR_YEAR_START } from "../lib/fiscalYear";

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  /** 1-12; 1 = January = the calendar year. See lib/fiscalYear.ts. */
  fiscalYearStartMonth: number;
  /** How this user's figures are LABELLED. Nothing stored is ever converted. */
  currency: CurrencyCode;
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
    // A reporting preference, so it belongs to the person rather than the
    // browser: picking an April start on a laptop has to hold on a phone. The
    // default is what makes it invisible to anyone who never opens the setting
    // — 1 is January, and a fiscal year starting in January IS a calendar year.
    fiscalYearStartMonth: { type: Number, default: CALENDAR_YEAR_START, min: 1, max: 12 },
    // Display only — see lib/currency.ts. `enum` keeps a code the app cannot
    // render out of the collection, and the default is what makes the setting
    // invisible to anyone who never opens it.
    currency: { type: String, default: DEFAULT_CURRENCY, enum: CURRENCY_CODES },
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
//
// PARTIAL, and that is load-bearing rather than fussy. A unique index is built
// over EVERY document in the collection, so one document that lacks both keys
// indexes as (null, null) — and a second one collides with it, which aborts the
// build. Mongoose builds indexes in the background and swallows that failure,
// so the app comes up with no constraint at all and nothing on screen to say
// so. That is exactly what happened in production: this collection turned out
// to be shared with another application whose documents have no `userId` and no
// `normalizedName`, six of them, so the index never existed and `npm run seed`
// re-created "Marketing", "Payroll" and "Tools" on every run.
//
// `normalizedName: {$type: "string"}` is true of every document this app writes
// (the field is required above) and false for anything that is not ours, so the
// constraint covers precisely the rows it is meant to and can always be built.
// Fixing the shared database is the real repair — see AUDIT.md — but a
// constraint that cannot be defeated by a neighbour is worth having regardless.
Category.index(
  { userId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { normalizedName: { $type: "string" } } }
);

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
// NO unique {userId, categoryId, month} here, deliberately, and that is the one
// place Actual parts company with Plan. A plan is a target — a cell has exactly
// one — but spend is a LEDGER: a category is hit several times in a month (three
// ad invoices, two tool renewals), and each of those is its own line item with
// its own note. The report already $sums per cell, so many rows and one row read
// the same downstream; what a unique index bought was protection from a
// double-submitted form and a re-imported file, and both of those are handled
// where they happen instead (the form is an append the user can see and remove,
// the import replaces its own batch — see importCsv.ts).
//
// Mongoose never DROPS an index it stopped declaring, so removing one from this
// file leaves it in place on any database that already built it — and the next
// insert fails with a duplicate-key error that has no line of code to blame.
// The deployed cluster has had `userId_1_categoryId_1_month_1` dropped by hand
// (`db.actuals.dropIndex("userId_1_categoryId_1_month_1")`); a database created
// before that change needs the same one-liner. Never `syncIndexes()` — see
// AGENTS.md, the categories collection is shared with another application.
//
// Matches the report's query shape exactly: filter userId+month range, group by
// category. Serves the drill-down too — repo.listActuals({month, categoryId}) is
// three equalities against this same prefix order, and the {categoryId}-only
// variant still seeks: month has a couple of dozen distinct values, so the
// planner walks one interval per month rather than the whole collection
// (measured in tests/indexes.test.ts — 264 keys read to return 240 rows).
//
// createdAt is the trailing key, and it is there for the sort, not the filter.
// listActuals orders by {month, createdAt} and caps at ACTUALS_LIMIT; with the
// three equalities pinned, month is constant and createdAt is the only thing
// left to order by, so the index supplies it rather than the plan ending in a
// blocking SORT. That sort now matters more than it used to: a cell holds a
// whole month of entries, so this is the index that keeps a busy category's
// drill-down in chronological order for free. The report's range $match is
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

/**
 * Mongoose caches a compiled model by name on its singleton, so re-running this
 * module returns the FIRST schema it ever saw. In production that is the point
 * — one process, one compile. In development Next re-executes the module on
 * every hot reload while the mongoose singleton survives, so an edited schema
 * is ignored until someone restarts the server, and a write to a field the
 * stale schema lacks is silently discarded by strict mode rather than failing.
 * A 200 that changes nothing is the worst shape a bug can take, so dev throws
 * the cached model away and compiles the schema in front of it.
 *
 * Tests run with NODE_ENV=test and one process per file, so nothing here fires.
 */
function compile<T>(name: string, schema: Schema<T>): Model<T> {
  if (process.env.NODE_ENV === "development" && models[name]) mongoose.deleteModel(name);
  return (models[name] as Model<T>) ?? model<T>(name, schema);
}

export const M = {
  User: compile<UserDoc>("User", User),
  Category: compile<CategoryDoc>("Category", Category),
  Plan: compile<PlanDoc>("Plan", Plan),
  Actual: compile<ActualDoc>("Actual", Actual),
  PeriodLock: compile<PeriodLockDoc>("PeriodLock", PeriodLock),
};
export type Db = typeof mongoose;
