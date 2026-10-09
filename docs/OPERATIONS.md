# Maintain your service

## Update and restore

Choose a [release](https://github.com/lumirth/giscusflare/releases), update your source deployment and install the matching browser archive in native consumers. Preserve Wrangler's Worker name, repository policy, Durable Object binding and migration history. Preserve live secrets, including `SESSION_SECRET`, so operational records remain readable. Commit the website lockfile and rebuild it.

Record the current Worker version and website revision before updating. Deploy a compatible service before activating its browser client. Check `/healthz`, assets, anonymous reading, preview and the contribution paths you can exercise. Report authenticated GitHub writes separately from anonymous and local checks.

Source deployments apply Wrangler `vars`; copy any dashboard-only public settings into source before deploying. If an update fails, restore a compatible Worker and website pair. Cloudflare version rollback changes code; it does not restore stored data.

## Host-prepared content

Keep a producer revision tied to its Markdown rules and resource build. Update `createRepository({ content: { revision, prepare } })` and the referenced immutable resources together. Cached prepared results use that revision and full rendering input. Eligible artifacts survive object restart in the existing store for 24 hours, within 8 MiB/256-item per-object bounds; retention failure does not reject otherwise valid output. The producer must apply commenter-safe interpretation; article-author permissions must not grant commenters raw executable HTML or extensions.

Resource URLs must remain reachable by the embedding website and allowed by its CSP. Prepared output can fail to install when a stylesheet or module is missing, even when the service is healthy. Check both comment bodies and anonymous preview, with a cold browser cache. Preparation reuse does not include viewer authorization; normal service policy still applies to each request. Prepared HTTP packets bypass edge reuse and carry `Cache-Control: no-store`, so inspect repository preparation separately from HTTP cache hits.

## Troubleshoot

| Symptom | What to inspect |
| --- | --- |
| Setup loads, but comments do not | GitHub credentials, App installation and repository/category settings |
| Website rejected | Exact allowed origin, including any `www` variant |
| Sign-in fails after a domain change | GitHub callback: `PUBLIC_ORIGIN` plus `/auth/callback`; website service URL |
| Native requests blocked | CORS and CSP; service in `connect-src` |
| `VERSION_MISMATCH` | Matching Worker/browser protocol, then reload |
| Prepared content unavailable | Deployed trusted producer, revision and returned resources |
| Preview requires sign-in | Selected delivery mode; GitHub preview requires authentication, prepared preview does not |
| HTTP 429 | Supplied retry interval and account/provider usage |
| Submission outcome uncertain | Retry the existing record with the original author; inspect GitHub before creating another contribution |
| Several recovered drafts appear | Explicitly select the intended record; same destination does not imply same intent |
| Comments fail under load | Worker execution errors/CPU, request and object duration, SQLite allowances |
| Named sort paused | Returned reason and retry time |

The setup repository check contacts GitHub and verifies access/category. `/api/v5/setup` reports configured service settings; `/healthz` reports that the service responds. Neither establishes an authenticated contribution.

## Named sorts

For `paused` results, `budget` means wait for reset or adjust `RANKING_BUDGET` after inspecting usage. `upstream` means the provider could not complete acquisition; retry after the reported time. `size` means collection/order limits were exceeded; inspect discussion size and `maxOrderBytes`. See [configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts) and [reading state](API.md#reading-document).

## Credentials and logs

Add a replacement GitHub App key or client secret and exercise sign-in before retiring the old credential. Keep `SESSION_SECRET` during routine updates; changing it requires readers to sign in again.

Log request counts, timing and error codes. Exclude comment bodies, authorization headers, callback query strings and session tokens. The supplied deployment disables Workers observability; inspect account-level logging separately. See [security](https://github.com/lumirth/giscusflare/blob/main/SECURITY.md).
