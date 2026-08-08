/**
 * dedupe-actuals.ts — one-off migration for a database written before an actual
 * became one entry per category x month.
 *
 * Run it before deploying that change, because the failure mode is silent:
 * Mongoose builds indexes in the background and a unique index cannot be built
 * on a collection that already holds duplicates. The build fails, the error is
 * swallowed, and the app runs with no constraint and nothing on screen to say
 * so. This merges the duplicates first, then builds the index in the
 * foreground and reports what happened.
 *
 * Merging SUMS the amounts rather than keeping the newest, because the report
 * has always summed a cell's entries — summing is the only merge that leaves
 * every variance figure exactly where the user last saw it. The oldest entry in
 * each cell keeps its _id, note and createdAt; the rest are deleted.
 *
 *   npm run dedupe:actuals
 */
import mongoose, { Types } from "mongoose";
import { M } from "../src/domain/models";
import { normalizeName } from "../src/domain/repo";

interface Cell {
  _id: { userId: Types.ObjectId; categoryId: Types.ObjectId; month: string };
  ids: Types.ObjectId[];
  total: number;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  // $sort before $group so $push preserves insertion order and "the oldest" is
  // ids[0] rather than whatever the storage engine handed back.
  const cells = await M.Actual.aggregate<Cell>([
    { $sort: { _id: 1 } },
    {
      $group: {
        _id: { userId: "$userId", categoryId: "$categoryId", month: "$month" },
        ids: { $push: "$_id" },
        total: { $sum: "$amountMinor" },
      },
    },
    { $match: { "ids.1": { $exists: true } } }, // two or more entries in one cell
  ]);

  let dropped = 0;
  for (const cell of cells) {
    const [keep, ...rest] = cell.ids;
    await M.Actual.updateOne({ _id: keep }, { $set: { amountMinor: cell.total } });
    await M.Actual.deleteMany({ _id: { $in: rest } });
    dropped += rest.length;
    console.log(`merged ${cell.ids.length} entries -> ${cell._id.month} / ${cell._id.categoryId}`);
  }

  // Categories are compared more strictly now (unicode form and runs of
  // whitespace on top of case), so a stored normalizedName may be stale: leave
  // it and "Marketing  Ops" still lets a second "Marketing Ops" in. Recomputed
  // in JS with the app's own normalizeName rather than in an aggregation, both
  // because $trim cannot collapse an inner double space and because a second
  // definition of "same name" is the bug this is fixing.
  //
  // A pair that already collides under the new rule is NOT merged here: that
  // would have to move the loser's plans and actuals onto the winner and pick
  // which display name survives. Reported for a human, with everything else
  // still applied.
  const categories = await M.Category.find({}, { userId: 1, name: 1, normalizedName: 1 }).lean();
  const claimed = new Map<string, string>(); // userId|normalized -> name that holds it
  let renormalized = 0;
  for (const c of categories) {
    const normalizedName = normalizeName(c.name);
    const holder = claimed.get(`${c.userId}|${normalizedName}`);
    if (holder !== undefined) {
      console.warn(`user ${c.userId}: "${holder}" and "${c.name}" are the same name now — merge by hand`);
      continue;
    }
    claimed.set(`${c.userId}|${normalizedName}`, c.name);
    // The display name gets the same cleanup createCategory now applies, so a
    // stored "Ad  Spend" stops rendering with the double space it was typed with.
    const name = c.name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (normalizedName === c.normalizedName && name === c.name) continue;
    await M.Category.updateOne({ _id: c._id }, { $set: { name, normalizedName } });
    renormalized++;
  }

  // syncIndexes, not ensureIndexes: it also drops indexes the schema no longer
  // declares, and it throws rather than swallowing a failed unique build.
  await Promise.all([M.Actual.syncIndexes(), M.Category.syncIndexes()]);

  console.log(
    `done — ${cells.length} duplicated cell(s) merged, ${dropped} entr(ies) removed, ` +
      `${renormalized} category name(s) renormalised, indexes in sync`
  );
  await mongoose.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
