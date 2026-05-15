"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CheckCircle2, XCircle, MinusCircle, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

interface ProviderHealth {
  name: string;
  category: string;
  configured: boolean;
  reachable: boolean | null;
  status_code?: number;
  latency_ms?: number;
  notes?: string;
}

interface HealthResponse {
  summary: { total: number; configured: number; reachable: number; unreachable: number };
  providers: ProviderHealth[];
}

function StatusIcon({ p }: { p: ProviderHealth }) {
  if (!p.configured) return <MinusCircle className="h-4 w-4 text-muted-foreground/40" />;
  if (p.reachable === true) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (p.reachable === false) return <XCircle className="h-4 w-4 text-red-500" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground/40" />;
}

const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI",
  search: "Search",
  places: "Google APIs",
  scraper: "Direct scrapers",
  registry: "Public registries",
  enrichment: "Enrichment",
  db: "Database",
};

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData((await res.json()) as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped: Record<string, ProviderHealth[]> = {};
  for (const p of data?.providers ?? []) {
    grouped[p.category] = grouped[p.category] ?? [];
    grouped[p.category].push(p);
  }

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-emerald-500" /> Provider health
          </h1>
          <p className="text-sm text-muted-foreground">
            Reachability + latency across every provider in the stack.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Re-probe
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Probing providers…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">{error}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="rounded-xl border border-border/40 bg-card p-3">
              <div className="text-2xl font-bold tabular-nums">{data.summary.total}</div>
              <div className="text-xs text-muted-foreground">Tracked</div>
            </div>
            <div className="rounded-xl border border-border/40 bg-card p-3">
              <div className="text-2xl font-bold tabular-nums">{data.summary.configured}</div>
              <div className="text-xs text-muted-foreground">Configured</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-2xl font-bold tabular-nums text-emerald-600">{data.summary.reachable}</div>
              <div className="text-xs text-muted-foreground">Reachable</div>
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <div className="text-2xl font-bold tabular-nums text-red-600">{data.summary.unreachable}</div>
              <div className="text-xs text-muted-foreground">Failing</div>
            </div>
          </div>

          {Object.entries(grouped).map(([cat, providers]) => (
            <section key={cat} className="rounded-xl border border-border/40 bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border/30">
                <h3 className="text-sm font-semibold">{CATEGORY_LABELS[cat] ?? cat}</h3>
              </div>
              <div className="divide-y divide-border/30">
                {providers.map((p) => (
                  <div key={p.name} className="flex items-center gap-3 px-4 py-2">
                    <StatusIcon p={p} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.notes && (
                        <div className="text-xs text-muted-foreground truncate">{p.notes}</div>
                      )}
                    </div>
                    {p.status_code != null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                        p.status_code >= 200 && p.status_code < 300 ? "bg-emerald-500/10 text-emerald-600"
                        : p.status_code === 429 ? "bg-amber-500/10 text-amber-600"
                        : "bg-red-500/10 text-red-600"
                      }`}>{p.status_code}</span>
                    )}
                    {p.latency_ms != null && (
                      <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                        {p.latency_ms} ms
                      </span>
                    )}
                    {!p.configured && (
                      <span className="text-xs text-muted-foreground/60">not configured</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
