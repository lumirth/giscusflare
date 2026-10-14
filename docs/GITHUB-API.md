# GitHub API use

Use this reference when changing GitHub queries or investigating API usage. Anonymous acquisition uses the registered installation credential. Signed-in acquisition can use an already usable user credential, while account access and contributions always use that user's authority. Public observations are shared independently of the credential that acquired them; configured public repository and category scope apply to every acquisition.

## Comment operations

| Action | GitHub operation |
| --- | --- |
| Create a discussion for a page | `createDiscussion` |
| Add a comment or reply | `addDiscussionComment` |
| Edit a comment | `updateDiscussionComment` |
| Delete a comment | `deleteDiscussionComment` |
| Hide or reveal a comment | `minimizeComment`, `unminimizeComment` |
| Add or remove an emoji reaction | `addReaction`, `removeReaction` |

The App needs Discussions read/write permission and the included Metadata read permission. GitHub also checks the acting user's permissions. Locking, closing, answer assignment and account blocking remain GitHub administration actions.

Read [GitHub's Discussions guide](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions) and [App permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-graphql-api-access) for the upstream contract. [Verification](../TESTING.md) separates recorded-schema checks from real App acceptance.

## Display and ranking queries

Display queries fetch a bounded page of comment content and a small reply preview. Ranking fetches score inputs separately, then loads comment content for the selected IDs. Profiles reuse inputs they have in common.

Public acquisition combines repository validation, current metadata and the requested window. A user-specific access refusal or primary allowance exhaustion can fall back once to installation authority. Secondary throttling never triggers credential cycling. Public reading does not wait for user-token renewal. Account access needs its own narrow user-token query; a genuinely missing display profile needs a separate identity query. Contributions resolve selection and target authority before the mutation; mutation fields establish completion without a whole-discussion refresh. [API](API.md#http-protocol) owns the request/result shapes and replay behavior.

GitHub Markdown interpretation acquires one installation token per batch and calls the Markdown endpoint for each missing HTML input, without participation authorization or another repository-head query. Host-prepared content uses the internal producer without GitHub work. Installation/category discovery belongs to registration; token renewal, page resolution, first discussion creation and ranking can still add calls. Measure cold credential renewal separately from a warm token or cached result; there is no universal one-call or two-call cost promise.

GitHub's point cost, returned nodes, resource limits and response bytes are different constraints. A query with a low point cost can still exceed resource limits. Grouped reaction totals use `ReactionGroup.reactors`; the deprecated `users` field omits additional reactor types such as bots, mannequins and organizations. Reading totals does not select individual reactor nodes. See GitHub's [reaction reference](https://docs.github.com/en/graphql/reference/reactions).

GitHub connections require `first` or `last` between 1 and 100. Count-only connections request one without selecting member nodes. Zero reply prefetch likewise suppresses child nodes while observing the actual total; a nonempty unobserved window has an empty cursor, and an empty window has no cursor. An explicit reply read fetches its own last-50 window; its reply cursor is never applied to the root connection. See [pagination requirements](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api).

Treat partial GraphQL errors as incomplete reads. Keep known comments until a complete discovery pass confirms membership changes. Provider admission and cooldowns are durable and shared at installation, immutable user or OAuth-client allowance scope. Primary limits pause their resource; secondary limits pause that credential scope. Ranking yields admission to interactive work. HTTP and GraphQL errors retain bounded, redacted diagnostics, including GitHub request IDs and rate headers.

GitHub documents [GraphQL rate and resource limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). Cache lifetime and ranking allowances are configured by the service operator, as described in [configuration](CONFIGURATION.md).

## Reactions and upvotes

Emoji reactions and GitHub Discussions upvotes are separate data. giscusflare exposes the eight emoji reactions. A ranking profile can read existing upvote counts, but the interface does not submit upvotes. GitHub's own interface remains available for that action.
