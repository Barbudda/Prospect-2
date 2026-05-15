// GET  /api/tasks              — list all open tasks for the user
// POST /api/tasks              — create a task
// PATCH /api/tasks/[id]        — mark done / update (handled in the dynamic route)
//
// Tasks are stored as rows in lead_enrichment_events with
// provider = "task" and a structured status:
//   - "scheduled" → not done yet; error_message stores the JSON payload
//   - "done"      → completed
// This avoids a schema migration. The data is fully audit-trail-ready.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface TaskPayload {
  title: string;
  due_at?: string;          // ISO
  notes?: string;
  kind?: "follow_up" | "verify" | "outreach" | "research" | "compliance";
}

interface TaskEvent {
  id: string;
  lead_id: string;
  provider: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Pull all task-events for leads owned by the user. Join via lead_id.
    const filterStatus = req.nextUrl.searchParams.get("status") ?? "scheduled";

    const { data: events, error } = await supabase
      .from("lead_enrichment_events")
      .select("id, lead_id, status, error_message, created_at, leads!inner(id, primary_name, city, user_id)")
      .eq("provider", "task")
      .eq("status", filterStatus)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const tasks = (events ?? [])
      .filter((e) => {
        const leadJoin = (e as unknown as { leads?: { user_id?: string } }).leads;
        return leadJoin?.user_id === user.id;
      })
      .map((e) => {
        const ev = e as unknown as TaskEvent & {
          leads?: { id: string; primary_name: string; city: string };
        };
        let payload: TaskPayload | null = null;
        try {
          payload = ev.error_message ? (JSON.parse(ev.error_message) as TaskPayload) : null;
        } catch {
          payload = null;
        }
        return {
          task_id: ev.id,
          lead_id: ev.lead_id,
          lead_name: ev.leads?.primary_name ?? "(unknown)",
          lead_city: ev.leads?.city ?? "",
          status: ev.status,
          created_at: ev.created_at,
          title: payload?.title ?? "(no title)",
          due_at: payload?.due_at,
          notes: payload?.notes,
          kind: payload?.kind ?? "follow_up",
        };
      });

    return NextResponse.json({ count: tasks.length, tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/tasks]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      lead_id: string;
      title: string;
      due_at?: string;
      notes?: string;
      kind?: TaskPayload["kind"];
    };
    if (!body.lead_id || !body.title)
      return NextResponse.json({ error: "lead_id and title required" }, { status: 400 });

    // Verify lead ownership
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("id", body.lead_id)
      .eq("user_id", user.id)
      .single();
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const payload: TaskPayload = {
      title: body.title,
      due_at: body.due_at,
      notes: body.notes,
      kind: body.kind ?? "follow_up",
    };

    const service = createServiceClient();
    const { data: inserted, error } = await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: body.lead_id,
        provider: "task",
        status: "scheduled",
        error_message: JSON.stringify(payload),
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ task_id: inserted?.id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/tasks]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
