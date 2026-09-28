# Configure your service

Edit your Worker's variables in Cloudflare under **Settings → Variables and Secrets**, or in your source repository's `wrangler.jsonc`. The [setup page](../DEPLOY.md) generates the initial configuration.

## Choose allowed websites

`REPOSITORIES` lists the GitHub repositories your service uses and the websites allowed to embed their comments:

```json
{
  "you/comments": {
    "origins": ["https://example.com", "https://www.example.com"],
    "category": "Announcements"
  }
}
```

Add each website's origin, including the protocol and any port. For example, local development at `http://localhost:4321` needs its own entry. Paths and wildcard subdomains are not accepted. An empty `origins` list allows no websites.

To use another comments repository, add another entry with its category and websites, and install your GitHub App on that repository.

## Repository settings

The fields below go inside each repository's entry in `REPOSITORIES`.

| Setting | Default | Value |
| --- | --- | --- |
| `origins` | Required | Up to 30 website origins, or `"*"` for any website |
| `category` | Required | Exact discussion category name |
| `categoryId` | Empty | Optional category ID, checked against the name |
| `defaultCommentOrder` | `oldest` | `oldest` or `newest` |
| `maxReplyPrefetch` | `20` | Maximum replies fetched initially per comment, from 0 to 100; the browser requests 5 by default |
| `customThemeOrigins` | `[]` | Up to 20 extra origins for theme CSS and fonts |

Use lowercase `owner/repository` keys. The service accepts up to 100 repositories and rejects unknown settings. The JSON must fit Cloudflare's environment-variable size limit.

## Cache settings

Set these per repository:

| Setting | Default | Value |
| --- | --- | --- |
| `displayCacheMs` | `60000` | Public comment and reply cache lifetime in milliseconds |
| `countCacheMs` | `300000` | Post-count cache lifetime in milliseconds |

Both accept 0 to 3600000 milliseconds. Zero disables that cache. For example, `"displayCacheMs": 180000` caches public comments for three minutes. Readers still see their own successful changes immediately.

See [Cloudflare usage](../FREE-TIER.md#choose-freshness-for-your-site) to choose lifetimes for your traffic.

## Custom theme CSS

Set a CSS URL as the theme in your embed or JavaScript configuration. It can come from your comments service or one of the repository's allowed websites. For CSS hosted elsewhere, add its origin to `customThemeOrigins`. Add external font origins there too.

Native embedding also follows your website's Content Security Policy. See [customization](EXTENDING.md#change-appearance) for theme and component options.

## Sort by reactions or reply counts

To add a "Popular" order alongside Oldest and Newest, add a `ranking` field to the repository's settings:

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

This example gives each thumbs-up or heart one point and each reply half a point. Tied comments show oldest first. The default interface adds `popular` to its sorting controls. A custom interface selects it with `conversation.setOrder({ profile: 'popular' })`.

Each profile can use any of the eight [reaction names](API.md#commands), plus `replies`, `upvotes` and `answer`. Weights can be positive or negative. GitHub upvotes are separate from emoji reactions; they can contribute to a score, but visitors upvote through GitHub.

`maxAgeSeconds` sets the maximum score age. The default is 600 seconds; accepted values are 1 to 604800 seconds. Increasing it allows less frequent updates. giscusflare fetches only the values used by your profiles. Including reply counts requires smaller batches than reactions alone. See [sorting costs](../FREE-TIER.md#sorting-by-reactions-or-reply-counts).

You can define up to eight profiles. Names start with a lowercase letter and contain up to 32 lowercase letters, digits, underscores or hyphens. Ties use creation time in the selected direction, then a stable ID order.

### Sorting resource limits

Set `RANKING_BUDGET` to a JSON object to change these service-wide limits:

| Setting | Default | Controls |
| --- | --- | --- |
| `maxRequestsPerHour` | `240` | GitHub calls used to prepare orders |
| `maxRowsWrittenPerDay` | `32000` | SQLite write allowance |
| `maxRowsReadPerDay` | `500000` | SQLite read allowance |
| `maxOrderBytes` | `524288` | Maximum size in bytes of a returned comment-ID list |

The call and row allowances are divided equally among repositories with sorting profiles. Discussions in each repository share that allocation. The service reserves enough allowance for a step before starting it, so its budget can run out before actual usage reaches the number you set. GitHub calls include access checks and token renewal.

These limits apply to preparing custom orders. Ordinary comments, sign-in and other services in your account also use Cloudflare resources. Check [account allowances](../FREE-TIER.md#free-allowances) when increasing the budget.

A custom order reports `preparing` while its data loads and `paused` when it cannot finish. [Troubleshooting](OPERATIONS.md#when-a-custom-sort-cannot-load) explains the reasons; the [API reference](API.md#ranked-views) covers custom controls.

## Offer open hosting

To let any website embed comments from one repository, set that repository's `origins` to `"*"`.

To let other website owners use your service with their own public repositories, add an `OPEN_HOSTING` variable:

```json
{
  "origins": "*",
  "category": "Announcements"
}
```

Website owners install your GitHub App on their repository and use your setup page to generate an embed. Their traffic uses your Cloudflare and GitHub allowances.

An explicit `REPOSITORIES` entry overrides `OPEN_HOSTING` for that repository. Use an explicit entry to offer sorting profiles as well.

## Service settings

| Variable | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | Your comments service's origin, without a trailing slash |
| `GITHUB_APP_ID` | Numeric GitHub App ID as a string |
| `GITHUB_CLIENT_ID` | GitHub App client ID |
| `REPOSITORIES` | Repository settings shown above |
| `OPEN_HOSTING` | Default settings for other public repositories with your App installed |
| `RANKING_BUDGET` | Resource limits for custom sorting |

Store `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` and `SESSION_SECRET` as encrypted secrets. See [setup](../DEPLOY.md#configure-cloudflare) for their values and [operations](OPERATIONS.md#rotate-credentials) when rotating credentials.

## Request rate limits

The supplied Cloudflare bindings allow 120 reads, 30 writes and 15 sign-in starts per IP per minute at each Cloudflare location. These limit bursts of requests. They do not cap daily account usage. See [Cloudflare's binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
