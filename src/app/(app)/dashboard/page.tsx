"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, ArrowRight, Network, MapPin, TrendingUp, Sparkles, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

interface DashboardData {
  generated_at: string;
  coverage: {
    total: number;
    with_phone: number;
    with_email: number;
    with_website: number;
    reconstructed: number;
    no_website_high_score: number;
  };
  compliance: {
    total: number;
    not_contacted: number;
    contacted: number;
    replied: number;
    converted: number;
    opted_out: number;
    unsubscribed: number;
    missing_contact: number;
  };
  top_leads: Array<{
    id: string;
    name: string;
    city: string;
    score: number;
    score_label?: string;
    lead_type?: string;
    has_phone: boolean;
    has_email: boolean;
  }>;
  city_ranking: Array<{
    city: string;
    lead_count: number;
    avg_score: number;
    top_3: Array<{ id: string; name: string; score: number; score_label?: string }>;
  }>;
  operator_clusters: Array<{
    cluster_key: string;
    match_type: string;
    confidence: string;
    lead_count: number;
    representative: { id: string; primary_name: string; city: string; score: number };
    cities: string[];
  }>;
  multi_property_operators: Array<{
    id: string;
    name: string;
    city: string;
    estimated_property_count: number;
    score: number;
  }>;
  revenue_upside_no_website: Array<{
    id: string;
    name: string;
    city: string;
    score: number;
    has_phone: boolean;
    lead_type?: string;
  }>;
  top_weird_signals: Array<{
    code: string;
    severity: string;
    count: number;
    description: string;
  }>;
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 border-red-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-blue-500/10 text-blue-600 border-blue-500/30",
};

const SCORE_LABEL_COLORS: Record<string, string> = {
  Hot: "bg-red-500/15 text-red-600",
  Good: "bg-amber-500/15 text-amber-600",
  Medium: "bg-blue-500/15 text-blue-600",
  Weak: "bg-muted text-muted-foreground",
};

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      <div className={`text-3xl font-bold tabular-nums ${color ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setData((await res.json()) as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Aggregating signals across your leads…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
        <AlertCircle className="h-4 w-4 inline mr-2" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Intelligence Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Cross-portfolio view across {data.coverage.total} leads · generated{" "}
            {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Coverage */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Coverage</h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Total leads" value={data.coverage.total} />
          <StatCard label="With phone" value={data.coverage.with_phone} color="text-emerald-600" />
          <StatCard label="With email" value={data.coverage.with_email} color="text-blue-600" />
          <StatCard label="With website" value={data.coverage.with_website} />
          <StatCard label="Visual reconstruction" value={data.coverage.reconstructed} color="text-violet-600" />
          <StatCard label="No-website, high score" value={data.coverage.no_website_high_score} color="text-amber-600" />
        </div>
      </section>

      {/* Compliance */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" /> Compliance health
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Not contacted" value={data.compliance.not_contacted} />
          <StatCard label="Contacted" value={data.compliance.contacted} color="text-blue-600" />
          <StatCard label="Replied" value={data.compliance.replied} color="text-emerald-600" />
          <StatCard label="Converted" value={data.compliance.converted} color="text-emerald-600" />
          <StatCard label="Opted-out / DNC" value={data.compliance.opted_out + data.compliance.unsubscribed} color="text-red-600" />
          <StatCard label="No contact data" value={data.compliance.missing_contact} color="text-muted-foreground" />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top leads */}
        <section className="rounded-xl border border-border/40 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h3 className="font-semibold text-sm">Top leads by score</h3>
          </div>
          <div className="divide-y divide-border/30">
            {data.top_leads.map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="text-lg font-bold tabular-nums w-10">{l.score}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{l.name}</span>
                    {l.score_label && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SCORE_LABEL_COLORS[l.score_label] ?? ""}`}>
                        {l.score_label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.city} · {l.lead_type ?? ""} {l.has_phone ? "· 📞" : ""} {l.has_email ? "· ✉" : ""}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
            {data.top_leads.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">No leads yet.</div>
            )}
          </div>
        </section>

        {/* Operator clusters */}
        <section className="rounded-xl border border-border/40 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
            <Network className="h-4 w-4 text-violet-600" />
            <h3 className="font-semibold text-sm">Hidden operators (clusters)</h3>
          </div>
          <div className="divide-y divide-border/30">
            {data.operator_clusters.slice(0, 8).map((c) => (
              <Link
                key={`${c.match_type}:${c.cluster_key}`}
                href={`/leads/${c.representative.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="text-2xl font-bold tabular-nums w-12 text-violet-600">
                  {c.lead_count}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.representative.primary_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Match: <span className="font-mono">{c.match_type}</span> · {c.confidence} confidence
                    {c.cities.length > 1 && ` · ${c.cities.length} cities`}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
            {data.operator_clusters.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No clusters yet — gather more leads to detect hidden operators.
              </div>
            )}
            {data.operator_clusters.length > 8 && (
              <Link href="/operators" className="block px-4 py-2 text-xs text-violet-600 hover:underline text-center">
                See all {data.operator_clusters.length}+ clusters →
              </Link>
            )}
          </div>
        </section>

        {/* Revenue upside */}
        <section className="rounded-xl border border-border/40 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <h3 className="font-semibold text-sm">Revenue upside (no website, high score)</h3>
          </div>
          <div className="divide-y divide-border/30">
            {data.revenue_upside_no_website.slice(0, 8).map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="text-lg font-bold tabular-nums w-10 text-amber-600">{l.score}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.city} · {l.lead_type ?? ""}
                    {l.has_phone && " · 📞 reachable"}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
            {data.revenue_upside_no_website.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">No matches yet.</div>
            )}
          </div>
        </section>

        {/* City ranking */}
        <section className="rounded-xl border border-border/40 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            <h3 className="font-semibold text-sm">Best cities</h3>
          </div>
          <div className="divide-y divide-border/30">
            {data.city_ranking.slice(0, 8).map((c) => (
              <div key={c.city} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.city}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.lead_count} leads · avg {c.avg_score}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {c.top_3.map((t) => (
                    <Link
                      key={t.id}
                      href={`/leads/${t.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {t.name} ({t.score})
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {data.city_ranking.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">No data.</div>
            )}
          </div>
        </section>
      </div>

      {/* Weird signals */}
      <section className="rounded-xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="font-semibold text-sm">Portfolio-level weird signals</h3>
          <p className="text-xs text-muted-foreground">
            How often each opportunity signal fires across your leads.
          </p>
        </div>
        <div className="divide-y divide-border/30">
          {data.top_weird_signals.map((s) => (
            <div key={s.code} className="flex items-start gap-3 px-4 py-2.5">
              <div className="text-2xl font-bold tabular-nums w-12 text-right">{s.count}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${SEVERITY_COLORS[s.severity]}`}>
                    {s.severity}
                  </span>
                  <code className="text-xs font-mono">{s.code}</code>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
              </div>
            </div>
          ))}
          {data.top_weird_signals.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No weird signals detected yet. Run more discovery.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
