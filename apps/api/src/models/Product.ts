import { Schema, model, type InferSchemaType } from 'mongoose';

const ProductSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, match: /^[A-Z0-9-]{3,40}$/ },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    brand: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, required: true, maxlength: 2000 },
    // Money is stored as integer satang (1 THB = 100 satang).
    priceSatang: { type: Number, required: true, min: 1, max: 10_000_000, validate: Number.isInteger },
    stock: { type: Number, required: true, min: 0, max: 1_000_000, validate: Number.isInteger },
    inventoryRevision: { type: BigInt, required: true, default: 0n },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    imageUrl: { type: String, default: '' },
    specs: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

ProductSchema.index({ isActive: 1, categoryId: 1, priceSatang: 1 });

export type ProductDoc = InferSchemaType<typeof ProductSchema>;
export const Product = model('Product', ProductSchema, 'products');
