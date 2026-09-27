# Broader Giscusflare release qualification

The shared model, reusable interactions, iframe/native embedding and standard presentation are implemented. [Status](STATUS.md) records verification; [Design](DESIGN.md) defines ownership and behavior.

## Scope

The user-approved Kukas integration is deployed. Its design and activation gates are complete. This document is the single remaining qualification checklist for broader Giscusflare release claims; it is not an instruction to reopen Kukas design or begin this work automatically. See [bounded evidence](CONFIDENCE.md) for what was actually checked.

## Standard presentation

Compare directly with Giscus on the same discussion, across supported themes/locales and narrow/wide layouts. Check loading, colors, borders, spacing, author rows, reactions, folding, sorting and the composer. Record intentional differences in [Presentation](PRESENTATION.md). Visual parity does not require copying Giscus's UI implementation.

## Real GitHub permissions

Verify each supported author/moderator action with App-issued user tokens, including permission denial and revoked access. Cover edited, deleted, minimized, locked, closed and answered states. Check canonical results after mutations and mapping behavior after discussion deletion. See [GitHub API](GITHUB-API.md).

Native upvotes remain unverified for App-issued user tokens. Keep them separate from emoji reactions. Use contextual GitHub links for unsupported actions, including abuse reporting.

## Browser coverage

Exercise Preview/Write, grouped undo/redo, selection, focus, refresh during composition, sort changes, long reply chains and uncertain-write recovery. Test both embedding modes, same-window authentication and optional popup return. Include Safari, Firefox and physical iOS.

Run a rich-content corpus through Preview and published comments: Markdown structures, code, math, media, long identifiers, lazy-loading failures and reduced rendering profiles.

## Deployment qualification

Measure Worker CPU, GitHub requests, storage operations and browser resources under representative traffic. Local tests and a paid staging account do not establish Free-plan capacity. Keep deployment instructions and the capability matrix current.

## Public API and packaging

Before a stable public release, qualify the package/deployment instructions and versioning contract against both the standard presentation and the shipped Kukas consumer. Keep custom presentations on supported core APIs. Anonymous Post/Note Toasts remain in their separate service; they are outside this comments qualification work.
