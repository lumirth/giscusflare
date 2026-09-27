# Cloudflare usage

Giscusflare uses Workers, Static Assets and SQLite Durable Objects. Public response caching reduces calls to GitHub and Durable Objects. Ranking is optional because ordering an entire discussion requires work beyond fetching the page someone reads.

## Free allowances

Checked on 2026-09-27. Include your other services when budgeting the account's allowances.

| Resource | Free allowance |
| --- | --- |
| Dynamic Worker requests | 100,000 per day |
| Worker CPU | 10 ms per HTTP request |
| Durable Object requests | 100,000 per day |
| Durable Object duration | 13,000 GB-s per day |
| SQLite rows read | 5 million per day |
| SQLite rows written | 100,000 per day |
| SQLite storage | 5 GB total, up to 1 GB per object |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/). Static files served without invoking the Worker do not use dynamic Worker requests. See [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## What a visit costs

An anonymous iframe load includes its first comment page in the HTML response. It does not need a second initial thread request. A native presentation requests the first page directly. Scripts, styles and images use Static Assets.

A cached public response still invokes the outer Worker to check policy. It returns before the repository object. A miss calls the object, which can reuse its own response or query GitHub. Signed-in reads use the reader's permissions and bypass public caching.

Ten thousand anonymous first-page loads therefore start at 10,000 dynamic Worker requests, or 10% of the daily allowance, before additional activity. This is a request-count model, not a measured workload. Sign-in, pagination, refreshes, reactions, comments, retries and count requests add work.

Page-list counts accept up to 20 terms in one request. Their cache includes empty conversations. Count entries stay in memory rather than generating SQLite writes on every refresh.

## Choose freshness

| Setting | Default | Cost tradeoff |
| --- | --- | --- |
| `displayCacheMs` | 60 seconds | Longer public reuse reduces object and GitHub reads |
| `countCacheMs` | 5 minutes | Longer count reuse suits indexes and archive pages |
| Browser `replyPrefetch` | 5 replies per root | Smaller previews reduce response size and GitHub work |
| Whole-discussion ranking | Disabled | Enabling it adds metadata reads and derived storage |
| Ranking `maxAgeSeconds` | 600 seconds | Longer observation reuse reduces metadata requests and progress writes |

Cache settings accept milliseconds in configuration. A reader sees their own confirmed write immediately. Other readers see changes on a later read after the cached response expires. An open tab does not keep requesting comments on a timer.

The same settings work on Free and paid plans. Change them to match the freshness your website needs and the usage you observe.

## Ranking costs

A ranked view needs the chosen inputs for every root comment, then fetches content only for the selected display page. Compact metadata batches avoid repeatedly downloading all comment bodies and reply previews.

Reaction ranking, reply-count ranking and other profiles share their stored inputs when possible. Giscusflare writes changed records rather than rewriting the whole index. Changes made through the service update known values; activity directly on GitHub is found during later refresh work.

Operators allocate ranking resources to explicit repositories. A budget-limited or incomplete ranking does not become a misleading sort of only the comments already loaded. Chronological comments remain usable while the derived view catches up.

## CPU and object duration

Network waiting does not count toward the outer Worker's CPU time. Parsing, validation, cryptography and serialization do. Durable Object duration is different: an active object can accrue wall time while waiting for GitHub. Its published duration uses a 128 MB allocation, so 13,000 GB-s corresponds to 104,000 active object-seconds across the account. Overlapping work in the same object is not counted by summing individual request durations.

The service serializes JSON inside the object and transfers its completed body, status and headers through RPC. The Worker reconstructs the HTTP response without parsing the JSON again. It uses bounded jobs and clears upstream deadlines when response bodies finish, so completed work does not keep an object active unnecessarily.

## Measurements and release checks

Local workerd experiments verified the selected ranking layout at 10,000 and 100,000 generated candidates. Restoring them after an actual object restart read 79 and 782 SQLite rows respectively. A targeted update read three rows and wrote one. These measurements cover candidate storage; job progress, budgets, indexes and alarms must be included in a deployment total.

The integrated release still needs its deployed Cloudflare workload measurement. Local timing and prototype row counts do not establish its Worker CPU percentile or daily account usage. The earlier application's staging CPU sample does not describe this redesign.

For a deployment measurement, record cold and warm loads, signed-in reads, writes, authorization, counts and ranking refreshes. Track Worker CPU and errors, dynamic requests, object requests and active duration, SQLite rows and GitHub request consumption. Keep the workload, deployment version and cache settings with the result.

GitHub also has [GraphQL request and resource limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). Cloudflare rate-limit bindings control bursts at each location; they do not replace daily quota monitoring.
