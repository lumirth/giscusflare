# Running on Cloudflare's Free plan

Cloudflare's Free plan includes 100,000 Worker requests per day. Loading the first page of comments while signed out uses one request, so 10,000 such loads use 10% of that allowance. Loading more comments, posting and signing in add requests. Static files such as scripts and styles are served without using the Worker request allowance.

The service also uses Cloudflare's Durable Objects to communicate with GitHub and store sessions. In a deployed test with 12,100 requests across 100 discussions, it used 1.8% of the daily object request allowance and 3.1% of the SQLite write allowance. The workload and results are below.

## Measurements from a deployed service

On September 27, 2026, we tested a mix of readers and contributors:

- 10,000 iframe page loads across 100 discussions.
- 1,000 signed-in reads and 100 complete sign-in flows.
- 200 writes and 500 count requests, each for 20 posts.

The test used the default one-minute cache, 20 comments per page and up to five replies per comment. A simulated GitHub endpoint added an 80 ms delay to each request. This run preceded the 2.0 cache changes.

| Measurement | Result |
| --- | --- |
| Worker CPU, median / p95 / p99 | 1.11 / 2.95 / 6.85 ms |
| Worker CPU, p99.9 | 25.17 ms |
| Durable Object requests | 1,815 |
| Durable Object duration | 20.57 GB-s |
| SQLite rows read / written | 6,277 / 3,071 |
| HTTP failures / execution errors | 0 / 0 |

Most requests were below the Free plan's 10 ms CPU limit, with a small tail above it. Object duration used 0.16% of the daily allowance. A separate sequential run measured p99 CPU of 3 ms for sign-in preparation, 4 ms for callbacks and 5 ms for signed-in comment reads.

The repeated visits in this test often reused cached responses. Readers spread across an archive will cause more GitHub requests than readers concentrated on a few popular posts. Signed-in readers also need individual responses for their permissions and selected reactions.

GitHub response time affects object duration. Two live queries took about one second for five comments with replies and four seconds for 20 comments with 53 prefetched replies. Waiting for GitHub does not use Worker CPU, but it does use object duration. At Cloudflare's 128 MB allocation, 10,000 separate one-second waits use about 1,280 GB-s, or 9.8% of the daily allowance. Four-second waits would use about 39%. Concurrent waits in the same object overlap.

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

These allowances are shared with other services in your account. Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Choose freshness for your site

Public comments are cached for one minute and counts for five minutes by default. A reader sees their own successful comment or reaction immediately. Other readers see it when they next load comments after the cached response expires.

For a blog, a few minutes between updates may be acceptable. Increasing the cache lifetime lets more visitors reuse a response. For an active discussion, a shorter lifetime shows recent contributions sooner. Leaving a tab open does not continuously fetch comments.

| Setting | Default | Change it to |
| --- | --- | --- |
| `displayCacheMs` | 60,000 ms | Cache public comments longer or show others' contributions sooner |
| `countCacheMs` | 300,000 ms | Update counts beside posts less or more often |
| Browser `fetching.replyPrefetch` | 5 replies per comment | Fetch fewer replies initially; readers can expand the rest |

Set cache lifetimes in your [repository configuration](docs/CONFIGURATION.md#cache-settings). Set reply prefetch in your [JavaScript options](docs/API.md#options). Caching reduces GitHub and object work; a visitor's request to the Worker still counts toward the daily request allowance.

For comment counts beside an archive or post list, [batch up to 20 posts](docs/API.md#http-reads) in one request. Retain the returned counts until `expiresAt` to avoid requesting them again on each page load.

## Sorting by reactions or reply counts

An order such as "Popular" needs scores for comments across the discussion, including those outside the visible page. [Sorting profiles](docs/CONFIGURATION.md#sort-by-reactions-or-reply-counts) let you choose which reactions or reply counts contribute to that score.

`maxAgeSeconds` controls how old those scores can be, with a default of ten minutes. A longer age reduces refresh work. Sorting by reactions alone also allows larger GitHub batches than including reply counts.

In a local test with 10,000 top-level comments, 144 refreshes at ten-minute intervals and 200 reaction changes, the service wrote 12,315 SQLite rows over the simulated day. Each active discussion needs its own refreshes. See [the full test results](docs/CONFIDENCE.md#ranking-resource-measurements) for the request and storage measurements.

Use `RANKING_BUDGET` to limit the work spent on these orders. Its defaults and allocation across repositories are listed in [configuration](docs/CONFIGURATION.md#sorting-resource-limits).

## Check your usage

Cloudflare's metrics show how your actual traffic compares. Check requests and CPU for the Worker, plus Durable Object duration and SQLite usage.

| If usage is high | What to adjust |
| --- | --- |
| Worker requests from post-list counts | Batch counts and reuse them until expiry |
| GitHub requests or object duration | Increase public cache lifetimes or reduce initial reply prefetch |
| Reads and writes for custom sorting | Use fewer score inputs or increase `maxAgeSeconds` |
| Worker CPU | Inspect large responses and the requests associated with execution errors |

See [troubleshooting](docs/OPERATIONS.md#troubleshoot) for failed requests and service errors.
