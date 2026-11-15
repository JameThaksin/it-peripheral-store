import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { categories, products } from './data.js';

// Insert-only, repeatable seed (DATABASE_DESIGN §8): never modifies existing documents.
export async function seed(): Promise<{ categoriesInserted: number; productsInserted: number; productsSkipped: number }> {
  await Promise.all([Category.syncIndexes(), Product.syncIndexes()]);
  let categoriesInserted = 0;
  for (const c of categories) {
    const r = await Category.updateOne(
      { slug: c.slug },
      { $setOnInsert: { ...c, isActive: true, activeProductCount: 0 } },
      { upsert: true },
    );
    categoriesInserted += r.upsertedCount;
  }
  const catIds = new Map((await Category.find({}, { slug: 1 }).lean()).map((c) => [c.slug, c._id]));

  let productsInserted = 0;
  let productsSkipped = 0;
  for (const p of products) {
    const categoryId = catIds.get(p.category);
    if (!categoryId) throw new Error(`Unknown category ${p.category} for ${p.sku}`);
    const { category: _category, ...fields } = p;
    const session = await mongoose.startSession();
    try {
      let inserted = 0;
      await session.withTransaction(async () => {
        inserted = 0;
        const r = await Product.updateOne(
          { sku: p.sku },
          { $setOnInsert: { ...fields, categoryId, inventoryRevision: 0n, isActive: true, deletedAt: null, imageUrl: '' } },
          { upsert: true, session },
        );
        if (r.upsertedCount === 1) {
          // Counter changes only when the product was actually inserted.
          const c = await Category.updateOne({ _id: categoryId, isActive: true }, { $inc: { activeProductCount: 1 } }, { session });
          if (c.matchedCount !== 1) throw new Error(`Category ${p.category} is inactive`);
          inserted = 1;
        }
      });
      if (inserted) productsInserted++; else productsSkipped++;
    } finally {
      await session.endSession();
    }
  }
  return { categoriesInserted, productsInserted, productsSkipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
  try {
    const r = await seed();
    const active = await Product.countDocuments({ isActive: true });
    console.log(`[seed] categories inserted: ${r.categoriesInserted}; products inserted: ${r.productsInserted}; skipped (already present): ${r.productsSkipped}; active products: ${active}`);
  } finally {
    await disconnectDb();
  }
}
