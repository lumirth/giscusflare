# Compatibility reference

Maintainers use this checklist to compare the standard giscusflare widget with giscus. It comes from giscus commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. See [Verification evidence](CONFIDENCE.md) for completed tests.

## Behavior to preserve

| Area | Reference behavior |
| --- | --- |
| Identity | GitHub sign-in, return to the host, sign-out, and viewer permissions |
| Mapping | Six mapping modes, strict matching, category selection, and backlinks |
| First write | A mapped discussion can be created on the first comment or reaction. Explicit-number mapping must not create a replacement. |
| Editor | Write/Preview, fixed-width font, automatic height, Ctrl/Cmd+Enter, reply cancellation, Markdown help, and top or bottom placement |
| Content | Headings, emphasis, lists, quotes, tables, details, code, emoji, task-list appearance, and math |
| Code | Syntax-token styling, copy controls, and copy feedback |
| Reactions | Eight GitHub emoji values, counts, and viewer selection on discussions, comments, and replies |
| Pagination | Oldest/newest order, root pagination, and latest-five reply folding |
| Refresh | Refresh on return, reconnect, and local actions. The inspected source does not require continuous polling. |
| Exceptional states | Loading, errors, missing discussions, rate limits, locked threads, deleted authors, and minimized comments |
| Languages and themes | Dictionaries, fallback, pluralization, localized dates, RTL, input direction, and named or custom themes |
| Host integration | Lazy iframe loading, resizing, clipboard permission, and configuration, session, metadata, and error messages |

Task lists are display-only. The source review found no dedicated upload, lightbox, or Mermaid subsystem.

## Differences to test deliberately

giscusflare adds native embedding, custom presentations, in-widget author and moderation actions, and bounded reply pagination. These need their own acceptance tests. Upstream giscus fetches at most 100 replies before local expansion and a GitHub overflow link; giscusflare can fetch further pages in the widget.

Native upvotes are disabled in the inspected giscus widget. See [GitHub API support](GITHUB-API.md).

Third-party giscus themes may depend on selectors that differ in giscusflare. Test the rendered result instead of assuming selector compatibility.

## Source references

- [Comment editor](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/CommentBox.tsx), [conversation](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Giscus.tsx), [comments](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Comment.tsx), and [replies](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/components/Reply.tsx).
- [Discussion queries](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/getDiscussion.ts), [Markdown preview](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/markdown.ts), and [refresh and pagination](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/giscus/discussions.ts).
- [Content adapter](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/adapter.ts), [math and its license notice](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/vendor/math-renderer-element.ts), and [content styles](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/styles/base.css).
- [Localization](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/i18n.tsx), [themes](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/lib/hooks.ts), [loader](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/client.ts), and [host configuration](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/ADVANCED-USAGE.md).
