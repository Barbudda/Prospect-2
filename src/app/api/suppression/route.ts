// GET /api/suppression                 → list user's suppression entries
// POST /api/suppression                 → add an email/phone manually
// DELETE /api/suppression?id=<uuid>     → remove a single entry
//
// The DNC button on /leads/[id] auto-adds via markLeadDoNotContact, so this
// endpoint is mostly used by power users importing their existing
// unsubscribe list or removing an entry by mistake.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  addToSuppressionList,
  removeFromSuppressionList,
  normaliseEmailForSuppression,
  normalisePhoneForSuppression,
} from "@/lib/utils/suppression";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)), 500);

    const { data, error } = await supabase
      .from("suppression_list")
      .select("id, kind, value, reason, source, source_lead_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Soft-fail when migration 007 hasn't been applied yet.
      if (/relation .*suppression_list.* does not exist/i.test(error.message)) {
        return NextResponse.json({
          entries: [],
          total: 0,
          info: "Suppression list table not yet provisioned. Apply migration 007 to enable.",
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ entries: data ?? [], total: data?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/suppression]", message);
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

    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      phone?: string;
      reason?: string;
      entries?: Array<{ email?: string; phone?: string; reason?: string }>;
    };

    const entries = Array.isArray(body.entries)
      ? body.entries
      : [{ email: body.email, phone: body.phone, reason: body.reason }];

    // Validate and reject obviously-bad inputs early so the user sees the
    // error rather than a silent no-op.
    const cleaned: Array<{ email?: string; phone?: string; reason?: string }> = [];
    for (const e of entries) {
      const email = normaliseEmailForSuppression(e.email ?? null);
      const phone = normalisePhoneForSuppression(e.phone ?? null);
      if (!email && !phone) continue;
      cleaned.push({
        email: email ?? undefined,
        phone: phone ?? undefined,
        reason: e.reason,
      });
    }
    if (cleaned.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one valid email or phone." },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const result = await addToSuppressionList(
      service,
      user.id,
      cleaned.map((e) => ({ ...e, source: "manual_api" }))
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/suppression]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const service = createServiceClient();
    const result = await removeFromSuppressionList(service, user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[DELETE /api/suppression]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
