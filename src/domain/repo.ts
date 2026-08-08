/**
 * repo.ts — ScopedRepo: tenant isolation made STRUCTURAL. (security by design)
 * userId is injected into every filter/insert here. Route handlers never
 * touch raw models, so "forgot the userId filter" is impossible by
 * construction — the unscoped models are not exported from the domain layer.
 */
import { Types, trusted, type ClientSession } from "mongoose";
import { M } from "./models";
import { AppError } from "../lib/errors";

/**
 * One category x month can hold many entries by design (real bookkeeping, and
 * it makes drill-down free). This is the ceiling on how many one read returns,
 * so a pathological cell cannot hand the UI an unbounded document set or blow
 * a response body up. 500 is far past a human's month of receipts.
 *
 * ponytail: it is a hard cut, not a page — row 501 is simply not returned and
 * the caller is not told. The report aggregates server-side and is unaffected;
 * only the drill-down list could ever reach it. The upgrade is a cursor
 * (`createdAt` + `_id` after-key) once anyone actually hits 500.
 */
export const ACTUALS_LIMIT = 500;

export class ScopedRepo {
  constructor(private userId: Types.ObjectId) {}

  private scope<T extends object>(filter: T) {
    return { ...filter, userId: this.userId };
  }

  // -- categories -----------------------------------------------------------
  async createCategory(name: string) {
    const normalizedName = name.trim().toLowerCase();
    try {
      return await M.Category.create({ userId: this.userId, name: name.trim(), normalizedName });
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000)
        throw new AppError("VALIDATION_FAILED", `Category "${name}" already exists.`);
      throw e;
    }
  }
  /** Projection = the CONTRACT's {_id, name}; normalizedName and the
   *  timestamps are internal and no caller reads them. */
  listCategories() {
    return M.Category.find(this.scope({}), { name: 1 }).sort({ name: 1 }).lean();
  }
  async requireCategory(categoryId: string) {
    const c = await M.Category.findOne(this.scope({ _id: categoryId })).lean();
    if (!c) throw new AppError("UNKNOWN_CATEGORY", "That category doesn't exist. Pick one from the list.");
    return c;
  }
  findCategoryByName(normalizedName: string) {
    return M.Category.findOne(this.scope({ normalizedName })).lean();
  }

  // -- plans (upsert = idempotent by design) --------------------------------
  upsertPlan(categoryId: string, month: string, amountMinor: number) {
    return M.Plan.findOneAndUpdate(
      this.scope({ categoryId, month }),
      { $set: { amountMinor } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).lean();
  }
  deletePlan(categoryId: string, month: string) {
    return M.Plan.deleteOne(this.scope({ categoryId, month }));
  }
  /**
   * Served by {userId:1, month:1, categoryId:1}. trusted() marks the one place
   * an operator object is deliberate, so sanitizeFilter (lib/db.ts) leaves it
   * alone instead of wrapping it in $eq — `from`/`to` are Zod-validated
   * YYYY-MM strings, never caller-shaped objects.
   * Projection = what the plans grid renders; _id and the timestamps are not read.
   */
  listPlans(from: string, to: string) {
    return M.Plan.find(this.scope({ month: trusted({ $gte: from, $lte: to }) }), {
      categoryId: 1,
      month: 1,
      amountMinor: 1,
    }).lean();
  }

  // -- actuals ---------------------------------------------------------------
  createActual(
    doc: {
      categoryId: string;
      month: string;
      amountMinor: number;
      note?: string;
      source?: "manual" | "import";
      importBatchId?: string;
    },
    session?: ClientSession
  ) {
    // Array form so the session actually reaches the write (Model.create with
    // an options object only honours `session` in the array overload).
    return M.Actual.create([{ ...doc, userId: this.userId }], { session }).then(d => d[0]);
  }
  /** Projection = the CONTRACT's actual shape plus importBatchId (the import
   *  tests group by it); userId and updatedAt are internal. */
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
  /** trusted(): see listPlans. Every caller reads `month` and nothing else. */
  listLocks(from: string, to: string) {
    return M.PeriodLock.find(this.scope({ month: trusted({ $gte: from, $lte: to }) }), { month: 1 }).lean();
  }

  get uid() {
    return this.userId;
  }
}
