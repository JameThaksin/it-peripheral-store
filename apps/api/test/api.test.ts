// API smoke tests against a REAL MongoDB replica set (no mocks).
// Requires MONGODB_URI (e.g. the local Docker replica set); uses database `itps_test_smoke`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed/run.js';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true';
const app = createApp();

before(async () => {
  await connectDb(uri, 'itps_test_smoke');
  await mongoose.connection.dropDatabase();
  await seed();
});
after(async () => { await mongoose.connection.dropDatabase(); await disconnectDb(); });

test('GET /api/health reports db up', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.db, 'up');
});

test('seed inserted at least 30 active products and is repeatable', async () => {
  const res = await request(app).get('/api/products?limit=48').expect(200);
  assert.ok(res.body.meta.total >= 30, `total ${res.body.meta.total}`);
  const again = await seed();
  assert.equal(again.productsInserted, 0);
  assert.equal(again.categoriesInserted, 0);
  const res2 = await request(app).get('/api/products?limit=48').expect(200);
  assert.equal(res2.body.meta.total, res.body.meta.total);
});

test('category counters match active products', async () => {
  const cats = (await request(app).get('/api/categories').expect(200)).body.data as { slug: string; productCount: number }[];
  assert.ok(cats.length >= 5);
  for (const c of cats) {
    const r = await request(app).get(`/api/products?category=${c.slug}&limit=48`).expect(200);
    assert.equal(r.body.meta.total, c.productCount, c.slug);
  }
});

test('search and category filter', async () => {
  const kb = await request(app).get('/api/products?category=keyboards&limit=48').expect(200);
  assert.ok(kb.body.data.length > 0);
  assert.ok(kb.body.data.every((p: { category: { slug: string } }) => p.category.slug === 'keyboards'));
  const q = await request(app).get('/api/products?q=monitor').expect(200);
  assert.ok(q.body.meta.total > 0);
  assert.ok(q.body.data.every((p: { name: string; description: string }) => /monitor/i.test(p.name + p.description)));
  const none = await request(app).get('/api/products?q=zzzz-no-match').expect(200);
  assert.equal(none.body.meta.total, 0);
  const regexSafe = await request(app).get('/api/products?q=' + encodeURIComponent('.*(')).expect(200);
  assert.equal(regexSafe.body.meta.total, 0);
});

test('sorting, pagination and money as integer satang', async () => {
  const r = await request(app).get('/api/products?sort=price_asc&limit=5&page=1').expect(200);
  const prices = r.body.data.map((p: { priceSatang: number }) => p.priceSatang);
  assert.deepEqual(prices, [...prices].sort((a: number, b: number) => a - b));
  assert.ok(prices.every(Number.isInteger));
  assert.equal(r.body.data.length, 5);
});

test('strict query validation rejects unknown params', async () => {
  const r = await request(app).get('/api/products?foo=1').expect(400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  await request(app).get('/api/products?limit=1000').expect(400);
});

test('product detail by sku and 404', async () => {
  const r = await request(app).get('/api/products/KB-MECH-TKL-01').expect(200);
  assert.equal(r.body.data.sku, 'KB-MECH-TKL-01');
  await request(app).get('/api/products/NOPE-0000').expect(404);
  await request(app).get('/api/nope').expect(404);
});
