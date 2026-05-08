"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
import { Search, Sparkles, RefreshCw } from "lucide-react";
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
  source_url: string;
  score: number;
  score_label: ScoreLabel;
  outreach_status: OutreachStatus;
  outreach_email: string | null;
  run_id: string | null;
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
  const router = useRouter();
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
  const [outreachStatus, setOutreachStatus] = useState("");

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
      if (outreachStatus) params.set("outreach_status", outreachStatus);

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
  }, [page, runFilter, search, scoreLabel, leadType, hasEmail, hasPhone, hasWebsite, outreachStatus]);

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
            Export {selected.size > 0 ? `Selected (${selected.size})` : "CSV"}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-8 h-9"
        />
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-40">
          <Select value={scoreLabel} onValueChange={(v: string | null) => { setScoreLabel(!v || v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger>
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

        <div className="w-48">
          <Select value={leadType} onValueChange={(v: string | null) => { setLeadType(!v || v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Lead type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All types</SelectItem>
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
          <Select value={outreachStatus} onValueChange={(v: string | null) => { setOutreachStatus(!v || v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Outreach" />
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

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Switch id="hasEmail" checked={hasEmail} onCheckedChange={(v) => { setHasEmail(v); setPage(1); }} />
            <Label htmlFor="hasEmail">Has email</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch id="hasPhone" checked={hasPhone} onCheckedChange={(v) => { setHasPhone(v); setPage(1); }} />
            <Label htmlFor="hasPhone">Has phone</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch id="hasWebsite" checked={hasWebsite} onCheckedChange={(v) => { setHasWebsite(v); setPage(1); }} />
            <Label htmlFor="hasWebsite">Has website</Label>
          </div>
        </div>
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
                  <TableCell className="font-medium max-w-[180px] truncate">
                    <Link href={`/leads/${lead.id}`} className="hover:underline">
                      {lead.primary_name || "—"}
                    </Link>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => window.open(lead.website_url!, "_blank")}
                        >
                          Site
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
