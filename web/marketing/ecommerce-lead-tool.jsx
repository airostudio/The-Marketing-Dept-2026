import React, { useMemo, useState } from 'react';

const regions = ['All', 'North America', 'Europe', 'Asia-Pacific', 'Latin America', 'Middle East & Africa'];
const platforms = ['All', 'Shopify', 'WooCommerce'];
const csvHeaders = ['domain', 'platform', 'region', 'country', 'category', 'monthlyVisits', 'employeeBand', 'score', 'ownerPath', 'pain', 'compliance'];

function filterLeads(leads, filters) {
  const platform = filters.platform || 'All';
  const region = filters.region || 'All';
  const query = (filters.query || '').trim().toLowerCase();
  const minScore = Number(filters.minScore ?? 0);

  return leads
    .filter((lead) => platform === 'All' || lead.platform === platform)
    .filter((lead) => region === 'All' || lead.region === region)
    .filter((lead) => lead.score >= minScore)
    .filter((lead) => {
      if (!query) return true;
      const haystack = `${lead.domain} ${lead.country} ${lead.category} ${lead.signals.join(' ')}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.score - a.score);
}

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(leads, headers = csvHeaders) {
  const rows = leads.map((lead) => headers.map((key) => escapeCsvValue(lead[key])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function Icon({ children }) {
  return <span className="inline-flex h-6 w-6 items-center justify-center text-lg leading-none">{children}</span>;
}

function Card({ children, className = '' }) {
  return <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

function Button({ children, onClick, variant = 'solid', className = '' }) {
  const base = 'inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-medium transition active:scale-[0.99]';
  const styles = variant === 'outline'
    ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
    : 'bg-slate-950 text-white hover:bg-slate-800';
  return <button type="button" onClick={onClick} className={`${base} ${styles} ${className}`}>{children}</button>;
}

export default function EcommerceLeadTool({ leads = [], onOutreachBrief }) {
  const [platform, setPlatform] = useState('All');
  const [region, setRegion] = useState('All');
  const [query, setQuery] = useState('');
  const [minScore, setMinScore] = useState(70);

  const filtered = useMemo(() => {
    return filterLeads(leads, { platform, region, query, minScore });
  }, [leads, platform, region, query, minScore]);

  const exportCsv = () => {
    const csv = buildCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ecommerce-platform-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const topScore = filtered.length ? Math.max(...filtered.map((lead) => lead.score)) : 0;
  const countries = new Set(filtered.map((lead) => lead.country)).size;

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                <Icon>🛒</Icon> Regional ecommerce lead finder
              </div>
              <h1 className="text-3xl font-semibold tracking-tight lg:text-5xl">Shopify &amp; WooCommerce owner targeting tool</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                Segment ecommerce stores by platform, geography, intent signals, and likely business pain. Built for compliant B2B outreach, account-based ads, and agency sales qualification.
              </p>
            </div>
            <Button onClick={exportCsv} className="text-base" disabled={filtered.length === 0}>
              <span className="mr-2">⬇️</span> Export filtered CSV
            </Button>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-4">
          <Card className="lg:col-span-1">
            <div className="space-y-5 p-5">
              <div className="flex items-center gap-2 text-lg font-semibold"><Icon>🔎</Icon> Filters</div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
                <div className="flex items-center rounded-2xl border bg-white px-3 py-2">
                  <span className="text-slate-400">⌕</span>
                  <input
                    className="ml-2 w-full bg-transparent outline-none"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="beauty, Stripe, Australia..."
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Platform</label>
                <select className="w-full rounded-2xl border bg-white p-3" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {platforms.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Region</label>
                <select className="w-full rounded-2xl border bg-white p-3" value={region} onChange={(e) => setRegion(e.target.value)}>
                  {regions.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Minimum lead score: {minScore}</label>
                <input className="w-full" type="range" min="50" max="100" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
              </div>

              <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <div className="font-semibold">⚠️ Compliance mode</div>
                This tool avoids personal-email scraping. Use business contact routes, ads audiences, partner directories, and opt-out-safe B2B outreach.
              </div>
            </div>
          </Card>

          <main className="space-y-4 lg:col-span-3">
            <div className="grid gap-4 md:grid-cols-3">
              <Card><div className="p-5"><div className="mb-3 text-2xl">🌍</div><div className="text-2xl font-semibold">{filtered.length}</div><div className="text-sm text-slate-600">qualified accounts</div></div></Card>
              <Card><div className="p-5"><div className="mb-3 text-2xl">🏢</div><div className="text-2xl font-semibold">{countries}</div><div className="text-sm text-slate-600">countries represented</div></div></Card>
              <Card><div className="p-5"><div className="mb-3 text-2xl">⭐</div><div className="text-2xl font-semibold">{topScore}</div><div className="text-sm text-slate-600">top lead score</div></div></Card>
            </div>

            {leads.length === 0 && (
              <Card>
                <div className="p-8 text-center text-slate-600">No leads loaded. Connect a data source to populate the table.</div>
              </Card>
            )}

            {leads.length > 0 && filtered.length === 0 && (
              <Card>
                <div className="p-8 text-center text-slate-600">No accounts match the current filters. Lower the score threshold or broaden the region/platform.</div>
              </Card>
            )}

            {filtered.map((lead) => (
              <Card key={lead.domain} className="transition hover:shadow-md">
                <div className="p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold">{lead.domain}</h2>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{lead.platform}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">Score {lead.score}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span>📍 {lead.country}, {lead.region}</span>
                        <span>{lead.category}</span>
                        <span>{lead.monthlyVisits.toLocaleString()} est. monthly visits</span>
                        <span>{lead.employeeBand} employees</span>
                      </div>
                    </div>
                    {onOutreachBrief && (
                      <Button variant="outline" onClick={() => onOutreachBrief(lead)}>✉️ Build outreach brief</Button>
                    )}
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="mb-2 font-medium">Detection signals</div>
                      <div className="flex flex-wrap gap-2">
                        {lead.signals.map((signal) => <span key={signal} className="rounded-full bg-white px-2 py-1 text-xs shadow-sm">{signal}</span>)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="mb-2 font-medium">Likely pitch angle</div>
                      <p className="text-sm leading-6 text-slate-600">{lead.pain}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="mb-2 font-medium">✅ Owner targeting path</div>
                      <p className="text-sm leading-6 text-slate-600">{lead.ownerPath}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{lead.compliance}</p>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}
