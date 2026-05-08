import type {
  NormalizedLead,
  RunConfig,
  RunStats,
  SearchResult,
  RawBusinessResult,
  LogLevel,
} from "@/lib/types";
import { generateQueries, detectLanguage } from "./query-generator";
import { extractContactsFromWebsite } from "./contact-extractor";
import { classifyLead } from "./classifier";
import { scoreLead } from "./scorer";
import { deduplicateLeads } from "./deduplicator";
import { generateOutreachAngle } from "./outreach";
import { SerpAPISearchProvider } from "@/lib/providers/serpapi-search";
import { BraveSearchProvider } from "@/lib/providers/brave-search";
import { TavilySearchProvider } from "@/lib/providers/tavily-search";
import { GooglePlacesProvider } from "@/lib/providers/google-places";
import { SerpAPIMapsProvider } from "@/lib/providers/serpapi-maps";
import { HunterProvider } from "@/lib/providers/hunter";
import { DropcontactProvider } from "@/lib/providers/dropcontact";
import { extractDomain } from "@/lib/utils/url";
import { DEFAULT_RUN_CONFIG } from "@/lib/types";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Provider registries ──────────────────────────────────────────────────

const SEARCH_PROVIDERS = [new SerpAPISearchProvider(), new BraveSearchProvider(), new TavilySearchProvider()];
const LOCAL_PROVIDERS = [new GooglePlacesProvider(), new SerpAPIMapsProvider()];
const ENRICHMENT_PROVIDERS = [new HunterProvider(), new DropcontactProvider()];

// ─── Logger ───────────────────────────────────────────────────────────────

async function log(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>
) {
  await supabase.from("search_run_logs").insert({
    run_id: runId,
    level,
    message,
    metadata_json: metadata ?? null,
  });
}

async function updateRun(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  updates: Record<string, unknown>
) {
  await supabase.from("search_runs").update(updates).eq("id", runId);
}

// ─── Sleep helper ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── OTA domain blocklist ──────────────────────────────────────────────────

const OTA_DOMAINS = new Set([
  "booking.com", "tripadvisor.com", "tripadvisor.fr",
  "airbnb.com", "airbnb.fr", "vrbo.com", "homeaway.com",
  "expedia.com", "hotels.com", "google.com", "yelp.com",
  "pagesjaunes.fr", "leboncoin.fr", "abritel.fr",
]);

function isOtaUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return OTA_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// ─── Lead normalizer ──────────────────────────────────────────────────────

