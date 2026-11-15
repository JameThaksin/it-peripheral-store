import { Types } from 'mongoose';
import { z } from 'zod';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';

export const ProductQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60).optional(),
    sort: z.enum(['name', 'price_asc', 'price_desc', 'newest']).default('name'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(12),
  })
  .strict();

export type ProductQuery = z.infer<typeof ProductQuerySchema>;

const SORTS = {
  name: { name: 1 },
  price_asc: { priceSatang: 1, name: 1 },
  price_desc: { priceSatang: -1, name: 1 },
  newest: { createdAt: -1 },
} as const;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CategoryDto { id: string; name: string; slug: string; description: string; productCount: number }

export interface ProductDto {
  id: string; sku: string; name: string; brand: string; description: string;
  priceSatang: number; stock: number; inStock: boolean; imageUrl: string; specs: string[];
  category: { id: string; name: string; slug: string } | null;
}

export async function listCategories(): Promise<CategoryDto[]> {
  const cats = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  return cats.map((c) => ({
    id: String(c._id), name: c.name, slug: c.slug, description: c.description ?? '', productCount: c.activeProductCount ?? 0,
  }));
}

export async function listProducts(query: ProductQuery) {
  const filter: Record<string, unknown> = { isActive: true };
  if (query.category) {
    const cat = await Category.findOne({ slug: query.category, isActive: true }).lean();
    if (!cat) return { items: [] as ProductDto[], page: query.page, limit: query.limit, total: 0, totalPages: 0 };
    filter.categoryId = cat._id;
  }
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { sku: rx }, { description: rx }];
  }
  const [total, docs] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate<{ categoryId: { _id: Types.ObjectId; name: string; slug: string } | null }>('categoryId', 'name slug')
      .lean(),
  ]);
  const items: ProductDto[] = docs.map((p) => ({
    id: String(p._id), sku: p.sku, name: p.name, brand: p.brand, description: p.description,
    priceSatang: p.priceSatang, stock: p.stock, inStock: p.stock > 0, imageUrl: p.imageUrl ?? '', specs: p.specs ?? [],
    category: p.categoryId ? { id: String(p.categoryId._id), name: p.categoryId.name, slug: p.categoryId.slug } : null,
  }));
  return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
}

export async function getProduct(idOrSku: string): Promise<ProductDto | null> {
  const filter = Types.ObjectId.isValid(idOrSku) && /^[a-f0-9]{24}$/.test(idOrSku)
    ? { _id: new Types.ObjectId(idOrSku), isActive: true }
    : { sku: idOrSku.toUpperCase(), isActive: true };
  const p = await Product.findOne(filter)
    .populate<{ categoryId: { _id: Types.ObjectId; name: string; slug: string } | null }>('categoryId', 'name slug')
    .lean();
  if (!p) return null;
  return {
    id: String(p._id), sku: p.sku, name: p.name, brand: p.brand, description: p.description,
    priceSatang: p.priceSatang, stock: p.stock, inStock: p.stock > 0, imageUrl: p.imageUrl ?? '', specs: p.specs ?? [],
    category: p.categoryId ? { id: String(p.categoryId._id), name: p.categoryId.name, slug: p.categoryId.slug } : null,
  };
}
