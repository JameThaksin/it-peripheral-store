import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { pingDb } from '../config/db.js';
import { getProduct, listCategories, listProducts, ProductQuerySchema } from '../services/catalog.js';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export const api = Router();

api.get('/health', wrap(async (_req, res) => {
  const db = await pingDb();
  res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down', uptimeSeconds: Math.round(process.uptime()) });
}));

api.get('/categories', wrap(async (_req, res) => {
  res.json({ data: await listCategories() });
}));

api.get('/products', wrap(async (req, res) => {
  const parsed = ProductQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  const result = await listProducts(parsed.data);
  return res.json({ data: result.items, meta: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages } });
}));

const IdParam = z.string().min(1).max(40).regex(/^[A-Za-z0-9-]+$/);
api.get('/products/:id', wrap(async (req, res) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const product = await getProduct(id.data);
  if (!product) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  return res.json({ data: product });
}));

api.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
