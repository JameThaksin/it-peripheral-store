import { Link, NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductPage from './pages/ProductPage';

export default function App() {
  return (
    <div className="d-flex flex-column min-vh-100">
      <nav className="navbar navbar-expand-md navbar-dark bg-dark sticky-top">
        <div className="container">
          <Link className="navbar-brand fw-bold" to="/">🖥️ IT Peripheral Store</Link>
          <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav"
            aria-controls="nav" aria-label="Toggle navigation"
            onClick={() => document.getElementById('nav')?.classList.toggle('show')}>
            <span className="navbar-toggler-icon" />
          </button>
          <div className="collapse navbar-collapse" id="nav">
            <ul className="navbar-nav ms-auto">
              <li className="nav-item"><NavLink className="nav-link" to="/" end>Home</NavLink></li>
              <li className="nav-item"><NavLink className="nav-link" to="/products">Products</NavLink></li>
            </ul>
          </div>
        </div>
      </nav>
      <main className="flex-grow-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<CatalogPage />} />
          <Route path="/products/:id" element={<ProductPage />} />
          <Route path="*" element={<div className="container py-5"><h1 className="h3">Page not found</h1><Link to="/">Go home</Link></div>} />
        </Routes>
      </main>
      <footer className="bg-dark text-white-50 py-4 mt-5">
        <div className="container small d-flex flex-column flex-md-row justify-content-between gap-2">
          <span>© 2026 IT Peripheral Store · University project</span>
          <span>Prices in THB, including VAT</span>
        </div>
      </footer>
    </div>
  );
}
