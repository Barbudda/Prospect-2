"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Download } from "lucide-react";
import type { RunStatus, RunStats, LogLevel } from "@/lib/types";

interface LogEntry {
  level: LogLevel;
  message: string;
  created_at: string;
}

interface StatusData {
  id: string;
  status: RunStatus;
  progress: number;
  stats: RunStats;
  recent_logs: LogEntry[];
  lead_count: number;
  error_message?: string;
}

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Starting...",
  collecting_sources: "Collecting Sources",
  extracting_contacts: "Extracting Contacts",
  enriching: "Enriching Leads",
  deduplicating: "Deduplicating",
  scoring: "Scoring",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<RunStatus, string> = {
  queued: "secondary",
  running: "default",
  collecting_sources: "default",
  extracting_contacts: "default",
  enriching: "default",
  deduplicating: "default",
  scoring: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "secondary",
};

const LOG_COLORS: Record<LogLevel, string> = {
  info: "text-foreground",
  warn: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
  debug: "text-muted-foreground",
};

export default function RunProgressPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const router = useRouter();
  const [data, setData] = useState<StatusData | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isDone = data?.status === "completed" || data?.status === "failed" || data?.status === "cancelled";

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/runs/${runId}/status`);
      if (!res.ok) return;
      const json: StatusData = await res.json();
      setData(json);

      if (json.status === "completed" || json.status === "failed" || json.status === "cancelled") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }

      // Auto-scroll logs
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    } catch {}
  }

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 3_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runId]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      toast.info("Run cancelled.");
      fetchStatus();
    } catch {
      toast.error("Failed to cancel run");
    } finally {
      setCancelling(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading run status...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Search Run</h1>
          <p className="text-sm text-muted-foreground font-mono">{runId}</p>
        </div>
        <Badge variant={STATUS_COLORS[data.status] as "default" | "secondary" | "destructive"}>
          {STATUS_LABELS[data.status]}
        </Badge>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {STATUS_LABELS[data.status]}
            </span>
            <span className="font-mono font-medium">{data.progress}%</span>
          </div>
          <Progress value={data.progress} className="h-2" />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            {[
              { label: "Sources found", value: data.stats.sources_found },
              { label: "Websites crawled", value: data.stats.websites_crawled },
              { label: "Leads extracted", value: data.stats.leads_extracted ?? data.lead_count },
              { label: "Deduplicated", value: data.stats.leads_deduplicated },
              { label: "Enriched", value: data.stats.enriched },
              { label: "Errors", value: data.stats.errors },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error message */}
      {data.status === "failed" && data.error_message && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <strong>Error:</strong> {data.error_message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {!isDone && (
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling..." : "Cancel Run"}
          </Button>
        )}
        {(data.status === "completed" || data.lead_count > 0) && (
          <>
            <Link
              href={`/leads?run=${runId}`}
              className="inline-flex items-center justify-center rounded-lg h-7 gap-1 px-2.5 text-[0.8rem] font-medium bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
            >
              View {data.lead_count} Leads →
            </Link>
            <a
              href={`/api/export/csv?run=${runId}`}
              className="inline-flex items-center gap-1 rounded-lg h-7 px-2.5 text-[0.8rem] font-medium border border-border hover:bg-muted transition-colors"
            >
              <Download className="h-3 w-3" />
              Download CSV
            </a>
          </>
        )}
        {isDone && data.lead_count === 0 && data.status !== "failed" && (
          <p className="text-sm text-muted-foreground self-center">
            No real leads found for this search. Try adjusting the city or adding more source providers.
          </p>
        )}
      </div>

      {/* Live logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Run Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logRef}
            className="h-64 overflow-y-auto rounded bg-muted/30 p-3 font-mono text-xs space-y-1"
          >
            {data.recent_logs.length === 0 ? (
              <p className="text-muted-foreground">Waiting for logs...</p>
            ) : (
              data.recent_logs.map((log, i) => (
                <div key={i} className={`flex gap-2 ${LOG_COLORS[log.level]}`}>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className="uppercase text-[10px] font-bold shrink-0 w-8">
                    {log.level}
                  </span>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
