# Running on Cloudflare's Free plan

Start with the default one-minute comment cache and five-minute count cache. Giscusflare shares anonymous reads between visitors, fetches comments a page at a time and does no ranking work unless you enable it. An idle comments tab does not poll GitHub.

Your usage depends on how often people open comments, how many different discussions they visit, and how much they participate. A popular post can serve many readers from the same cached response. Visits spread across older posts are less likely to share a cached response, even at the same total traffic.

## What uses your allowance

| Activity | Work performed |
| --- | --- |
| Load anonymous comments | One dynamic request for the first page, through either the iframe or native API |
| Read a cached page | The Worker checks website policy and returns the cached response |
| Read an uncached page | The repository object reuses its own cache or fetches from GitHub; identical reads in progress share that fetch |
| Read while signed in | The service fetches with the reader's permissions and reaction selections |
| Load more comments or replies | Another request for that page |
| Comment, react or sign in | GitHub requests and durable session or operation records |
| Show counts on an index page | One count request can cover up to 20 page identifiers |
| Use a ranked view | Shared metadata collection for the discussion, followed by content reads for the selected page |

The iframe includes the first anonymous comment page in its HTML. It does not make a second request for that same page. Scripts, styles and other files served directly by Static Assets do not consume dynamic Worker requests.

For example, 10,000 anonymous first-page loads use 10,000 dynamic requests, or 10% of the daily Worker request allowance. Pagination, sign-in, writes and refreshes add to that count. Cache hits reduce GitHub and Durable Object work, but still count as Worker requests.

## Free allowances

Cloudflare's published allowances, checked September 28, 2026:

| Resource | Free allowance |
| --- | --- |
| Dynamic Worker requests | 100,000 per day |
| Worker CPU | 10 ms per HTTP request |
| Durable Object requests | 100,000 per day |
| Durable Object duration | 13,000 GB-s per day |
| SQLite rows read | 5 million per day |
| SQLite rows written | 100,000 per day |
| SQLite storage | 5 GB total, up to 1 GB per object |

Other services in your account use these allowances too. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Choose freshness for your site

| Setting | Default | When to change it |
| --- | --- | --- |
| `displayCacheMs` | 60,000 ms | Increase it if a few minutes' delay for other readers is acceptable |
| `countCacheMs` | 300,000 ms | Increase it when archive or index counts need less frequent updates |
| Browser `replyPrefetch` | 5 replies per root | Reduce it to download fewer replies before a reader expands them |
| Ranking `maxAgeSeconds` | 600 seconds | Increase it if ranked order can update less often |

A reader sees their own confirmed comment or reaction immediately. Other readers see changes on their next read after public cache expiry. Returning to a stale tab or reconnecting can trigger a read. There is no continuous comment refresh timer.

Longer caching helps most when people revisit the same pages within that interval. It does less for a site where each visit opens a different discussion. Signed-in reads bypass public caches, so a busy community with many participants has different costs from a mostly anonymous readership.

These settings work on both Free and paid plans. [Configuration](docs/CONFIGURATION.md) lists their accepted values.

## Measurements from a deployed service

We ran a concurrent traffic test on September 27, 2026, to measure the deployed service's Worker CPU, object use and SQLite operations. It sent 12,100 HTTP requests:

- 10,000 iframe page loads across 100 discussions.
- 1,000 signed-in reads and 100 complete sign-in flows.
- 200 writes and 500 count requests, each containing 20 page identifiers.

Comment pages requested 20 root comments and up to five replies per root. Public caching used the default 60 seconds. A simulated GitHub endpoint added an 80 ms delay to each upstream request.

| Measurement | Result |
| --- | --- |
| Worker CPU, median / p95 / p99 | 1.11 / 2.95 / 6.85 ms |
| Worker CPU, p99.9 | 25.17 ms |
| Repository object requests | 1,815 |
| Repository object duration | 20.57 GB-s |
| SQLite rows read / written | 6,277 / 3,071 |
| HTTP failures / execution errors | 0 / 0 |

The run used about 1.8% of the daily object request allowance, 0.16% of object duration and 3.1% of SQLite writes. Most requests took less than the Free plan's 10 ms CPU limit, with a small tail above it. A separate sequential run measured p99 CPU of 3 ms for sign-in preparation, 4 ms for callbacks and 5 ms for signed-in comment reads.

The concurrent run concentrated visits within cache lifetimes and overlapped work in the repository object. For a site with scattered visits, the same number of readers can cause more GitHub fetches. Real GitHub timing also matters. Two separate live queries took about one second for five roots with replies and four seconds for 20 roots with 53 prefetched replies.

Network waiting does not count toward Worker CPU. It does count toward active Durable Object duration. Cloudflare charges that duration at a 128 MB allocation. As a sizing example, 10,000 separate one-second object waits use about 1,250 GB-s, or 9.6% of the daily allowance. At four seconds each, they use about 38%. Concurrent waits in the same object overlap rather than adding their full durations together.

## If you enable ranking

Ordinary chronological reading fetches the page someone wants to read. A ranked view also needs score inputs for every root comment in that discussion. Giscusflare collects those inputs separately from comment bodies, shares them between profiles and writes records when they change. A ranking refresh begins on demand; after it completes, an unread discussion does not keep refreshing.

For a 10,000-root discussion, a local workerd SQLite test simulated a day with 10,080 ranking reads, 144 refresh cycles at ten-minute intervals, a daily membership audit and 200 confirmed reaction changes. It used 12,315 SQLite writes. An unchanged refresh used 75 writes and 14 GitHub requests. Restoring the collection after an object restart read 79 rows.

The budget charged 25,237 reserved writes against the default 32,000-write allocation. Reservations cover possible work before it starts, so they can exceed actual writes. The service divides the configured allowance among ranking-enabled repositories; discussions within a repository share its allocation.

Several active ranked discussions can therefore use more resources than repeated visits to one ranked discussion. The current object keeps only one candidate collection and one computed order in memory. Switching between discussions can require SQLite reads and another sort. See [architecture](docs/DESIGN.md#traffic-across-pages) for how the shared state works.

The default `maxOrderBytes` caps the returned ID list at 512 KiB. In a separate deployed test, a 100,000-ID order occupied 2.7 MB and reached 18 ms p99 Worker CPU. Measure CPU before raising that cap for very large discussions.

## Measure your deployment

Use the Worker's metrics for request counts, CPU percentiles and execution errors. Check Durable Object requests and duration alongside SQLite rows read, rows written and storage. GitHub has its own [API limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

Measure a normal day's traffic and a busy period. Compare anonymous and signed-in use, repeated visits to popular posts and visits across the archive. If you offer ranking, include several active discussions. Those patterns tell you more about your site's capacity than its largest thread alone.

For high GitHub or object usage, inspect cache reuse and reply prefetch first. For ranking usage, inspect the number of active discussions, selected inputs and observation age. If CPU is the constraint, inspect response size and the operations with the highest percentiles. [Operations](docs/OPERATIONS.md) covers troubleshooting, and [verification results](docs/CONFIDENCE.md) records the other release checks.
