# GitHub API use

Use this reference when changing GitHub queries or investigating API usage. giscusflare uses an App installation token for anonymous reads and the reader's App-issued token for signed-in requests. Both the configured repository policy and GitHub permissions apply.

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

Tests validate produced query documents and variables against the recorded official GitHub GraphQL schema. The local provider then supplies controlled permissions and failures. Record the schema version separately from a live App acceptance result.

Read [GitHub's Discussions guide](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions) and [App permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-graphql-api-access) for the upstream contract.

## Display and ranking queries

Display queries fetch a bounded page of comment content and a small reply preview. Ranking fetches score inputs separately, then loads comment content for the selected IDs. Profiles reuse inputs they have in common.

The page acquisition query combines repository validation, current metadata and the requested root, reply or ID window. Signed acquisition also observes the current viewer profile. Contributions validate the selected page and target before their effect. Mutation responses return fields owned by the operation; reaction changes retain only the selected reaction group, rather than refreshing the whole discussion to define completion. Optional ranking work does not reopen a confirmed contribution. GitHub Markdown preview checks public repository identity and archive state before rendering; host-prepared preview uses the configured producer without GitHub preview authorization. Token renewal, page discovery, first discussion creation and optional ranking reads add calls; there is no universal one-call or two-call cost promise.

GitHub's point cost, returned nodes, resource limits and response bytes are different constraints. A query with a low point cost can still exceed resource limits. Grouped reaction totals use `ReactionGroup.reactors`; the deprecated `users` field omits additional reactor types such as bots, mannequins and organizations. Reading totals does not select individual reactor nodes. See GitHub's [reaction reference](https://docs.github.com/en/graphql/reference/reactions).

GitHub connections require `first` or `last` between 1 and 100. Count-only connections request one without selecting member nodes. Zero reply prefetch likewise suppresses child nodes while observing the actual total; a nonempty unobserved window has an empty cursor, and an empty window has no cursor. An explicit reply read fetches its own last-50 window; its reply cursor is never applied to the root connection. See [pagination requirements](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api).

Treat partial GraphQL errors as incomplete reads. Keep known comments until a complete discovery pass confirms membership changes. When GitHub throttles a request, wait until its retry time before continuing.

GitHub documents [GraphQL rate and resource limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). Cache lifetime and ranking allowances are configured by the service operator, as described in [configuration](CONFIGURATION.md).

## Reactions and upvotes

Emoji reactions and GitHub Discussions upvotes are separate data. giscusflare exposes the eight emoji reactions. A ranking profile can read existing upvote counts, but the interface does not submit upvotes. GitHub's own interface remains available for that action.
