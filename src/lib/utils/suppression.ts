// SUPPRESSION LIST — compliance Tier 1.1
//
// Per-user do-not-contact registry. Every lead-insert path consults this
// helper to skip emails / phones that the user has previously marked as
// opted-out, so we never re-acquire a suppressed contact from a different
// source. Keyed on E.164 phones and lowercased emails so any variant of
// the same contact (spaces, country prefix, casing) still matches.
//
// All checks degrade gracefully when the `suppression_list` table is
// missing (migration 007 not yet applied) — the helper logs once and
// returns "not suppressed" so existing flows keep working. Apply
// migration 007 to activate enforcement.

import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePhone } from "./contact-validator";

let warnedMissingTable = false;

export interface SuppressionKey {
  email?: string | null;
  phone?: string | null;
}

interface SuppressionRow {
  kind: "email" | "phone" | "domain";
  value: string;
}

// Normalise an email/phone into the canonical form we store in the table.
export function normaliseEmailForSuppression(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalisePhoneForSuppression(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const v = validatePhone(raw, "FR");
  return v.valid && v.e164 ? v.e164 : null;
}

// Pull the user's entire suppression list as a Set keyed by `kind:value`.
// Caching the whole set is cheap (typical user has <1000 suppressions) and
// avoids per-row round-trips when bulk-inserting hundreds of leads.
export async function loadSuppressionSet(
  service: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  try {
    const { data, error } = await service
      .from("suppression_list")
      .select("kind, value")
      .eq("user_id", userId)
      .limit(10_000);
    if (error) {
      // Common case: migration 007 not applied yet. Don't crash the caller.
      if (
        /relation .*suppression_list.* does not exist/i.test(error.message) ||
        /could not find/i.test(error.message)
      ) {
        if (!warnedMissingTable) {
          console.warn(
            "[suppression] `suppression_list` table missing — skipping enforcement. Apply migration 007."
          );
          warnedMissingTable = true;
        }
        return new Set<string>();
      }
      console.warn("[suppression] read failed:", error.message);
      return new Set<string>();
    }
    return new Set((data ?? []).map((r: SuppressionRow) => `${r.kind}:${r.value}`));
  } catch (err) {
    console.warn("[suppression] read threw:", err instanceof Error ? err.message : err);
    return new Set<string>();
  }
}

// Check whether a single contact (email or phone, either or both) is
// currently suppressed for the given user.
export function isSuppressed(
  suppressed: Set<string>,
  key: SuppressionKey
): { suppressed: boolean; reason?: string } {
  const email = normaliseEmailForSuppression(key.email ?? null);
  if (email && suppressed.has(`email:${email}`)) {
    return { suppressed: true, reason: `email:${email}` };
  }
  const phone = normalisePhoneForSuppression(key.phone ?? null);
  if (phone && suppressed.has(`phone:${phone}`)) {
    return { suppressed: true, reason: `phone:${phone}` };
  }
  return { suppressed: false };
}

// Bulk-insert one or many contacts into the suppression list. Idempotent —
// the unique constraint on (user_id, kind, value) makes re-inserts no-ops.
export async function addToSuppressionList(
  service: SupabaseClient,
  userId: string,
  entries: Array<{
    email?: string | null;
    phone?: string | null;
    reason?: string | null;
    source?: string | null;
    source_lead_id?: string | null;
  }>
): Promise<{ inserted: number; skipped: number }> {
  const rows: Array<{
    user_id: string;
    kind: "email" | "phone";
    value: string;
    reason: string | null;
    source: string | null;
    source_lead_id: string | null;
  }> = [];

  for (const e of entries) {
    const email = normaliseEmailForSuppression(e.email);
    const phone = normalisePhoneForSuppression(e.phone);
    if (email) {
      rows.push({
        user_id: userId,
        kind: "email",
        value: email,
        reason: e.reason ?? null,
        source: e.source ?? null,
        source_lead_id: e.source_lead_id ?? null,
      });
    }
    if (phone) {
      rows.push({
        user_id: userId,
        kind: "phone",
        value: phone,
        reason: e.reason ?? null,
        source: e.source ?? null,
        source_lead_id: e.source_lead_id ?? null,
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  try {
    const { data, error } = await service
      .from("suppression_list")
      .upsert(rows, { onConflict: "user_id,kind,value", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (
        /relation .*suppression_list.* does not exist/i.test(error.message) ||
        /could not find/i.test(error.message)
      ) {
        // Table missing — fail soft. Caller will still flag the lead via
        // the existing outreach_status path.
        return { inserted: 0, skipped: rows.length };
      }
      console.error("[suppression] insert failed:", error.message);
      return { inserted: 0, skipped: rows.length };
    }
    const inserted = data?.length ?? 0;
    return { inserted, skipped: rows.length - inserted };
  } catch (err) {
    console.error("[suppression] insert threw:", err instanceof Error ? err.message : err);
    return { inserted: 0, skipped: rows.length };
  }
}

// Remove a single suppression by id (used by the manual management endpoint).
export async function removeFromSuppressionList(
  service: SupabaseClient,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const { error } = await service
    .from("suppression_list")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    console.warn("[suppression] delete failed:", error.message);
    return { deleted: false };
  }
  return { deleted: true };
}
