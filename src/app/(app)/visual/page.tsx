"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  ScanSearch,
  CheckCircle2,
  Circle,
  Loader2,
  MapPin,
  Globe,
  Mail,
  Phone,
  Building2,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  AlertCircle,
  ArrowRight,
  Star,
  Users,
  StopCircle,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

// ─── Pipeline steps (single mode) ────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: "extract",    label: "Image Extraction",      detail: "Fetching listing photos",                              delay: 1500  },
  { key: "vision",     label: "Google Vision AI",       detail: "Detecting objects, labels, OCR text",                  delay: 4000  },
  { key: "mammouth1",  label: "Mammouth Analysis",      detail: "Generating property semantic profile",                 delay: 7000  },
  { key: "geo",        label: "Geo Hypothesis",         detail: "Generating location candidates",                       delay: 10000 },
  { key: "streetview", label: "Street View Matching",   detail: "Computing visual similarity score",                    delay: 16000 },
  { key: "places",     label: "Place & Business Match", detail: "Searching nearby operators",                           delay: 21000 },
  { key: "cadastre",   label: "IGN Cadastre",           detail: "Identifying cadastral parcel",                         delay: 24000 },
  { key: "entity",     label: "Entity Resolution",      detail: "Pappers + web search → Mammouth ranking",             delay: 28000 },
  { key: "contact",    label: "Contact Enrichment",     detail: "Dropcontact professional lookup",                      delay: 33000 },
  { key: "phone",      label: "Phone Hunter",           detail: "Searching SIRENE registry, OTAs & web for phone",      delay: 37000 },
  { key: "booking",    label: "Direct Booking Scan",    detail: "Detecting booking engine signals",                     delay: 41000 },
  { key: "scoring",    label: "Global Scoring",         detail: "Mammouth computes confidence scores",                  delay: 44000 },
] as const;

type StepKey = typeof PIPELINE_STEPS[number]["key"];
type StepState = "pending" | "running" | "done";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhoneDiscoveryResult {
  number: string;
  source: string;
  source_url?: string;
  method: string;
  confidence: "high" | "medium" | "low";
}

interface ReconstructionResult {
  detected_location?: {
    latitude: number;
    longitude: number;
    address?: string;
    neighborhood?: string;
    confidence: number;
  } | null;
  operator?: {
    name: string;
    website?: string;
    activity?: string;
    siret?: string;
    address?: string;
    confidence: number;
  } | null;
  contact?: { email?: string; phone?: string };
  direct_booking?: boolean;
  direct_booking_url?: string;
  confidence_scores?: {
    geo_confidence: number;
    image_match_confidence: number;
    entity_confidence: number;
  };
  pipeline_steps?: Record<string, string>;
  phone_discovery_results?: PhoneDiscoveryResult[];
  best_phone?: string;
}

interface VisualLead {
  id?: string;
  primary_name: string;
  city: string;
  country: string;
  address?: string;
  website_url?: string;
  email?: string;
  phone?: string;
  score: number;
  score_label: string;
  quality_summary?: string;
}

interface ApiResponse {
  lead_id?: string;
  lead?: VisualLead;
  reconstruction?: ReconstructionResult;
  images?: string[];
  error?: string;
}

interface DiscoveredListing {
  url: string;
  title: string;
  host_name?: string;
  superhost: boolean;
  review_count: number | null;
}

interface MassResult {
  url: string;
  title: string;
  status: "pending" | "running" | "done" | "error";
  lead?: VisualLead;
  reconstruction?: ReconstructionResult;
  error?: string;
}

// ─── Score bar ───────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ─── Mass result card ─────────────────────────────────────────────────────────

const SCORE_COLORS: Record<string, string> = {
  Hot: "bg-red-500/15 text-red-600",
  Good: "bg-amber-500/15 text-amber-600",
  Medium: "bg-blue-500/15 text-blue-600",
  Weak: "bg-muted text-muted-foreground",
};

