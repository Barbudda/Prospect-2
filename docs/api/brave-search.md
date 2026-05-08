# Brave Search API

Docs: https://api.search.brave.com/app/documentation/web-search
Get key: https://api.search.brave.com/

## Web Search
```
GET https://api.search.brave.com/res/v1/web/search
Headers:
  Accept: application/json
  Accept-Encoding: gzip
  X-Subscription-Token: {key}
Params:
  q={query}
  count=10
  country={country_code}    // FR, GB, ES, DE
  search_lang={lang}        // fr, en, es, de
  safesearch=moderate

Response fields to use:
  web.results[].url         → source_url
  web.results[].title       → title
  web.results[].description → snippet
```

## Rate limits
- 2000 free queries/month
- Add minimum 500ms delay between requests

## Error handling
- 401 → Invalid key → throw ProviderAuthError
- 422 → Bad params → log query and throw
- 429 → Rate limited → wait 30s, retry once
