# GitHub API use

Giscusflare reads public GitHub Discussions through a GitHub App installation. Reader writes use that reader's App-issued token. The service checks repository and target scope separately from the user's permission to act.

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

Read [GitHub's Discussions guide](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions) and [App permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-graphql-api-access) for the upstream contract.

## Display and ranking queries

Display queries fetch a bounded page of comment content and a small reply preview. Whole-discussion ranking acquires compact inputs separately, then fetches content only for the selected IDs. Profiles share required inputs.

GitHub's point cost, returned nodes, resource limits and response bytes are different constraints. A query with a low point cost can still exceed resource limits. Grouped reaction totals avoid fetching individual reactors; selecting fewer fields reduces response parsing and serialization work.

A partial GraphQL error does not establish that an omitted comment was deleted or that discovery reached the end. Incomplete inputs keep ranking work incomplete. Upstream throttling supplies a retry boundary rather than triggering an immediate retry loop.

GitHub documents [GraphQL rate and resource limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). Cache lifetime and ranking allowances are configured by the service operator, as described in [configuration](CONFIGURATION.md).

## Reactions and upvotes

Emoji reactions and GitHub Discussions upvotes are separate data. Giscusflare exposes the eight emoji reactions. A ranking profile can read existing upvote counts, but the interface does not submit upvotes. GitHub's own interface remains available for that action.
