export type Product = {
  id: number; name: string; brand: string; category: string; price: number;
  description?: string; avg_rating?: number; review_count?: number; rating_change?: number;
  revenue?: number; units_sold?: number; return_rate?: number;
};
export type KPI = {
  key: string; label: string; value: number; format: string; change_pct: number;
  note: string; is_rate?: boolean;
};
export type TrendPoint = {
  date: string; revenue: number; units_sold: number; returns: number;
  avg_rating: number | null; review_count: number;
};
export type Review = {
  id: number; product_id: number; date: string; rating: number; text: string;
  source: string; topic: string; sentiment: string; helpful_votes: number;
  retrieval_score?: number;
};
export type Overview = {
  range: { start: string; end: string; days: number; previous_start: string; previous_end: string };
  kpis: KPI[]; trends: TrendPoint[]; topic_stats: { topic: string; count: number; avg_rating?: number }[];
  products: Product[]; selected_product_id: number; data_note: string;
};
export type Finding = { label: string; value: string; detail: string };
export type Action = { priority: string; title: string; detail: string; requires_approval: boolean };
export type Citation = Review;
export type Investigation = {
  id?: number; question: string; product_id: number; period_days: number; title: string;
  summary: string; findings: Finding[]; metrics: any; citations: Citation[];
  recommended_actions: Action[]; limitations: string[]; sql_queries: { title: string; sql: string }[];
  plan_steps: { name: string; status: string; detail: string }[]; confidence: number;
  mode?: string; created_at?: string; synthetic_data?: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const body = await response.json(); message = body.detail || message; } catch { /* response had no JSON */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  config: () => request<{ app_name: string; mode: string; openai_enabled: boolean; data_note: string }>('/api/config'),
  products: () => request<Product[]>('/api/products'),
  overview: (productId: number, days: number) => request<Overview>(`/api/overview?product_id=${productId}&days=${days}`),
  consumer: (productId: number, days: number) => request<{ topic_stats: any[]; reviews: Review[]; range: any }>(`/api/consumer-insights?product_id=${productId}&days=${days}&limit=12`),
  searchReviews: (query: string, productId: number, days: number) => request<{ count: number; retrieval_mode: string; results: Review[] }>('/api/reviews/search', { method: 'POST', body: JSON.stringify({ query, product_id: productId, days, limit: 12 }) }),
  investigate: (question: string, productId: number, periodDays: number) => request<Investigation>('/api/investigate', { method: 'POST', body: JSON.stringify({ question, product_id: productId, period_days: periodDays }) }),
  reports: () => request<any[]>('/api/investigations?limit=50'),
  report: (id: number) => request<Investigation>(`/api/investigations/${id}`),
};
