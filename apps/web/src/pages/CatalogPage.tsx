import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Category, type ProductPage } from '../api/client';
import ProductCard from '../components/ProductCard';
import { ErrorBox, Loading } from '../components/Status';

const SORTS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
];

export default function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'name';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<ProductPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(q);

  useEffect(() => { api.categories().then(setCategories).catch(() => undefined); }, []);
  useEffect(() => setSearch(q), [q]);

  const load = () => {
    setLoading(true); setError('');
    api.products({ q: q || undefined, category: category || undefined, sort, page, limit: 12 })
      .then(setResult)
      .catch(() => setError('Could not load products. Please try again.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [q, category, sort, page]);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const activeCat = categories.find((c) => c.slug === category);

  return (
    <div className="container py-4">
      <h1 className="h3 mb-3">{activeCat ? activeCat.name : 'All products'}</h1>
      <div className="row g-4">
        <aside className="col-lg-3">
          <form role="search" className="mb-3" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }}>
            <label htmlFor="search" className="form-label fw-semibold">Search</label>
            <div className="input-group">
              <input id="search" className="form-control" type="search" placeholder="e.g. keyboard, 4K, USB-C" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="btn btn-primary" type="submit">Go</button>
            </div>
          </form>
          <div className="mb-3">
            <label htmlFor="category" className="form-label fw-semibold">Category</label>
            <select id="category" className="form-select" value={category} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.slug}>{c.name} ({c.productCount})</option>)}
            </select>
          </div>
          <div className="mb-3">
            <label htmlFor="sort" className="form-label fw-semibold">Sort by</label>
            <select id="sort" className="form-select" value={sort} onChange={(e) => update({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {(q || category) && <button className="btn btn-outline-secondary w-100" onClick={() => setParams(new URLSearchParams())}>Clear filters</button>}
        </aside>
        <section className="col-lg-9">
          {error && <ErrorBox message={error} onRetry={load} />}
          {loading && !result ? <Loading /> : result && (
            <>
              <p className="text-muted small" data-testid="result-count">
                {result.meta.total} product{result.meta.total === 1 ? '' : 's'}{q && <> matching “{q}”</>}
              </p>
              {result.data.length === 0 ? (
                <div className="text-center py-5 text-muted">No products found. Try another search or category.</div>
              ) : (
                <div className="row row-cols-1 row-cols-sm-2 row-cols-xl-3 g-3">
                  {result.data.map((p) => <div className="col" key={p.id}><ProductCard product={p} /></div>)}
                </div>
              )}
              {result.meta.totalPages > 1 && (
                <nav className="mt-4" aria-label="Pagination">
                  <ul className="pagination justify-content-center">
                    <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}><button className="page-link" onClick={() => update({ page: String(page - 1) })}>Previous</button></li>
                    {Array.from({ length: result.meta.totalPages }, (_, i) => i + 1).map((n) => (
                      <li key={n} className={`page-item ${n === page ? 'active' : ''}`}><button className="page-link" onClick={() => update({ page: String(n) })}>{n}</button></li>
                    ))}
                    <li className={`page-item ${page >= result.meta.totalPages ? 'disabled' : ''}`}><button className="page-link" onClick={() => update({ page: String(page + 1) })}>Next</button></li>
                  </ul>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
