import mongoose, { Schema, model, models, type Model, type Types } from "mongoose";
import { CURRENCY_CODES, DEFAULT_CURRENCY, type CurrencyCode } from "../lib/currency";
import { CALENDAR_YEAR_START } from "../lib/fiscalYear";

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  /** 1-12; 1 = January = the calendar year. */
  fiscalYearStartMonth: number;
  /** Display label only. Nothing stored is ever converted. */
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
    fiscalYearStartMonth: { type: Number, default: CALENDAR_YEAR_START, min: 1, max: 12 },
    currency: { type: String, default: DEFAULT_CURRENCY, enum: CURRENCY_CODES },
  },
  { timestamps: true }
);
User.index({ email: 1 }, { unique: true });

const Category = new Schema<CategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    normalizedName: { type: String, required: true }, // set in repo.normalizeName
  },
  { timestamps: true }
);
// Partial by necessity: this collection is shared with another application whose
// documents lack both keys, and they would all index as (null, null) and abort
// the build — silently, since mongoose builds in the background. See AGENTS.md.
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
Plan.index({ userId: 1, categoryId: 1, month: 1 }, { unique: true });
// The unique index cannot serve month ranges — categoryId sits between the
// equality and the range. Pinned by name in tests/indexes.test.ts.
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
// Deliberately NOT unique on {userId, categoryId, month}: a category is spent
// against many times a month and each spend is its own row. A database that
// built the old unique index keeps it — mongoose never drops one it stopped
// declaring — and needs `db.actuals.dropIndex("userId_1_categoryId_1_month_1")`
// once, by hand. Never syncIndexes(). Trailing createdAt serves the sort.
Actual.index({ userId: 1, month: 1, categoryId: 1, createdAt: 1 });

const PeriodLock = new Schema<PeriodLockDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  month: { type: String, required: true },
  lockedAt: { type: Date, default: Date.now },
});
PeriodLock.index({ userId: 1, month: 1 }, { unique: true });

// Mongoose caches compiled models on its singleton, which survives Next's hot
// reload — so an edited schema would be ignored and strict mode would silently
// discard writes to new fields. Dev throws the cached model away.
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
