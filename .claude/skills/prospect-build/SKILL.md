---
description: Run next build for the Prospect Airbnb project and surface any TypeScript or compilation errors with file locations
allowed-tools: Bash(npm *)
user-invocable: true
disable-model-invocation: false
---

## Task

Run the Next.js production build and report the results.

!`npm run build 2>&1`

## Report format

If the build **succeeds**:
- Confirm ✅ Build passed
- List all routes generated (static vs dynamic)
- Note any warnings worth fixing

If the build **fails**:
- List each error as: `[file:line] — error message`
- For each error, give a one-line fix
- Prioritize TypeScript type errors first, then module errors, then config errors

Keep the report concise. No need to repeat what already works.
