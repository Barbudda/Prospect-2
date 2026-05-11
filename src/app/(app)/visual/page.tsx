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
} from "lucide-react";
import { toast } from "sonner";

// ─── Pipeline steps definition ───────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: "extract",   label: "Image Extraction",      detail: "Fetching listing photos",                             delay: 1500  },
  { key: "vision",    label: "Google Vision AI",       detail: "Detecting objects, labels, OCR text",                 delay: 4000  },
  { key: "mammouth1", label: "Mammouth Analysis",      detail: "Generating property semantic profile",                delay: 7000  },
  { key: "geo",       label: "Geo Hypothesis",         detail: "Generating location candidates",                      delay: 10000 },
  { key: "streetview",label: "Street View Matching",   detail: "Computing visual similarity score",                   delay: 16000 },
  { key: "places",    label: "Place & Business Match", detail: "Searching nearby operators",                          delay: 21000 },
  { key: "cadastre",  label: "IGN Cadastre",           detail: "Identifying cadastral parcel",                        delay: 24000 },
  { key: "entity",    label: "Entity Resolution",      detail: "Pappers + web search → Mammouth ranking",            delay: 28000 },
  { key: "contact",   label: "Contact Enrichment",     detail: "Dropcontact professional lookup",                     delay: 33000 },
  { key: "phone",     label: "Phone Hunter",           detail: "Searching registries, OTAs & Pages Jaunes for phone", delay: 37000 },
  { key: "booking",   label: "Direct Booking Scan",    detail: "Detecting booking engine signals",                    delay: 41000 },
  { key: "scoring",   label: "Global Scoring",         detail: "Mammouth computes confidence scores",                 delay: 44000 },
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
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default function VisualPage() {
  const router = useRouter();
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

    // Animate pipeline steps using scheduled delays
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
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      setStatus("error");
    }
  }

  useEffect(() => () => clearTimers(), []);

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

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-600 dark:text-violet-400">
          <Eye className="h-3.5 w-3.5" />
          Visual Property Intelligence
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Identify the real operator
          <br />
          <span className="text-muted-foreground font-normal">behind any STR listing</span>
        </h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Paste an Airbnb URL. Google Vision reads the photos. Mammouth locates the property,
          identifies the operator, and finds their contact details.
        </p>
      </div>

      {/* ── Input form ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Listing URL
          </label>
          <div className="relative">
            <ScanSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10 font-mono text-sm"
              placeholder="https://www.airbnb.com/rooms/..."
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

      {/* ── Pipeline progress ────────────────────────────────────────────── */}
      {status !== "idle" && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          {/* Extracted images strip */}
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
                    {state === "done" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    {state === "running" && (
                      <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />
                    )}
                    {state === "pending" && (
                      <Circle className="h-4 w-4 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium ${state === "pending" ? "text-muted-foreground/50" : "text-foreground"}`}>
                      {step.label}
                    </span>
                    {state === "running" && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                    )}
                  </div>
                  {state === "done" && (
                    <span className="text-xs text-muted-foreground/60">done</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {status === "error" && error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Analysis failed</p>
            <p className="mt-1 text-red-500/80">{error}</p>
          </div>
        </div>
      )}

      {/* ── Result card ──────────────────────────────────────────────────── */}
      {status === "done" && lead && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          {/* Header */}
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
                  {[
                    recon.detected_location.neighborhood,
                    lead.city,
                    lead.country,
                  ].filter(Boolean).join(", ")}
                </div>
              )}
              {lead.address && (
                <p className="text-xs text-muted-foreground">{lead.address}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-3xl font-bold tabular-nums">{lead.score}</div>
              <div className="text-xs text-muted-foreground">Score</div>
            </div>
          </div>

          {/* Contact info */}
          <div className="px-6 py-4 grid grid-cols-2 gap-3 border-b border-border/40">
            {lead.website_url && (
              <a
                href={lead.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline truncate"
              >
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

          {/* Confidence scores */}
          {scores && (
            <div className="px-6 py-4 space-y-3 border-b border-border/40">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                AI Confidence
              </p>
              <ScoreBar label="Geographic match" value={scores.geo_confidence} />
              <ScoreBar label="Visual match" value={scores.image_match_confidence} />
              <ScoreBar label="Entity identification" value={scores.entity_confidence} />
            </div>
          )}

          {/* Quality summary */}
          {lead.quality_summary && (
            <div className="px-6 py-4 border-b border-border/40">
              <p className="text-xs text-muted-foreground leading-relaxed">{lead.quality_summary}</p>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 py-4 flex gap-3">
            {result?.lead_id && (
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={() => router.push(`/leads/${result.lead_id}`)}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Open Lead
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => router.push("/leads?sort=newest")}
            >
              View All Leads
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus("idle");
                setResult(null);
                setUrl("");
                setCity("");
                resetSteps();
              }}
            >
              Analyze another
            </Button>
          </div>
        </div>
      )}

      {/* ── Empty state hint ─────────────────────────────────────────────── */}
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
    </div>
  );
}
