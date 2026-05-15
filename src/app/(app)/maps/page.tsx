"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Map,
  MapPin,
  Loader2,
  Phone,
  Globe,
  ExternalLink,
  AlertCircle,
  ArrowRight,
  Building2,
  Star,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export const dynamic = "force-dynamic";

interface MapsLead {
  id?: string;
  primary_name: string;
  lead_type: string;
  city: string;
  address?: string;
  phone?: string;
  website_url?: string;
  google_maps_url?: string;
  score: number;
  score_label: string;
}

interface ApiResponse {
  saved: number;
  duplicates_skipped?: number;
  total_found: number;
  queries_used: string[];
  skipped_no_contact: number;
  skipped_invalid_phone: number;
  leads: MapsLead[];
  info?: string;
  error?: string;
}

const SCORE_COLORS: Record<string, string> = {
  Hot: "bg-red-500/15 text-red-600",
  Good: "bg-amber-500/15 text-amber-600",
  Medium: "bg-blue-500/15 text-blue-600",
  Weak: "bg-muted text-muted-foreground",
};

export default function MapsProspectPage() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("France");
  const [maxLeads, setMaxLeads] = useState(25);
  const [enrichCadastre, setEnrichCadastre] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");

  async function handleScan() {
    if (!city.trim()) {
      toast.error("Enter a city");
      return;
    }
    setStatus("running");
    setResult(null);
    setError("");

    try {
      const res = await fetch("/api/maps-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          country,
          max_leads: maxLeads,
          enrich_cadastre: enrichCadastre,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? "Scan failed");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
      if (data.saved > 0) {
        toast.success(`${data.saved} new leads saved`);
      } else if ((data.duplicates_skipped ?? 0) > 0) {
        toast.info(`All ${data.duplicates_skipped} results already in your leads`);
      } else {
        toast.info(data.info ?? "No new operators found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setStatus("error");
    }
  }

  const withPhone = result?.leads.filter((l) => l.phone).length ?? 0;
  const withWebsite = result?.leads.filter((l) => l.website_url).length ?? 0;
  const noWebsite = result?.leads.filter((l) => !l.website_url).length ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Map className="h-3.5 w-3.5" />
          Maps Prospect
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Find STR operators pinned on Google Maps
          <br />
          <span className="text-muted-foreground font-normal">
            verified phones, instant results
          </span>
        </h1>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Paris, Nice, Bordeaux…"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={status === "running"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleScan();
                }}
              />
            </div>
          </div>
          <div className="w-32 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country</label>
            <Input
              placeholder="France"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={status === "running"}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Max operators to fetch
          </label>
          <div className="flex gap-2">
            {[10, 25, 50].map((n) => (
              <button
                key={n}
                onClick={() => setMaxLeads(n)}
                disabled={status === "running"}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                  maxLeads === n
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {n} operators
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={enrichCadastre}
            onChange={(e) => setEnrichCadastre(e.target.checked)}
            disabled={status === "running"}
            className="rounded"
          />
          <span className="text-muted-foreground">
            Enrich with IGN Cadastre (France only — slower, adds cadastral reference)
          </span>
        </label>

        <Button
          onClick={handleScan}
          disabled={status === "running"}
          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          size="lg"
        >
          {status === "running" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning Google Maps in {city || "city"}…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Scan {city || "city"} on Google Maps
            </>
          )}
        </Button>
      </div>

      {/* Error */}
      {status === "error" && error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Scan failed</p>
            <p className="mt-1 text-red-500/80">{error}</p>
          </div>
        </div>
      )}

      {/* Results header */}
      {status === "done" && result && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
              <div className="text-2xl font-bold tabular-nums">{result.saved}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Saved</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-emerald-600">{withPhone}</div>
              <div className="text-xs text-muted-foreground mt-0.5">With phone</div>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-blue-600">{withWebsite}</div>
              <div className="text-xs text-muted-foreground mt-0.5">With website</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-amber-600">{noWebsite}</div>
              <div className="text-xs text-muted-foreground mt-0.5">No website</div>
            </div>
          </div>

          {(result.duplicates_skipped ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground text-center">
              Skipped {result.duplicates_skipped} duplicates · {result.skipped_no_contact} had no contact ·{" "}
              {result.skipped_invalid_phone} had invalid phone format
            </div>
          )}

          {/* Results list */}
          {result.leads.length > 0 ? (
            <div className="space-y-2">
              {result.leads.map((l, i) => (
                <div
                  key={l.id ?? i}
                  className="rounded-xl border border-border/60 bg-card shadow-sm p-4 space-y-2"
                >
                  <div className="flex items-start gap-3 justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            SCORE_COLORS[l.score_label] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {l.score_label}
                        </span>
                        <span className="font-semibold text-sm">{l.primary_name}</span>
                        {!l.website_url && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            No website
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {l.lead_type}
                        </span>
                        {l.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {l.address}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-bold tabular-nums">{l.score}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    {l.phone ? (
                      <a
                        href={`tel:${l.phone}`}
                        className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {l.phone}
                      </a>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted-foreground/50 text-xs">
                        <Phone className="h-3.5 w-3.5" />
                        No phone
                      </span>
                    )}
                    {l.website_url && (
                      <a
                        href={l.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-blue-600 hover:underline truncate max-w-[200px]"
                      >
                        <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{l.website_url.replace(/^https?:\/\//, "")}</span>
                      </a>
                    )}
                    {l.google_maps_url && (
                      <a
                        href={l.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Map className="h-3 w-3" />
                        Maps
                      </a>
                    )}
                    {l.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 text-xs gap-1"
                        onClick={() => router.push(`/leads/${l.id}`)}
                      >
                        <ArrowRight className="h-3 w-3" />
                        Open
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              {result.info ?? "No operators matched."}
            </div>
          )}

          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/leads?sort=newest")}>
              View all leads
            </Button>
          </div>
        </>
      )}

      {/* Idle hint */}
      {status === "idle" && (
        <div className="text-center space-y-4 py-4">
          <div className="inline-grid grid-cols-3 gap-3 text-xs text-muted-foreground max-w-md mx-auto">
            {[
              { icon: Map, text: "Scans Google Places for STR operators" },
              { icon: Phone, text: "Pulls verified phone numbers" },
              { icon: Building2, text: "Cadastre cross-reference (FR)" },
            ].map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-muted/30"
              >
                <Icon className="h-5 w-5 text-emerald-500" />
                <span className="text-center leading-tight">{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
