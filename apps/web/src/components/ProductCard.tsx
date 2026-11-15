import { Link } from 'react-router-dom';
import { categoryColor, categoryIcon, formatTHB, type Product } from '../api/client';

export default function ProductCard({ product }: { product: Product }) {
  const slug = product.category?.slug;
  return (
    <div className="card h-100 product-card border-0 shadow-sm" data-testid="product-card">
      <div className="product-thumb" style={{ background: categoryColor(slug) }} aria-hidden="true">{categoryIcon(slug)}</div>
      <div className="card-body d-flex flex-column">
        <div className="small text-muted mb-1">{product.brand} · {product.category?.name}</div>
        <h2 className="h6 card-title">
          <Link className="stretched-link text-decoration-none text-dark" to={`/products/${product.sku}`}>{product.name}</Link>
        </h2>
        <div className="mt-auto d-flex justify-content-between align-items-center">
          <span className="price">{formatTHB(product.priceSatang)}</span>
          {product.inStock
            ? <span className="badge text-bg-success">In stock</span>
            : <span className="badge text-bg-secondary">Out of stock</span>}
        </div>
      </div>
    </div>
  );
}
