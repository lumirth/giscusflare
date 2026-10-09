# Configure your service

Edit your Worker's variables in Cloudflare under **Settings → Variables and Secrets**, or in your source repository's `wrangler.jsonc`. The [setup page](../DEPLOY.md) generates the initial configuration.

## Choose allowed websites

`REPOSITORIES` lists the GitHub repositories your service uses and the websites allowed to embed their comments:

```json
{
  "you/comments": {
    "origins": ["https://example.com", "https://www.example.com"],
    "category": "Announcements",
    "repositoryId": "COPY_FROM_REGISTRATION",
    "installationId": 123456,
    "categoryId": "COPY_FROM_REGISTRATION"
  }
}
```

Add each website's origin, including the protocol and any port. For example, local development at `http://localhost:4321` needs its own entry. Paths and wildcard subdomains are not accepted. An empty `origins` list allows no websites.

To add a discussion repository, install the App, run the [registration command](../DEPLOY.md#register-the-repository), and add its returned immutable identities with the category and website policy.

## Repository settings

The fields below go inside each repository's entry in `REPOSITORIES`.

| Setting | Default | Value |
| --- | --- | --- |
| `origins` | Required | Up to 30 website origins, or `"*"` for any website |
| `category` | Required | Exact discussion category name |
| `repositoryId` | Required | Immutable repository ID returned by registration |
| `installationId` | Required | App installation ID returned by registration, as a number |
| `categoryId` | Required | Registered discussion category ID |
| `defaultCommentOrder` | `oldest` | `oldest` or `newest` |
| `maxReplyPrefetch` | `20` | Maximum replies fetched initially per comment, from 0 to 100; the browser requests 5 by default |
| `customThemeOrigins` | `[]` | Up to 20 extra origins for theme CSS and fonts |

Use lowercase `owner/repository` keys. The service accepts up to 100 repositories and rejects unknown settings. The JSON must fit Cloudflare's environment-variable size limit.

## Cache settings

Set these per repository:

| Setting | Default | Value |
| --- | --- | --- |
| `displayCacheMs` | `60000` | Public comment and reply cache lifetime in milliseconds |
| `countCacheMs` | `300000` | Count-observation reuse lifetime in milliseconds |

Public count observations reuse the edge response and shared browser capability; actor selection deduplicates active work. Both settings accept 0 to 3600000 milliseconds. Zero disables that cache. For example, `"displayCacheMs": 180000` caches public comments for three minutes. Readers still see their own successful changes immediately.

See [Cloudflare usage](../FREE-TIER.md#reads-contributions-and-freshness) to choose lifetimes for your traffic.

## Custom theme CSS

Set a CSS URL as the theme in your embed or JavaScript configuration. It can come from your comments service or one of the repository's allowed websites. For CSS hosted elsewhere, add its origin to `customThemeOrigins`. Add external font origins there too.

Mona is inline SVG. Custom themes set `--mona-ink` and `--mona-face` for its two colors instead of supplying a loading GIF.

Native embedding also follows your website's Content Security Policy. See [customization](API.md#content-and-counts) for theme and component options.

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
  "refreshSeconds": 600
}
```

This example gives each thumbs-up or heart one point and each reply half a point. Tied comments show oldest first. The default interface adds `popular` to its sorting controls. A custom interface selects it with `conversation.setOrder({ profile: 'popular' })`.

Each profile can use any of the eight [reaction names](API.md#actions-reactions-and-session), plus `replies`, `upvotes` and `answer`. Weights can be positive or negative. GitHub upvotes are separate from emoji reactions; they can contribute to a score, but visitors upvote through GitHub.

`refreshSeconds` sets the interval after a completed acquisition before another is requested. The default is 600 seconds; accepted values are 1 to 604800 seconds. A returned order reports its acquisition's start and completion times and next refresh time. Remote observations can span that interval; this is neither an atomic snapshot nor a guarantee that every value is younger than one age cutoff. Increasing the cadence interval permits less frequent acquisition. The service fetches only profile inputs; reply counts require smaller batches than reactions alone. See [sorting costs](../FREE-TIER.md#optional-ranking).

You can define up to eight profiles. Names start with a lowercase letter and contain up to 32 lowercase letters, digits, underscores or hyphens. Ties use creation time in the selected direction, then a stable ID order.

### Sorting resource limits

Set `RANKING_BUDGET` to a JSON object to change these service-wide limits:

| Setting | Default | Controls |
| --- | --- | --- |
| `maxRequestsPerHour` | `240` | GitHub calls used to prepare orders |
| `maxRowsWrittenPerDay` | `36000` | Metered SQLite write threshold |
| `maxRowsReadPerDay` | `4000000` | Metered SQLite read threshold |
| `maxOrderBytes` | `524288` | Maximum size in bytes of a returned comment-ID list |

The call and row allowances are divided equally among repositories with sorting profiles. Discussions in each repository share that allocation. Upstream calls are admitted before dispatch, including access checks and token renewal. SQLite use is measured from native cursor counters and checked between bounded steps; a step can cross a daily row threshold before subsequent work pauses. These row settings are thresholds, not strict account-wide spending caps.

These limits cover ranking access, acquisition, publication and ready-order work. Default row thresholds are 80% of the Free SQL read allowance and 36% of its write allowance; they are not independent capacity for every repository. Ordinary comments, sign-in and other services in your account also use Cloudflare resources. Check [account allowances](../FREE-TIER.md#free-allowances) when increasing the budget.

Splitting the default allowance among several repositories does not guarantee each can complete acquisition on the requested cadence. Access checks and token renewal can exhaust the hourly call allowance while SQL use remains low. Measure intended traffic and discussion sizes before enabling sorting across an archive; increase the service-wide call budget only within GitHub's applicable limits.

A custom order reports `preparing` while its data loads and `paused` when it cannot finish. [Troubleshooting](OPERATIONS.md#named-sorts) explains the reasons; the [API reference](API.md#reading-document) covers custom controls.

## Offer open hosting

To let any website embed comments from one repository, set that repository's `origins` to `"*"`.

To let other website owners use your service with their own public repositories, add an `OPEN_HOSTING` variable:

```json
{
  "origins": "*",
  "category": "Announcements"
}
```

Website owners install your GitHub App on their public repository, then obtain a registration reference from POST `/api/v7/registration` with `{ repo, origin, category }`. Include the returned `registration` in native page options or `data-registration` on the iframe script. The service verifies installation/public scope before issuing this policy-bound reference; ordinary requests do not allocate repository state from arbitrary unregistered input. Owners must register again when the hosting policy or installation changes. Their traffic uses your Cloudflare and GitHub allowances.

To obtain a reference from an open deployment:

```js
const response = await fetch(service + '/api/v7/registration', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ repo: 'you/comments', origin: location.origin, category: 'Announcements' }),
});
const { registration } = await response.json();
```

Use the configured hosting category. Paste the returned reference into setup's embed-generator registration field, or put it directly in `data-registration`/native page options. This sealed reference is distinct from the operator's public repository-ID JSON used to configure an explicit policy.

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

Bind a separately deployed content Worker as `CONTENT`. Its profile owns interpretation and disposable result reuse; it does not hold GitHub credentials or Repository storage. [Content setup](EXTENDING.md#prepare-content-in-your-deployment).

Store `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` and `SESSION_SECRET` as encrypted secrets. See [setup](../DEPLOY.md#configure-cloudflare) for their values and [operations](OPERATIONS.md#credentials-and-logs) when rotating credentials.

## Request rate limits

The supplied Cloudflare bindings allow 120 reads, 30 writes and 15 sign-in starts per IP per minute at each Cloudflare location. These limit bursts of requests. They do not cap daily account usage. See [Cloudflare's binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