function businessToLead(
  result: RawBusinessResult,
  city: string,
  country: string,
  query: string
): NormalizedLead {
  const text = [result.business_name, result.category ?? ""].join(" ");
  const leadType = classifyLead(text, result.category);
  const domain = result.website ? extractDomain(result.website) ?? undefined : undefined;

  const qualitySummary = [
    `Found via local business search for "${query}".`,
    result.category ? `Category: ${result.category}.` : null,
    result.rating ? `Rating: ${result.rating}/5 (${result.review_count ?? 0} reviews).` : null,
    result.website ? `Website: ${result.website}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const partial: Partial<NormalizedLead> = {
    primary_name: result.business_name,
    company_name: result.business_name,
    lead_type: leadType,
    city,
    country,
    address: result.address,
    website_url: result.website,
    domain,
    phone: result.phone,
    google_maps_url: result.google_maps_url,
    source_url: result.source_url || result.google_maps_url || "",
    source_type: "local_business",
    quality_summary: qualitySummary,
    confidence: "medium",
    status: "new",
    outreach_status: "not_contacted",
    sources: [
      {
        provider: "local_business",
        source_url: result.source_url || result.google_maps_url || "",
        source_type: "local_business",
        title: result.business_name,
        evidence_text: qualitySummary,
        confidence: "medium",
      },
    ],
    raw_payload: result.raw_provider_payload,
  };

  const { score, label } = scoreLead(partial);

  return {
    ...partial,
    score,
    score_label: label,
    suggested_angle: generateOutreachAngle(leadType),
    source_url: partial.source_url!,
  } as NormalizedLead;
}

function searchResultToLead(
  result: SearchResult,
  city: string,
  country: string,
  query: string
): NormalizedLead | null {
  if (isOtaUrl(result.url)) return null;

  const text = [result.title, result.snippet ?? ""].join(" ");
  const leadType = classifyLead(text);
  const domain = extractDomain(result.url) ?? undefined;

  const qualitySummary = [
    `Found via web search for "${query}".`,
    result.snippet ? `Snippet: ${result.snippet}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const partial: Partial<NormalizedLead> = {
    primary_name: result.title.split(/[|\-–]/)[0].trim(),
    company_name: result.title.split(/[|\-–]/)[0].trim(),
    lead_type: leadType,
    city,
    country,
    website_url: result.url,
    domain,
    source_url: result.url,
    source_type: "web_search",
    quality_summary: qualitySummary,
    confidence: "low",
    status: "new",
    outreach_status: "not_contacted",
    sources: [
      {
        provider: "web_search",
        source_url: result.url,
        source_type: "web_search",
        title: result.title,
        snippet: result.snippet,
        evidence_text: qualitySummary,
        confidence: "low",
      },
    ],
  };

  const { score, label } = scoreLead(partial);

  return {
    ...partial,
    score,
    score_label: label,
    lead_type: leadType,
    suggested_angle: generateOutreachAngle(leadType),
    source_url: result.url,
  } as NormalizedLead;
}

// ─── Persist leads to DB (full — with sources and signals) ────────────────

async function persistLeads(
  supabase: ReturnType<typeof createServiceClient>,
  leads: NormalizedLead[],
  userId: string,
  runId: string
): Promise<void> {
  for (const lead of leads) {
    const { data: inserted, error } = await supabase
      .from("leads")
      .insert({
        user_id: userId,
        run_id: runId,
        primary_name: lead.primary_name,
        company_name: lead.company_name,
        person_name: lead.person_name,
        lead_type: lead.lead_type,
        city: lead.city,
        country: lead.country,
        address: lead.address,
        website_url: lead.website_url,
        domain: lead.domain,
        email: lead.email || null,
        phone: lead.phone || null,
        whatsapp_url: lead.whatsapp_url,
        instagram_url: lead.instagram_url,
        linkedin_url: lead.linkedin_url,
        facebook_url: lead.facebook_url,
        contact_form_url: lead.contact_form_url,
        google_maps_url: lead.google_maps_url,
        source_url: lead.source_url,
        source_type: lead.source_type,
        score: lead.score,
        score_label: lead.score_label,
        confidence: lead.confidence,
        status: "new",
        outreach_status: "not_contacted",
        suggested_angle: lead.suggested_angle,
        quality_summary: lead.quality_summary,
      })
      .select("id")
      .single();

    if (error || !inserted) continue;

    const leadId = inserted.id as string;

    if (lead.sources && lead.sources.length > 0) {
      await supabase.from("lead_sources").insert(
        lead.sources.map((s) => ({
          lead_id: leadId,
          run_id: runId,
          provider: s.provider,
          source_url: s.source_url,
          source_type: s.source_type,
          title: s.title,
          snippet: s.snippet,
          evidence_text: s.evidence_text,
          confidence: s.confidence,
        }))
      );
    }

    if (lead.signals && lead.signals.length > 0) {
      await supabase.from("lead_signals").insert(
        lead.signals.map((s) => ({
          lead_id: leadId,
          signal_type: s.signal_type,
          signal_value: s.signal_value,
          source_url: s.source_url,
          confidence: s.confidence,
        }))
      );
    }
  }
}

// ─── Draft save (minimal insert for live progress count) ─────────────────
// Saves just enough to make the lead count visible on the progress page.
// These draft leads are deleted and replaced by the final persist at the end.

async function saveDraftLeads(
  supabase: ReturnType<typeof createServiceClient>,
  leads: NormalizedLead[],
  userId: string,
  runId: string
): Promise<void> {
  if (leads.length === 0) return;
  const rows = leads.map((lead) => ({
    user_id: userId,
    run_id: runId,
    primary_name: lead.primary_name,
    lead_type: lead.lead_type,
    city: lead.city,
    country: lead.country,
    website_url: lead.website_url ?? null,
    domain: lead.domain ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    source_url: lead.source_url,
    source_type: lead.source_type ?? null,
    score: lead.score,
    score_label: lead.score_label,
    confidence: lead.confidence,
    status: "draft",
    outreach_status: "not_contacted",
  }));
  // Insert all rows, ignore individual failures
  await supabase.from("leads").insert(rows);
}

// ─── Main orchestrator ────────────────────────────────────────────────────

export async function runSearchOrchestrator(
  runId: string,
  userId: string,
  city: string,
  country: string,
  targetType: string,
  config: Partial<RunConfig> = {}
): Promise<void> {
  const cfg: RunConfig = { ...DEFAULT_RUN_CONFIG, ...config };
  const supabase = createServiceClient();
  const language = detectLanguage(country);
  const stats: RunStats = {
    sources_found: 0,
    websites_crawled: 0,
    leads_extracted: 0,
    leads_deduplicated: 0,
    errors: 0,
    enriched: 0,
  };

  try {
    // ── Mark running ──────────────────────────────────────────────────────
    await updateRun(supabase, runId, {
      status: "running",
      started_at: new Date().toISOString(),
      progress: 5,
    });
    await log(supabase, runId, "info", `Search started for ${city}, ${country}`);

    // ── Generate queries ──────────────────────────────────────────────────
    const normalizedTarget = (targetType ?? "all").toLowerCase().replace(/ /g, "_") as
      | "all"
      | "concierges"
      | "property_managers"
      | "direct_owners"
      | "agencies";
    const queries = generateQueries(city, country, normalizedTarget, cfg.maxSearchQueries);

    let allLeads: NormalizedLead[] = [];
    const seenUrls = new Set<string>();

    // ══ ENGINE 1: Local Business Search ══════════════════════════════════
    await updateRun(supabase, runId, { status: "collecting_sources", progress: 10 });

    if (cfg.enableLocalBusiness) {
      const configuredLocalProviders = LOCAL_PROVIDERS.filter((p) => p.isConfigured());

      if (configuredLocalProviders.length === 0) {
        await log(supabase, runId, "warn", "No local business provider configured — skipping Engine 1");
      } else {
        for (const provider of configuredLocalProviders) {
          for (const query of queries.localBusiness.slice(0, 10)) {
            try {
              const results = await provider.searchBusinesses(
                query,
                `${city}, ${country}`,
                country,
                cfg.maxResultsPerQuery
              );
              await sleep(cfg.searchProviderDelayMs);

              const newLeads: NormalizedLead[] = [];
              for (const r of results) {
                if (!r.source_url || seenUrls.has(r.source_url)) continue;
                seenUrls.add(r.source_url);
                stats.sources_found++;
                const lead = businessToLead(r, city, country, query);
                if (lead.source_url) {
                  allLeads.push(lead);
                  newLeads.push(lead);
                }
              }

              // Progressive save: persist draft leads immediately for live count
              if (newLeads.length > 0) {
                await saveDraftLeads(supabase, newLeads, userId, runId);
              }

              await log(
                supabase,
                runId,
                "info",
                `[${provider.name}] "${query}" → ${results.length} results`
              );
            } catch (err) {
              stats.errors++;
              await log(supabase, runId, "error", `[${provider.name}] Error: ${String(err)}`);
            }
          }
        }
      }
    }

    await updateRun(supabase, runId, { progress: 25 });

    // ══ ENGINE 2: Web Search Discovery ═══════════════════════════════════
    if (cfg.enableWebSearch) {
      const configuredSearchProviders = SEARCH_PROVIDERS.filter((p) => p.isConfigured());

      if (configuredSearchProviders.length === 0) {
        await log(supabase, runId, "warn", "No web search provider configured — skipping Engine 2");
      } else {
        const provider = configuredSearchProviders[0];
        await log(supabase, runId, "info", `Using search provider: ${provider.name}`);

        for (const query of queries.webSearch.slice(0, cfg.maxSearchQueries)) {
          try {
            const results = await provider.search(query, country, language, cfg.maxResultsPerQuery);
            await sleep(cfg.searchProviderDelayMs);

            const newLeads: NormalizedLead[] = [];
            for (const r of results) {
              if (!r.url || seenUrls.has(r.url) || isOtaUrl(r.url)) continue;
              seenUrls.add(r.url);
              stats.sources_found++;
              const lead = searchResultToLead(r, city, country, query);
              if (lead) {
                allLeads.push(lead);
                newLeads.push(lead);
              }
            }

            // Progressive save: persist new leads immediately for live count
            if (newLeads.length > 0) {
              await saveDraftLeads(supabase, newLeads, userId, runId);
            }

            await log(supabase, runId, "info", `[${provider.name}] "${query}" → ${results.length} results`);
          } catch (err) {
            stats.errors++;
            await log(supabase, runId, "error", `[${provider.name}] Error for "${query}": ${String(err)}`);
          }
        }
      }
    }

    await updateRun(supabase, runId, { progress: 45 });
    await log(supabase, runId, "info", `${stats.sources_found} sources collected. Starting contact extraction.`);

    // ══ ENGINE 3: Website Contact Extraction ══════════════════════════════
    await updateRun(supabase, runId, { status: "extracting_contacts", progress: 50 });

    if (cfg.enableContactExtraction) {
      const websitesToCrawl = allLeads
        .filter((l) => l.website_url && !isOtaUrl(l.website_url))
        .slice(0, cfg.maxWebsitesToCrawl);

      await log(supabase, runId, "info", `Crawling ${websitesToCrawl.length} websites for contact data`);

      const BATCH = cfg.crawlerConcurrency;
      for (let i = 0; i < websitesToCrawl.length; i += BATCH) {
        const batch = websitesToCrawl.slice(i, i + BATCH);
        const checks = await Promise.allSettled(
          batch.map((lead) =>
            extractContactsFromWebsite(lead.website_url!, {
              maxPages: cfg.maxPagesPerWebsite,
              timeoutMs: cfg.pageTimeoutMs,
            }).catch(() => null)
          )
        );

        for (let j = 0; j < batch.length; j++) {
          const lead = batch[j];
          const result = checks[j];
          stats.websites_crawled++;

          if (result.status === "fulfilled" && result.value) {
            const contacts = result.value;

            const idx = allLeads.findIndex((l) => l.website_url === lead.website_url);
            if (idx !== -1) {
              const existing = allLeads[idx];
              const updated: NormalizedLead = {
                ...existing,
                email: contacts.emails[0]?.value || existing.email,
                phone: contacts.phones[0]?.raw || existing.phone,
                whatsapp_url: contacts.whatsapp_url || existing.whatsapp_url,
                instagram_url: contacts.instagram_url || existing.instagram_url,
                linkedin_url: contacts.linkedin_url || existing.linkedin_url,
                facebook_url: contacts.facebook_url || existing.facebook_url,
                contact_form_url: contacts.contact_form?.form_url ?? existing.contact_form_url,
                company_name: contacts.company_name || existing.company_name,
                primary_name: contacts.company_name || existing.primary_name,
              };

              if (contacts.relevant_keywords && contacts.relevant_keywords.length > 0) {
                updated.quality_summary = [
                  existing.quality_summary,
                  `Detected signals: ${contacts.relevant_keywords.join(", ")}.`,
                ]
                  .filter(Boolean)
                  .join(" ");

                updated.signals = contacts.relevant_keywords.map((kw) => ({
                  signal_type: "keyword",
                  signal_value: kw,
                  source_url: lead.website_url ?? "",
                  confidence: "medium" as const,
                }));
              }

              if (contacts.number_of_properties) {
                updated.quality_summary = [
                  updated.quality_summary,
                  `Manages approximately ${contacts.number_of_properties} properties.`,
                ]
                  .filter(Boolean)
                  .join(" ");
              }

              const { score, label } = scoreLead(updated);
              updated.score = score;
              updated.score_label = label;

              allLeads[idx] = updated;
            }
          } else if (result.status === "rejected") {
            stats.errors++;
            await log(
              supabase,
              runId,
              "warn",
              `Contact extraction failed for ${lead.website_url}: ${String(result.reason)}`
            );
          }
        }
      }
    }

    await updateRun(supabase, runId, { progress: 65 });

    // ══ ENGINE 4: Enrichment ══════════════════════════════════════════════
    await updateRun(supabase, runId, { status: "enriching", progress: 70 });

    if (cfg.enableEnrichment) {
      const configuredEnrichmentProviders = ENRICHMENT_PROVIDERS.filter((p) => p.isConfigured());

      if (configuredEnrichmentProviders.length === 0) {
        await log(supabase, runId, "info", "Enrichment skipped: no enrichment provider is configured.");
      } else {
        const provider = configuredEnrichmentProviders[0];
        const leadsToEnrich = allLeads.filter((l) => l.domain && !l.email).slice(0, 50);

        await log(supabase, runId, "info", `Enriching ${leadsToEnrich.length} leads via ${provider.name}`);

        for (const lead of leadsToEnrich) {
          try {
            let result = await provider.enrichCompany(
              lead.domain!,
              lead.company_name ?? lead.primary_name,
              country
            );

            // If company enrichment found nothing but we have a person name, try person enrichment
            if (result.status !== "success" && lead.person_name && lead.domain) {
              result = await provider.enrichPerson(
                lead.person_name,
                lead.company_name ?? lead.primary_name,
                lead.domain,
                country
              );
            }

            if (result.status === "success" && result.emails && result.emails.length > 0) {
              const idx = allLeads.findIndex((l) => l.domain === lead.domain);
              if (idx !== -1) {
                allLeads[idx].email = result.emails[0].value;
                const { score, label } = scoreLead(allLeads[idx]);
                allLeads[idx].score = score;
                allLeads[idx].score_label = label;
                stats.enriched++;
              }
            }

            await sleep(500);
          } catch (err) {
            stats.errors++;
            await log(supabase, runId, "warn", `Enrichment failed for ${lead.domain}: ${String(err)}`);
          }
        }
      }
    }

    await updateRun(supabase, runId, { progress: 80 });

    // ══ DEDUPLICATION ═════════════════════════════════════════════════════
    await updateRun(supabase, runId, { status: "deduplicating", progress: 82 });

    const beforeDedup = allLeads.length;
    allLeads = deduplicateLeads(allLeads);
    const afterDedup = allLeads.length;
    stats.leads_deduplicated = beforeDedup - afterDedup;

    await log(
      supabase,
      runId,
      "info",
      `Deduplication merged ${stats.leads_deduplicated} duplicate entries. ${afterDedup} unique leads remaining.`
    );

    // ══ SCORING ═══════════════════════════════════════════════════════════
    await updateRun(supabase, runId, { status: "scoring", progress: 88 });

    allLeads = allLeads.map((lead) => {
      const { score, label } = scoreLead(lead);
      return { ...lead, score, score_label: label };
    });

    allLeads.sort((a, b) => b.score - a.score);
    allLeads = allLeads.slice(0, cfg.maxLeadsReturned);
    stats.leads_extracted = allLeads.length;

    await log(supabase, runId, "info", `Scoring complete. ${stats.leads_extracted} leads ready.`);

    // ══ FINAL PERSIST ══════════════════════════════════════════════════════
    // Delete draft leads saved during collection, then insert the final
    // deduped+scored set with full source and signal data.
    await updateRun(supabase, runId, { progress: 92 });

    await supabase.from("leads").delete().eq("run_id", runId).eq("user_id", userId);

    if (allLeads.length > 0) {
      await persistLeads(supabase, allLeads, userId, runId);
      await log(supabase, runId, "info", `${allLeads.length} leads saved to database.`);
    } else {
      await log(
        supabase,
        runId,
        "warn",
        "Search completed. No contactable Airbnb-related leads were found for this search. Try a larger city or different target type."
      );
    }

    // ── Complete ──────────────────────────────────────────────────────────
    await updateRun(supabase, runId, {
      status: "completed",
      progress: 100,
      finished_at: new Date().toISOString(),
      stats_json: stats,
    });

    await log(
      supabase,
      runId,
      "info",
      `Run completed. ${stats.sources_found} sources found | ${stats.websites_crawled} websites crawled | ${stats.leads_extracted} leads created | ${stats.errors} errors.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(supabase, runId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: message,
      stats_json: stats,
    });
    await log(supabase, runId, "error", `Run failed: ${message}`);
    throw err;
  }
}
