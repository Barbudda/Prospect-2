"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Sparkles, RefreshCw, Copy } from "lucide-react";
import type { ScoreLabel, OutreachStatus } from "@/lib/types";

interface Lead {
  id: string;
  primary_name: string;
  lead_type: string;
  city: string;
  country: string;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  instagram_url: string | null;
  contact_form_url: string | null;
  source_url: string;
  score: number;
  score_label: ScoreLabel;
  outreach_status: OutreachStatus;
  outreach_email: string | null;
  run_id: string | null;
  superhost: boolean | null;
  review_count: number | null;
}

const SCORE_COLORS: Record<ScoreLabel, string> = {
  Hot: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  Good: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400",
  Medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400",
  Weak: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const OUTREACH_COLORS: Record<OutreachStatus, string> = {
  not_contacted: "text-muted-foreground",
  contacted: "text-blue-600 dark:text-blue-400 font-medium",
  replied: "text-emerald-600 dark:text-emerald-400 font-semibold",
  not_interested: "text-gray-400 line-through",
  converted: "text-emerald-700 dark:text-emerald-300 font-bold",
  unsubscribed: "text-gray-400",
  opted_out: "text-gray-400",
};

export default function LeadsPage() {
  const sp = useSearchParams();
  const runFilter = sp.get("run") ?? "";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generatingBulk, setGeneratingBulk] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [scoreLabel, setScoreLabel] = useState("");
  const [leadType, setLeadType] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [hasInstagram, setHasInstagram] = useState(false);
  const [hasContactForm, setHasContactForm] = useState(false);
  const [superhostOnly, setSuperhostOnly] = useState(false);
  const [minReviews, setMinReviews] = useState("");
  const [outreachStatus, setOutreachStatus] = useState("");
  const [sortBy, setSortBy] = useState("score_desc");

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (runFilter) params.set("run", runFilter);
      if (search) params.set("q", search);
      if (scoreLabel) params.set("score_label", scoreLabel);
      if (leadType) params.set("lead_type", leadType);
      if (hasEmail) params.set("has_email", "true");
      if (hasPhone) params.set("has_phone", "true");
      if (hasWebsite) params.set("has_website", "true");
      if (hasInstagram) params.set("has_instagram", "true");
      if (hasContactForm) params.set("has_contact_form", "true");
      if (superhostOnly) params.set("superhost", "true");
      if (minReviews) params.set("min_reviews", minReviews);
      if (outreachStatus) params.set("outreach_status", outreachStatus);
      if (sortBy) params.set("sort", sortBy);

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch leads");
      const data = await res.json();
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [page, runFilter, search, scoreLabel, leadType, hasEmail, hasPhone, hasWebsite, hasInstagram, hasContactForm, superhostOnly, minReviews, outreachStatus, sortBy]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }

  async function markSelected(status: OutreachStatus) {
    if (selected.size === 0) return;
    try {
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), outreach_status: status }),
      });
      toast.success(`${selected.size} lead(s) updated`);
      fetchLeads();
      setSelected(new Set());
    } catch {
      toast.error("Failed to update leads");
    }
  }

  async function copyEmails() {
    const emails = leads
      .filter((l) => selected.has(l.id) && l.email)
      .map((l) => l.email as string);
    if (emails.length === 0) {
      toast.error("No emails found in selected leads");
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      toast.success(`${emails.length} email(s) copied to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} lead(s)? This cannot be undone.`)) return;
    try {
      await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      toast.success(`${selected.size} lead(s) deleted`);
      setSelected(new Set());
      fetchLeads();
    } catch {
      toast.error("Failed to delete leads");
    }
  }

  async function generateBulkOutreach() {
    const ids = Array.from(selected).slice(0, 10);
    if (ids.length === 0) return;
    setGeneratingBulk(true);
    try {
      const res = await fetch("/api/leads/bulk-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success(`Generated outreach emails for ${data.succeeded}/${data.total} leads`);
      fetchLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate emails");
    } finally {
      setGeneratingBulk(false);
    }
  }

  async function exportCSV() {
    const params = new URLSearchParams();
    if (runFilter) params.set("run", runFilter);
    if (selected.size > 0) params.set("ids", Array.from(selected).join(","));
    window.location.href = `/api/export/csv?${params.toString()}`;
  }

  async function exportXLSX() {
    const params = new URLSearchParams();
    if (runFilter) params.set("run", runFilter);
    if (selected.size > 0) params.set("ids", Array.from(selected).join(","));
    window.location.href = `/api/export/xlsx?${params.toString()}`;
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} total leads</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={copyEmails}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Emails
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={generateBulkOutreach}
                disabled={generatingBulk}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generatingBulk
                  ? "Generating..."
                  : `Generate Emails (${Math.min(selected.size, 10)})`}
              </Button>
              <Button variant="outline" size="sm" onClick={() => markSelected("contacted")}>
                Mark Contacted ({selected.size})
              </Button>
              <Button variant="outline" size="sm" onClick={() => markSelected("unsubscribed")}>
                Mark Unsubscribed
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-amber-600 hover:bg-amber-500/10"
                onClick={async () => {
                  if (!confirm(`Mark ${selected.size} lead(s) as Do-Not-Contact?\nTheir contact data (email, phone, WhatsApp) will be nulled.`)) return;
                  const ids = Array.from(selected);
                  const res = await fetch("/api/leads/bulk-dnc", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lead_ids: ids, reason: "Bulk DNC from leads list" }),
                  });
                  if (!res.ok) {
                    const b = await res.json().catch(() => ({}));
                    toast.error(b.error ?? "Bulk DNC failed");
                    return;
                  }
                  const data = await res.json();
                  toast.success(`${data.processed} marked DNC, ${data.failed} failed`);
                  setSelected(new Set());
                  fetchLeads();
                }}
              >
                Bulk DNC ({selected.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={deleteSelected}
              >
                Delete ({selected.size})
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            Export {selected.size > 0 ? `CSV (${selected.size})` : "CSV"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={exportXLSX}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Export {selected.size > 0 ? `Excel (${selected.size})` : "Excel"}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        {/* Row 1: search + sort */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-8 h-9"
            />
          </div>
          <div className="w-44">
            <Select value={sortBy} onValueChange={(v: string | null) => { if (v) { setSortBy(v); setPage(1); } }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="score_desc">Score ↓ (Best first)</SelectItem>
                <SelectItem value="score_asc">Score ↑ (Worst first)</SelectItem>
                <SelectItem value="hidden_potential">Hidden Potential</SelectItem>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="email_first">Email first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: dropdowns */}
        <div className="flex gap-3 flex-wrap">
          <div className="w-44">
            <Select value={scoreLabel} onValueChange={(v: string | null) => { setScoreLabel(!v || v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All scores</SelectItem>
                <SelectItem value="Hot">Hot</SelectItem>
                <SelectItem value="Good">Good</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Weak">Weak</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-52">
            <Select value={leadType} onValueChange={(v: string | null) => { setLeadType(!v || v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Lead type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All types</SelectItem>
                <SelectItem value="Individual Airbnb Host">Individual Airbnb Host</SelectItem>
                <SelectItem value="Airbnb Concierge">Airbnb Concierge</SelectItem>
                <SelectItem value="Property Manager">Property Manager</SelectItem>
                <SelectItem value="Direct Booking Owner">Direct Booking Owner</SelectItem>
                <SelectItem value="Vacation Rental Agency">Vacation Rental Agency</SelectItem>
                <SelectItem value="Gîte / Villa Operator">Gîte / Villa Operator</SelectItem>
                <SelectItem value="Co-host / Consultant">Co-host / Consultant</SelectItem>
                <SelectItem value="Real Estate Seasonal Rental">Real Estate Seasonal Rental</SelectItem>
                <SelectItem value="Unknown STR Lead">Unknown STR Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <Select value={minReviews} onValueChange={(v: string | null) => { setMinReviews(!v || v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Min. reviews" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any reviews</SelectItem>
                <SelectItem value="5">5+ reviews</SelectItem>
                <SelectItem value="10">10+ reviews</SelectItem>
                <SelectItem value="20">20+ reviews</SelectItem>
                <SelectItem value="50">50+ reviews</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <Select value={outreachStatus} onValueChange={(v: string | null) => { setOutreachStatus(!v || v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Outreach status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All statuses</SelectItem>
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

        {/* Row 3: toggles */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm pt-1">
          {[
            { id: "fEmail", label: "Email", state: hasEmail, set: setHasEmail },
            { id: "fPhone", label: "Phone", state: hasPhone, set: setHasPhone },
            { id: "fWebsite", label: "Website", state: hasWebsite, set: setHasWebsite },
            { id: "fInstagram", label: "Instagram", state: hasInstagram, set: setHasInstagram },
            { id: "fContactForm", label: "Contact form", state: hasContactForm, set: setHasContactForm },
            { id: "fSuperhost", label: "Superhost only", state: superhostOnly, set: setSuperhostOnly },
          ].map((f) => (
            <div key={f.id} className="flex items-center gap-1.5">
              <Switch id={f.id} checked={f.state} onCheckedChange={(v) => { f.set(v); setPage(1); }} />
              <Label htmlFor={f.id} className="text-xs text-muted-foreground cursor-pointer">{f.label}</Label>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      {leads.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-8 py-14 text-center">
          <p className="text-sm font-medium text-foreground">No leads found</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            {runFilter
              ? "This search returned no contactable leads. Try a larger city or adding more source providers."
              : search
              ? `No leads matching "${search}". Try a different name or email.`
              : "Start a search from the dashboard to generate leads."}
          </p>
          {!runFilter && !search && (
            <Link href="/" className="inline-flex items-center gap-1.5 mt-4 rounded-lg h-8 px-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Go to Dashboard
            </Link>
          )}
        </div>
      ) : loading && leads.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          Loading leads...
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size === leads.length && leads.length > 0}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead className="w-16">Score</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-8" title="AI email generated">AI</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} className={selected.has(lead.id) ? "bg-muted/30" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggleSelect(lead.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${SCORE_COLORS[lead.score_label as ScoreLabel] ?? ""}`}
                    >
                      {lead.score} {lead.score_label}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <Link href={`/leads/${lead.id}`} className="hover:underline truncate block">
                      {lead.primary_name || "—"}
                    </Link>
                    <div className="flex gap-1 mt-0.5">
                      {lead.superhost && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">Superhost</span>
                      )}
                      {lead.review_count != null && lead.review_count > 0 && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600">{lead.review_count} reviews</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                    {lead.lead_type}
                  </TableCell>
                  <TableCell className="text-sm">{lead.city}</TableCell>
                  <TableCell className="text-xs">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-blue-600 hover:underline truncate block max-w-[160px]"
                      >
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="hover:underline">
                        {lead.phone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.outreach_email ? (
                      <span title="AI outreach email generated" className="text-xs text-emerald-600 font-medium">✓</span>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs capitalize ${OUTREACH_COLORS[lead.outreach_status as OutreachStatus] ?? "text-muted-foreground"}`}>
                      {lead.outreach_status?.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="inline-flex items-center justify-center rounded-lg h-7 px-2 text-xs font-medium hover:bg-muted hover:text-foreground transition-colors"
                      >
                        Open
                      </Link>
                      {lead.website_url && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(lead.website_url!, "_blank")}>
                          Site
                        </Button>
                      )}
                      {!lead.website_url && lead.contact_form_url && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(lead.contact_form_url!, "_blank")}>
                          Listing
                        </Button>
                      )}
                      {lead.instagram_url && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(lead.instagram_url!, "_blank")}>
                          IG
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
