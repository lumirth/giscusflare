# Cloudflare usage

giscusflare can run on Cloudflare’s Free plan. Capacity depends on requests, CPU, GitHub latency, discussion sizes and ranking frequency. These are separate constraints; a cache hit or a small database does not establish that every request fits the account allowance.

## Free allowances

Checked October 7, 2026:

| Resource | Included allowance | Scope |
| --- | --- | --- |
| Dynamic Worker requests | 100,000/day | Account |
| Worker HTTP CPU | 10 ms/request | Active execution |
| Memory | 128 MB | Isolate, including concurrent requests |
| Durable Object requests | 100,000/day | Account |
| Durable Object duration | 13,000 GB-s/day | Active or non-hibernateable elapsed time |
| SQLite reads / writes | 5 million / 100,000 rows/day | Account |
| SQLite storage | 5 GB | Account |

Static Assets ordinarily serve scripts and styles without dynamic Worker request usage. The official Durable Object storage table and FAQ disagree about the Free per-object ceiling (10 GB versus 1 GB); do not plan near either limit without clarification. Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Reads, contributions and freshness

An iframe includes the first anonymous comment page. Subsequent pages, expanded replies, counts, authentication and contributions add requests. Native rendering loads through the API. A request served from the application’s public cache still reaches the Worker and counts toward its allowance.

Anonymous readers can share cached content. Signed-in reads use the reader’s permissions and selected reactions, so they bypass public caching. A reader sees their own confirmed contribution immediately; other readers see it through subsequent reads, subject to the public cache expiry. Open tabs refresh on configured focus/reconnect events, rather than continuously polling.

Set `displayCacheMs` and `countCacheMs` per repository. Increase them when delayed public updates are acceptable. Reduce `fetching.replyPrefetch` to fetch less reply content initially. Readers can expand the remaining replies. [Configuration](docs/CONFIGURATION.md#cache-settings) and [browser options](docs/API.md#options) describe these settings.

Batch counts for up to 20 page identifiers and retain them until their returned `expiresAt`. Show zero only when the service returns zero; a failed request does not establish that a page has no comments.

## Elapsed time and CPU

Waiting on GitHub does not consume ordinary Worker CPU, but it keeps the repository Durable Object active. Object duration uses an allocated 128 MB even if its actual memory use is smaller. Overlapping requests in the same object share elapsed duration; do not sum their wall times as independent charges. [Durable Object compute billing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Parsing responses, constructing HTML, serialization and cryptography still perform compute. Large payloads and bursts can exhaust CPU or shared memory before daily request allowances. Check platform CPU metrics; production JavaScript clocks do not advance during pure CPU loops and cannot measure that work reliably. [Cloudflare timer semantics](https://developers.cloudflare.com/workers/runtime-apis/performance/).

## Optional ranking

Chronological views fetch the requested page. A named ranking profile needs score inputs across the discussion, including roots outside that page. More roots, score inputs, active discussions and shorter refresh intervals increase work. A result reports its acquisition interval. `refreshSeconds` starts the next acquisition after a completed one; a scan paused by budget can span multiple quota windows. The interval is not an atomic GitHub snapshot or a maximum age for every value.

SQL reads are charged by rows examined, not just rows returned. Updating unchanged observations’ timestamps on every refresh would also spend writes; the service records the completed acquisition interval separately and conditionally updates typed observations. Changes to the root-count/newest-root signature trigger enumeration; otherwise the service renews known IDs. Scan checkpoints, membership indexes and deletion of obsolete rows still use storage. A low GitHub point cost does not establish a low SQL or CPU cost.

`RANKING_BUDGET` meters native SQL work separately from the account’s total use. SQL thresholds stop work between bounded scan steps, so the last step or an order query can exceed its threshold. HTTP requests have a hard admission limit before upstream calls. These settings are not hard caps on total Cloudflare billing. Ordinary reads, writes, sessions and other services also consume the account allocation. A ranking can pause before a requested order is complete. Budget pauses preserve scan progress; a failed provider acquisition is abandoned and a later attempt begins with a fresh head and cursor. See [ranking settings](docs/CONFIGURATION.md#sorting-resource-limits) and [pause reasons](docs/OPERATIONS.md#when-a-custom-sort-cannot-load).

## Check your deployment

Measure cold and warm reads, signed-in reads, contributions, counts and ranked views. Include one busy discussion and traffic spread across an archive. Record the source version, settings, GitHub response conditions, Worker CPU and requests, object duration, and actual SQLite rows read/written.

Older release benchmarks used a different persistence design and do not establish current capacity. [Verification results](docs/CONFIDENCE.md) separates current local evidence from historical and deployed observations. Before increasing ranking or payload limits, measure the largest discussion and workload you intend to support.
