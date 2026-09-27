# Standard presentation

The standard widget follows [giscus](https://giscus.app/). Its reference source is pinned at commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`.

## Appearance and behavior

The widget uses giscus themes, Octicons, eight emoji reactions, compact author rows, a reply timeline, and a bottom composer by default. Replies initially fold to the latest five. Readers can change the sort order and expand more replies. The editor has Write and Preview tabs, Markdown help, and a focus ring. The initial loader uses giscus's Mona animation.

Below 440px of available width, the header wraps its sorting and menu controls onto a separate row. The widget adds no outer gutter. The host page controls that spacing.

Comment menus expose edit, delete and hide actions according to the reader's permissions. Discussion administration stays on GitHub. Emoji reactions retain their GitHub meaning; GitHub upvotes are separate.

The editor keeps its textarea and decoration nodes stable to preserve browser undo history through typing and preview changes. Reactions appear immediately, then reconcile with serialized GitHub writes. Reply pagination fetches bounded pages instead of loading every reply at once.

## Custom presentations

The standard templates use the public conversation runtime. A custom presentation can import `giscusflare/headless` without importing the standard templates or styles. See [Extending giscusflare](EXTENDING.md) and the [custom presentation example](../examples/custom.ts).

Use the shared content renderer for preview and published content. It handles sanitization, code controls, and optional lazy math. A custom theme may need changes to its selectors because the native widget scopes styles to its root.

## Recorded comparison

On September 26, 2026, a desktop WebKit comparison inspected Light, Dark, Dark Dimmed, NoBorder Light, Purple Dark, Light High Contrast, and Fro. It compared colors, padding, line heights, and border radii for author rows, prose, reactions, sorting, and the editor.

The [theme measurements](evidence/theme-comparison.json), [signed-in light screenshot](evidence/standard-refinement-light.png), and [anonymous light screenshot](evidence/standard-anonymous-light.png) record that pass. Match viewer state when comparing screenshots. Selected reactions and viewer-authored comments use different colors from their anonymous equivalents.

A narrow desktop WebKit check found equal document scroll and client widths, with the comment edge at the host's 8px gutter. See the [mobile-width screenshot](evidence/core-mobile-gutters.png).

Native undo was compared with a plain textarea using the same keystrokes, including a Preview/Write round trip. A DOM regression test checks node stability. It cannot verify the browser's undo stack.

See [Verification evidence](CONFIDENCE.md) for the remaining browser coverage.
