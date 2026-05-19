"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Send,
  Sparkles,
  RefreshCw,
  Mail,
  Wand2,
  ListChecks,
  Eye,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  primary_name: string | null;
  company_name: string | null;
  lead_type: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  score: number | null;
  score_label: string | null;
  outreach_status: string | null;
  outreach_generated_at: string | null;
}

interface Draft {
  subject: string;
  body: string;
}

type Mode = "rag_per_lead" | "general_template" | "manual";

export default function MailingPage() {
  // ───── Lead pool ─────────────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    setLoadingLeads(true);
    try {
      const res = await fetch("/api/leads?limit=500");
      const data = await res.json();
      setLeads(Array.isArray(data?.leads) ? data.leads : []);
    } catch {
      toast.error("Failed to load leads");
    } finally {
      setLoadingLeads(false);
    }
  }

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (onlyWithEmail && !l.email) return false;
      if (excludeContacted && (l.outreach_status === "contacted" || l.outreach_status === "opted_out" || l.outreach_status === "unsubscribed")) return false;
      if (!filter.trim()) return true;
      const needle = filter.toLowerCase();
      return (
        (l.primary_name ?? "").toLowerCase().includes(needle) ||
        (l.company_name ?? "").toLowerCase().includes(needle) ||
        (l.city ?? "").toLowerCase().includes(needle) ||
        (l.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [leads, filter, onlyWithEmail, excludeContacted]);

  function toggleAll() {
    if (selected.size === filteredLeads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredLeads.map((l) => l.id)));
    }
  }

  // ───── Composer ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("rag_per_lead");
  const [chatPrompt, setChatPrompt] = useState("");
  const [composing, setComposing] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<Draft | null>(null);
  const [generalDraft, setGeneralDraft] = useState<Draft | null>(null);
  const [perLeadDrafts, setPerLeadDrafts] = useState<Record<string, Draft>>({});
  const [manualSubject, setManualSubject] = useState("");
  const [manualBody, setManualBody] = useState("");

  async function preview() {
    if (!chatPrompt.trim()) {
      toast.error("Tell the chatbot what email to write");
      return;
    }
    const previewLead = filteredLeads.find((l) => selected.has(l.id)) ?? filteredLeads[0];
    if (!previewLead) {
      toast.error("Select at least one lead to preview against");
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/email/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", prompt: chatPrompt.trim(), preview_lead_id: previewLead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Compose failed");
      setPreviewDraft(data.draft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setComposing(false);
    }
  }

  async function composeGeneral() {
    if (!chatPrompt.trim()) {
      toast.error("Tell the chatbot what email to write");
      return;
    }
    if (selected.size === 0) {
      toast.error("Select at least one lead");
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/email/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "general", prompt: chatPrompt.trim(), lead_ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Compose failed");
      setGeneralDraft(data.draft);
      toast.success("General template generated. Edit before sending.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setComposing(false);
    }
  }

  async function composePerLead() {
    if (!chatPrompt.trim()) {
      toast.error("Tell the chatbot what email to write");
      return;
    }
    if (selected.size === 0) {
      toast.error("Select at least one lead");
      return;
    }
    if (selected.size > 30 && !confirm(`Per-lead drafting calls the AI ${selected.size}× and can take a minute. Continue?`)) {
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/email/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "per_lead", prompt: chatPrompt.trim(), lead_ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Compose failed");
      setPerLeadDrafts(data.drafts ?? {});
      const drafted = data.drafted ?? 0;
      const requested = data.requested ?? 0;
      toast.success(`Drafted ${drafted}/${requested} emails${data.truncated ? " (capped at 30 per call)" : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setComposing(false);
    }
  }

  // ───── Send ──────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<null | {
    sent: number;
    failed: number;
    skipped_suppressed: number;
    skipped_frequency_cap: number;
    skipped_no_email: number;
  }>(null);
  const [dryRun, setDryRun] = useState(false);
  const [force, setForce] = useState(false);

  async function sendCampaign() {
    if (selected.size === 0) {
      toast.error("Select leads first");
      return;
    }
    if (mode === "manual" && (!manualSubject.trim() || !manualBody.trim())) {
      toast.error("Subject and body required");
      return;
    }
    if (mode === "general_template" && !generalDraft) {
      toast.error("Generate the general template first");
      return;
    }
    if (mode === "rag_per_lead" && Object.keys(perLeadDrafts).length === 0) {
      toast.error("Draft the per-lead emails first");
      return;
    }

    const draftedCount = Object.keys(perLeadDrafts).length;
    const summary =
      mode === "manual"
        ? `Send your manual email to ${selected.size} lead(s).`
        : mode === "general_template"
        ? `Send the general template to ${selected.size} lead(s) with {{primary_name}} / {{city}} substituted.`
        : `Send ${draftedCount} per-lead drafts.`;
    const msg = `${summary}${dryRun ? "\n\n(Dry run — nothing will actually go out.)" : ""}${force ? "\n\nFORCE: bypassing 90-day per-lead frequency cap." : ""}\n\nProceed?`;
    if (!confirm(msg)) return;

    setSending(true);
    setSendResult(null);
    try {
      const payload: Record<string, unknown> = {
        kind: mode,
        lead_ids: Array.from(selected),
        force,
        dry_run: dryRun,
        name: chatPrompt.trim().slice(0, 80) || undefined,
      };
      if (mode === "manual") {
        payload.subject = manualSubject.trim();
        payload.body = manualBody.trim();
      } else if (mode === "general_template" && generalDraft) {
        payload.subject = generalDraft.subject;
        payload.body = generalDraft.body;
      } else if (mode === "rag_per_lead") {
        payload.rag_prompt = chatPrompt.trim();
        payload.rag_drafts = perLeadDrafts;
      }
      const res = await fetch("/api/email/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Campaign failed");
      setSendResult({
        sent: data.sent ?? 0,
        failed: data.failed ?? 0,
        skipped_suppressed: data.skipped_suppressed ?? 0,
        skipped_frequency_cap: data.skipped_frequency_cap ?? 0,
        skipped_no_email: data.skipped_no_email ?? 0,
      });
      toast.success(
        `Campaign done · ${data.sent ?? 0} sent · ${data.failed ?? 0} failed · ${(data.skipped_suppressed ?? 0) + (data.skipped_frequency_cap ?? 0) + (data.skipped_no_email ?? 0)} skipped`
      );
      fetchLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  // ───── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 pb-16">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Mail className="h-3 w-3" />
          Mass mailing
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Auto mailing</h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Pick leads, tell the chatbot what to write, then send. The
          suppression list and the 90-day per-lead frequency cap are
          enforced before every send. Resend powers delivery; bounces and
          spam complaints auto-suppress the recipient.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
        {/* ───── Lead picker ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Audience
            </CardTitle>
            <CardDescription>
              {selected.size} selected · {filteredLeads.length} visible · {leads.length} total
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Filter by name, company, city, email…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 min-w-[180px]"
              />
              <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loadingLeads}>
                <RefreshCw className={`h-3.5 w-3.5 ${loadingLeads ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyWithEmail}
                  onChange={(e) => setOnlyWithEmail(e.target.checked)}
                />
                Only leads with an email
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={excludeContacted}
                  onChange={(e) => setExcludeContacted(e.target.checked)}
                />
                Hide contacted / opted-out
              </label>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Button variant="ghost" size="sm" onClick={toggleAll} className="h-7 text-xs">
                {selected.size === filteredLeads.length && filteredLeads.length > 0
                  ? "Clear selection"
                  : "Select all visible"}
              </Button>
              <span>Click rows to toggle.</span>
            </div>

            <div className="border border-border/60 rounded-lg max-h-[460px] overflow-y-auto divide-y divide-border/40">
              {filteredLeads.map((l) => {
                const checked = selected.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(selected);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      setSelected(next);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-colors ${
                      checked ? "bg-primary/10" : "hover:bg-muted/40"
                    }`}
                  >
                    <input type="checkbox" checked={checked} readOnly className="pointer-events-none" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.primary_name ?? "Unnamed"}</div>
                      <div className="text-muted-foreground truncate">
                        {l.email ?? "no email"}
                        {l.city && ` · ${l.city}`}
                        {l.lead_type && ` · ${l.lead_type}`}
                      </div>
                    </div>
                    {l.outreach_status && l.outreach_status !== "not_contacted" && (
                      <Badge variant="outline" className="text-[10px]">
                        {l.outreach_status}
                      </Badge>
                    )}
                  </button>
                );
              })}
              {!loadingLeads && filteredLeads.length === 0 && (
                <p className="text-xs text-muted-foreground italic p-4 text-center">
                  No leads match. Adjust filters or import more leads first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ───── Composer ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Compose
            </CardTitle>
            <CardDescription>
              Three modes. The chatbot drafts emails from your instruction;
              you always preview and can edit before send.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="rag_per_lead">
                  <Sparkles className="h-3 w-3 mr-1" /> Per-lead AI
                </TabsTrigger>
                <TabsTrigger value="general_template">
                  <Wand2 className="h-3 w-3 mr-1" /> Shared template
                </TabsTrigger>
                <TabsTrigger value="manual">
                  <Mail className="h-3 w-3 mr-1" /> Manual
                </TabsTrigger>
              </TabsList>

              {/* RAG per-lead */}
              <TabsContent value="rag_per_lead" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  One personalised draft per selected lead using its full context
                  (operator type, city, signals).
                </p>
                <textarea
                  value={chatPrompt}
                  onChange={(e) => setChatPrompt(e.target.value)}
                  rows={5}
                  className="input"
                  placeholder="Example: Pitch our AI guest assistant. Reference the city, mention they have no chatbot if that signal is in the data, and lead with cleaning-question reduction. End with a quick 15-min call CTA."
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={preview} disabled={composing || !chatPrompt.trim()} size="sm" variant="outline">
                    <Eye className="h-3.5 w-3.5 mr-1.5" />
                    Preview on one lead
                  </Button>
                  <Button onClick={composePerLead} disabled={composing || !chatPrompt.trim() || selected.size === 0} size="sm">
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    {composing ? "Drafting…" : `Draft ${Math.min(selected.size, 30)} emails`}
                  </Button>
                </div>

                {previewDraft && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview</p>
                    <p className="text-sm font-medium">Subject: {previewDraft.subject}</p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">{previewDraft.body}</p>
                  </div>
                )}

                {Object.keys(perLeadDrafts).length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    {Object.keys(perLeadDrafts).length} per-lead drafts ready. Click Send when you&apos;re happy.
                  </div>
                )}
              </TabsContent>

              {/* Shared template */}
              <TabsContent value="general_template" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  One shared draft that goes to every selected lead. Use{" "}
                  <code className="text-[10px]">{`{{primary_name}}`}</code> and{" "}
                  <code className="text-[10px]">{`{{city}}`}</code> as placeholders.
                </p>
                <textarea
                  value={chatPrompt}
                  onChange={(e) => setChatPrompt(e.target.value)}
                  rows={5}
                  className="input"
                  placeholder="Example: A short pitch about how our AI assistant cuts repetitive guest questions. Keep it under 120 words, professional tone, end with a soft CTA."
                />
                <Button onClick={composeGeneral} disabled={composing || !chatPrompt.trim() || selected.size === 0} size="sm">
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                  {composing ? "Drafting…" : "Draft shared template"}
                </Button>
                {generalDraft && (
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <label className="space-y-1 block">
                      <span className="text-xs font-medium text-muted-foreground">Subject</span>
                      <Input
                        value={generalDraft.subject}
                        onChange={(e) => setGeneralDraft((d) => (d ? { ...d, subject: e.target.value } : d))}
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-xs font-medium text-muted-foreground">Body</span>
                      <textarea
                        value={generalDraft.body}
                        onChange={(e) => setGeneralDraft((d) => (d ? { ...d, body: e.target.value } : d))}
                        rows={10}
                        className="input"
                      />
                    </label>
                  </div>
                )}
              </TabsContent>

              {/* Manual */}
              <TabsContent value="manual" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Write the exact email you want every selected lead to receive. No AI in the loop.
                </p>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium text-muted-foreground">Subject</span>
                  <Input value={manualSubject} onChange={(e) => setManualSubject(e.target.value)} />
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium text-muted-foreground">Body</span>
                  <textarea
                    value={manualBody}
                    onChange={(e) => setManualBody(e.target.value)}
                    rows={10}
                    className="input"
                  />
                </label>
              </TabsContent>
            </Tabs>

            <div className="border-t border-border/40 pt-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                Dry run (queue, don&apos;t send)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Bypass 90-day cap
              </label>
              <div className="flex-1" />
              <Button onClick={sendCampaign} disabled={sending || selected.size === 0}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {sending
                  ? "Sending…"
                  : dryRun
                  ? `Queue ${selected.size} (dry)`
                  : `Send to ${selected.size} lead${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>

            {sendResult && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
                <div className="font-medium text-foreground">Campaign complete</div>
                <div>{sendResult.sent} sent · {sendResult.failed} failed</div>
                <div className="text-muted-foreground">
                  Skipped: {sendResult.skipped_suppressed} suppressed ·{" "}
                  {sendResult.skipped_frequency_cap} within 90-day cap ·{" "}
                  {sendResult.skipped_no_email} without email
                </div>
                <div className="pt-1">
                  <Link href="/leads" className="text-primary hover:underline inline-flex items-center gap-1">
                    Review the contacted leads <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Before you send to real people
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>1. Set <code>RESEND_API_KEY</code> and <code>RESEND_FROM_EMAIL</code> in Vercel env (use a verified sending domain).</p>
          <p>2. Set <code>RESEND_WEBHOOK_SECRET</code> and point Resend webhook at <code>/api/email/webhook/resend</code> to auto-suppress bounces and spam complaints.</p>
          <p>3. Apply migration 008 (run <code>scripts/migrate.mjs</code>) to provision the campaign + message tables.</p>
          <p>4. Every email carries a one-click unsubscribe; complaints and bounces auto-add to the suppression list.</p>
        </CardContent>
      </Card>
    </div>
  );
}
