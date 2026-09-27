# Configuration

Configure your Worker through Cloudflare's Variables and Secrets settings or its `wrangler.jsonc`. [Setup](../DEPLOY.md) generates the initial values for your repository and website.

## Service settings

| Variable | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | The comments service's exact origin, without a trailing slash |
| `GITHUB_APP_ID` | Numeric GitHub App ID as a string |
| `GITHUB_CLIENT_ID` | GitHub App client ID |
| `REPOSITORIES` | Policies keyed by lowercase `owner/repository` |
| `OPEN_HOSTING` | Optional default policy for other public repositories with the App installed |
| `RANKING_BUDGET` | Shared resource allocation for explicitly enabled ranking repositories |

Store `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` and `SESSION_SECRET` as encrypted secrets. Keep `SESSION_SECRET` across updates to preserve reader sessions.

An empty deployment serves setup and health checks. It accepts no comments or reader sign-in until its GitHub credentials and repository policy are configured.

## Repository policy

```json
{
  "you/comments": {
    "origins": ["https://example.com"],
    "category": "Announcements",
    "displayCacheMs": 60000,
    "countCacheMs": 300000
  }
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `origins` | Required | Up to 30 exact website origins; `[]` denies all websites; `"*"` allows any website |
| `category` | Required | Exact discussion category name |
| `categoryId` | Empty | Optional category ID, checked with the name |
| `defaultCommentOrder` | `oldest` | `oldest` or `newest` |
| `displayCacheMs` | `60000` | Anonymous discussion and reply cache lifetime, from 0 to 3600000 milliseconds |
| `countCacheMs` | `300000` | Page-list count cache lifetime, from 0 to 3600000 milliseconds |
| `maxReplyPrefetch` | `20` | Maximum initial replies per root, from 0 to 100; the browser requests 5 by default |
| `customThemeOrigins` | `[]` | Up to 20 extra origins allowed to serve theme CSS and fonts |

Zero disables the corresponding cache. The service accepts up to 100 explicit repository policies and rejects unknown settings. The complete JSON must also fit Cloudflare's environment-variable size limit.

A longer display cache reduces GitHub reads for public visitors. A successful write updates the writer immediately; other visitors see it on their next read after the cached result expires. Cache expiry also bounds how long an earlier public response can remain available after upstream permissions change. See [resource usage](../FREE-TIER.md) for tuning.

## Choose allowed websites

`https://example.com`, `https://www.example.com` and `http://localhost:4321` are different origins. Include each one you intend to serve. Entries contain no paths, query strings or wildcard subdomains.

The policy applies to native API requests and iframe embedding. It does not make public GitHub discussions private. Origin headers identify a browser page; they are not credentials for a scripted HTTP client.

## Offer open hosting

Set a repository's `origins` to `"*"` to let any website embed that repository. To let website owners bring other public repositories, add an `OPEN_HOSTING` JSON variable:

```json
{
  "origins": "*",
  "category": "Announcements"
}
```

Each website owner installs your public GitHub App on their comments repository. The service checks installation and public repository access before accepting the repository. An explicit `REPOSITORIES` entry takes precedence over this default.

Open hosting shares your service's Cloudflare and GitHub allowances. Whole-discussion ranking requires an explicit repository allocation; open hosting does not allocate ranking work for arbitrary repositories.

## Enable ranked views

Add named profiles to an explicit repository policy:

```json
"ranking": {
  "profiles": {
    "popular": {
      "weights": { "THUMBS_UP": 1, "HEART": 1, "replies": 0.5 },
      "tieBreak": "oldest"
    }
  },
  "maxAgeSeconds": 600
}
```

Each score is the sum of its inputs multiplied by their weights. Supported inputs are the eight reaction names, `replies`, `upvotes` and `answer`. Weights can be negative. An omitted or zero-weight input requires no ranking acquisition unless another profile uses it. Ties use creation time in the selected direction and a stable ID order.

The example includes reply counts, so refreshes need reply metadata as well as reaction counts. A reactions-only profile can fetch more candidate records in a batch. `upvotes` reads GitHub's existing upvotes; it does not add an upvote action to the comments interface.

Use one to eight profiles. Names contain lowercase letters, digits, underscores or hyphens and start with a letter. `maxAgeSeconds` defaults to 600 and accepts 1 through 604800 seconds. It measures the oldest required observation, not the time a refresh finished. If refresh work cannot meet the age or budget, the API reports that condition instead of returning an incomplete whole-discussion order.

The optional `RANKING_BUDGET` JSON variable sets these deployment-wide defaults:

| Setting | Default |
| --- | --- |
| `maxRequestsPerHour` | `240` GitHub calls |
| `maxRowsWrittenPerDay` | `25000` SQLite rows |
| `maxRowsReadPerDay` | `500000` SQLite rows |
| `maxOrderBytes` | `8388608` bytes per complete order |

The service divides call and row allowances equally among explicitly ranking-enabled repositories. The order-size limit applies to each result. Leave room for sessions, ordinary reads and writes, and other services in your Cloudflare account. Increasing the allocation does not increase the provider's limits.

Without `ranking`, the service acquires and stores no ranking metadata. `OPEN_HOSTING` cannot contain ranking profiles. Add a repository explicitly before enabling this work for it.

## Themes and rate limits

Named themes are served with giscusflare. A custom CSS URL can use the service origin, an allowed website origin or an origin listed in `customThemeOrigins`. Add external font origins there too. Native presentations also follow the embedding website's Content Security Policy.

The supplied Cloudflare bindings allow 120 reads, 30 writes and 15 authorization starts per IP per minute at each Cloudflare location. These are burst limits, not an account-wide daily budget. See [Cloudflare's binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
