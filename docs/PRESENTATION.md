# Standard presentation replacement

Implemented 2026-09-26 against Giscus commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5` and direct visual inspection of the discussion on giscus.app.

## Retained design

The default uses Giscus's original named themes, compiled base/global styles, GitHub Octicons, eight original emoji reactions, 26px reaction controls, compact author/date/badge rows, threaded reply timeline, latest-five reply folding, segmented sorting, and bottom composer. Its Write/Preview tabs, Markdown footer and surrounding focus ring follow the upstream editor. Ordinary sign-in uses same-window navigation; popup sign-in is an explicit API option. Empty threads have one primary sign-in control, with contextual sign-in inside a reaction picker when opened.

The rejected monolithic widget, prepared-DOM component hooks, rearrangement helper and bespoke stylesheet were deleted. The new standard modules consume public shared APIs. The iframe bootstrap handles embedding only. A separate headless example demonstrates a wholly different layout without importing the standard renderer or CSS. Kukas's unfinished presentation has been removed from the deployment build; it is a later consumer exercise.

## Deliberate differences

| Difference | Reason |
| --- | --- |
| Persistent textarea during Preview | Preserve native editing/undo history instead of remounting the editor. |
| Optimistic latest-intent reaction queue | Immediate feedback with serialized writes, definite rollback and explicit uncertain-outcome recovery. |
| Five replies prefetched, bounded pages on demand | Free-tier-first upstream work budget; configurable independently of presentation. |
| Contextual author and discussion action menus | Expose permission-checked editing/moderation and GitHub report links without a separate administration interface. |
| No inert upvote control | App-issued user tokens do not provide the supported upvote operation assumed by that affordance. No emoji is renamed as an upvote. |
| Giscusflare attribution | Accurately identify this independent implementation. |
| Sanitized shared rich-content renderer and lazy math | The same safe pipeline serves Preview, published content and replacement presentations. |
| Native embedding with scoped CSS | Host pages may choose direct embedding while iframe isolation remains available. |
| Optional short draft recovery and bounded refresh policy | Shared, configurable continuity; no presentation-specific persistence or polling engine. |

The added action menus are an intentional capability extension. Exact pixels are not the contract; accidental styling or workflow differences remain defects.

## Verification boundaries

Automated model tests exercise races, response loss, identity changes, canonical reconciliation, cancel/reopen behavior and recovery. JSDOM checks editor attachment/focus continuity, default structure and replaceable parts. Build assertions reject standard modules in headless/custom-only graphs.

Direct browser checks on the retained real staging fixture verified reply expansion from five to nine, immediate reaction feedback and removal, light/dark themes, rich content including code and math, and undo after Preview. A local 390px iframe viewport was measured at 390px client/scroll width, with no horizontal page overflow. Its anonymous composer and thread layout were visually inspected. The local iframe request/initialization path was exercised against the simulated GitHub service.

The browser controller could inspect the iframe but refused its sign-in click with a stale focus-root error. That specific browser-driven sign-in round trip is not newly certified here. Existing local workerd authentication tests and earlier real App sign-in evidence are separate evidence. Hardware iOS, every theme/locale, full real-token moderation and Free-plan request CPU require dedicated release qualification.
