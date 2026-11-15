import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, categoryColor, categoryIcon, formatTHB, type Product } from '../api/client';
import { ErrorBox, Loading } from '../components/Status';

export default function ProductPage() {
  const { id = '' } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setProduct(null); setError('');
    api.product(id).then(setProduct).catch(() => setError('Product not found.'));
  }, [id]);

  if (error) return <div className="container py-5"><ErrorBox message={error} /><Link to="/products">Back to products</Link></div>;
  if (!product) return <Loading />;
  const slug = product.category?.slug;
  return (
    <div className="container py-4">
      <nav aria-label="breadcrumb"><ol className="breadcrumb">
        <li className="breadcrumb-item"><Link to="/products">Products</Link></li>
        {product.category && <li className="breadcrumb-item"><Link to={`/products?category=${slug}`}>{product.category.name}</Link></li>}
        <li className="breadcrumb-item active" aria-current="page">{product.name}</li>
      </ol></nav>
      <div className="row g-4">
        <div className="col-md-5">
          <div className="rounded d-flex align-items-center justify-content-center shadow-sm" style={{ height: 320, fontSize: '7rem', background: categoryColor(slug) }} aria-hidden="true">{categoryIcon(slug)}</div>
        </div>
        <div className="col-md-7">
          <div className="text-muted">{product.brand} · SKU {product.sku}</div>
          <h1 className="h2">{product.name}</h1>
          <div className="fs-3 price my-3">{formatTHB(product.priceSatang)}</div>
          <p>{product.description}</p>
          {product.specs.length > 0 && <ul>{product.specs.map((s) => <li key={s}>{s}</li>)}</ul>}
          <p>{product.inStock ? <span className="badge text-bg-success">In stock ({product.stock})</span> : <span className="badge text-bg-secondary">Out of stock</span>}</p>
          <button className="btn btn-primary btn-lg" disabled title="Cart and checkout are planned for the next milestone">Add to cart (coming soon)</button>
        </div>
      </div>
    </div>
  );
}
