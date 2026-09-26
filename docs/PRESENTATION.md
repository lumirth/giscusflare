# Standard presentation

The visual reference is Giscus itself, pinned at `3d6430237108ca4ee3eb6a1a20595201c09c72d5` and checked against the live widget at giscus.app. GitHub Discussions supplies the data and APIs; its website is not the visual acceptance reference.

## Default appearance

The standard presentation uses Giscus's named themes, Octicons, eight emoji reactions, compact author rows, reply timeline, latest-five folding, segmented sorting and bottom composer. Write/Preview tabs, the Markdown footer and editor focus ring follow Giscus. Initial loading uses its Mona animation, including the light, dark and dimmed variants from GitHub's asset servers.

The implementation uses separate Lit templates over the public conversation runtime. A replacement presentation can use `giscusflare/headless` without loading these templates or styles. The [independent example](../examples/custom.ts) demonstrates that boundary. The separate `kukas-giscusflare` consumer also exercises this boundary with its own Note-like presentation.

## Intentional differences

| Difference | Reason |
| --- | --- |
| Header wraps below 440px of available container width | Keep the comment summary together and move sorting/menu controls to their own row. |
| Persistent editor and decoration nodes | Preserve native undo grouping and editing history through Preview. |
| Optimistic reaction queue | Show changes immediately while serializing writes and reconciling GitHub results. |
| Five prefetched replies, bounded pages on demand | Limit initial API work; allow larger threads to expand in the widget. |
| Contextual author/discussion menus | Provide permission-checked editing and moderation, plus GitHub report links. |
| No disabled upvote control | A working upvote mutation has not been verified with App-issued user tokens. |
| Lowercase giscusflare attribution | Identify the service in use. |
| Shared sanitized content renderer, lazy math | Give standard and custom presentations the same content capabilities. |
| Native embedding and scoped styles | Support direct integration alongside iframe isolation. |
| Configurable recovery and fetching | Let deployments choose persistence and background-work budgets. |

Additional menus use the active Giscus theme's border, overlay, text and focus colors. Styling differences need a reason; a separate implementation alone is not one.

## Browser checks on 2026-09-26

Both widgets displayed `lumirth/kukas-comments` discussion 1. Light, Dark, Dark Dimmed, NoBorder Light, Purple Dark, Light High Contrast and Fro were inspected visually. Computed colors, padding, line heights and border radii were compared for author rows, prose, reaction controls, sorting and the editor.

This pass corrected the attribution link color, post reaction-picker text size, action-menu outline, comment surface background and native theme root scoping. Purple Dark exposed the missing `html` font rule; Fro also uses root-level font settings. Closed popovers can return stale computed styles in WebKit, so inspect them open when checking theme changes.

Native undo was compared with a plain textarea using the same keyboard sequence. Recreating sibling SVG nodes on each keystroke split WebKit undo into single characters. Stable nodes restored grouped undo, including after Preview/Write. A DOM-mutation regression test covers the triggering behavior; JSDOM alone cannot verify native undo.

The earlier 390px iframe check measured equal client and scroll widths and inspected the anonymous composer. Physical iOS, Firefox, every theme/locale, complete real-token moderation and Free-plan CPU qualification remain release work. See [Status](STATUS.md).

[Measured theme values](evidence/theme-comparison.json) record the compared controls in seven themes. The signed-in light view is shown in [the staging screenshot](evidence/standard-refinement-light.png). Viewer state must match when comparing colors. GitHub's live records confirmed that every visible reaction in this fixture belonged to `lumirth`, who also authored every root comment. On signing out of staging, all four visible reaction pills retained their counts but became neutral, and all three root borders changed to `rgb(208, 215, 222)`. The [anonymous light view](evidence/standard-anonymous-light.png) records that result. The apparent universal highlighting came from the single-author fixture, not from using counts or repository ownership as selection signals.

A mixed-state presentation regression now covers a selected heart beside an unselected thumbs-up with a larger count, viewer-authored and other-authored roots (both marked OWNER), and a refresh clearing viewer flags without losing counts. Live comparisons with multiple participants remain preferable to this fixture for visual review.

## Mobile gutter correction

The native CSS scoper now discards empty selector-list entries. An upstream code-block rule ends with a trailing comma; previously, the empty entry became `.giscusflare`, applying 16px code-block padding to the whole widget. The fix removes that unintended root styling rather than offsetting it with negative margins. A regression checks the generated native CSS.

The staging host contributes an 8px gutter at phone widths; the widget contributes none. A 390px WebKit check measured the comment edge at x=8px and document scroll width equal to viewport width. [Mobile screenshot](evidence/core-mobile-gutters.png). This is desktop WebKit at a narrow viewport, not a physical iPhone check.
