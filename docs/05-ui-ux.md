# UI/UX Specification

## Design principles
- Zero unnecessary UI
- One primary action per page
- Progress always visible during runs
- Empty states are honest — no fake data, no placeholders
- Errors explain what happened and what the user should do

## Dashboard (/)
- Search form: City, Country, Target Type, Lead Count
- If no provider configured: show setup warning banner, disable Find Leads button
- Advanced sources toggle (local business, web search, extraction, enrichment)
- Provider status badges (active providers shown as chips)
- Compliance notice (always visible)

## Progress Page (/runs/[id])
- Status badge with current phase name
- Progress bar (0–100%)
- 6-stat grid: Sources found, Websites crawled, Leads extracted, Deduplicated, Enriched, Errors
- Live log stream (auto-scroll, last 20 entries, colour-coded by level)
- Cancel Run button (while running)
- View Leads button (when leads exist)
- Honest empty state when no leads found

## Leads Table (/leads)
- Columns: Score badge, Name, Type, City, Email, Phone, Outreach status, Actions
- Filters: Score label, Lead type, Outreach status, Has email/phone/website toggles
- Sort by score descending by default
- Bulk select with checkboxes
- Bulk actions: Mark contacted, Mark unsubscribed, Export CSV
- Pagination (50 per page)
- Honest empty state: "No real leads found for this search."

## Lead Detail (/leads/[id])
- Header: name, type, city, score badge
- Contact Details card: all emails, phones, social links, contact form, maps
- Quality Summary card
- Sources & Evidence card: all source URLs with provider, title, evidence text
- Detected Signals card: keyword badges
- Outreach card: suggested angle + status dropdown + notes textarea + Save button
- Enrichment History (if any enrichment was run)
- Original source URL at the bottom

## Settings (/settings)
- Setup instruction banner (shows how to configure .env.local)
- Tabs: Search, Local Business, Enrichment, STR Data
- Each provider: name, status badge, env var hint, Test Connection button
- STR providers show as "Disabled — Interface ready for V2"
- No API key input fields (keys configured via .env.local only)
