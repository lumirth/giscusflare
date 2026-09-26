# GitHub API capabilities for giscusflare

Checked 2026-09-26 against current official documentation and pinned Giscus source. This is a documentation/source review. Real App-token results are recorded separately in [Status](STATUS.md).

## Public operation inventory

| Capability | API | Relevant state/authority |
| --- | --- | --- |
| Edit comment/reply | `updateDiscussionComment` | `viewerCanUpdate`, `viewerCannotUpdateReasons` |
| Delete comment/reply | `deleteDiscussionComment` | `viewerCanDelete`; parents with replies are wiped, preserving the thread |
| Hide/restore comment | `minimizeComment`, `unminimizeComment` | `viewerCanMinimize`, `viewerCanUnminimize`, reason/state |
| Lock/unlock | `lockLockable`, `unlockLockable` | `locked`, `activeLockReason`; no documented `viewerCanLock` |
| Close/reopen | `closeDiscussion`, `reopenDiscussion` | `viewerCanClose`, `viewerCanReopen` |
| Answer selection/removal | `markDiscussionCommentAsAnswer`, `unmarkDiscussionCommentAsAnswer` | Per-viewer capability fields, answerable category |
| Edit/delete discussion | `updateDiscussion`, `deleteDiscussion` | `viewerCanUpdate`, `viewerCanDelete` |
| Native upvote/undo | `addUpvote`, `removeUpvote` | `viewerCanUpvote`, `viewerHasUpvoted`, `upvoteCount`; app-token restriction unresolved |

Sources: [Discussions schema](https://docs.github.com/en/graphql/reference/discussions), [discussion mutation guide](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions), [Minimizable](https://docs.github.com/en/graphql/reference/issues#minimizable), [Lockable](https://docs.github.com/en/graphql/reference/issues#lockable). DiscussionComment implements Minimizable even though the generic mutation description incompletely lists types.

## Authority and verification

GitHub App Discussions read/write permissions are the relevant starting point. GitHub does not provide a complete per-mutation GraphQL permission matrix; its [permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-graphql-api-access) calls for testing intended operations.

Reader/moderator operations use the acting user's app-issued token. Access is bounded by both the user and app. Installation tokens must not be substituted to bypass a reader's missing authority. Classic OAuth/PAT scopes and GitHub App permissions are different models. See [user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Query viewer capabilities where available and enforce target/repository scope server-side. For locking, establish a conservative server-side capability based on verified repository authority and handle denial from GitHub; authorship alone is insufficient. GitHub's [moderation documentation](https://docs.github.com/en/discussions/managing-discussions-for-your-community/moderating-discussions) identifies triage access as sufficient for discussion moderation, but that does not prove every mutation succeeds for every role.

Acceptance should exercise the actual app configuration with an author, unrelated reader and moderator, including revoked access, lock state changes and canonical post-mutation results. Each successful capability needs a real-token test; schema presence and mocked tests alone are insufficient.

## Native upvotes: preserve the distinction

Pinned Giscus `3d643023`, `components/Comment.tsx`, disables upvotes with a comment specifically citing GitHub App user tokens. [The referenced issue](https://github.com/orgs/community/discussions/3968) includes GitHub's 2021 confirmation of unsupported integration tokens and a July 2026 user report of the same problem. No resolution is shown. This is evidence against assuming support, not a fresh authenticated reproduction.

The API's existence is established. Its usability in our authentication model is not. Retain an explicit verification gate; do not demand personal access tokens from readers to work around it. Kukas's accepted THUMBS_UP Toast mapping remains unchanged. Emoji reactions and native upvotes have separate identities/counts and must never be silently converted.

## Operations with effects beyond one conversation

[Personal blocking](https://docs.github.com/en/rest/users/blocking#block-a-user) supports GitHub App user tokens with a separate user permission. [Organization blocking](https://docs.github.com/en/rest/orgs/blocking#block-a-user-from-an-organization) supports user/installation tokens with a separate organization permission. These affect the account or organization, not just a blog comment thread.

Offer blocking through contextual comment/discussion controls when the acting user and App have permission. Explicitly identify whether it affects the personal account or organization. Use contextual GitHub action links when API support, deployment permissions, or the need for a broader administration workflow makes a handoff appropriate. Do not use standalone duplicate links or imply a handoff completed the operation. No public abuse-report submission API was established; [GitHub's reporting instructions](https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam) use GitHub's own interface/forms, so retain that handoff.
