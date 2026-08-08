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
 * One category x month holds exactly one entry (the unique index in models.ts),
 * so this ceiling now bounds the unfiltered read — every cell a user owns —
 * rather than a single pathological cell. 500 is far past a bookkeeper's range.
 *
 * ponytail: it is a hard cut, not a page — row 501 is simply not returned and
 * the caller is not told. The report aggregates server-side and is unaffected;
 * only an unfiltered list could reach it. The upgrade is a cursor (`month` +
 * `_id` after-key) once anyone actually hits 500.
 */
export const ACTUALS_LIMIT = 500;

/**
 * The display form of a name: unicode composed so two spellings of the same
 * letters are the same string, and runs of whitespace collapsed so a stray
 * double space is not a different word.
 */
const displayName = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ");

/**
 * THE comparison form, and the only thing the unique index sees. Case-folded on
 * top of the cleanup above, so "Marketing", "marketing " and "Marketing  " are
 * one category rather than three rows that render identically in every list.
 * Exported because the CSV import resolves its rows against the same rule —
 * two definitions of "same name" is how look-alike duplicates get in.
 */
export const normalizeName = (name: string) => displayName(name).toLowerCase();

export class ScopedRepo {
  constructor(private userId: Types.ObjectId) {}

  /**
   * userId onto every filter — and undefined values off it. The driver
   * serializes an explicit `undefined` as BSON null, so {categoryId: undefined}
   * asks for a null categoryId and matches nothing, rather than meaning "don't
   * filter on it". Every filter in this class already routes through here, so
   * dropping them once is what stops the next method with an optional key from
   * having to remember. trusted() values pass through untouched: the value is
   * copied by reference, so the symbol mongoose marks it with survives.
   */
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
  /** Takes the name as typed — normalising here is what stops a caller doing it differently. */
  findCategoryByName(name: string) {
    return M.Category.findOne(this.scope({ normalizedName: normalizeName(name) })).lean();
  }
  /**
   * The whole name -> category map in one read. The CSV import resolves every
   * row against this instead of a findOne per row: a 20k-row file went from
   * 20k round trips to one, and a user holds tens of categories, so the map is
   * a few kilobytes however big the file is.
   */
  async categoriesByName() {
    const cats = await M.Category.find(this.scope({}), { name: 1, normalizedName: 1 }).lean();
    return new Map(cats.map(c => [c.normalizedName, c]));
  }

  // -- plans (upsert = idempotent by design) --------------------------------
  /** Projection = the CONTRACT's plan shape. userId and __v are internal and
   *  every other read here projects; this one used to hand back the raw doc. */
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
  /**
   * A cell holds one entry, so a write REPLACES it — logging spend twice for
   * the same category and month leaves one figure, not two rows that the report
   * silently adds together. The unique index is the rule; this is the only way
   * every caller (manual log, seed, import) obeys it.
   *
   * $unset, not just $set: replacing an imported entry with a manual one has to
   * drop the batch id it carried, and clearing the note has to clear it.
   */
  async upsertActual(
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
    const { categoryId, month, amountMinor, note, source = "manual", importBatchId } = doc;
    const set: Record<string, unknown> = { amountMinor, source };
    const unset: Record<string, 1> = {};
    if (note === undefined) unset.note = 1;
    else set.note = note;
    if (importBatchId === undefined) unset.importBatchId = 1;
    else set.importBatchId = importBatchId;

    // An empty $unset is an error to Mongo, not a no-op, so it only goes in when
    // there is something to clear.
    const update = Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set };
    const write = () =>
      M.Actual.findOneAndUpdate(this.scope({ categoryId, month }), update, {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        session,
      }).lean();

    // Two writes racing for the same empty cell: one inserts, the other's upsert
    // finds nothing and then trips the unique index. Retrying finds the row the
    // winner wrote and updates it, which is what "replace" meant either way.
    return write().catch((e: unknown) =>
      (e as { code?: number })?.code === 11000 ? write() : Promise.reject(e)
    );
  }
  /**
   * The import's write, and the only bulk one. One bulkWrite sends the whole
   * batch in a single command instead of an await-per-row loop — same cells,
   * same transaction, one round trip. Upserts rather than inserts, so importing
   * a file twice settles on the same figures instead of doubling the month.
   */
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
    return M.Actual.bulkWrite(
      docs.map(d => ({
        updateOne: {
          filter: this.scope({ categoryId: d.categoryId, month: d.month }),
          update: {
            $set: { amountMinor: d.amountMinor, source: d.source, importBatchId: d.importBatchId },
            $unset: { note: 1 }, // an imported row carries none; a replaced manual one must lose its own
          },
          upsert: true,
        },
      })),
      { session }
    );
  }
  /** Projection = the CONTRACT's actual shape plus importBatchId (the import
   *  tests group by it); userId and updatedAt are internal. With one entry per
   *  cell, {month, categoryId} returns at most one row. */
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
  /**
   * Every closed month, as a set. Same trade as categoriesByName(): the import
   * asks "is this row's month locked?" once per row, and a user holds tens of
   * locks, so one read answers all of them.
   */
  async lockedMonths() {
    const locks = await M.PeriodLock.find(this.scope({}), { month: 1 }).lean();
    return new Set(locks.map(l => l.month));
  }

  get uid() {
    return this.userId;
  }
}
