# Release work

The shared model, reusable interactions, iframe/native embedding and standard presentation are implemented. [Status](STATUS.md) records verification; [Design](DESIGN.md) defines ownership and behavior.

## Gate for starting Kukas

The bounded desktop journey, narrow-screen check and resource sample are recorded in [Confidence](CONFIDENCE.md). They are sufficient to proceed with the separate Kukas presentation. The broader items below are public-release qualification, not prerequisites for each design iteration.

## Standard presentation

Compare directly with Giscus on the same discussion, across themes and narrow/wide layouts. Check loading, colors, borders, spacing, author rows, reactions, folding, sorting and the composer. Record intentional differences in [Presentation](PRESENTATION.md). Visual parity does not require copying Giscus's UI implementation.

## Real GitHub permissions

Verify each supported author/moderator action with App-issued user tokens, including permission denial and revoked access. Cover edited, deleted, minimized, locked, closed and answered states. Check canonical results after mutations and mapping behavior after discussion deletion. See [GitHub API](GITHUB-API.md).

Native upvotes remain unverified for App-issued user tokens. Keep them separate from emoji reactions. Use contextual GitHub links for unsupported actions, including abuse reporting.

## Browser coverage

Exercise Preview/Write, grouped undo/redo, selection, focus, refresh during composition, sort changes, long reply chains and uncertain-write recovery. Test both embedding modes, same-window authentication and optional popup return. Include Safari, Firefox and physical iOS.

Run a rich-content corpus through Preview and published comments: Markdown structures, code, math, media, long identifiers, lazy-loading failures and reduced rendering profiles.

## Deployment qualification

Measure Worker CPU, GitHub requests, storage operations and browser resources under representative traffic. Local tests and a paid staging account do not establish Free-plan capacity. Keep deployment instructions and the capability matrix current.

## Kukas presentation

Refine Kukas's native presentation in `kukas-giscusflare` using public core APIs. Keep anonymous Post/Note Toasts in their separate service. If the presentation needs private core access, improve the public contract first.

Production Kukas comments stay disabled until visual approval. Stabilize the customization API after the standard presentation and Kukas both exercise it.
