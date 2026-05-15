// PATCH /api/tasks/[id] — mark a task done (or update its payload)
// DELETE /api/tasks/[id]

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { status?: "done" | "scheduled"; notes?: string };

    const { data: task } = await supabase
      .from("lead_enrichment_events")
      .select("id, lead_id, error_message, leads!inner(user_id)")
      .eq("id", id)
      .eq("provider", "task")
      .single();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const ownership = (task as unknown as { leads?: { user_id?: string } }).leads;
    if (ownership?.user_id !== user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updates: { status?: string; error_message?: string } = {};
    if (body.status) updates.status = body.status;
    if (body.notes) {
      try {
        const current = task.error_message ? JSON.parse(task.error_message as string) : {};
        updates.error_message = JSON.stringify({ ...current, notes: body.notes });
      } catch {
        updates.error_message = JSON.stringify({ notes: body.notes });
      }
    }

    const service = createServiceClient();
    const { error: updErr } = await service
      .from("lead_enrichment_events")
      .update(updates)
      .eq("id", id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[PATCH /api/tasks/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: task } = await supabase
      .from("lead_enrichment_events")
      .select("id, leads!inner(user_id)")
      .eq("id", id)
      .eq("provider", "task")
      .single();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const ownership = (task as unknown as { leads?: { user_id?: string } }).leads;
    if (ownership?.user_id !== user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const service = createServiceClient();
    await service.from("lead_enrichment_events").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[DELETE /api/tasks/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
