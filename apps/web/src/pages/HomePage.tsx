import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, categoryColor, categoryIcon, type Category, type Product } from '../api/client';
import ProductCard from '../components/ProductCard';
import { ErrorBox, Loading } from '../components/Status';

export default function HomePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const load = () => {
    setLoading(true); setError('');
    Promise.all([api.categories(), api.products({ sort: 'price_desc', limit: 8 })])
      .then(([c, p]) => { setCategories(c); setFeatured(p.data); })
      .catch(() => setError('Could not load the store. Please try again.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <>
      <section className="hero py-5">
        <div className="container py-md-4">
          <div className="row align-items-center g-4">
            <div className="col-lg-7">
              <h1 className="display-5 fw-bold">Gear up your desk</h1>
              <p className="lead opacity-75">Keyboards, mice, monitors, audio and accessories, chosen for students and professionals.</p>
              <form className="d-flex gap-2 mt-4" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/products?q=${encodeURIComponent(q.trim())}`); }}>
                <input className="form-control form-control-lg" type="search" placeholder="Search products…" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn btn-warning btn-lg" type="submit">Search</button>
              </form>
            </div>
            <div className="col-lg-5 text-center d-none d-lg-block" aria-hidden="true" style={{ fontSize: '6rem' }}>⌨️🖱️🎧</div>
          </div>
        </div>
      </section>

      <div className="container py-5">
        {error && <ErrorBox message={error} onRetry={load} />}
        {loading ? <Loading /> : (
          <>
            <h2 className="h4 mb-3">Shop by category</h2>
            <div className="row row-cols-2 row-cols-md-4 row-cols-lg-7 g-3 mb-5">
              {categories.map((c) => (
                <div className="col" key={c.id}>
                  <Link to={`/products?category=${c.slug}`} className="card category-tile h-100 text-center text-decoration-none text-dark border-0 shadow-sm">
                    <div className="card-body">
                      <div className="rounded-circle mx-auto mb-2 d-flex align-items-center justify-content-center" style={{ width: 56, height: 56, background: categoryColor(c.slug), fontSize: '1.6rem' }}>{categoryIcon(c.slug)}</div>
                      <div className="fw-semibold small">{c.name}</div>
                      <div className="text-muted small">{c.productCount} items</div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h2 className="h4 mb-0">Featured</h2>
              <Link to="/products" className="btn btn-outline-primary btn-sm">View all products</Link>
            </div>
            <div className="row row-cols-1 row-cols-sm-2 row-cols-lg-4 g-3">
              {featured.map((p) => <div className="col" key={p.id}><ProductCard product={p} /></div>)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
