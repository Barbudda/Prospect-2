// Core domain types for Prospect Airbnb Leads V1

export type LeadType =
  | "Airbnb Concierge"
  | "Property Manager"
  | "Direct Booking Owner"
  | "Vacation Rental Agency"
  | "Gîte / Villa Operator"
  | "Co-host / Consultant"
  | "Real Estate Seasonal Rental"
  | "Unknown STR Lead";

export type RunStatus =
  | "queued"
  | "running"
  | "collecting_sources"
  | "extracting_contacts"
  | "enriching"
  | "deduplicating"
  | "scoring"
  | "completed"
  | "failed"
  | "cancelled";

export type ScoreLabel = "Hot" | "Good" | "Medium" | "Weak";

export type OutreachStatus =
  | "not_contacted"
  | "contacted"
  | "replied"
  | "not_interested"
  | "converted"
  | "unsubscribed"
  | "opted_out";

export type ProviderType = "search" | "local_business" | "enrichment" | "str_data" | "ai";

export type ProviderStatus = "configured" | "missing_key" | "failing" | "disabled";

export type ContactType =
  | "email"
  | "phone"
  | "whatsapp"
  | "contact_form"
  | "instagram"
  | "linkedin"
  | "facebook";

export type Confidence = "high" | "medium" | "low";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type ContactFormType =
  | "general_contact"
  | "owner_acquisition"
  | "guest_inquiry"
  | "booking_inquiry"
  | "quote_request"
  | "unknown";

// ─── Raw provider results ───────────────────────────────────────────────────

export interface RawBusinessResult {
  business_name: string;
  category?: string;
  website?: string;
  phone?: string;
  address?: string;
  rating?: number;
  review_count?: number;
  google_maps_url?: string;
  source_url: string;
  location?: string;
  opening_hours?: string[];
  raw_provider_payload?: Record<string, unknown>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  source_url: string;
}

// ─── Extracted contact data ─────────────────────────────────────────────────

export interface ExtractedEmail {
  value: string;
  confidence: Confidence;
  source: string;
}

export interface ExtractedPhone {
  raw: string;
  normalized?: string;
  confidence: Confidence;
  source: string;
}

export interface ContactFormSignal {
  form_found: boolean;
  form_url: string | null;
  form_type: ContactFormType;
}

export interface ExtractedContacts {
  emails: ExtractedEmail[];
  phones: ExtractedPhone[];
  whatsapp_url?: string;
  contact_page_url?: string;
  contact_form?: ContactFormSignal;
  instagram_url?: string;
  linkedin_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
  company_name?: string;
  person_name?: string;
  address?: string;
  legal_company_name?: string;
  siren_siret?: string;
  vat_number?: string;
  number_of_properties?: number;
  cities_served?: string[];
  services_offered?: string[];
  page_language?: string;
  relevant_keywords?: string[];
  booking_engine_links?: string[];
  pms_links?: string[];
}

// ─── Enrichment ─────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  provider: string;
  status: "success" | "failed" | "skipped" | "partial";
  emails?: Array<{ value: string; confidence: Confidence; verified: boolean }>;
  phones?: Array<{ value: string; confidence: Confidence }>;
  person_name?: string;
  company_name?: string;
  linkedin_url?: string;
  error?: string;
  raw?: Record<string, unknown>;
}

// ─── STR data provider ──────────────────────────────────────────────────────

export interface STRListingResult {
  listing_url: string;
  title?: string;
  owner_name?: string;
  address?: string;
  platform?: string;
}

export interface STRListingEnrichmentResult {
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  management_company?: string;
}

export interface OwnerEnrichmentResult {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

// ─── Normalized lead ────────────────────────────────────────────────────────

export interface NormalizedLead {
  id?: string;
  user_id?: string;
  run_id?: string;
  primary_name: string;
  company_name?: string;
  person_name?: string;
  lead_type: LeadType;
  city: string;
  country: string;
  address?: string;
  website_url?: string;
  domain?: string;
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
  confidence: Confidence;
  status: string;
  outreach_status: OutreachStatus;
  suggested_angle?: string;
  notes?: string;
  quality_summary?: string;
  sources?: Array<{
    provider: string;
    source_url: string;
    source_type?: string;
    title?: string;
    snippet?: string;
    evidence_text?: string;
    confidence?: Confidence;
  }>;
  signals?: Array<{
    signal_type: string;
    signal_value: string;
    source_url?: string;
    confidence?: Confidence;
  }>;
  raw_payload?: Record<string, unknown>;
}

// ─── Run config ─────────────────────────────────────────────────────────────

export interface RunConfig {
  maxSearchQueries: number;
  maxResultsPerQuery: number;
  maxWebsitesToCrawl: number;
  maxPagesPerWebsite: number;
  pageTimeoutMs: number;
  crawlerConcurrency: number;
  searchProviderDelayMs: number;
  maxLeadsReturned: number;
  enableLocalBusiness: boolean;
  enableWebSearch: boolean;
  enableContactExtraction: boolean;
  enableEnrichment: boolean;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  maxSearchQueries: 12,
  maxResultsPerQuery: 10,
  maxWebsitesToCrawl: 40,
  maxPagesPerWebsite: 5,
  pageTimeoutMs: 8_000,
  crawlerConcurrency: 3,
  searchProviderDelayMs: 800,
  maxLeadsReturned: 250,
  enableLocalBusiness: true,
  enableWebSearch: true,
  enableContactExtraction: true,
  enableEnrichment: true,
};

// ─── Run stats ───────────────────────────────────────────────────────────────

export interface RunStats {
  sources_found: number;
  websites_crawled: number;
  leads_extracted: number;
  leads_deduplicated: number;
  errors: number;
  enriched: number;
}

// ─── Provider interfaces ─────────────────────────────────────────────────────

export interface LocalBusinessProvider {
  readonly name: string;
  isConfigured: () => boolean;
  searchBusinesses(
    query: string,
    location: string,
    country: string,
    limit: number
  ): Promise<RawBusinessResult[]>;
}

export interface SearchProvider {
  readonly name: string;
  isConfigured: () => boolean;
  search(
    query: string,
    country: string,
    language: string,
    limit: number
  ): Promise<SearchResult[]>;
}

export interface EnrichmentProvider {
  readonly name: string;
  isConfigured: () => boolean;
  enrichCompany(
    domain: string,
    companyName: string,
    country: string
  ): Promise<EnrichmentResult>;
  enrichPerson(
    name: string,
    companyName: string,
    domain: string,
    country: string
  ): Promise<EnrichmentResult>;
}

export interface STRDataProvider {
  readonly name: string;
  isConfigured: () => boolean;
  searchListings(area: string, country: string, limit: number): Promise<STRListingResult[]>;
  enrichListing(listingUrl: string): Promise<STRListingEnrichmentResult>;
  enrichOwner(
    propertyAddress: string,
    ownerName: string,
    domain: string
  ): Promise<OwnerEnrichmentResult>;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface RunStatusResponse {
  id: string;
  status: RunStatus;
  progress: number;
  stats: RunStats;
  recent_logs: Array<{ level: LogLevel; message: string; created_at: string }>;
  lead_count: number;
  error_message?: string;
}

export interface ProviderStatusInfo {
  name: string;
  type: ProviderType;
  status: ProviderStatus;
  description: string;
}
