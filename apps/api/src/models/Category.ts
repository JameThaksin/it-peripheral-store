import { Schema, model, type InferSchemaType } from 'mongoose';

const CategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    description: { type: String, default: '', maxlength: 300 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    activeProductCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

export type CategoryDoc = InferSchemaType<typeof CategorySchema>;
export const Category = model('Category', CategorySchema, 'categories');
