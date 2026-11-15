export interface Category { id: string; name: string; slug: string; description: string; productCount: number }
export interface Product {
  id: string; sku: string; name: string; brand: string; description: string;
  priceSatang: number; stock: number; inStock: boolean; imageUrl: string; specs: string[];
  category: { id: string; name: string; slug: string } | null;
}
export interface ProductPage { data: Product[]; meta: { page: number; limit: number; total: number; totalPages: number } }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  categories: () => getJson<{ data: Category[] }>('/api/categories').then((r) => r.data),
  products: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
    return getJson<ProductPage>(`/api/products?${qs.toString()}`);
  },
  product: (idOrSku: string) => getJson<{ data: Product }>(`/api/products/${encodeURIComponent(idOrSku)}`).then((r) => r.data),
};

export const formatTHB = (satang: number) =>
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(satang / 100);

const ICONS: Record<string, string> = { keyboards: '⌨️', mice: '🖱️', headsets: '🎧', monitors: '🖥️', webcams: '📷', storage: '💾', accessories: '🔌' };
const COLORS: Record<string, string> = { keyboards: '#e7f0ff', mice: '#eafaf1', headsets: '#fff3e6', monitors: '#f1ecff', webcams: '#ffeef0', storage: '#e9f7fb', accessories: '#f3f4f6' };
export const categoryIcon = (slug?: string) => (slug && ICONS[slug]) || '🧩';
export const categoryColor = (slug?: string) => (slug && COLORS[slug]) || '#eef1f5';
