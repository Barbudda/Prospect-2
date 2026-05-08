# Compliance

## Allowed data sources
- Public web pages (no authentication required)
- Official documented APIs with published terms of service
- Public business directories and Google Maps listings

## Not allowed
- Scraping Airbnb.com or any platform that prohibits scraping in its ToS
- Bypassing authentication or login walls
- Scraping private or member-only content
- Using undocumented or unofficial APIs

## Rate limiting (mandatory)
- Minimum 1000ms delay between requests to search providers
- Minimum 500ms delay between enrichment provider requests
- Maximum 3 concurrent website crawl requests
- Respect Retry-After headers when present
- Exponential backoff on 429 responses

## OTA blocklist
The orchestrator maintains a blocklist of OTA domains that are never
crawled or included as leads:
booking.com, tripadvisor.com, airbnb.com, vrbo.com, homeaway.com,
expedia.com, hotels.com, google.com, yelp.com, pagesjaunes.fr,
leboncoin.fr, abritel.fr

## GDPR compliance
- B2B data only (business contact information, not private individuals)
- Only publicly available business contact information is collected
- Opted-out field tracked per lead (`opted_out` column)
- User can delete all their data (cascade delete via auth.users)

## Required UI notice (displayed on dashboard and export)
"This tool collects only publicly available business information
for professional B2B outreach purposes. All leads are sourced from
public web pages, business directories, and official APIs. Use
responsibly and in accordance with applicable data protection
regulations (GDPR, CCPA, etc.)."
