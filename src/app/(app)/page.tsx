"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Search, AlertTriangle, Zap, Globe, Mail, Building2, ChevronDown, History, ChevronRight, MapPin } from "lucide-react";
import type { RunStatus } from "@/lib/types";

interface ProviderStatus {
  name: string;
  type: string;
  status: "configured" | "missing_key" | "failing" | "disabled";
}

interface RecentRun {
  id: string;
  city: string;
  country: string;
  status: RunStatus;
  lead_count: number;
  created_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("France");
  const [targetType, setTargetType] = useState("all");
  const [requestedLeads, setRequestedLeads] = useState("50");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [enableLocalBusiness, setEnableLocalBusiness] = useState(true);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [enableExtraction, setEnableExtraction] = useState(true);
  const [enableEnrichment, setEnableEnrichment] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [stats, setStats] = useState({ total_leads: 0, completed_runs: 0, leads_with_email: 0, hot_leads: 0, leads_contacted: 0, outreach_generated: 0 });

  useEffect(() => {
    fetch("/api/providers/status")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => {});
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setStats({
        total_leads: d.total_leads ?? 0,
        completed_runs: d.completed_runs ?? 0,
        leads_with_email: d.leads_with_email ?? 0,
        hot_leads: d.hot_leads ?? 0,
        leads_contacted: d.leads_contacted ?? 0,
        outreach_generated: d.outreach_generated ?? 0,
      }))
      .catch(() => {});
    fetch("/api/runs?limit=5")
      .then((r) => r.json())
      .then((d) => setRecentRuns(d.runs ?? []))
      .catch(() => {});
  }, []);

  const hasSearchProvider = providers.some(
    (p) =>
      (p.type === "search" || p.type === "local_business") &&
      p.status === "configured"
  );

  const configuredProviders = providers.filter((p) => p.status === "configured");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim()) {
      toast.error("Please enter a city");
      return;
    }

    setLoading(true);
    try {
      const createRes = await fetch("/api/runs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          country: country.trim(),
          targetType,
          requestedLeads: parseInt(requestedLeads, 10),
          config: {
            enableLocalBusiness,
            enableWebSearch,
            enableContactExtraction: enableExtraction,
            enableEnrichment,
          },
        }),
      });

      const createBody = await createRes.text();
      let createData: { run_id?: string; error?: string } = {};
      try { createData = JSON.parse(createBody); } catch { /* non-JSON error page */ }

      if (!createRes.ok) {
        throw new Error(createData.error ?? `Server error ${createRes.status}`);
      }
      if (!createData.run_id) {
        throw new Error("Server returned no run ID");
      }
      const run_id = createData.run_id;

      fetch(`/api/runs/${run_id}/start`, { method: "POST" }).catch(() => {});
      router.push(`/runs/${run_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start search");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero */}
      <div className="text-center pt-8 pb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-5">
          <Zap className="h-3 w-3" />
          Automated B2B Lead Discovery
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
          Find Airbnb Leads
        </h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
          Automatically discover contactable Airbnb-related B2B prospects — concierges, property managers, and vacation rental agencies.
        </p>

        {/* Active providers strip */}
        {configuredProviders.length > 0 && (
          <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
            {configuredProviders.slice(0, 4).map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {p.name}
              </span>
            ))}
            {configuredProviders.length > 4 && (
              <span className="text-xs text-muted-foreground">
                +{configuredProviders.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats cards — only show once user has data */}
      {stats.total_leads > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-2">
          {[
            { label: "Total Leads", value: stats.total_leads.toLocaleString(), href: "/leads" },
            { label: "With Email", value: stats.leads_with_email.toLocaleString(), href: "/leads?has_email=true" },
            { label: "Hot Leads", value: stats.hot_leads.toLocaleString(), href: "/leads?score_label=Hot" },
            { label: "Runs Done", value: stats.completed_runs.toLocaleString(), href: "/runs" },
            { label: "Contacted", value: stats.leads_contacted.toLocaleString(), href: "/leads?outreach_status=contacted" },
            { label: "AI Emails", value: stats.outreach_generated.toLocaleString(), href: "/leads" },
          ].map((s) => (
            <Link key={s.label} href={s.href} className="rounded-xl border border-border/60 bg-card px-4 py-3 text-center hover:bg-muted/30 transition-colors">
              <div className="text-2xl font-bold tracking-tight">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Warning: no provider */}
      {!hasSearchProvider && providers.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 px-4 py-3 mb-5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200 leading-snug">
            No search provider configured.{" "}
            <a href="/settings" className="font-semibold underline underline-offset-2">
              Add one in Settings →
            </a>
          </p>
        </div>
      )}

      {/* Main form card */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Card header strip */}
        <div className="px-6 pt-5 pb-4 border-b border-border/60">
          <h2 className="font-semibold text-sm text-foreground">Search Parameters</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Define your target market and lead count</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* City / Country row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="city" className="text-xs font-medium">
                City / Area <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  id="city"
                  placeholder="e.g. Biarritz"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country" className="text-xs font-medium">
                Country <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  id="country"
                  placeholder="e.g. France"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  required
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          {/* Type / Count row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> Target Type
              </Label>
              <Select value={targetType} onValueChange={(v: string | null) => { if (v) setTargetType(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Airbnb-related</SelectItem>
                  <SelectItem value="concierges">Concierge Services</SelectItem>
                  <SelectItem value="property_managers">Property Managers</SelectItem>
                  <SelectItem value="direct_owners">Direct Booking Owners</SelectItem>
                  <SelectItem value="agencies">Vacation Rental Agencies</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <Mail className="h-3 w-3" /> Number of Leads
              </Label>
              <Select value={requestedLeads} onValueChange={(v: string | null) => { if (v) setRequestedLeads(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 leads</SelectItem>
                  <SelectItem value="50">50 leads</SelectItem>
                  <SelectItem value="100">100 leads</SelectItem>
                  <SelectItem value="250">250 leads</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Advanced sources */}
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <span>Advanced Sources</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
            </button>
            {showAdvanced && (
              <div className="border-t border-border/60 px-4 py-3 bg-muted/20 grid grid-cols-2 gap-2.5">
                {[
                  { id: "local", label: "Local Business Search", value: enableLocalBusiness, set: setEnableLocalBusiness },
                  { id: "web", label: "Web Search Discovery", value: enableWebSearch, set: setEnableWebSearch },
                  { id: "extraction", label: "Website Contact Extraction", value: enableExtraction, set: setEnableExtraction },
                  { id: "enrichment", label: "Enrichment APIs", value: enableEnrichment, set: setEnableEnrichment },
                ].map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Checkbox
                      id={item.id}
                      checked={item.value}
                      onCheckedChange={(v) => item.set(Boolean(v))}
                      className="h-3.5 w-3.5"
                    />
                    <label htmlFor={item.id} className="text-xs text-muted-foreground cursor-pointer select-none">
                      {item.label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full h-10 font-semibold text-sm shadow-sm bg-primary hover:bg-primary/90 transition-all"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                Starting search...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5" />
                Find Leads
              </span>
            )}
          </Button>
        </form>

        {/* Compliance footer */}
        <div className="px-6 py-3 border-t border-border/60 bg-muted/20">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium">Compliance:</span> Collects only publicly available business information for professional B2B outreach. Use in accordance with GDPR, CCPA, and applicable data protection regulations.
          </p>
        </div>
      </div>

      {/* Recent Runs */}
      {recentRuns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              Recent Runs
            </h2>
            <Link href="/runs" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          </div>
          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60">
            {recentRuns.map((run) => {
              return (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
                >
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{run.city}, {run.country}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {run.lead_count > 0 && (
                      <span className="text-xs font-medium text-foreground">
                        {run.lead_count} leads
                      </span>
                    )}
                    <Badge
                      variant={run.status === "completed" ? "outline" : run.status === "failed" ? "destructive" : "secondary"}
                      className="text-[10px] capitalize"
                    >
                      {run.status}
                    </Badge>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-12" />
    </div>
  );
}
