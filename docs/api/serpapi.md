# SerpAPI

Docs: https://serpapi.com/search-api
Get key: https://serpapi.com/

## Web Search
```
GET https://serpapi.com/search
Params:
  engine=google
  q={query}
  api_key={key}
  num=10
  gl={country_code}    // fr, gb, es, de, it
  hl={language}        // fr, en, es, de, it

Response fields to use:
  organic_results[].link        → source_url
  organic_results[].title       → title
  organic_results[].snippet     → snippet
```

## Google Maps Search
```
GET https://serpapi.com/search
Params:
  engine=google_maps
  q={query} {location}
  api_key={key}
  type=search

Response fields to use:
  local_results[].title         → business_name
  local_results[].website       → website_url
  local_results[].phone         → phone
  local_results[].address       → address
  local_results[].place_id_search → source_url fallback
```

## Rate limits
- 100 free searches/month
- Add minimum 1000ms delay between requests

## Error handling
- 401 → Invalid API key → throw ProviderAuthError
- 429 → Rate limited → wait 60s, retry once
- 500 → Server error → retry after 5s, max 3 times
