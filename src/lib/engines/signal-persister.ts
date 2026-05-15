// SIGNAL PERSISTER (#14 — compliance audit trail)
//
// Writes detected signals (weird signals, review insights, press mentions)
// to the lead_signals table with source attribution. The table existed but
// was empty — this engine finally populates it, giving us a per-lead
// audit trail of every observation that influenced scoring or outreach.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeirdSignal } from "@/lib/engines/weird-signal-scanner";
import type { ReviewSignal } from "@/lib/engines/review-intelligence";
import type { PressMention } from "@/lib/engines/news-scanner";

export interface PersistInputs {
  weird_signals?: WeirdSignal[];
  review_signals?: ReviewSignal[];
  press_mentions?: PressMention[];
}

export async function persistSignalsForLead(
  service: SupabaseClient,
  leadId: string,
  inputs: PersistInputs
): Promise<{ inserted: number }> {
  const rows: Array<{
    lead_id: string;
    signal_type: string;
    signal_value: string;
    source_url?: string;
    confidence: "high" | "medium" | "low";
  }> = [];

  for (const s of inputs.weird_signals ?? []) {
    rows.push({
      lead_id: leadId,
      signal_type: `weird:${s.code}`,
      signal_value: s.description,
      confidence: s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low",
    });
  }

  for (const s of inputs.review_signals ?? []) {
    rows.push({
      lead_id: leadId,
      signal_type: `review:${s.kind}`,
      signal_value: s.description,
      confidence: s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low",
    });
  }

  for (const m of inputs.press_mentions ?? []) {
    rows.push({
      lead_id: leadId,
      signal_type: `press:${m.domain}`,
      signal_value: m.title,
      source_url: m.url,
      confidence: "high", // press is a verified third-party source
    });
  }

  if (rows.length === 0) return { inserted: 0 };

  try {
    // De-dupe vs existing rows for this lead — avoid re-inserting the same
    // signal_type on every scan.
    const { data: existing } = await service
      .from("lead_signals")
      .select("signal_type")
      .eq("lead_id", leadId);
    const existingTypes = new Set((existing ?? []).map((r) => r.signal_type));
    const novel = rows.filter((r) => !existingTypes.has(r.signal_type));
    if (novel.length === 0) return { inserted: 0 };

    const { error } = await service.from("lead_signals").insert(novel);
    if (error) {
      console.error("[signal-persister] insert failed:", error.message);
      return { inserted: 0 };
    }
    return { inserted: novel.length };
  } catch (err) {
    console.error("[signal-persister] failed:", err instanceof Error ? err.message : err);
    return { inserted: 0 };
  }
}
