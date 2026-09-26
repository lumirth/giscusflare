# Giscusflare acceptance reference

Type: research
Status: resolved

Source inspection of upstream Giscus at `3d6430237108ca4ee3eb6a1a20595201c09c72d5`, available in the reviewed port checkout. This records source-visible capabilities, not completed browser/GitHub acceptance. Port changes are present in that checkout; do not treat port-specific transport/build changes as upstream architecture requirements.

| Area | Source-visible upstream behavior | Giscusflare acceptance implication |
| --- | --- | --- |
| Identity | GitHub sign-in, session exchange, sign-out and host messages | Preserve identity/permissions; own session implementation and migration are allowed. |
| Writing | Comment/reply creation; mapped discussion created on first comment or reaction; explicit-number mapping never creates a replacement | Verify mapping continuity, author identity, retries and first-write concurrency. |
| Editor | Write/Preview, fixed-width-font toggle, autoresizing input, Ctrl/Cmd+Enter, cancel reply, Markdown help, top/bottom placement | These are actual default capabilities, not optional polish to omit from a minimal rebuild. |
| Rich content | GitHub `bodyHTML`; preview through contextual GFM `/markdown`; shared HTML enhancement | Foundational pipeline covering preview and published content consistently. |
| Content structures | Headings, emphasis, lists, quotes, tables, details, inline/block code, emoji and task-list styling | Verify a representative corpus; task-list appearance does not imply persistent checkbox editing. |
| Code | GitHub syntax-token styling, injected copy controls and feedback | Preserve highlighting and copy behavior; upstream is not evidence of a particular local highlighter library. |
| Math | Custom-element enhancement; heavy engine loaded when math connects; sanitized MathML output, input limits and errors | Include in the rich-content baseline. Alternative implementations need compatibility tests/fallbacks. Review the vendor file's separate license before reuse. |
| Other media | Returned HTML is rendered; no dedicated upload, lightbox or diagram subsystem established by inspected source | Verify supported image/media markup with actual fixtures. Do not declare Mermaid or uploads required for parity solely because GitHub itself has richer functionality. |
| Reactions | Eight values with counts/viewer state on discussion/comments/replies; main-post visibility is independent | Keep standard reaction meaning. Native upvote button is disabled in inspected upstream; a working native upvote mutation is not an upstream parity requirement. |
| Pagination | Oldest/newest, root pagination; last 100 replies fetched, last five initially shown, local expansion and GitHub overflow link | Preserve familiar folding/order while deliberately improving full in-widget pagination and state continuity. |
| Refresh | SWR revalidates on mount/focus/reconnect and local actions; no continuous polling/SSE/WebSocket found | Do not mistake the homepage's automatic-fetch promise for a mandatory recurring timer. Preserve fresh-on-return/action behavior and evaluate refresh costs. |
| Exceptional states | Loading/errors/not-found/rate-limit/locked; deleted/minimized notices; deleted-author fallback | Model these explicitly, including state changes while a reader composes. Closed/answered/accepted-answer state support was not established. |
| Editing/moderation | Inspected widget displays edited/deleted/minimized states but has no discovered edit/delete/minimize action implementation; GitHub links provide access | Candidate in-widget editing/deletion/moderation are enhancements, not proven upstream parity requirements. Decide what to expose in the standard interface. |
| Localization/themes | Dictionaries/fallback/pluralization, localized dates, RTL and auto-direction input; varied named themes and live custom CSS | Include localization and actual theme behavior in parity scope; do not claim unchanged third-party selector compatibility. |
| Host integration | Six mapping modes, strict hashes, repo/category/backlinks; lazy/resizing iframe, clipboard permission, metadata/errors/session/config messages | Familiar contracts where useful, documented new APIs where better. Direct-in-page mode is an accepted Giscusflare addition. |

## Source pointers

- [Editor](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/CommentBox.tsx), [conversation](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Giscus.tsx), [comments](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Comment.tsx), [replies](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Reply.tsx).
- [GitHub queries](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/getDiscussion.ts), [preview](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/markdown.ts), [refresh/pagination](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/giscus/discussions.ts).
- [Rich-content adapter](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/adapter.ts), [math renderer/license notice](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/vendor/math-renderer-element.ts), [content/code styles](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/styles/base.css).
- [Localization](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/i18n.tsx), [theme hooks](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/hooks.ts), [loader](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/client.ts), [public integration documentation](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/ADVANCED-USAGE.md).

Use this inventory to construct actual acceptance fixtures. Absence of an implementation in this inspection is not a claim about all GitHub features or every later Giscus version.

## Expanded scope after the interview

The user wants fuller author/moderation actions wherever the GitHub API permits them. Their absence from pinned Giscus no longer implies deferral. See [current API and token evidence](GITHUB-API.md). API support must be verified using the deployed app and acting user, particularly for native upvotes.