function MassResultCard({
  result,
  onViewLead,
}: {
  result: MassResult;
  onViewLead: (id: string) => void;
}) {
  if (result.status === "pending") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/30 bg-muted/20">
        <Circle className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" />
        <span className="text-sm text-muted-foreground/50 truncate">{result.title}</span>
      </div>
    );
  }

  if (result.status === "running") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-500/30 bg-violet-500/5">
        <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{result.title}</p>
          <p className="text-xs text-muted-foreground">Analyzing with AI…</p>
        </div>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5">
        <AlertCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground truncate">{result.title}</p>
          <p className="text-xs text-red-400">{result.error ?? "Analysis failed"}</p>
        </div>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
        </a>
      </div>
    );
  }

  const lead = result.lead;
  if (!lead) return null;

  const recon = result.reconstruction;
  const phone = recon?.best_phone ?? lead.phone;
  const phoneResult = recon?.phone_discovery_results?.[0];
  const noWebsite = !lead.website_url;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3 justify-between">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {lead.score_label && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCORE_COLORS[lead.score_label] ?? "bg-muted text-muted-foreground"}`}>
                {lead.score_label}
              </span>
            )}
            {recon?.direct_booking && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Direct booking
              </span>
            )}
            {noWebsite && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium flex items-center gap-1">
                <Star className="h-3 w-3" />
                No website
              </span>
            )}
          </div>
          <p className="font-semibold text-sm leading-tight">{lead.primary_name}</p>
          {(lead.address ?? lead.city) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {[lead.address, lead.city].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold tabular-nums">{lead.score}</div>
          <div className="text-xs text-muted-foreground">score</div>
        </div>
      </div>

      {/* Phone — primary value */}
      {phone ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <Phone className="h-4 w-4 text-emerald-500 flex-shrink-0" />
          <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">{phone}</span>
          {phoneResult && (
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full font-medium ${
              phoneResult.confidence === "high"
                ? "bg-emerald-500/10 text-emerald-600"
                : phoneResult.confidence === "medium"
                ? "bg-amber-500/10 text-amber-600"
                : "bg-muted text-muted-foreground"
            }`}>
              {phoneResult.source}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/30">
          <Phone className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
          <span className="text-xs text-muted-foreground/50">No phone found</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {lead.id && (
          <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={() => onViewLead(lead.id!)}>
            <ArrowRight className="h-3 w-3" />
            View Lead
          </Button>
        )}
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
            <ExternalLink className="h-3 w-3" />
            Listing
          </Button>
        </a>
        {lead.website_url && (
          <a href={lead.website_url} target="_blank" rel="noopener noreferrer" className="ml-auto">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
              <Globe className="h-3 w-3" />
              Website
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default function VisualPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"mass" | "map" | "single">("mass");

  // ── Map Prospect (Google Places) state ────────────────────────────────────
  const [mapCity, setMapCity] = useState("");
  const [mapCountry, setMapCountry] = useState("France");
  const [mapMax, setMapMax] = useState(10);
  const [mapStatus, setMapStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [mapError, setMapError] = useState("");
  const [mapLeads, setMapLeads] = useState<Array<{
    id?: string;
    name: string;
    city: string;
    address?: string;
    phone?: string;
    website?: string;
    score: number;
    score_label: string;
    parcel_ref?: string;
    saved: boolean;
    error?: string;
  }>>([]);

  async function handleMapProspect() {
    if (!mapCity.trim()) { toast.error("Enter a city"); return; }
    setMapStatus("running");
    setMapError("");
    setMapLeads([]);
    try {
      const res = await fetch("/api/map-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: mapCity.trim(), country: mapCountry, max_results: mapMax }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json() as {
        discovered?: number;
        saved?: number;
        leads?: typeof mapLeads;
        error?: string;
      };
      if (!res.ok || data.error) {
        setMapError(data.error ?? "Discovery failed");
        setMapStatus("error");
        return;
      }
      setMapLeads(data.leads ?? []);
      setMapStatus("done");
      toast.success(`${data.saved} lead${data.saved === 1 ? "" : "s"} saved from Google Maps`);
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Failed");
      setMapStatus("error");
    }
  }

  // ── Single mode state ──────────────────────────────────────────────────────
  const [url, setUrl] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("France");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [stepStates, setStepStates] = useState<Record<StepKey, StepState>>(
    Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, "pending"])) as Record<StepKey, StepState>
  );
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Mass mode state ────────────────────────────────────────────────────────
  const [massCity, setMassCity] = useState("");
  const [massCountry, setMassCountry] = useState("France");
  const [massMax, setMassMax] = useState(10);
  const [massStatus, setMassStatus] = useState<"idle" | "discovering" | "analyzing" | "done" | "error">("idle");
  const [massResults, setMassResults] = useState<MassResult[]>([]);
  const [massError, setMassError] = useState("");
  const stoppedRef = useRef(false);

  // ── Single mode helpers ────────────────────────────────────────────────────

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function resetSteps() {
    setStepStates(
      Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, "pending"])) as Record<StepKey, StepState>
    );
  }

  function advanceStepsTo(index: number) {
    setStepStates((prev) => {
      const next = { ...prev };
      PIPELINE_STEPS.forEach((s, i) => {
        if (i < index) next[s.key] = "done";
        else if (i === index) next[s.key] = "running";
      });
      return next;
    });
  }

  function completeAllSteps() {
    setStepStates(
      Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, "done"])) as Record<StepKey, StepState>
    );
  }

  async function handleAnalyze() {
    if (!url.trim()) { toast.error("Paste an Airbnb listing URL"); return; }
    if (!city.trim()) { toast.error("Enter the city"); return; }

    clearTimers();
    resetSteps();
    setStatus("running");
    setResult(null);
    setError("");
    setExtractedImages([]);

    PIPELINE_STEPS.forEach((step, i) => {
      const t = setTimeout(() => advanceStepsTo(i), step.delay);
      timersRef.current.push(t);
    });

    try {
      const res = await fetch("/api/visual-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), city: city.trim(), country }),
        signal: AbortSignal.timeout(125_000),
      });

      clearTimers();
      const data: ApiResponse = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "Analysis failed");
        setStatus("error");
        return;
      }

      completeAllSteps();
      setResult(data);
      setExtractedImages(data.images ?? []);
      setStatus("done");
    } catch (err) {
      clearTimers();
      setError(err instanceof Error ? err.message : "Request failed");
      setStatus("error");
    }
  }

  useEffect(() => () => clearTimers(), []);

  // ── Mass mode helpers ──────────────────────────────────────────────────────

  function stopMass() {
    stoppedRef.current = true;
    setMassStatus("done");
  }

  async function handleMassProspect() {
    if (!massCity.trim()) { toast.error("Enter a city to prospect"); return; }

    stoppedRef.current = false;
    setMassStatus("discovering");
    setMassResults([]);
    setMassError("");

    try {
      // Phase 1: Discover listings
      const discoverRes = await fetch("/api/visual-prospect/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: massCity.trim(), country: massCountry, max_listings: massMax }),
      });

      if (!discoverRes.ok) {
        const err = (await discoverRes.json()) as { error?: string };
        setMassError(err.error ?? "Failed to discover listings");
        setMassStatus("error");
        return;
      }

      const { listings } = (await discoverRes.json()) as {
        listings: DiscoveredListing[];
        total_found: number;
      };

      if (!listings.length) {
        setMassError(`No Airbnb listings found for "${massCity}". Try a larger city.`);
        setMassStatus("error");
        return;
      }

      // Init result placeholders
      setMassResults(
        listings.map((l) => ({ url: l.url, title: l.title, status: "pending" as const }))
      );
      setMassStatus("analyzing");

      // Phase 2: Analyze 2 listings at a time
      const BATCH = 2;
      for (let i = 0; i < listings.length; i += BATCH) {
        if (stoppedRef.current) break;

        const batch = listings.slice(i, i + BATCH);

        await Promise.all(
          batch.map(async (listing, bi) => {
            const idx = i + bi;

            setMassResults((prev) =>
              prev.map((r, j) => (j === idx ? { ...r, status: "running" as const } : r))
            );

            try {
              const res = await fetch("/api/visual-prospect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: listing.url,
                  city: massCity.trim(),
                  country: massCountry,
                }),
                signal: AbortSignal.timeout(130_000),
              });

              const data = (await res.json()) as ApiResponse;

              if (!res.ok || !data.lead) {
                setMassResults((prev) =>
                  prev.map((r, j) =>
                    j === idx
                      ? { ...r, status: "error" as const, error: data.error ?? "Analysis failed" }
                      : r
                  )
                );
                return;
              }

              setMassResults((prev) =>
                prev.map((r, j) =>
                  j === idx
                    ? {
                        ...r,
                        status: "done" as const,
                        lead: data.lead!,
                        reconstruction: data.reconstruction,
                      }
                    : r
                )
              );
            } catch (err) {
              setMassResults((prev) =>
                prev.map((r, j) =>
                  j === idx
                    ? {
                        ...r,
                        status: "error" as const,
                        error: err instanceof Error ? err.message : "Timeout",
                      }
                    : r
                )
              );
            }
          })
        );
      }

      if (!stoppedRef.current) setMassStatus("done");
    } catch (err) {
      setMassError(err instanceof Error ? err.message : "Failed to start");
      setMassStatus("error");
    }
  }

  // ── Single mode derived state ──────────────────────────────────────────────
  const recon = result?.reconstruction;
  const lead = result?.lead;
  const scores = recon?.confidence_scores;
  const phoneResults = recon?.phone_discovery_results ?? [];
  const bestPhoneResult = phoneResults[0];
  const displayPhone = recon?.best_phone ?? lead?.phone;
  const noWebsite = lead && !lead.website_url;

  const scoreLabelColor: Record<string, string> = {
    Hot: "bg-red-500/15 text-red-600 border-red-500/30",
    Good: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    Medium: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    Weak: "bg-muted text-muted-foreground border-border",
  };

  // ── Mass mode derived state ────────────────────────────────────────────────
  const massTotal = massResults.length;
  const massCompleted = massResults.filter((r) => r.status === "done" || r.status === "error").length;
  const massSaved = massResults.filter((r) => r.status === "done").length;
  const massWithPhone = massResults.filter(
    (r) => r.status === "done" && !!(r.reconstruction?.best_phone ?? r.lead?.phone)
  ).length;
  const massNoWebsite = massResults.filter(
    (r) => r.status === "done" && !r.lead?.website_url
  ).length;
  const massProgress = massTotal > 0 ? (massCompleted / massTotal) * 100 : 0;
  const massRunning = massStatus === "discovering" || massStatus === "analyzing";

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-600 dark:text-violet-400">
          <Eye className="h-3.5 w-3.5" />
          Visual Property Intelligence
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {activeTab === "mass"
            ? "Find operators at scale"
            : activeTab === "map"
            ? "Find lodgings on the map"
            : "Identify the real operator"}
          <br />
          <span className="text-muted-foreground font-normal">
            {activeTab === "mass"
              ? "in any city — contacts the hard way"
              : activeTab === "map"
              ? "via Google Places + Cadastre"
              : "behind any STR listing"}
          </span>
        </h1>
      </div>

      {/* ── Tab toggle ──────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl border border-border/60 bg-muted/40 p-1 gap-1">
        {(["mass", "map", "single"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-background text-foreground shadow-sm border border-border/40"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "mass" ? (
              <><Users className="h-3.5 w-3.5" /> Mass Prospect</>
            ) : tab === "map" ? (
              <><MapPin className="h-3.5 w-3.5" /> Map Prospect</>
            ) : (
              <><ScanSearch className="h-3.5 w-3.5" /> Single Analysis</>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* MASS MODE                                                           */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "mass" && (
        <>
          {/* ── Mass form ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    placeholder="Paris, Nice, Bordeaux…"
                    value={massCity}
                    onChange={(e) => setMassCity(e.target.value)}
                    disabled={massRunning}
                    onKeyDown={(e) => { if (e.key === "Enter") handleMassProspect(); }}
                  />
                </div>
              </div>
              <div className="w-32 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country</label>
                <Input
                  placeholder="France"
                  value={massCountry}
                  onChange={(e) => setMassCountry(e.target.value)}
                  disabled={massRunning}
                />
              </div>
            </div>

            {/* Targets count */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Targets to analyze
              </label>
              <div className="flex gap-2">
                {[5, 10, 15].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMassMax(n)}
                    disabled={massRunning}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                      massMax === n
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-600"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {n} listings
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleMassProspect}
                disabled={massRunning}
                className="flex-1 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                size="lg"
              >
                {massStatus === "discovering" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Discovering listings…</>
                ) : massStatus === "analyzing" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing {massCompleted}/{massTotal}…</>
                ) : (
                  <><Users className="h-4 w-4" /> Find Targets in {massCity || "…"}</>
                )}
              </Button>
              {massRunning && (
                <Button variant="outline" size="lg" onClick={stopMass} className="gap-2 shrink-0">
                  <StopCircle className="h-4 w-4" />
                  Stop
                </Button>
              )}
            </div>
          </div>

          {/* ── Progress bar ──────────────────────────────────────────────── */}
          {massTotal > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {massStatus === "done"
                    ? `Done — ${massSaved} lead${massSaved === 1 ? "" : "s"} saved`
                    : `Analyzing ${massCompleted} / ${massTotal}…`}
                </span>
                <span className="tabular-nums">{Math.round(massProgress)}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-500"
                  style={{ width: `${massProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Stats summary ─────────────────────────────────────────────── */}
          {massSaved > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums">{massSaved}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Leads saved</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-emerald-600">{massWithPhone}</div>
                <div className="text-xs text-muted-foreground mt-0.5">With phone</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-amber-600">{massNoWebsite}</div>
                <div className="text-xs text-muted-foreground mt-0.5">No website</div>
              </div>
            </div>
          )}

          {/* ── Mass error ────────────────────────────────────────────────── */}
          {massStatus === "error" && massError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Discovery failed</p>
                <p className="mt-1 text-red-500/80">{massError}</p>
              </div>
            </div>
          )}

          {/* ── Results list ──────────────────────────────────────────────── */}
          {massResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  {massTotal} listing{massTotal === 1 ? "" : "s"} found in {massCity}
                </p>
                {massStatus === "done" && massSaved > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-xs"
                    onClick={() => router.push("/leads?sort=newest")}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    View all leads
                  </Button>
                )}
              </div>
              {massResults.map((r, i) => (
                <MassResultCard
                  key={`${r.url}-${i}`}
                  result={r}
                  onViewLead={(id) => router.push(`/leads/${id}`)}
                />
              ))}
            </div>
          )}

          {/* ── Mass idle hint ────────────────────────────────────────────── */}
          {massStatus === "idle" && (
            <div className="text-center space-y-4 py-8">
              <div className="inline-grid grid-cols-2 gap-3 text-xs text-muted-foreground max-w-sm mx-auto">
                {[
                  { icon: Users, text: "Finds many Airbnb listings via Google" },
                  { icon: Eye, text: "Vision AI identifies the property" },
                  { icon: MapPin, text: "Cadastre & Pappers find the owner" },
                  { icon: Phone, text: "Phone hunter searches 6 sources" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-muted/30">
                    <Icon className="h-5 w-5 text-violet-500" />
                    <span className="text-center leading-tight">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* MAP MODE — Google Places + Cadastre                                 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "map" && (
        <>
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    placeholder="Paris, Nice, Bordeaux…"
                    value={mapCity}
                    onChange={(e) => setMapCity(e.target.value)}
                    disabled={mapStatus === "running"}
                    onKeyDown={(e) => { if (e.key === "Enter") handleMapProspect(); }}
                  />
                </div>
              </div>
              <div className="w-32 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country</label>
                <Input
                  placeholder="France"
                  value={mapCountry}
                  onChange={(e) => setMapCountry(e.target.value)}
                  disabled={mapStatus === "running"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Lodgings to analyse
              </label>
              <div className="flex gap-2">
                {[5, 10, 15, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMapMax(n)}
                    disabled={mapStatus === "running"}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                      mapMax === n
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-600"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleMapProspect}
              disabled={mapStatus === "running"}
              className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              size="lg"
            >
              {mapStatus === "running" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Querying Google Maps + Cadastre…</>
              ) : (
                <><MapPin className="h-4 w-4" /> Find Lodgings in {mapCity || "…"}</>
              )}
            </Button>
          </div>

          {mapStatus === "error" && mapError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Map prospect failed</p>
                <p className="mt-1 text-red-500/80">{mapError}</p>
              </div>
            </div>
          )}

          {mapLeads.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{mapLeads.length}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Found</div>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-emerald-600">
                    {mapLeads.filter((l) => l.phone).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">With phone</div>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-amber-600">
                    {mapLeads.filter((l) => !l.website).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">No website</div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">
                  Lodgings discovered on Google Maps in {mapCity}
                </p>
                {mapLeads.map((l, i) => (
                  <div key={`${l.id ?? l.name}-${i}`} className="rounded-xl border border-border/60 bg-card shadow-sm p-4 space-y-3">
                    <div className="flex items-start gap-3 justify-between">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {l.score_label && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCORE_COLORS[l.score_label] ?? "bg-muted text-muted-foreground"}`}>
                              {l.score_label}
                            </span>
                          )}
                          {!l.website && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium flex items-center gap-1">
                              <Star className="h-3 w-3" />
                              No website
                            </span>
                          )}
                          {l.parcel_ref && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-medium flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              Parcel {l.parcel_ref}
                            </span>
                          )}
                        </div>
                        <p className="font-semibold text-sm leading-tight">{l.name}</p>
                        {l.address && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            {l.address}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold tabular-nums">{l.score}</div>
                        <div className="text-xs text-muted-foreground">score</div>
                      </div>
                    </div>

                    {l.phone ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        <Phone className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                        <a href={`tel:${l.phone}`} className="font-semibold text-sm text-emerald-700 dark:text-emerald-400 hover:underline">
                          {l.phone}
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/30">
                        <Phone className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                        <span className="text-xs text-muted-foreground/60">No phone — try retry on the lead detail page</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {l.id && (
                        <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={() => router.push(`/leads/${l.id}`)}>
                          <ArrowRight className="h-3 w-3" />
                          View Lead
                        </Button>
                      )}
                      {l.website && (
                        <a href={l.website} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
                            <Globe className="h-3 w-3" />
                            Website
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mapStatus === "idle" && mapLeads.length === 0 && (
            <div className="text-center space-y-4 py-8">
              <div className="inline-grid grid-cols-2 gap-3 text-xs text-muted-foreground max-w-sm mx-auto">
                {[
                  { icon: MapPin, text: "Google Places finds every lodging on the map" },
                  { icon: Building2, text: "IGN Cadastre locks the exact parcel" },
                  { icon: Phone, text: "Phone Hunter fills the missing numbers" },
                  { icon: ShieldCheck, text: "Chain hotels filtered out automatically" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-muted/30">
                    <Icon className="h-5 w-5 text-violet-500" />
                    <span className="text-center leading-tight">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SINGLE MODE                                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "single" && (
        <>
          {/* ── Input form ────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Listing URL
              </label>
              <div className="relative">
                <ScanSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-10 font-mono text-sm"
                  placeholder="https://www.airbnb.com/rooms/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={status === "running"}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</label>
                <Input
                  placeholder="Paris"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={status === "running"}
                />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country</label>
                <Input
                  placeholder="France"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={status === "running"}
                />
              </div>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={status === "running"}
              className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              size="lg"
            >
              {status === "running" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing property…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Analyze Property</>
              )}
            </Button>
          </div>

          {/* ── Pipeline progress ──────────────────────────────────────────── */}
          {status !== "idle" && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              {extractedImages.length > 0 && (
                <div className="flex gap-2 p-4 border-b border-border/40 overflow-x-auto">
                  {extractedImages.slice(0, 5).map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt={`Listing photo ${i + 1}`}
                      className="h-20 w-28 object-cover rounded-lg flex-shrink-0 border border-border/40"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ))}
                </div>
              )}
              <div className="divide-y divide-border/30">
                {PIPELINE_STEPS.map((step) => {
                  const state = stepStates[step.key];
                  return (
                    <div key={step.key} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-5 flex-shrink-0">
                        {state === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {state === "running" && <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />}
                        {state === "pending" && <Circle className="h-4 w-4 text-muted-foreground/30" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${state === "pending" ? "text-muted-foreground/50" : "text-foreground"}`}>
                          {step.label}
                        </span>
                        {state === "running" && (
                          <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                        )}
                      </div>
                      {state === "done" && <span className="text-xs text-muted-foreground/60">done</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Error state ────────────────────────────────────────────────── */}
          {status === "error" && error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Analysis failed</p>
                <p className="mt-1 text-red-500/80">{error}</p>
              </div>
            </div>
          )}

          {/* ── Result card ────────────────────────────────────────────────── */}
          {status === "done" && lead && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-border/40 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold">{lead.primary_name}</h2>
                    {lead.score_label && (
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold ${scoreLabelColor[lead.score_label] ?? ""}`}
                      >
                        {lead.score_label}
                      </Badge>
                    )}
                    {recon?.direct_booking && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Direct booking
                      </Badge>
                    )}
                    {noWebsite && (
                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1">
                        <Star className="h-3 w-3" />
                        No website — high priority
                      </Badge>
                    )}
                  </div>
                  {recon?.detected_location && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                      {[recon.detected_location.neighborhood, lead.city, lead.country].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {lead.address && <p className="text-xs text-muted-foreground">{lead.address}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-3xl font-bold tabular-nums">{lead.score}</div>
                  <div className="text-xs text-muted-foreground">Score</div>
                </div>
              </div>

              <div className="px-6 py-4 grid grid-cols-2 gap-3 border-b border-border/40">
                {lead.website_url && (
                  <a href={lead.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline truncate">
                    <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{lead.website_url.replace(/^https?:\/\//, "")}</span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
                  </a>
                )}
                {lead.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{lead.email}</span>
                  </div>
                )}
                {displayPhone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium">{displayPhone}</span>
                    {bestPhoneResult && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        bestPhoneResult.confidence === "high"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : bestPhoneResult.confidence === "medium"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {bestPhoneResult.source}
                      </span>
                    )}
                  </div>
                )}
                {!displayPhone && phoneResults.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>No phone found</span>
                  </div>
                )}
                {recon?.operator?.siret && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>SIRET {recon.operator.siret}</span>
                  </div>
                )}
                {recon?.operator?.activity && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground col-span-2">
                    <span className="text-muted-foreground/60">Activity:</span>
                    {recon.operator.activity}
                  </div>
                )}
              </div>

              {scores && (
                <div className="px-6 py-4 space-y-3 border-b border-border/40">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Confidence</p>
                  <ScoreBar label="Geographic match" value={scores.geo_confidence} />
                  <ScoreBar label="Visual match" value={scores.image_match_confidence} />
                  <ScoreBar label="Entity identification" value={scores.entity_confidence} />
                </div>
              )}

              {lead.quality_summary && (
                <div className="px-6 py-4 border-b border-border/40">
                  <p className="text-xs text-muted-foreground leading-relaxed">{lead.quality_summary}</p>
                </div>
              )}

              <div className="px-6 py-4 flex gap-3">
                {result?.lead_id && (
                  <Button variant="default" size="sm" className="gap-2" onClick={() => router.push(`/leads/${result.lead_id}`)}>
                    <ArrowRight className="h-3.5 w-3.5" />
                    Open Lead
                  </Button>
                )}
                <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/leads?sort=newest")}>
                  View All Leads
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setStatus("idle"); setResult(null); setUrl(""); setCity(""); resetSteps(); }}>
                  Analyze another
                </Button>
              </div>
            </div>
          )}

          {/* ── Single idle hint ──────────────────────────────────────────── */}
          {status === "idle" && (
            <div className="text-center space-y-4 py-8">
              <div className="inline-grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                {[
                  { icon: Eye, text: "Google Vision reads listing photos" },
                  { icon: MapPin, text: "Mammouth locates the property" },
                  { icon: Building2, text: "Pappers identifies the operator" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-muted/30">
                    <Icon className="h-5 w-5 text-violet-500" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
