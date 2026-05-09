"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { History, Search, MapPin, Users, Clock, ChevronRight } from "lucide-react";
import type { RunStatus } from "@/lib/types";

interface RunSummary {
  id: string;
  city: string;
  country: string;
  target_type: string;
  status: RunStatus;
  progress: number;
  requested_leads: number;
  lead_count: number;
  error_message?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  stats_json?: {
    sources_found: number;
    websites_crawled: number;
    leads_extracted: number;
    errors: number;
  };
}

const STATUS_BADGE: Record<RunStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Queued", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  collecting_sources: { label: "Collecting", variant: "default" },
  extracting_contacts: { label: "Extracting", variant: "default" },
  reconstructing: { label: "Reconstructing", variant: "default" },
  enriching: { label: "Enriching", variant: "default" },
  deduplicating: { label: "Deduplicating", variant: "default" },
  scoring: { label: "Scoring", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

function formatDuration(start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.round((e - s) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  async function fetchRuns(p = 1) {
    setLoading(true);
    try {
      const res = await fetch(`/api/runs?page=${p}&limit=20`);
      if (!res.ok) throw new Error("Failed to load runs");
      const data = await res.json();
      setRuns(data.runs ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRuns(page); }, [page]);

  const totalPages = Math.ceil(total / 20);

  if (loading && runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading runs...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            Run History
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} total runs</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg h-8 px-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          New Search
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-8 py-16 text-center">
          <History className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No runs yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Start a search from the dashboard to generate your first leads.
          </p>
          <Link href="/" className="inline-flex items-center gap-1.5 mt-4 rounded-lg h-8 px-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Go to Dashboard
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
          {runs.map((run) => {
            const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.queued;
            const isActive = !["completed", "failed", "cancelled"].includes(run.status);
            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors group"
              >
                {/* City + country */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {run.city}, {run.country}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {run.target_type?.replace(/_/g, " ") ?? "All types"} · {new Date(run.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="hidden sm:flex items-center gap-5 text-xs text-muted-foreground shrink-0">
                  <div className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <span className={run.lead_count > 0 ? "font-semibold text-foreground" : ""}>
                      {run.lead_count} leads
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatDuration(run.started_at, run.finished_at)}</span>
                  </div>
                </div>

                {/* Status + progress */}
                <div className="flex items-center gap-3 shrink-0">
                  {isActive && (
                    <div className="w-24 bg-border rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${run.progress}%` }}
                      />
                    </div>
                  )}
                  <Badge variant={badge.variant} className="text-xs shrink-0">
                    {badge.label}
                  </Badge>
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
