# The 3.0 replacement

Version 3 replaces the conversation, authentication, repository authority and ranking models while retaining the demo/default giscus presentation visually. The codebase becomes smaller by deleting responsibilities that the new owners make unnecessary. It deliberately breaks browser contracts, the service protocol, persisted coordination and ranking freshness semantics. [Design](DESIGN.md) specifies the resulting system.

## What was replaced

| Earlier machinery | Version 3 owner and resulting deletion |
| --- | --- |
| Nested thread/reply DTOs, projected conversation state, read/mutation reconciliation and depth restoration | One normalized `PageDocument` contains canonical nodes and ordered windows. The service emits canonical acquisition results and patches. Refresh replaces reading windows. The old controller and model files are deleted. |
| Browser conversation subclass, forwarding facade, mount subscription relay and independent draft channel | `createConversation` returns the actual page owner with browser capabilities attached. The mount owns page/view replacement; the page owns its own observers, writing and contributions. |
| Generic operation registries, mixed string scopes and contribution snapshots | Draft records contain text, editor, retry key and pending/error state. One serial effect queue owns issued contributions; reaction intent is per subject. |
| Editors attached to fetched rows, preview bindings and retained presentation-part registry | Page draft records retain writing independently of fetched rows. The main editor is permanent; inline reply/edit DOM belongs to its rendered row. Views and bodies own acquired resources through abort lifetimes. There is no row-depth restoration or part-retention sweep. |
| Utility compiler/scanner and hover-label controller | A pinned generated visual foundation plus one authored override sheet reproduce the reference appearance. Native CSS derives picker labels from the active button. The owned textarea has a small reference-geometry hook with CSS as the sole owner of its size bounds; CSS positions the main editor without moving it. |
| Separate thread/replies/hydrate and comment/edit/delete/reaction/moderation protocol families | One `page` acquisition protocol and one `contribute` command family carry the canonical contract. HTTP serialization belongs to the Worker. |
| Client repository/category hints and different configured/open repository actor selection | The Worker resolves the immutable installed public repository ID. Both hosting modes use the same App/repository/version actor identity; category policy belongs to the operator. |
| Separate known/find/authority/root/reply/hydration/create pipelines | One acquisition path resolves selection, observes fresh authority and obtains the requested window. Creation shares that owner under the term lock. |
| Effect response projections persisted in receipts, mutable-login receipt ownership and legacy fingerprint promotion | A receipt holds immutable principal, request fingerprint and minimal confirmed effect identity. Current display and counts come from an optional fresh observation. Failure to observe cannot repeat a confirmed effect. |
| OAuth completion endpoint, polling, tickets, ready credential staging and consume handoff | The parent creates its future capability. Authorization atomically installs its hashed session; the trusted return lets the parent adopt its own capability. Sessions hold principal and credentials; page reads supply current display. |
| Grouped ranking JSON, separate locators, discover/catchup/finalization phases, pending/unresolved queues, conservative reservations and partial corrections | Typed SQL observations, one collection checkpoint and a two-mode acquisition scan. Complete canonical facts update SQL directly. SQL computes scores; a bounded cache retains derived completed orders. |
| Maximum-age/fence guarantees, policy mirrors and legacy derived-storage migration | A result reports its acquisition interval and refresh cadence. Budget pauses retain successful progress; failed acquisition is abandoned and a later attempt starts fresh. Version 3 uses fresh coordination namespaces. |
| Parallel Node/SQLite service, test transport factories, private exports, JSDOM globals and isolated unit/change-detector suites | Public workflows run against the actual Worker/SQLite Durable Object in workerd, Chromium/WebKit and independently modeled GitHub effects. The parallel runtime and all old `test/*.test.mjs` files are deleted. |

Current product outcomes include root/reply reading, chronological and configured ranking orders, contributions, editing, removal, reactions, moderation, counts, Markdown preview, GitHub sign-in, native/iframe rendering, custom presentations, themes, translations and setup. Breaking contracts are explicit rather than supported by adapters. No Effect framework was added: the concrete ownership changes remove the duplicated lifecycle/state responsibilities without introducing another runtime model.

## Replacement-inclusive accounting

