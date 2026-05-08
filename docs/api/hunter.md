# Hunter.io

Docs: https://hunter.io/api-documentation
Get key: https://hunter.io/

## Domain Search
```
GET https://api.hunter.io/v2/domain-search
Params:
  domain={domain}
  api_key={key}
  limit=5

Response fields to use:
  data.emails[].value         → email
  data.emails[].confidence    → confidence (keep only >= 70)
  data.emails[].first_name    → first_name
  data.emails[].last_name     → last_name
  data.organization           → confirmed company name
```

## Rules
- Only use emails with confidence >= 70
- Never invent or guess emails
- If no results: return empty array, do not mark as enriched

## Rate limits
- 25 free domain searches/month
- Add 500ms delay between requests

## Error handling
- 401 → Invalid key → throw ProviderAuthError
- 429 → Rate limited → skip enrichment for this lead, log warning
