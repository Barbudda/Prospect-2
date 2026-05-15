"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Network,
  Loader2,
  AlertCircle,
  Phone,
  Globe,
  ArrowRight,
  Layers,
  MapPin,
  RefreshCw,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface OperatorCluster {
  cluster_key: string;
  match_type: "siret" | "phone" | "domain" | "email_domain" | "company_name";
  confidence: "high" | "medium" | "low";
  lead_count: number;
  lead_ids: string[];
  representative: {
    id: string;
    primary_name: string;
    city: string;
    score: number;
    phone?: string;
    email?: string;
    website_url?: string;
  };
  cities: string[];
  total_score: number;
  evidence: string[];
}

interface ApiResponse {
  total_leads_analysed: number;
  clusters_found: number;
  clusters: OperatorCluster[];
  error?: string;
}

const MATCH_TYPE_LABEL: Record<OperatorCluster["match_type"], string> = {
  siret: "SIRET match",
  phone: "Same phone",
  domain: "Same website",
  email_domain: "Same email domain",
  company_name: "Same brand name",
};

const CONFIDENCE_COLOR: Record<OperatorCluster["confidence"], string> = {
  high: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

export default function OperatorsPage() {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clusters");
      const body = (await res.json()) as ApiResponse;
      if (!res.ok || body.error) {
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between pt-2">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Network className="h-4 w-4" />
            Operator Intelligence
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Hidden Operator Detector</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Groups your leads that share a phone, website, email domain, or brand name —
            revealing multi-property operators behind individual listings.
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Failed to load clusters</p>
            <p className="mt-1 text-red-500/80">{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4 text-center">
              <div className="text-2xl font-bold tabular-nums">{data.total_leads_analysed}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Leads analysed</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
              <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {data.clusters_found}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Operators detected</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <div className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {data.clusters.reduce((s, c) => s + c.lead_count, 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Listings clustered</div>
            </div>
          </div>

          {data.clusters.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              No multi-property operators detected yet. Run a few more searches and come back.
            </div>
          ) : (
            <div className="space-y-3">
              {data.clusters.map((cluster) => {
                const key = `${cluster.match_type}:${cluster.cluster_key}`;
                const isOpen = expanded.has(key);
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden"
                  >
                    <button
                      onClick={() => toggleExpanded(key)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-emerald-600" />
                        <span className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {cluster.lead_count}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">
                            {cluster.representative.primary_name}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                              CONFIDENCE_COLOR[cluster.confidence]
                            }`}
                          >
                            {cluster.confidence}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                            {MATCH_TYPE_LABEL[cluster.match_type]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          {cluster.cities.length > 0 && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {cluster.cities.slice(0, 3).join(", ")}
                              {cluster.cities.length > 3 && ` +${cluster.cities.length - 3}`}
                            </span>
                          )}
                          {cluster.representative.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {cluster.representative.phone}
                            </span>
                          )}
                          {cluster.representative.website_url && (
                            <span className="flex items-center gap-1 truncate max-w-[200px]">
                              <Globe className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">
                                {cluster.representative.website_url.replace(/^https?:\/\//, "")}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border/40 px-4 py-3 space-y-2 bg-muted/10">
                        {cluster.evidence.length > 0 && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Evidence: </span>
                            {cluster.evidence.join(" · ")}
                          </div>
                        )}
                        <div className="text-xs font-medium text-muted-foreground pt-1">
                          {cluster.lead_count} clustered listings:
                        </div>
                        <div className="space-y-1">
                          {cluster.lead_ids.map((id) => (
                            <button
                              key={id}
                              onClick={() => router.push(`/leads/${id}`)}
                              className="w-full text-left flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-background border border-transparent hover:border-border/40 transition-colors"
                            >
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono text-muted-foreground">
                                {id.slice(0, 8)}
                              </span>
                              <span className="truncate">
                                {id === cluster.representative.id
                                  ? `${cluster.representative.primary_name} (representative)`
                                  : "(open to view)"}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="pt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="text-xs gap-1.5"
                            onClick={() => router.push(`/leads/${cluster.representative.id}`)}
                          >
                            <ArrowRight className="h-3 w-3" />
                            Open representative
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