The [file-level ledger](source-ledger.csv) compares committed `b39375bbba0b8249c3bc661c63150b5917b31d80`, the dirty checkout saved when this effort began, and the complete current implementation. It includes every present replacement under `src`, `test`, `scripts`, `examples`, `package`, `public` and `website`, including native/browser verification support.

Documentation, configuration, lockfiles, dependencies, vendor/platform reference data and generated outputs are excluded from authored-source savings. TypeScript 5.9.3 `createPrinter` with LineFeed normalizes JS/TS before counting nonblank lines. CSS, HTML and template literal contents retain formatting. Physical lines and bytes are also reported. These measures expose formatting and replacement costs; they are not a semantic complexity score.

| Scope and measure | Committed baseline | Dirty starting checkout | Version 3 |
| --- | ---: | ---: | ---: |
| Product `src`: consistently printed nonblank lines | 7,863 | 7,225 | 6,094 |
| Product `src`: physical lines | 6,718 | 5,884 | 5,178 |
| Product `src`: bytes | 446,474 | 423,479 | 384,922 |
| All authored implementation/examples/verification: printed lines | 12,078 | 11,318 | 8,373 |
| All authored implementation/examples/verification: physical lines | 9,596 | 8,758 | 7,100 |
| All authored implementation/examples/verification: bytes | 680,915 | 662,251 | 534,500 |

Against committed main, product printed source falls **22.5%** (1,769 lines), and the complete authored apparatus falls **30.7%** (3,705 lines). Total bytes fall **21.5%** (146,415 bytes). Against the already modified dirty starting checkout, product printed source falls **15.7%** and the complete apparatus **26.0%**, with total bytes down **19.3%**. New verification drivers grow `scripts`; their full cost is included rather than hidden by deletion of the older test directory.

The generated visual dependency is disclosed separately in [source provenance](PROVENANCE.md); it is not counted as authored source and no runtime CSS payload reduction is claimed. Project overrides, markup and native/theme adaptation remain fully counted. The ordinary build removes Tailwind and its 67-package compiler chain. Removing JSDOM retires the simulated browser environment and 43 installed packages; dependency removals are not counted as authored LOC savings.

## Behavior and resource evidence

The [release gate](../TESTING.md) exercises public HTTP/OAuth/contribution workflows through native workerd and SQLite, browser journeys in Chromium/WebKit, complete-service ranking with native SQL counters and due alarms, and consumers built from an extracted package. Old unit suites and synthetic ranking/runtime worlds are not current qualification. Receipts in `docs/evidence` identify the exact source hash, runtime, conditions and passing or failing result.

The visual qualification separately compares the actual pre-PR and replacement demos in both engines and embedding modes at narrow and desktop widths. Equivalent reading, writing, preview, appearance, menu, reaction, reply, edit and delete-dialog states use full RGBA comparison without masks. Its receipt declares controlled input and state normalization. Restoring the presentation does not restore the old ownership model.

The native provider model keeps effects outside workerd across restart. Receipt replay is checked against the independent external effect count, including a confirmed write whose optional observation fails and an ambiguous write whose connection dies after commit. Browser typing/undo/redo, persisted writing, actual readback, resource retirement and host isolation supply behavioral oracles. Stable node identity alone does not establish native editing history.

The ranking workload covers a warm stable 10,000-root/10,000-visit/200-reaction day, the representative allowance divided across three enabled repositories, and a cold acquisition paused by budget and restarted in native storage while external membership changes. It uses realistic opaque IDs and records actual complete-order JSON bytes. See [capacity](../FREE-TIER.md) and [verification results](CONFIDENCE.md) for conditions and current receipts.

Simplification does not imply every resource is cheaper. A confirmed existing-target effect uses preflight, minimal mutation and optional canonical observation: three provider calls excluding token renewal. This pays for a single fresh canonical representation instead of keeping effect-specific projection/reconciliation. Ranking SQL thresholds stop between bounded steps and can overshoot the last step; HTTP admission is enforced before provider calls. Ready orders describe an acquisition interval, not a globally atomic or uniformly fresh remote snapshot.

Local evidence does not establish deployed CPU, object-duration distributions, real GitHub permissions, Cloudflare billing, Firefox or physical Safari/iOS behavior. No version 3 deployment or package publication is claimed. Cutover requires matching Worker/browser versions and manual reconciliation of old uncertain writes; old namespaces remain retained for recovery.
