// GET /api/partners
// Classifies every saved lead as either a target customer or a potential
// partner (cleaning, photography, smart-locks, etc.). Returns the partner
// candidates grouped by role.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyLeadAsPartner, type LeadForPartner, type PartnerRole } from "@/lib/engines/partner-classifier";

export const dynamic = "force-dynamic";

interface LeadRow extends LeadForPartner {
  id: string;
  city?: string | null;
  score?: number | null;
  phone?: string | null;
  email?: string | null;
  website_url?: string | null;
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, lead_type, city, quality_summary, score, phone, email, website_url"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(3000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const leads = (data ?? []) as LeadRow[];

    interface PartnerHit {
      id: string;
      name: string;
      city?: string | null;
      score?: number | null;
      role: PartnerRole;
      confidence: "high" | "medium" | "low";
      reasoning: string;
      has_contact: boolean;
    }
    const byRole = new Map<PartnerRole, PartnerHit[]>();
    let total = 0;

    for (const lead of leads) {
      const c = classifyLeadAsPartner(lead);
      if (!c.is_partner) continue;
      total++;
      const arr = byRole.get(c.role) ?? [];
      arr.push({
        id: lead.id,
        name: lead.primary_name ?? "(unnamed)",
        city: lead.city,
        score: lead.score,
        role: c.role,
        confidence: c.confidence,
        reasoning: c.reasoning,
        has_contact: Boolean(lead.phone || lead.email || lead.website_url),
      });
      byRole.set(c.role, arr);
    }

    // Sort each role bucket by score desc
    for (const [, arr] of byRole) {
      arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    const groups = Array.from(byRole.entries())
      .map(([role, partners]) => ({ role, count: partners.length, partners: partners.slice(0, 50) }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ total_partners: total, groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/partners]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
