import { Types, trusted, type ClientSession } from "mongoose";
import { M } from "./models";
import { AppError } from "../lib/errors";

// ponytail: hard cut, not a page — row 501 is dropped and the caller is not
// told. Upgrade to a cursor (`month` + `_id` after-key) if anyone hits it.
export const ACTUALS_LIMIT = 500;

const displayName = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ");

/** THE comparison form, and the only thing the unique category index sees. */
export const normalizeName = (name: string) => displayName(name).toLowerCase();

export class ScopedRepo {
  constructor(private userId: Types.ObjectId) {}

  // userId onto every filter, undefined values off it — the driver serializes an
  // explicit undefined as BSON null, which matches nothing instead of meaning
  // "don't filter". trusted() values pass through by reference, keeping the mark.
  private scope<T extends object>(filter: T) {
    const defined = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined));
    return { ...defined, userId: this.userId } as T & { userId: Types.ObjectId };
  }

  // -- categories -----------------------------------------------------------
  async createCategory(name: string) {
    const display = displayName(name);
    try {
      return await M.Category.create({
        userId: this.userId,
        name: display,
        normalizedName: normalizeName(name),
      });
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000)
        throw new AppError("VALIDATION_FAILED", `Category "${display}" already exists.`);
      throw e;
    }
  }
  listCategories() {
    return M.Category.find(this.scope({}), { name: 1 }).sort({ name: 1 }).lean();
  }
  async requireCategory(categoryId: string) {
    const c = await M.Category.findOne(this.scope({ _id: categoryId })).lean();
    if (!c) throw new AppError("UNKNOWN_CATEGORY", "That category doesn't exist. Pick one from the list.");
    return c;
  }
  /** Takes the name as typed; normalising here is what stops callers doing it differently. */
  findCategoryByName(name: string) {
    return M.Category.findOne(this.scope({ normalizedName: normalizeName(name) })).lean();
  }
  /** One read for the whole map — the CSV import resolves every row against it. */
  async categoriesByName() {
    const cats = await M.Category.find(this.scope({}), { name: 1, normalizedName: 1 }).lean();
    return new Map(cats.map(c => [c.normalizedName, c]));
  }

  // -- plans -----------------------------------------------------------------
  upsertPlan(categoryId: string, month: string, amountMinor: number) {
    return M.Plan.findOneAndUpdate(
      this.scope({ categoryId, month }),
      { $set: { amountMinor } },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        projection: { categoryId: 1, month: 1, amountMinor: 1 },
      }
    ).lean();
  }
  deletePlan(categoryId: string, month: string) {
    return M.Plan.deleteOne(this.scope({ categoryId, month }));
  }
  /** trusted() marks the operator object as deliberate so sanitizeFilter (lib/db.ts) leaves it alone. */
  listPlans(from: string, to: string) {
    return M.Plan.find(this.scope({ month: trusted({ $gte: from, $lte: to }) }), {
      categoryId: 1,
      month: 1,
      amountMinor: 1,
    }).lean();
  }

  // -- actuals ---------------------------------------------------------------
  /** One spend, APPENDED — a category-month is a ledger. Corrections are delete + re-log. */
  async createActual(doc: {
    categoryId: string;
    month: string;
    amountMinor: number;
    note?: string;
    source?: "manual" | "import";
    importBatchId?: string;
  }) {
    const a = await M.Actual.create({ ...doc, userId: this.userId });
    return {
      _id: a._id,
      categoryId: a.categoryId,
      month: a.month,
      amountMinor: a.amountMinor,
      note: a.note,
      source: a.source,
      importBatchId: a.importBatchId,
      createdAt: a.createdAt,
    };
  }
  createActuals(
    docs: {
      categoryId: string;
      month: string;
      amountMinor: number;
      source: "manual" | "import";
      importBatchId?: string;
    }[],
    session?: ClientSession
  ) {
    return M.Actual.insertMany(
      docs.map(d => ({ ...d, userId: this.userId })),
      { session }
    );
  }
  /** Clears a batch so a re-imported file describes the spend once. See importCsv.ts. */
  deleteActualsByBatch(importBatchId: string, session?: ClientSession) {
    return M.Actual.deleteMany(this.scope({ importBatchId }), { session });
  }
  listActuals(filter: { month?: string; categoryId?: string }, limit = ACTUALS_LIMIT) {
    return M.Actual.find(this.scope(filter), {
      categoryId: 1,
      month: 1,
      amountMinor: 1,
      note: 1,
      source: 1,
      importBatchId: 1,
      createdAt: 1,
    })
      .sort({ month: 1, createdAt: 1 })
      .limit(limit)
      .lean();
  }
  /** A junk id is a miss, not a crash: Mongoose would raise CastError -> 500. */
  async findActual(id: string) {
    const a = Types.ObjectId.isValid(id) ? await M.Actual.findOne(this.scope({ _id: id })).lean() : null;
    if (!a) throw new AppError("NOT_FOUND", "That entry no longer exists.");
    return a;
  }
  async deleteActual(id: string) {
    const res = Types.ObjectId.isValid(id)
      ? await M.Actual.deleteOne(this.scope({ _id: id }))
      : { deletedCount: 0 };
    if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "That entry no longer exists.");
  }

  // -- locks -----------------------------------------------------------------
  isLocked(month: string) {
    return M.PeriodLock.exists(this.scope({ month }));
  }
  lock(month: string) {
    return M.PeriodLock.findOneAndUpdate(
      this.scope({ month }),
      { $setOnInsert: { lockedAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    ).lean();
  }
  unlock(month: string) {
    return M.PeriodLock.deleteOne(this.scope({ month }));
  }
  /** trusted(): see listPlans. */
  listLocks(from: string, to: string) {
    return M.PeriodLock.find(this.scope({ month: trusted({ $gte: from, $lte: to }) }), { month: 1 }).lean();
  }
  /** One read for the whole set — the import asks per row. */
  async lockedMonths() {
    const locks = await M.PeriodLock.find(this.scope({}), { month: 1 }).lean();
    return new Set(locks.map(l => l.month));
  }

  get uid() {
    return this.userId;
  }
}
