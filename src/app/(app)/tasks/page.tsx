"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, CheckSquare, ArrowRight, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";

export const dynamic = "force-dynamic";

interface Task {
  task_id: string;
  lead_id: string;
  lead_name: string;
  lead_city: string;
  status: string;
  created_at: string;
  title: string;
  due_at?: string;
  notes?: string;
  kind: string;
}

const KIND_COLORS: Record<string, string> = {
  follow_up: "bg-blue-500/10 text-blue-600",
  verify: "bg-amber-500/10 text-amber-600",
  outreach: "bg-emerald-500/10 text-emerald-600",
  research: "bg-violet-500/10 text-violet-600",
  compliance: "bg-red-500/10 text-red-600",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"scheduled" | "done">("scheduled");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?status=${status}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [status]);

  async function complete(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    toast.success("Marked done");
    await load();
  }

  async function remove(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    toast.success("Deleted");
    await load();
  }

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-emerald-500" /> Tasks
          </h1>
          <p className="text-sm text-muted-foreground">
            Follow-ups, verifications, and compliance escalations per lead.
          </p>
        </div>
        <div className="flex rounded-lg border border-border/40 bg-muted/30 p-0.5">
          {(["scheduled", "done"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                status === s ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {s === "scheduled" ? "Open" : "Done"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          {status === "scheduled" ? "No open tasks. Schedule a follow-up from any lead detail page." : "No completed tasks yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div
              key={t.task_id}
              className="rounded-xl border border-border/40 bg-card p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{t.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${KIND_COLORS[t.kind] ?? "bg-muted text-muted-foreground"}`}>
                    {t.kind.replace("_", " ")}
                  </span>
                  {t.due_at && (
                    <span className="text-[10px] flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> {new Date(t.due_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Link href={`/leads/${t.lead_id}`} className="text-xs text-muted-foreground hover:text-foreground">
                  {t.lead_name} · {t.lead_city}
                </Link>
                {t.notes && <p className="text-xs text-muted-foreground mt-1">{t.notes}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                {status === "scheduled" && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => complete(t.task_id)}>
                    Done
                  </Button>
                )}
                <Link href={`/leads/${t.lead_id}`}>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                    <ArrowRight className="h-3 w-3" /> Open
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => remove(t.task_id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
