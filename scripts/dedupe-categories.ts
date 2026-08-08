/**
 * dedupe-categories.ts — one-off migration for a database whose unique index on
 * {userId, normalizedName} never actually existed.
 *
 * How that happens: a unique index is built over EVERY document in the
 * collection, so a neighbour's documents with no `normalizedName` all index as
 * null and collide with each other. The build aborts, Mongoose swallows the
 * error, and the app runs with no constraint — so every `npm run seed` created
 * another "Marketing", "Payroll" and "Tools" instead of finding the existing
 * one. The index is `partialFilterExpression`-scoped now, but a partial unique
 * index still cannot be built over rows that already violate it, which is what
 * this script clears.
 *
 * Merging keeps the OLDEST category in each {userId, normalizedName} group and
 * repoints that user's plans and actuals at it, because a category is only ever
 * a label: no figure changes, and the survivor is the one whose _id existing
 * links are most likely to already use. A losing category that holds a plan or
 * an actual for a cell the survivor also holds would violate THEIR unique
 * indexes on repoint, so those rows are dropped rather than repointed — they
 * are duplicates of the same cell by definition, and the survivor's figure is
 * the one on screen today.
 *
 *   npm run dedupe:categories -- --dry-run   # report only, write nothing
 *   npm run dedupe:categories                # merge, then build the index
 */
import mongoose, { Types } from "mongoose";
import { M } from "../src/domain/models";
import { connectDb } from "../src/lib/db";

interface Group {
  _id: { userId: Types.ObjectId; normalizedName: string };
  ids: Types.ObjectId[];
  name: string;
}

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await connectDb();

  const groups = await M.Category.aggregate<Group>([
    // Ours only: the neighbour's documents have no normalizedName and are not
    // this app's to touch.
    { $match: { normalizedName: { $type: "string" }, userId: { $type: "objectId" } } },
    { $sort: { _id: 1 } }, // so $push preserves insertion order and ids[0] is the oldest
    {
      $group: {
        _id: { userId: "$userId", normalizedName: "$normalizedName" },
        ids: { $push: "$_id" },
        name: { $first: "$name" },
      },
    },
    { $match: { $expr: { $gt: [{ $size: "$ids" }, 1] } } },
  ]);

  if (groups.length === 0) {
    console.log("No duplicate categories.");
  }

  let removed = 0;
  let repointed = 0;
  let dropped = 0;

  for (const g of groups) {
    const [keep, ...lose] = g.ids;
    const { userId } = g._id;
    console.log(`${g.name}: ${g.ids.length} copies -> keeping ${keep}`);
    if (dryRun) continue;

    // The driver's collections rather than the Mongoose models: the two models
    // have different document types, so an array of them is a union TypeScript
    // will not let you call `.find()` on, and a migration has no need for
    // schema casting anyway. Every value in these filters is one this script
    // built, so sanitizeFilter has nothing to protect.
    for (const coll of [M.Plan.collection, M.Actual.collection]) {
      const rows = await coll
        .find({ userId, categoryId: { $in: lose } }, { projection: { month: 1 } })
        .toArray();
      for (const row of rows) {
        // The survivor already owns this cell, so repointing would trip that
        // collection's own unique index. The duplicate row is the one to lose.
        const taken = await coll.findOne(
          { userId, categoryId: keep, month: row.month },
          { projection: { _id: 1 } }
        );
        if (taken) {
          await coll.deleteOne({ _id: row._id });
          dropped++;
        } else {
          await coll.updateOne({ _id: row._id }, { $set: { categoryId: keep } });
          repointed++;
        }
      }
    }

    const { deletedCount } = await M.Category.deleteMany({ _id: { $in: lose } });
    removed += deletedCount;
  }

  if (dryRun) {
    console.log(`\nDry run: ${groups.length} duplicated names, nothing written.`);
    return;
  }

  console.log(
    `\nRemoved ${removed} duplicate categories · repointed ${repointed} rows · dropped ${dropped}.`
  );

  // createIndexes, NOT syncIndexes. syncIndexes also DROPS every index the
  // schema does not declare — and this collection is shared, so that would
  // delete a neighbouring application's indexes as a side effect of tidying
  // ours. Foreground build, and reported either way: the whole reason this
  // script exists is that a background build failed silently.
  await M.Category.createIndexes();
  const built = (await M.Category.collection.indexes()).find(i => i.name === "userId_1_normalizedName_1");
  console.log(built?.unique ? "Unique index is in place." : "WARNING: unique index still missing.");
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
