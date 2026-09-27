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

## Measurements

The September 27, 2026 deployed reference run made 12,100 HTTP requests. It included 10,000 iframe page loads across 100 discussions, 1,000 signed-in reads, 100 complete sign-in flows, 200 writes and 500 count batches of 20 terms. Pages requested 20 root comments and up to five replies each. Public display caching used the default 60 seconds. All requests returned HTTP 200; Cloudflare reported no execution errors.

| Measured resource | Result |
| --- | --- |
| Outer Worker CPU median / p95 / p99 | 1.11 / 2.95 / 6.85 ms |
| Outer Worker CPU p99.9 | 25.17 ms |
| Repository object requests | 1,815 |
| Repository object duration | 20.57 GB-s |
| SQLite rows read / written | 6,277 / 3,071 |

This was a compressed, concurrent workload with a simulated GitHub endpoint that waited 80 ms. It measures the deployed application and Cloudflare accounting, but its cache hits and overlapping object activity are not a prediction for uniformly spaced visits. A separate check read complete responses through Chicago, Amsterdam and Osaka cache locations.

The 5 ms p99 engineering target was not met. Cloudflare allows occasional CPU overshoots, so successful responses do not establish that every request fits within 10 ms. A sequential follow-up measured p99 of 3 ms for sign-in preparation, 4 ms for callbacks and 5 ms for signed-in comment reads. Monitor your deployment's percentiles and errors, including less frequent operations.

Real GitHub reads take longer than the fixture. A production installation-token query for five roots and their replies took about one second. A separate public discussion query for 20 roots and 53 prefetched replies took about four seconds. Network waiting affects object duration even when Worker CPU stays low. For scale, 10,000 non-overlapping one-second object waits use about 1,250 GB-s, or 9.6% of the Free duration allowance, before other work. Four-second waits use about 38%. Caching and overlapping requests reduce that total; a quiet site spread across many discussions may get fewer cache hits.

## Ranking measurements

A native workerd SQLite run simulated a full day of demand for a 10,000-root discussion. It included 10,080 ranking reads, 144 refresh cycles at the default ten-minute age, a daily membership audit, and 200 confirmed reaction changes with updated-order reads. It used 12,315 actual SQLite writes. Conservative reservations charged 25,237 against the default 32,000-write ranking allocation. These are different counters: the reservation covers possible work before starting it.

An unchanged refresh used 75 actual writes and 14 upstream requests, without rewriting candidate data. Restoring the collection after an object restart read 79 rows. The native tests also stored and sorted 100,000 candidates with an explicit larger allowance, but transmitting that complete 2.7 MB order reached 18 ms outer Worker p99 in a deployed probe. The default `maxOrderBytes` therefore limits the serialized ID array to 512 KiB. Raise it only after measuring the resulting response on your plan.

[Verification evidence](docs/CONFIDENCE.md) describes the runtime, browser and real GitHub checks. GitHub also has [GraphQL request and resource limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). Cloudflare rate-limit bindings control bursts at each location; they do not replace daily quota monitoring.
