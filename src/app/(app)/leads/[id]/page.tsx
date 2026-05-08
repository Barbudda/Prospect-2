"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { OutreachStatus, ScoreLabel } from "@/lib/types";

interface LeadDetail {
  id: string;
  primary_name: string;
  company_name?: string;
  person_name?: string;
  lead_type: string;
  city: string;
  country: string;
  address?: string;
  website_url?: string;
  email?: string;
  phone?: string;
  whatsapp_url?: string;
  instagram_url?: string;
  linkedin_url?: string;
  facebook_url?: string;
  contact_form_url?: string;
  google_maps_url?: string;
  source_url: string;
  source_type?: string;
  score: number;
  score_label: ScoreLabel;
  confidence: string;
  outreach_status: OutreachStatus;
  suggested_angle?: string;
  notes?: string;
  quality_summary?: string;
  created_at: string;
  sources: Array<{
    id: string;
    provider: string;
    source_url: string;
    source_type?: string;
    title?: string;
    snippet?: string;
    evidence_text?: string;
    confidence?: string;
  }>;
  signals: Array<{
    id: string;
    signal_type: string;
    signal_value: string;
    source_url?: string;
    confidence?: string;
  }>;
  enrichment_events: Array<{
    id: string;
    provider: string;
    status: string;
    error_message?: string;
    created_at: string;
  }>;
}

const SCORE_COLORS: Record<ScoreLabel, string> = {
  Hot: "bg-red-100 text-red-700",
  Good: "bg-green-100 text-green-700",
  Medium: "bg-yellow-100 text-yellow-700",
  Weak: "bg-gray-100 text-gray-600",
};

function ContactItem({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate">
            {value}
          </a>
        ) : (
          <span className="text-sm truncate">{value}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success("Copied!");
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatus>("not_contacted");
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [outreachEmail, setOutreachEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setLead(d);
        setNotes(d.notes ?? "");
        setOutreachStatus(d.outreach_status ?? "not_contacted");
        if (d.outreach_email) setOutreachEmail(d.outreach_email);
      })
      .catch(() => toast.error("Failed to load lead"));
  }, [id]);

  async function generateOutreach() {
    setGeneratingOutreach(true);
    try {
      const res = await fetch(`/api/leads/${id}/outreach`, { method: "POST" });
      const body = await res.text();
      let data: { email?: string; error?: string } = {};
      try { data = JSON.parse(body); } catch { /* non-json */ }
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      if (data.email) setOutreachEmail(data.email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate outreach");
    } finally {
      setGeneratingOutreach(false);
    }
  }

  async function saveChanges() {
    setSaving(true);
    try {
      await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outreach_status: outreachStatus, notes }),
      });
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!lead) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
          ← All leads
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{lead.primary_name}</h1>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold ${SCORE_COLORS[lead.score_label]}`}
              >
                {lead.score} — {lead.score_label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {lead.lead_type} · {lead.city}, {lead.country}
            </p>
          </div>
        </div>
      </div>

      {/* Contact Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Contact Details
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {lead.email ? (
            <ContactItem label="Email" value={lead.email} href={`mailto:${lead.email}`} />
          ) : (
            <div className="py-2 text-sm text-muted-foreground">No email found.</div>
          )}
          {lead.phone && <ContactItem label="Phone" value={lead.phone} href={`tel:${lead.phone}`} />}
          {lead.whatsapp_url && <ContactItem label="WhatsApp" value={lead.whatsapp_url} href={lead.whatsapp_url} />}
          {lead.contact_form_url && (
            <ContactItem label="Contact Form" value={lead.contact_form_url} href={lead.contact_form_url} />
          )}
          {lead.website_url && (
            <ContactItem label="Website" value={lead.website_url} href={lead.website_url} />
          )}
          {lead.instagram_url && (
            <ContactItem label="Instagram" value={lead.instagram_url} href={lead.instagram_url} />
          )}
          {lead.linkedin_url && (
            <ContactItem label="LinkedIn" value={lead.linkedin_url} href={lead.linkedin_url} />
          )}
          {lead.facebook_url && (
            <ContactItem label="Facebook" value={lead.facebook_url} href={lead.facebook_url} />
          )}
          {lead.google_maps_url && (
            <ContactItem label="Google Maps" value="View on Maps" href={lead.google_maps_url} />
          )}
          {lead.address && <ContactItem label="Address" value={lead.address} />}
          {!lead.email && !lead.phone && !lead.contact_form_url && (
            <div className="py-2 text-sm text-amber-700 dark:text-amber-400">
              No contact method found for this lead.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quality Summary */}
      {lead.quality_summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Quality Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{lead.quality_summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Sources & Evidence */}
      {lead.sources.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Sources & Evidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {lead.sources.map((src) => (
                <div key={src.id} className="text-sm border rounded p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-xs">
                      {src.provider ?? src.source_type}
                    </Badge>
                    {src.confidence && (
                      <span className="text-xs text-muted-foreground capitalize">{src.confidence} confidence</span>
                    )}
                  </div>
                  {src.title && <p className="font-medium">{src.title}</p>}
                  <a
                    href={src.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs break-all"
                  >
                    {src.source_url}
                  </a>
                  {src.evidence_text && (
                    <p className="text-muted-foreground text-xs leading-relaxed">{src.evidence_text}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signals */}
      {lead.signals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Detected Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lead.signals.map((sig) => (
                <Badge key={sig.id} variant="secondary" className="text-xs">
                  {sig.signal_value}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Outreach Writer */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              AI Outreach Email
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={generateOutreach}
              disabled={generatingOutreach}
            >
              {generatingOutreach
                ? "Generating..."
                : outreachEmail
                ? "Regenerate"
                : "Generate with AI"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {outreachEmail ? (
            <div className="space-y-3">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed rounded-lg bg-muted/40 p-4 font-sans">
                {outreachEmail}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(outreachEmail);
                  toast.success("Copied to clipboard!");
                }}
              >
                Copy email
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click &ldquo;Generate with AI&rdquo; to create a personalized outreach email based on this lead&apos;s website and profile.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Outreach */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Outreach
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lead.suggested_angle && (
            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                Suggested Angle
              </p>
              {lead.suggested_angle}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Outreach Status</Label>
              <Select
                value={outreachStatus}
                onValueChange={(v: string | null) => { if (v) setOutreachStatus(v as OutreachStatus); }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_contacted">Not contacted</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="replied">Replied</SelectItem>
                  <SelectItem value="not_interested">Not interested</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                  <SelectItem value="opted_out">Opted out</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              placeholder="Add notes about this lead..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <Button size="sm" onClick={saveChanges} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Enrichment History */}
      {lead.enrichment_events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Enrichment History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lead.enrichment_events.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ev.provider}</span>
                    <Badge
                      variant={ev.status === "success" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {ev.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source URL */}
      <div className="text-xs text-muted-foreground">
        Original source:{" "}
        <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline break-all">
          {lead.source_url}
        </a>
      </div>
    </div>
  );
}
