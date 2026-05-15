"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, Handshake, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface PartnerHit {
  id: string;
  name: string;
  city?: string | null;
  score?: number | null;
  role: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  has_contact: boolean;
}

interface PartnerGroup {
  role: string;
  count: number;
  partners: PartnerHit[];
}

interface ApiResponse {
  total_partners: number;
  groups: PartnerGroup[];
}

const ROLE_LABELS: Record<string, string> = {
  cleaning: "Cleaning",
  photography: "Photography",
  linen: "Linen",
  interior_design: "Interior Design",
  smart_lock: "Smart Locks",
  pool_maintenance: "Pool Maintenance",
  real_estate_agent: "Real Estate Agents",
  concierge_company: "Concierge Companies (may compete or refer)",
  tourism_office: "Tourism Offices",
  legal_accounting: "Legal / Accounting",
  insurance: "Insurance",
};

const ROLE_OFFERS: Record<string, string> = {
  cleaning: "Co-branded cleaning-quality audit + revenue share for referred owners.",
  photography: "Free listing-photo grader → photographer gets new gigs, you get owners.",
  linen: "Joint hospitality-quality kit; linen partner introduces owners to you for direct-booking.",
  interior_design: "ROI-focused interior staging report; partner refers high-end owners.",
  smart_lock: "Hardware install + your guest-messaging stack — bundle the offer.",
  pool_maintenance: "Luxury villa pipeline — partner sees you as a value-add for their clients.",
  real_estate_agent: "Sale of furnished tourist property includes your direct-booking setup.",
  concierge_company: "Lead-sharing arrangement OR competitor — clarify positioning before pitching.",
  tourism_office: "Co-brand a 'professionalisation' workshop for newly registered furnished rentals.",
  legal_accounting: "LMNP / furnished-rental accountants forward owners needing operational setup.",
  insurance: "STR-specific insurance brokers pre-qualify operators who care about compliance.",
};

const CONF_COLORS: Record<string, string> = {
  high: "border-emerald-500/40 text-emerald-600",
  medium: "border-amber-500/40 text-amber-600",
  low: "border-border text-muted-foreground",
};

export default function PartnersPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/partners");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setData((await res.json()) as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data)
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Classifying leads as partners or targets…
      </div>
    );

  if (error)
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
        <AlertCircle className="h-4 w-4 inline mr-2" />
        {error}
      </div>
    );

  if (!data) return null;

  return (
    <div className="space-y-6 pb-12 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Handshake className="h-6 w-6 text-emerald-500" />
            Partner network
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.total_partners} potential partner{data.total_partners === 1 ? "" : "s"} detected across your leads. Sell to operators; partner with these.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data.groups.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No partners detected yet. Run more discovery on cleaning, photography, smart-lock, or interior-design queries.
        </div>
      ) : (
        <div className="space-y-4">
          {data.groups.map((g) => (
            <section
              key={g.role}
              className="rounded-xl border border-border/40 bg-card overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{ROLE_LABELS[g.role] ?? g.role}</h3>
                  <p className="text-xs text-muted-foreground">{g.count} candidate{g.count === 1 ? "" : "s"}</p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Confidence varies
                </span>
              </div>

              {ROLE_OFFERS[g.role] && (
                <div className="px-4 py-2 bg-emerald-500/5 border-b border-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-400">
                  <span className="font-semibold">Partnership play: </span>
                  {ROLE_OFFERS[g.role]}
                </div>
              )}

              <div className="divide-y divide-border/30">
                {g.partners.map((p) => (
                  <Link
                    key={p.id}
                    href={`/leads/${p.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${CONF_COLORS[p.confidence]}`}>
                          {p.confidence}
                        </span>
                        {!p.has_contact && (
                          <span className="text-[10px] text-muted-foreground">no contact</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.city ?? "—"} · score {p.score ?? 0} · {p.reasoning}
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
