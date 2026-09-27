# Free-tier usage

The project targets Cloudflare's Free plan. A deployment still needs to fit its request, CPU, storage, and bundle-size limits. This release has no production usage measurements. A [bounded staging sample](docs/CONFIDENCE.md) found stateless CPU outliers above the Free-plan limit; Free-plan readiness remains unverified.

## Requests

Scripts and styles use Workers Static Assets. Rendering the widget's HTML does not call a repository object. A normal thread load makes one repository RPC call. Native rate-limiting bindings check traffic without a separate counter object.

Readers trigger refreshes by writing, clicking Refresh, or returning to the page after the focus throttle expires. Open tabs do not poll comments every minute. Sign-in polling runs only during an authorization attempt.

Page-list counts use `/api/counts`: up to 20 terms per request, cached for 60 seconds by default, including empty conversations. Overlapping batches share reads. A cold batch needs repository metadata and up to two summary queries; warm batches need no GitHub request. Count clients do not need to load threads or poll.

Installation tokens are cached and refreshed under a lock. Concurrent requests share the refreshed token.

## Remaining costs

Dynamic HTTP requests invoke the Worker. Repository RPC calls invoke a Durable Object. Validation and SQL consume CPU, and GitHub requests count toward the App's API limits. Larger threads require more parsing and rendering work.

SQLite holds sessions, authorization records, page mappings, and write receipts. Most temporary records expire. An unresolved creation record remains until the service finds the discussion, so it does not create another by mistake.

Native rate limiting applies locally. It is not a global billing cap. Operators may need additional Cloudflare controls for distributed abuse.

## Before sharing a deployment

The build records compressed sizes in `dist/sizes.json` and rejects a Worker bundle above its 3 MiB gzip budget. Measure production CPU on anonymous reads, signed-in reads, and writes. Local test duration does not measure Cloudflare CPU usage.

Check the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Also review [Static Assets](https://developers.cloudflare.com/workers/static-assets/) and [rate-limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for the account you will use.

Traffic, thread size, and sign-in activity determine how much of those allowances a site uses.
