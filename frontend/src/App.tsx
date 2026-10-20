import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  Bell, Bot, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Code2, Database, Download, FileSearch, FileText, FlaskConical,
  Gauge, GitBranch, Layers3, Leaf, LoaderCircle, Menu, MessageCircle, MessageSquareText,
  PackageCheck, PanelLeftClose, Play, Plus, Search, Send, ShieldCheck, Sparkles,
  Star, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type Action, type Investigation, type Overview, type Product, type Review } from './api';

const navItems = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'consumer', label: 'Consumer voice', icon: MessageSquareText },
  { id: 'investigator', label: 'AI investigator', icon: Sparkles },
  { id: 'reports', label: 'Saved investigations', icon: FileText },
] as const;
type Page = typeof navItems[number]['id'];
const palette = ['#3D8066', '#83A991', '#D2A36C', '#8A9DC1', '#C58D8B', '#A3B7A9', '#B7A38E'];
const questions = [
  'Why are ratings declining, and what should we investigate first?',
  'What are the biggest consumer complaints for this product?',
  'Compare sales, return rate and review sentiment against the previous period.',
  'Find recent packaging complaints and recommend next steps.',
];

function money(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
}
function compact(value: number) {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}
function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
function Stars({ rating }: { rating: number }) {
  return <span className="stars" aria-label={`${rating} out of 5 stars`}><Star size={12} fill="currentColor" /> <b>{rating.toFixed(1)}</b></span>;
}
function Avatar({ children, tone = 'green' }: { children: ReactNode; tone?: string }) {
  return <span className={`avatar avatar-${tone}`}>{children}</span>;
}
function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
function Empty({ icon: Icon, title, detail }: { icon: any; title: string; detail: string }) {
  return <div className="empty"><span className="empty-icon"><Icon size={20} /></span><b>{title}</b><p>{detail}</p></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState(1);
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [consumer, setConsumer] = useState<{ topic_stats: any[]; reviews: Review[]; range: any } | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [config, setConfig] = useState<{ app_name: string; mode: string; openai_enabled: boolean; data_note: string } | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState(questions[0]);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [reviewQuery, setReviewQuery] = useState('packaging complaints');
  const [reviewResults, setReviewResults] = useState<Review[] | null>(null);
  const [searchMode, setSearchMode] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const activeProduct = useMemo(() => products.find(p => p.id === selectedProduct), [products, selectedProduct]);

  useEffect(() => {
    (window as any).__beautypulseNavigate = (destination: Page) => setPage(destination);
    return () => { delete (window as any).__beautypulseNavigate; };
  }, []);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [overviewData, consumerData] = await Promise.all([
        api.overview(selectedProduct, days),
        api.consumer(selectedProduct, days),
      ]);
      setOverview(overviewData);
      setConsumer(consumerData);
      setError('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingOverview(false);
    }
  }, [selectedProduct, days]);

  useEffect(() => {
    Promise.all([api.products(), api.config(), api.reports()])
      .then(([productData, configData, reportData]) => {
        setProducts(productData);
        setConfig(configData);
        setReports(reportData);
        if (productData.length && !productData.some(p => p.id === selectedProduct)) setSelectedProduct(productData[0].id);
      })
      .catch(err => setError(errorText(err)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const refreshReports = useCallback(async () => {
    try { setReports(await api.reports()); } catch { /* dashboard can remain usable if reports endpoint temporarily fails */ }
  }, []);

  const runInvestigation = async (event?: FormEvent) => {
    event?.preventDefault();
    if (question.trim().length < 8) { setError('Enter a more specific business question.'); return; }
    setBusy(true); setError(''); setPage('investigator'); setInvestigation(null);
    try {
      const result = await api.investigate(question.trim(), selectedProduct, days);
      setInvestigation(result);
      await refreshReports();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const searchConsumerReviews = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!reviewQuery.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api.searchReviews(reviewQuery, selectedProduct, days);
      setReviewResults(result.results);
      setSearchMode(result.retrieval_mode);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const openReport = async (id: number) => {
    setPage('investigator'); setBusy(true); setError('');
    try { setInvestigation(await api.report(id)); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const handleNav = (destination: Page) => { setPage(destination); setMobileNav(false); setError(''); };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Leaf size={22} strokeWidth={1.8} /></div>
          <div><div className="brand-name">beautypulse<span>AI</span></div><div className="brand-caption">CONSUMER INTELLIGENCE</div></div>
          <button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-logo">G</div>
          <div className="workspace-copy"><b>GlowNest Beauty</b><span>Demo workspace</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav">
          {navItems.map(item => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => handleNav(item.id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
              {item.id === 'reports' && reports.length > 0 && <span className="nav-count">{reports.length}</span>}
              {item.id === 'investigator' && <span className="nav-spark"><Sparkles size={13} /></span>}
            </button>;
          })}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">DATA & SYSTEM</div>
        <div className="side-feature"><span className="side-feature-icon"><Database size={16} /></span><div><b>Business data</b><span>PostgreSQL connected</span></div><i className="status-dot" /></div>
        <div className="side-feature"><span className="side-feature-icon lavender"><GitBranch size={16} /></span><div><b>Investigation agent</b><span>LangGraph workflow</span></div><i className="status-dot" /></div>
        <div className="sidebar-spacer" />
        <div className="sidebar-callout">
          <div className="callout-icon"><Sparkles size={16} /></div>
          <b>Better decisions start with evidence.</b>
          <p>Combine what customers say with what the business data shows.</p>
          <button onClick={() => { setQuestion(questions[0]); handleNav('investigator'); }}>Run an investigation <ArrowRight size={14} /></button>
        </div>
        <div className="sidebar-user"><div className="user-avatar">BP</div><div className="user-copy"><b>BeautyPulse Analyst</b><span>Portfolio workspace</span></div><button className="icon-button user-menu" aria-label="More account options"><Menu size={16} /></button></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>GlowNest Beauty</span><ChevronRight size={14} /><b>{navItems.find(n => n.id === page)?.label || 'Overview'}</b></div>
          <div className="topbar-right">
            <span className="demo-indicator"><i /> Synthetic demo data</span>
            <button className="top-icon icon-button" aria-label="Notifications"><Bell size={17} /><i /></button>
            <div className="top-avatar">BP</div>
          </div>
        </header>

        {error && <div className="error-banner"><AlertCircle size={16} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}

        <div className="page-container">
          {page === 'overview' && <OverviewPage
            overview={overview} products={products} selectedProduct={selectedProduct} days={days} activeProduct={activeProduct}
            loading={loadingOverview} reports={reports} onProduct={setSelectedProduct} onDays={setDays}
            onInvestigate={() => { setQuestion(questions[0]); handleNav('investigator'); }} onOpenReport={openReport}
          />}
          {page === 'consumer' && <ConsumerPage
            consumer={consumer} activeProduct={activeProduct} query={reviewQuery} setQuery={setReviewQuery}
            results={reviewResults} searchMode={searchMode} busy={busy} onSearch={searchConsumerReviews}
          />}
          {page === 'investigator' && <InvestigatorPage
            question={question} setQuestion={setQuestion} products={products} selectedProduct={selectedProduct}
            onProduct={setSelectedProduct} days={days} onDays={setDays} busy={busy} result={investigation}
            onRun={runInvestigation} onTryQuestion={setQuestion}
          />}
          {page === 'reports' && <ReportsPage reports={reports} onOpen={openReport} />}
          <footer className="page-footer"><span>BeautyPulse AI <span className="footer-dot">·</span> Evidence-first consumer intelligence</span><span><ShieldCheck size={13} /> Demo data only <span className="footer-dot">·</span> Built for portfolio demonstration</span></footer>
        </div>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, right }: { eyebrow?: string; title: string; description: string; right?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{right && <div className="heading-actions">{right}</div>}</div>;
}

function OverviewPage(props: {
  overview: Overview | null; products: Product[]; selectedProduct: number; days: number; activeProduct?: Product;
  loading: boolean; reports: any[]; onProduct: (id: number) => void; onDays: (days: number) => void;
  onInvestigate: () => void; onOpenReport: (id: number) => void;
}) {
  const { overview, products, selectedProduct, days, activeProduct, loading, reports, onProduct, onDays, onInvestigate, onOpenReport } = props;
  return <>
    <PageHeading eyebrow="OVERVIEW / BUSINESS PULSE" title="Consumer intelligence, made actionable." description="See what's changing across your products, understand what customers are saying, and know what to investigate next."
      right={<><div className="select-wrap"><PackageCheck size={15} /><select value={selectedProduct} onChange={e => onProduct(Number(e.target.value))} aria-label="Choose product">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={14} /></div><button className="button-primary" onClick={onInvestigate}><Sparkles size={16} /> New investigation</button></>} />
    <div className="hero-strip">
      <div className="hero-glow" />
      <div className="hero-copy"><div className="hero-overline"><Sparkles size={13} /> YOUR DAILY SIGNAL</div><h2>Look beyond the numbers.</h2><p>Bring customer feedback and business performance together to find the next best action.</p><button className="hero-button" onClick={onInvestigate}>Investigate a product <ArrowRight size={15} /></button></div>
      <div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-orbit orbit-three"/><div className="hero-center"><Leaf size={34}/></div><span className="hero-chip chip-rating"><Star size={13} fill="currentColor"/> Consumer voice</span><span className="hero-chip chip-data"><Activity size={13}/> Business data</span><span className="hero-chip chip-ai"><Sparkles size={13}/> AI insight</span></div>
      <div className="hero-count"><span>ACTIVE SIGNALS</span><b>{overview?.topic_stats?.length || 7}</b><small>consumer themes tracked</small></div>
    </div>

    <div className="section-toolbar"><div className="section-label"><span className="section-dot"/> Performance snapshot</div><div className="toolbar-right"><span className="range-label">Compare period</span><div className="range-toggle">{[7, 30, 90].map(n => <button key={n} onClick={() => onDays(n)} className={days === n ? 'selected' : ''}>{n} days</button>)}</div><span className="date-range">{overview ? `${dateLabel(overview.range.start)} – ${dateLabel(overview.range.end)}` : 'Loading period…'}</span></div></div>

    <div className="kpi-grid">
      {(overview?.kpis || fallbackKpis).map((kpi, index) => <KpiCard key={kpi.key} kpi={kpi} index={index} loading={loading} />)}
    </div>

    <div className="dashboard-grid main-charts-grid">
      <section className="panel revenue-panel">
        <div className="panel-heading"><div><div className="panel-title">Sales performance</div><div className="panel-subtitle">Daily revenue for {activeProduct?.name || 'selected product'}</div></div><Tag tone="green"><span className="tiny-live-dot"/> LIVE DATASET</Tag></div>
        <div className="chart-legend"><span><i className="legend-dot green-dot"/> Revenue</span><span><i className="legend-line"/> 7-day moving trend</span></div>
        <div className="revenue-total"><b>{money((overview?.trends || []).reduce((sum, d) => sum + d.revenue, 0))}</b><span>selected period revenue</span></div>
        <div className="chart-area revenue-chart">
          {loading ? <ChartSkeleton /> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={overview?.trends || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4b9076" stopOpacity={0.22}/><stop offset="100%" stopColor="#4b9076" stopOpacity={0.015}/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#edf0ed" strokeDasharray="3 4"/><XAxis dataKey="date" tickFormatter={d => new Date(`${d}T00:00:00`).getDate() % 5 === 0 ? dateLabel(d) : ''} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#929a94' }} minTickGap={12}/><YAxis tickFormatter={v => `₹${compact(v)}`} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#929a94' }} width={50}/><Tooltip content={<RevenueTooltip/>}/><Area type="monotone" dataKey="revenue" stroke="#397b62" strokeWidth={2.3} fill="url(#revenueFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart></ResponsiveContainer>}
        </div>
        <div className="chart-footnote"><span><span className="chart-foot-icon"><Activity size={13}/></span> Revenue is generated from demo units sold × product price with small synthetic discount variation.</span><span>INR</span></div>
      </section>
      <section className="panel topics-panel">
        <div className="panel-heading"><div><div className="panel-title">What customers talk about</div><div className="panel-subtitle">Review themes · {days} days</div></div><button className="icon-button subtle-icon" aria-label="Open consumer voice" onClick={() => (window as any).__beautypulseNavigate?.('consumer')}><ArrowRight size={17}/></button></div>
        <div className="topic-chart-wrap">
          {loading ? <ChartSkeleton /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={(overview?.topic_stats || []).slice(0, 6)} layout="vertical" margin={{ top: 5, right: 8, left: 6, bottom: 5 }}>
            <CartesianGrid horizontal={false} stroke="#edf0ed"/><XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#a0a7a1' }}/><YAxis type="category" dataKey="topic" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#59645d' }} width={85}/><Tooltip cursor={{ fill: '#f6f8f6' }} content={<TopicTooltip/>}/><Bar dataKey="count" radius={[0, 5, 5, 0]} barSize={15}>{(overview?.topic_stats || []).slice(0, 6).map((item, i) => <Cell key={item.topic} fill={palette[i % palette.length]} />)}</Bar>
          </BarChart></ResponsiveContainer>}
        </div>
        <div className="topics-list">{(overview?.topic_stats || []).slice(0, 4).map((item, i) => <div className="topic-line" key={item.topic}><span className="topic-color" style={{ background: palette[i % palette.length] }}/><span className="topic-name">{item.topic}</span><span className="topic-mentions">{item.count} mentions</span></div>)}</div>
        <button className="text-link full-width-link" onClick={() => (window as any).__beautypulseNavigate?.('consumer')}>Explore consumer voice <ArrowRight size={14}/></button>
      </section>
    </div>

    <div className="section-toolbar second-toolbar"><div className="section-label"><span className="section-dot clay-dot"/> Product pulse</div><button className="text-link" onClick={onInvestigate}>Investigate a product <ArrowRight size={14}/></button></div>
    <section className="panel product-table-panel">
      <div className="table-header-row"><div><div className="panel-title">Portfolio performance</div><div className="panel-subtitle">A cross-product view for the selected reporting window</div></div><Tag> {overview?.products?.length || products.length} PRODUCTS</Tag></div>
      <div className="table-scroll"><table className="product-table"><thead><tr><th>PRODUCT</th><th>RATING</th><th>REVIEW VOLUME</th><th>REVENUE</th><th>RETURN RATE</th><th>STATUS</th><th/></tr></thead><tbody>
        {(overview?.products || products).slice(0, 8).map((p, index) => <tr key={p.id} className={p.id === selectedProduct ? 'current-product-row' : ''} onClick={() => onProduct(p.id)}>
          <td><div className="product-name-cell"><div className={`product-swatch swatch-${index % 5}`}><span>{p.category?.slice(0, 1) || 'B'}</span></div><div><b>{p.name}</b><span>{p.category}</span></div></div></td>
          <td><Stars rating={p.avg_rating || 0}/><small className={`micro-change ${(p.rating_change || 0) < 0 ? 'negative' : 'positive'}`}>{(p.rating_change || 0) > 0 ? '+' : ''}{(p.rating_change || 0).toFixed(2)} vs prior</small></td>
          <td><b className="table-main-number">{p.review_count || 0}</b><span className="table-muted"> reviews</span></td>
          <td><b className="table-main-number">{compact(p.revenue || 0)}</b><span className="table-muted"> INR</span></td>
          <td><span className={(p.return_rate || 0) > 6 ? 'metric-warn' : 'metric-normal'}>{(p.return_rate || 0).toFixed(1)}%</span></td>
          <td><Tag tone={(p.rating_change || 0) < -0.15 || (p.return_rate || 0) > 6 ? 'amber' : 'green'}>{(p.rating_change || 0) < -0.15 ? 'Needs review' : (p.return_rate || 0) > 6 ? 'Watch returns' : 'On track'}</Tag></td>
          <td><button className="row-arrow" aria-label={`Select ${p.name}`}><ChevronRight size={16}/></button></td>
        </tr>)}
      </tbody></table></div>
      <div className="table-foot"><span><i className="tiny-info">i</i> Select a row to focus the dashboard on that product.</span><span>Updated from synthetic demo data</span></div>
    </section>

    <div className="bottom-insight-grid">
      <section className="insight-banner"><div className="insight-mark"><FlaskConical size={20}/></div><div><b>From signal to action</b><p>Investigate a rating drop by combining customer reviews, SQL metrics and availability indicators in one workflow.</p></div><button onClick={onInvestigate}>Start investigation <ArrowRight size={14}/></button></section>
      <section className="panel recent-panel"><div className="panel-heading"><div><div className="panel-title">Recent investigations</div><div className="panel-subtitle">Your latest saved reports</div></div><button className="icon-button subtle-icon" onClick={() => (window as any).__beautypulseNavigate?.('reports')} aria-label="View saved reports"><ArrowRight size={17}/></button></div>
        {reports.length ? reports.slice(0, 2).map(r => <button className="recent-report" key={r.id} onClick={() => onOpenReport(r.id)}><Avatar tone="lavender"><FileSearch size={15}/></Avatar><span><b>{r.title}</b><small>{r.created_at ? new Date(r.created_at).toLocaleString() : 'Recently saved'}</small></span><ChevronRight size={15}/></button>) : <div className="recent-empty">No reports yet. Run your first investigation.</div>}
      </section>
    </div>
    <div className="data-disclaimer"><ShieldCheck size={14}/><span>Data transparency: all product reviews and commercial KPIs shown in this environment are synthetic and intended for demonstration only.</span></div>
  </>;
}

const fallbackKpis = [
  { key: 'revenue', label: 'Net revenue', value: 0, format: 'currency', change_pct: 0, note: 'vs previous 30 days' },
  { key: 'units_sold', label: 'Units sold', value: 0, format: 'number', change_pct: 0, note: 'vs previous 30 days' },
  { key: 'return_rate', label: 'Return rate', value: 0, format: 'percent', change_pct: 0, note: 'percentage-point change' },
  { key: 'avg_rating', label: 'Average rating', value: 0, format: 'rating', change_pct: 0, note: 'star change vs prior' },
];
function KpiCard({ kpi, index, loading }: { kpi: any; index: number; loading: boolean }) {
  const iconMap: any = { revenue: TrendingUp, units_sold: PackageCheck, return_rate: Activity, avg_rating: Star };
  const Icon = iconMap[kpi.key] || Gauge;
  const glyphMap: any = { revenue: '₹', units_sold: '#', return_rate: '%', avg_rating: '★' };
  const isBad = kpi.key === 'return_rate' ? kpi.change_pct > 0.2 : kpi.key === 'avg_rating' ? kpi.change_pct < 0 : kpi.change_pct < 0;
  const value = kpi.format === 'currency' ? money(kpi.value) : kpi.format === 'percent' ? `${Number(kpi.value).toFixed(2)}%` : kpi.format === 'rating' ? `${Number(kpi.value).toFixed(2)} / 5` : compact(kpi.value);
  const change = kpi.is_rate ? `${kpi.change_pct > 0 ? '+' : ''}${Number(kpi.change_pct).toFixed(2)}${kpi.key === 'return_rate' ? ' pp' : ''}` : `${kpi.change_pct > 0 ? '+' : ''}${Number(kpi.change_pct).toFixed(1)}%`;
  return <section className={`kpi-card kpi-card-${index}`}><div className="kpi-top"><span className="kpi-label">{kpi.label}</span><span className={`kpi-icon kpi-icon-${index}`}><Icon size={16}/></span></div><div className="kpi-value">{loading ? <span className="value-skeleton"/> : value}</div><div className="kpi-bottom"><span className={`kpi-change ${isBad ? 'change-bad' : 'change-good'}`}>{isBad ? <ArrowDownRight size={13}/> : <ArrowUpRight size={13}/>} {loading ? '—' : change}</span><span className="kpi-note">{kpi.note}</span></div><span className="kpi-symbol" aria-hidden="true">{glyphMap[kpi.key]}</span></section>;
}
function ChartSkeleton() { return <div className="chart-skeleton"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div>; }
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><span>{dateLabel(label)}</span><b>{money(payload[0].value)}</b><small>Daily revenue</small></div>;
}
function TopicTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><span>{payload[0].payload.topic}</span><b>{payload[0].value} reviews</b><small>In selected period</small></div>;
}

function ConsumerPage(props: {
  consumer: { topic_stats: any[]; reviews: Review[]; range: any } | null; activeProduct?: Product;
  query: string; setQuery: (value: string) => void; results: Review[] | null; searchMode: string;
  busy: boolean; onSearch: (event?: FormEvent) => void;
}) {
  const { consumer, activeProduct, query, setQuery, results, searchMode, busy, onSearch } = props;
  const topics = consumer?.topic_stats || [];
  const maxTopic = Math.max(1, ...topics.map(t => t.count));
  const displayedReviews = results ?? consumer?.reviews ?? [];
  return <>
    <PageHeading eyebrow="CONSUMER INTELLIGENCE / VOICE OF CONSUMER" title="Listen beyond the star rating." description={`Explore the themes, friction points and customer language behind ${activeProduct?.name || 'your products'}.`} right={<Tag tone="green"><MessageCircle size={13}/> Voice of Consumer</Tag>} />
    <div className="consumer-intro"><div className="consumer-intro-icon"><MessageSquareText size={20}/></div><div><b>Review signals, not just sentiment.</b><p>Topic labels in the demo dataset are rule-based. Search uses semantic embeddings when configured, with a keyword retrieval fallback when no model key is available.</p></div><Tag>{consumer?.reviews?.length || 0} recent reviews shown</Tag></div>
    <div className="consumer-grid">
      <section className="panel topic-breakdown-panel"><div className="panel-heading"><div><div className="panel-title">Complaint & feedback themes</div><div className="panel-subtitle">Classified customer conversations</div></div><span className="panel-small-icon"><Layers3 size={17}/></span></div>
        <div className="theme-list">{topics.length ? topics.map((item, i) => <div className="theme-item" key={item.topic}><div className="theme-top"><span className="theme-dot" style={{background: palette[i % palette.length]}}/><b>{item.topic}</b><span className="theme-count">{item.count}</span></div><div className="theme-track"><span style={{width: `${item.count / maxTopic * 100}%`, background: palette[i % palette.length]}}/></div><div className="theme-bottom"><span>{item.count} mentions in selected period</span><span>{item.avg_rating ? `${item.avg_rating.toFixed(1)} average rating` : ''}</span></div></div>) : <Empty icon={MessageCircle} title="No feedback themes" detail="Try changing the product or date range."/>}</div>
        <div className="topic-legend"><span><i className="legend-dot green-dot"/> Topic mentions</span><span><i className="legend-dot clay-dot-small"/> Categories are demo classifications</span></div>
      </section>
      <section className="panel review-explorer-panel"><div className="panel-heading"><div><div className="panel-title">Review explorer</div><div className="panel-subtitle">Search customer language and surface evidence</div></div><span className="panel-small-icon"><Search size={17}/></span></div>
        <form className="review-search-form" onSubmit={onSearch}><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Try ‘packaging complaints’"/><button type="submit" disabled={busy} aria-label="Search reviews">{busy ? <LoaderCircle size={16} className="spin"/> : <ArrowRight size={16}/>}</button></form>
        <div className="query-chips">{['leaking bottle', 'irritation concerns', 'too expensive'].map(q => <button key={q} onClick={() => setQuery(q)}>{q}</button>)}</div>
        {searchMode && <div className="search-mode"><Sparkles size={12}/>{searchMode}</div>}
      </section>
    </div>
    <section className="panel review-list-panel"><div className="panel-heading"><div><div className="panel-title">{results ? `Search results (${displayedReviews.length})` : 'Recent customer reviews'}</div><div className="panel-subtitle">Every item below is a synthetic example, stored with its own record ID.</div></div><Tag>{displayedReviews.length} RECORDS</Tag></div>
      {displayedReviews.length ? <div className="review-list">{displayedReviews.map((review, index) => <ReviewCard key={review.id} review={review} index={index}/>)}</div> : <Empty icon={FileSearch} title="No matching reviews" detail="Try a broader search or switch to another product."/>}
    </section>
  </>;
}

function ReviewCard({ review, index }: { review: Review; index: number }) {
  const tones = ['green', 'lavender', 'peach', 'blue'];
  return <article className="review-card"><Avatar tone={tones[index % tones.length]}><MessageCircle size={15}/></Avatar><div className="review-card-main"><div className="review-meta"><b>Review #{review.id}</b><span className="meta-separator">·</span><span>{dateLabel(review.date)}</span><span className="meta-separator">·</span><span>{review.source}</span><span className="review-meta-spacer"/><Stars rating={review.rating}/></div><p>{review.text}</p><div className="review-tags"><Tag tone={review.sentiment === 'Negative' ? 'rose' : review.sentiment === 'Positive' ? 'green' : 'neutral'}>{review.sentiment}</Tag><Tag>{review.topic}</Tag>{review.retrieval_score !== undefined && <Tag tone="lavender">Match {review.retrieval_score.toFixed(2)}</Tag>}</div></div><button className="review-open-button" title="Source record" aria-label="Show source record"><ChevronRight size={17}/></button></article>;
}

function InvestigatorPage(props: {
  question: string; setQuestion: (q: string) => void; products: Product[]; selectedProduct: number;
  onProduct: (id: number) => void; days: number; onDays: (n: number) => void; busy: boolean;
  result: Investigation | null; onRun: (event?: FormEvent) => void; onTryQuestion: (q: string) => void;
}) {
  const { question, setQuestion, products, selectedProduct, onProduct, days, onDays, busy, result, onRun, onTryQuestion } = props;
  return <>
    <PageHeading eyebrow="APPLIED AI / AGENTIC WORKFLOWS" title="Ask a business question." description="Your investigation agent combines validated SQL, consumer review evidence and a guided synthesis workflow." right={<Tag tone="lavender"><GitBranch size={13}/> LangGraph workflow</Tag>} />
    <div className="investigator-layout">
      <section className="panel investigator-input-panel"><div className="investigator-intro"><div className="agent-avatar"><Bot size={24}/><span/></div><div><h3>BeautyPulse Investigator</h3><p>Evidence-first business analysis</p></div><Tag tone="green"><i className="tiny-live-dot"/> Ready</Tag></div>
        <form onSubmit={onRun} className="investigator-form"><label htmlFor="business-question">What would you like to understand?</label><textarea id="business-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. Why are ratings declining? Compare return rate, sales and recent consumer complaints…" rows={5}/>
          <div className="form-options"><label>Product<select value={selectedProduct} onChange={e => onProduct(Number(e.target.value))}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Comparison window<select value={days} onChange={e => onDays(Number(e.target.value))}><option value={7}>Last 7 days vs previous 7</option><option value={30}>Last 30 days vs previous 30</option><option value={60}>Last 60 days vs previous 60</option><option value={90}>Last 90 days vs previous 90</option></select></label></div>
          <div className="input-footer"><span><ShieldCheck size={13}/> Read-only tools · Actions require human approval</span><button className="button-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin"/> Investigating…</> : <><Play size={14} fill="currentColor"/> Run investigation</>}</button></div>
        </form>
        <div className="suggested-questions"><div className="subsection-label">TRY A STARTER QUESTION</div>{questions.map((q, i) => <button key={q} onClick={() => onTryQuestion(q)} className="suggested-question"><span className={`suggested-number suggested-${i}`}>{String(i + 1).padStart(2, '0')}</span><span>{q}</span><ArrowRight size={14}/></button>)}</div>
      </section>
      <section className="panel workflow-panel"><div className="panel-heading"><div><div className="panel-title">Investigation workflow</div><div className="panel-subtitle">A transparent, multi-step agent</div></div><span className="workflow-graph-icon"><GitBranch size={17}/></span></div>
        <div className="workflow-map">
          {[
            {icon: Sparkles, title: 'Plan question', desc: 'Identify product, time window and evidence needed', active: busy || Boolean(result)},
            {icon: Database, title: 'Query business metrics', desc: 'Read-only SQL for revenue, returns and ratings', active: busy || Boolean(result)},
            {icon: FileSearch, title: 'Retrieve consumer evidence', desc: 'Topic trends and review record references', active: busy || Boolean(result)},
            {icon: GitBranch, title: 'Reconcile signals', desc: 'Check changes and note evidence gaps', active: busy || Boolean(result)},
            {icon: FileText, title: 'Create action report', desc: 'Findings, limitations and reviewable next steps', active: Boolean(result)},
          ].map((step, i, arr) => (
            <div className={`workflow-step ${step.active ? 'step-active' : ''}`} key={step.title}>
              <div className="workflow-step-icon"><step.icon size={16}/>{step.active && <span><Check size={9}/></span>}</div>
              <div className="workflow-step-copy"><b>{step.title}</b><span>{step.desc}</span></div>
              {i < arr.length - 1 && <div className={`workflow-connector ${step.active ? 'connector-active' : ''}`}/>}
            </div>
          ))}
        </div>
        <div className="workflow-assurance"><div className="assurance-icon"><ShieldCheck size={17}/></div><div><b>Guardrails built in</b><p>Fixed SQL templates, read-only database tools, source references, and explicit limitations. The agent drafts actions; it does not execute business changes.</p></div></div>
        <div className="workflow-stack"><span><Database size={12}/> PostgreSQL</span><span><Code2 size={12}/> SQLGlot</span><span><GitBranch size={12}/> LangGraph</span><span><Sparkles size={12}/> Optional LLM</span></div>
      </section>
    </div>
    {busy && <section className="panel running-panel"><div className="running-spinner"><LoaderCircle size={22} className="spin"/></div><div><b>Investigating your question…</b><p>Running safe SQL queries, comparing review themes and assembling source evidence.</p></div><div className="running-bar"><span/></div></section>}
    {result && <InvestigationResult result={result}/>}
    {!result && !busy && <div className="investigator-footnote"><div className="footnote-icon"><CircleHelp size={16}/></div><span><b>What makes this agent different?</b> It computes numeric findings with SQL, retrieves source reviews independently, and only then prepares an explanation. Every report includes the queries, evidence and data limitations.</span></div>}
  </>;
}

function InvestigationResult({ result }: { result: Investigation }) {
  const [showSql, setShowSql] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const metrics = result.metrics || {};
  const curr = metrics.current || {};
  const prev = metrics.previous || {};
  return <section className="investigation-result" id="investigation-result">
    <div className="result-header"><div><div className="eyebrow"><CheckCircle2 size={13}/> INVESTIGATION COMPLETE <span className="result-id">{result.id ? `· REPORT #${result.id}` : ''}</span></div><h2>{result.title}</h2><p>{result.question}</p></div><div className="result-actions"><Tag tone="green">{result.mode || 'Evidence-first'}</Tag><button className="button-secondary" onClick={() => window.print()}><Download size={14}/> Export / print</button></div></div>
    <div className="result-summary-card"><div className="summary-icon"><Sparkles size={19}/></div><div><div className="summary-label">EXECUTIVE SUMMARY</div><p>{result.summary}</p><div className="summary-foot"><span><ShieldCheck size={13}/> {Math.round((result.confidence || 0) * 100)}% evidence coverage score</span><span><Clock3 size={13}/> {metrics.period?.start ? `${dateLabel(metrics.period.start)} – ${dateLabel(metrics.period.end)}` : `${result.period_days}-day comparison`}</span></div></div></div>
    <div className="result-metric-grid">{(result.findings || []).map((finding, i) => <div className="result-metric-card" key={finding.label}><span className="result-metric-label">{finding.label}</span><b>{finding.value}</b><p>{finding.detail}</p><span className={`result-metric-index result-index-${i}`}>{String(i + 1).padStart(2, '0')}</span></div>)}</div>
    <div className="result-two-col">
      <section className="panel result-panel"><div className="panel-heading"><div><div className="panel-title">Recommended next actions</div><div className="panel-subtitle">Prioritized suggestions — not automatic changes</div></div><Tag tone="amber">Human approval</Tag></div>
        <div className="action-list">{(result.recommended_actions || []).map((action: Action, index: number) => <div className="action-item" key={`${action.title}-${index}`}><span className={`action-priority priority-${action.priority.toLowerCase().replace(/[^a-z]/g, '-')}`}>{action.priority === 'High' ? <AlertCircle size={14}/> : action.priority === 'Medium' ? <Activity size={14}/> : <CheckCircle2 size={14}/>}</span><div className="action-copy"><div><b>{action.title}</b><Tag tone="neutral">{action.priority}</Tag></div><p>{action.detail}</p><span><ShieldCheck size={12}/> Requires human review</span></div></div>)}</div>
      </section>
      <section className="panel result-panel evidence-panel"><div className="panel-heading"><div><div className="panel-title">Consumer evidence</div><div className="panel-subtitle">Retrieved review records supporting the investigation</div></div><Tag>{result.citations?.length || 0} citations</Tag></div>
        {result.citations?.length ? <div className="evidence-list">{(showAllReviews ? result.citations : result.citations.slice(0, 4)).map((citation, i) => <div className="evidence-item" key={citation.id}><div className="evidence-item-top"><span className="evidence-ref">[R-{citation.id}]</span><span>{dateLabel(citation.date)}</span><span className="evidence-spacer"/><Stars rating={citation.rating}/></div><p>“{citation.text}”</p><div className="evidence-item-foot"><Tag>{citation.topic}</Tag><span>{citation.source}</span></div></div>)}{result.citations.length > 4 && <button className="text-link full-width-link" onClick={() => setShowAllReviews(!showAllReviews)}>{showAllReviews ? 'Show fewer reviews' : `Show ${result.citations.length - 4} more reviews`} <ArrowRight size={13}/></button>}</div> : <Empty icon={FileSearch} title="No reviews retrieved" detail="The report states this limitation instead of inventing consumer evidence."/>}
      </section>
    </div>
    <section className="panel sql-panel"><button className="sql-panel-trigger" onClick={() => setShowSql(!showSql)}><span className="sql-trigger-icon"><Code2 size={16}/></span><span><b>SQL transparency</b><small>{result.sql_queries?.length || 0} fixed, parameterized read-only SQL queries used for this report</small></span><span className="sql-spacer"/><Tag tone="green"><ShieldCheck size={12}/> Validated SELECT</Tag>{showSql ? <X size={16}/> : <ChevronDown size={16}/>}</button>
      {showSql && <div className="sql-query-list">{(result.sql_queries || []).map((q, i) => <div className="sql-query" key={q.title}><div className="sql-query-title"><span>QUERY {String(i + 1).padStart(2, '0')}</span><b>{q.title}</b></div><pre><code>{q.sql}</code></pre><div className="sql-param-note">Parameters are bound separately by SQLAlchemy; user input is never interpolated into SQL.</div></div>)}</div>}
    </section>
    <div className="limitations-card"><div className="limitations-icon"><AlertCircle size={17}/></div><div><b>Interpret with care</b><ul>{(result.limitations || []).map((limitation, i) => <li key={i}>{limitation}</li>)}</ul></div></div>
  </section>;
}

function ReportsPage({ reports, onOpen }: { reports: any[]; onOpen: (id: number) => void }) {
  return <>
    <PageHeading eyebrow="WORKSPACE / HISTORY" title="Saved investigations." description="Return to previous analyses, revisit evidence and keep business recommendations traceable." right={<Tag><FileText size={13}/>{reports.length} reports saved</Tag>} />
    <div className="reports-summary"><div className="reports-summary-icon"><Layers3 size={20}/></div><div><b>Your investigation history</b><p>Reports are stored in the connected database. Open a report to see the findings, citations, SQL queries and proposed actions captured at the time of analysis.</p></div></div>
    {reports.length ? <div className="report-grid">{reports.map((report, i) => <button className="report-card" key={report.id} onClick={() => onOpen(report.id)}><div className="report-card-top"><Avatar tone={['green', 'lavender', 'peach', 'blue'][i % 4]}><FileSearch size={16}/></Avatar><Tag tone="green">Saved report</Tag><span className="report-id">#{report.id}</span></div><h3>{report.title}</h3><p>{report.question}</p><div className="report-preview">{report.summary}</div><div className="report-card-foot"><span><Clock3 size={13}/>{report.created_at ? new Date(report.created_at).toLocaleString() : 'Saved investigation'}</span><span>Open report <ArrowRight size={13}/></span></div></button>)}</div> : <section className="panel no-reports"><Empty icon={FileText} title="No saved investigations yet" detail="Open the AI Investigator, ask a business question and save your first evidence-backed report."/><button className="button-primary" onClick={() => (window as any).__beautypulseNavigate?.('investigator')}><Sparkles size={15}/> Start an investigation</button></section>}
  </>;
}
