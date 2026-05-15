"use client";

// REVERSE CONCIERGE — Ecosystem view (#11 complete)
// Discovers the partner network around a city: cleaners, photographers,
// smart-lock installers, etc. For each role, surfaces partnership plays
// + a lead-sharing template.

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Handshake, MapPin, Sparkles, Copy, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const dynamic = "force-dynamic";

interface PartnerLead {
  id?: string;
  name: string;
  role: string;
  city: string;
  phone?: string;
  website_url?: string;
  score: number;
}

interface DiscoveryResponse {
  saved: number;
  duplicates_skipped?: number;
  by_role: Record<string, number>;
  queries_executed: number;
  leads: PartnerLead[];
  error?: string;
}

const ROLE_OFFERS: Record<string, { label: string; play: string; share_template: string }> = {
  "partner_discovery:cleaning": {
    label: "Cleaning companies",
    play: "Co-branded cleaning-quality audit. The cleaner gets new clients, you get owners ready for direct booking.",
    share_template:
      "Hi [Cleaner], I'm running a free 'direct booking funnel' audit for STR owners in [city]. Whenever I onboard one, I refer all the operational work (cleaning/turnover) to a single trusted local partner. Would you be open to a quick call about how we'd cross-refer?",
  },
  "partner_discovery:photography": {
    label: "Photographers",
    play: "Free listing-photo grader → photographer gets shoot leads, you get owners who care about presentation.",
    share_template:
      "Hi [Photographer], I run a one-page audit of Airbnb listing photos in [city] — it rates light, framing, and conversion impact. Most owners who see the report decide to commission a real shoot. I'd love to send them your way if our standards align.",
  },
  "partner_discovery:interior_design": {
    label: "Interior design / home staging",
    play: "ROI-focused interior staging report. Designer gets renovation gigs, you get higher-tier owners.",
    share_template:
      "Hi [Designer], I help STR owners in [city] benchmark their listing against the top 10% of revenue performers. Staging consistently shows up as the highest-ROI lever. Open to a partnership?",
  },
  "partner_discovery:smart_lock": {
    label: "Smart-lock installers",
    play: "Bundle: hardware install + your guest-messaging stack. Installer gets recurring revenue, you get automated owners.",
    share_template:
      "Hi [Installer], I help STR owners in [city] move to self-check-in. Hardware install is always step 1. Would you be open to being our preferred local installer?",
  },
  "partner_discovery:linen": {
    label: "Linen / laundry",
    play: "Joint hospitality-quality kit. Linen partner introduces owners; you introduce them back.",
    share_template:
      "Hi, I'd like to add you to a short list of trusted linen partners I recommend to STR owners in [city]. We could also reciprocate when your clients ask about direct booking or PMS.",
  },
  "partner_discovery:pool_maintenance": {
    label: "Pool maintenance",
    play: "Luxury villa pipeline — partner sees you as a value-add for their clients.",
    share_template:
      "Hi, I work with luxury villa operators in [city] on direct booking. Pool maintenance always comes up. Would you be open to mutual introductions?",
  },
  "partner_discovery:real_estate_agent": {
    label: "Real estate agents (furnished tourist sales)",
    play: "Sale of furnished tourist property → bundled with your direct-booking setup.",
    share_template:
      "Hi, I run direct-booking infrastructure for new owners. When you close a furnished-rental sale, the buyer needs operational setup — let's package that into the closing offer.",
  },
  "partner_discovery:legal_accounting": {
    label: "LMNP accountants / legal",
    play: "LMNP accountants forward owners needing operational setup post-registration.",
    share_template:
      "Hi, your LMNP clients often need direct booking, PMS, and a cleaning network the moment they register. I'd love to be the operator they're forwarded to.",
  },
};

export default function EcosystemPage() {
  const [city, setCity] = useState("");
  const [country] = useState("France");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState("");

  async function discover() {
    if (!city.trim()) {
      toast.error("Enter a city");
      return;
    }
    setStatus("running");
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/partners/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: city.trim(), country, max_per_role: 5 }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = (await res.json()) as DiscoveryResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? "Discovery failed");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
      toast.success(`Saved ${data.saved} new partner candidates`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setStatus("error");
    }
  }

  function groupByRole(leads: PartnerLead[]) {
    const map = new Map<string, PartnerLead[]>();
    for (const l of leads) {
      const arr = map.get(l.role) ?? [];
      arr.push(l);
      map.set(l.role, arr);
    }
    return Array.from(map.entries());
  }

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Handshake className="h-3.5 w-3.5" /> Reverse Concierge — Ecosystem
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Find the suppliers around STR operators
          <br />
          <span className="text-muted-foreground font-normal">cross-refer instead of cold-call</span>
        </h1>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Nice, Annecy, Biarritz…"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={status === "running"}
                onKeyDown={(e) => { if (e.key === "Enter") discover(); }}
              />
            </div>
          </div>
        </div>
        <Button onClick={discover} disabled={status === "running"} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" size="lg">
          {status === "running" ? <><Loader2 className="h-4 w-4 animate-spin" />Scanning suppliers in {city}…</> : <><Sparkles className="h-4 w-4" />Discover partner ecosystem in {city || "city"}</>}
        </Button>
      </div>

      {status === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
              <div className="text-2xl font-bold tabular-nums">{result.saved}</div>
              <div className="text-xs text-muted-foreground">Saved</div>
            </div>
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
              <div className="text-2xl font-bold tabular-nums">{result.duplicates_skipped ?? 0}</div>
              <div className="text-xs text-muted-foreground">Already in DB</div>
            </div>
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
              <div className="text-2xl font-bold tabular-nums">{result.queries_executed}</div>
              <div className="text-xs text-muted-foreground">Queries</div>
            </div>
          </div>

          {groupByRole(result.leads).map(([role, leads]) => {
            const offer = ROLE_OFFERS[role];
            return (
              <section key={role} className="rounded-xl border border-border/40 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30">
                  <h3 className="font-semibold text-sm">{offer?.label ?? role}</h3>
                  <p className="text-xs text-muted-foreground">{leads.length} candidate{leads.length === 1 ? "" : "s"}</p>
                </div>
                {offer && (
                  <>
                    <div className="px-4 py-2 bg-emerald-500/5 border-b border-emerald-500/10 text-xs">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">Partnership play: </span>
                      <span className="text-muted-foreground">{offer.play}</span>
                    </div>
                    <div className="px-4 py-2 border-b border-border/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Outreach template</span>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => {
                          navigator.clipboard.writeText(offer.share_template);
                          toast.success("Copied");
                        }}>
                          <Copy className="h-3 w-3 mr-1" />Copy
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 italic">"{offer.share_template}"</p>
                    </div>
                  </>
                )}
                <div className="divide-y divide-border/30">
                  {leads.slice(0, 6).map((l, i) => (
                    <div key={l.id ?? i} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{l.name}</div>
                        <div className="text-muted-foreground">
                          {l.city} {l.phone && `· ${l.phone}`}
                        </div>
                      </div>
                      <div className="text-sm font-bold tabular-nums w-8 text-right">{l.score}</div>
                      {l.id && (
                        <Link href={`/leads/${l.id}`}>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1">
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
