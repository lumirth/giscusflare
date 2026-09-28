# Default interface

The default interface uses giscus themes and layout, with Octicons, eight emoji reactions, compact author rows and a reply timeline. Its composer appears at the bottom unless configured otherwise. Readers can switch between Write and Preview, use a fixed-width font and expand earlier replies.

Comment menus show edit, delete and hide actions according to the reader's permissions. Discussion administration stays on GitHub.

## Embedding and layout

The native widget scopes its styles to its root. It adds no outer gutter, so your page controls the space around it. Below 440px of available width, the header moves sorting and menu controls onto another row. Replies initially show the latest five and load earlier replies in pages.

An iframe isolates the widget's styles from your page. Native embedding lets you place it directly in your layout. See [integration](INTEGRATION.md) for both options and [customization](EXTENDING.md) for component replacements or a complete custom interface.

## Comment content

Preview and posted comments use the same sanitized HTML renderer. It supports GitHub Markdown, syntax highlighting, copy controls and lazy math rendering. A malformed expression displays an error with its original source. Code-copy controls remain available when highlighting cannot complete.

GitHub code previews retain their file links, line numbers and indentation. GitHub expands code links only in the repository containing that code; a link copied into another repository remains a link. See [GitHub's code snippet guide](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-a-permanent-link-to-a-code-snippet).

## Comparing with giscus

The reference source is pinned at giscus commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Use the same discussion, theme, width and sign-in state when comparing the two interfaces. Selected reactions and the reader's own comments have different colors from their anonymous equivalents.

The September 26, 2026 WebKit pass compared Light, Dark, Dark Dimmed, NoBorder Light, Purple Dark, Light High Contrast and Fro. It measured colors, spacing, line heights and border radii for author rows, prose, reactions, sorting and the editor:

- [Theme measurements](evidence/theme-comparison.json).
- [Signed-in light view](evidence/standard-refinement-light.png) and [anonymous light view](evidence/standard-anonymous-light.png).
- [Narrow layout](evidence/core-mobile-gutters.png), with an 8px gutter supplied by the test page.

The September 27 comparison also checked the replacement implementation against the pre-redesign widget at 390 CSS pixels. Comment, reply, header and composer geometry matched. The September 28 pass added the complete rich-content example described above.

Native undo was checked against a plain textarea with the same keystrokes and a Preview/Write round trip. Automated tests preserve the editor's DOM nodes; browser checks exercise undo, focus and selection. See [testing](../TESTING.md#undo-regression) for the procedure.
