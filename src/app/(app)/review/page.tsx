"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, ArrowRight, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const dynamic = "force-dynamic";

interface ReviewItem {
  lead: {
    id: string;
    primary_name?: string | null;
    company_name?: string | null;
    lead_type?: string | null;
    city?: string | null;
    email?: string | null;
    phone?: string | null;
    website_url?: string | null;
    score?: number | null;
    confidence?: string | null;
  };
  reasons: Array<{ code: string; severity: "high" | "medium" | "low"; description: string }>;
  priority: number;
}

interface QueueResponse {
  total_scanned: number;
  items_needing_review: number;
  queue: ReviewItem[];
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 border-red-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-blue-500/10 text-blue-600 border-blue-500/30",
};

export default function ReviewPage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingOn, setActingOn] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/review-queue");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setData((await res.json()) as QueueResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function dismissAsDNC(leadId: string) {
    setActingOn(leadId);
    try {
      const res = await fetch(`/api/leads/${leadId}/dnc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Rejected from review queue", keep_contacts: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      toast.success("Marked DNC and contact data cleared.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingOn(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Scanning leads for verification flags…
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
    <div className="space-y-6 pb-12 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-amber-500" />
            Review queue
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.items_needing_review} of {data.total_scanned} leads need human verification.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data.queue.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
          <p className="text-emerald-700 dark:text-emerald-400 font-medium">
            All clear — no leads need verification right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.queue.map((item) => (
            <div
              key={item.lead.id}
              className="rounded-xl border border-border/40 bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">
                      {item.lead.primary_name || "(unnamed)"}
                    </span>
                    {item.lead.score != null && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">
                        score {item.lead.score}
                      </span>
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                      priority {item.priority}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.lead.city} · {item.lead.lead_type ?? "—"}
                    {item.lead.email && ` · ${item.lead.email}`}
                    {item.lead.phone && ` · ${item.lead.phone}`}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/leads/${item.lead.id}`}>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                      <ArrowRight className="h-3 w-3" />
                      Open
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-600 hover:bg-red-500/10"
                    onClick={() => dismissAsDNC(item.lead.id)}
                    disabled={actingOn === item.lead.id}
                  >
                    {actingOn === item.lead.id ? "…" : "Reject (DNC)"}
                  </Button>
                </div>
              </div>

              {/* Reasons */}
              <div className="space-y-1.5">
                {item.reasons.map((r) => (
                  <div
                    key={r.code}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${SEVERITY_COLORS[r.severity]}`}
                  >
                    <span className="font-mono text-[10px] uppercase shrink-0 mt-0.5">
                      {r.severity}
                    </span>
                    <span>{r.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
