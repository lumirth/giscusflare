# The 4.0 replacement

Version 4 separates content rendering from presentation, makes contribution identity independent of editor visibility, and distinguishes background observation from deliberate reading restart. It breaks the public browser and HTTP contracts to remove responsibilities that custom presentations previously reconstructed. [Design](DESIGN.md) describes the current system; [API](API.md) specifies its supported interface.

| Superseded responsibility | Current owner |
| --- | --- |
| Synchronous whole-body escape hatch, feature output inside imposed code shells, separate preview acquisition and enhancement | Explicit `ContentRenderer` with original source, lazy provider HTML and complete feature replacement. One `mountContent` lifetime serves bodies and previews. |
| Default Markdown/math interpretation imported by every consumer | Headless consumers select content explicitly; standard mounting supplies the optional GitHub renderer. Content CSS is separately importable. |
| Editor identity used as contribution destination; persisted draft text/key without unresolved state | Stable `Writing` target and immutable issued target/body/key/author. Visibility is separate, and recovery retains uncertainty. |
| Quiet refresh replacing accumulated roots/replies | Bounded observation of loaded content preserves traversal. Restart and order changes explicitly acquire a new traversal. |
| Presentation reconstruction of permissions, authentication and private reaction/effect recovery | Derived public subject actions and owner-specific writing actions. |
| Version 3 browser/protocol compatibility | Direct version 4 consumers and `/api/v4/`; no forwarding adapters. Durable receipt-key format remains unchanged. |

The standard presentation uses these same public owners and retains the established giscus appearance. Hosts can use the complete defaults, replace code/math output, or use their own Markdown pipeline for both previews and published bodies. A local renderer avoids the unused provider preview request. A replacement owns its full output and resources instead of removing unwanted default frames after rendering.

Writing retains its destination when hidden or when its row leaves reading. Protected issued writing cannot be changed or cleared; retry uses the original identity. Abandonment is explicit and cannot cancel a possibly completed external effect. Presentations choose how to expose that decision. Background observation is bounded and does not claim every loaded comment is uniformly fresh or discover new membership. Invalid continuity asks the reader to restart.

## Qualification and accounting

Version 4 is a release candidate, not a claim of a published or deployed service. Current qualification status belongs in the PR and test-run artifacts. [Verification](../TESTING.md) defines required behavior and release checks; [confidence](CONFIDENCE.md) distinguishes local proof from deployed acceptance.

Replacement accounting includes core, defaults, examples, downstream adapters and verification support. Report physical lines, consistently formatted authored lines and bytes; disclose generated dependencies separately. Dependencies, adapters and newly introduced verification count against the change. Compare the complete replacement with the actual starting checkout; moving a responsibility to another repository is not by itself a saving.

Detailed ledgers, JSON receipts and screenshots are ignored run/PR artifacts, not maintained source. Historical version 3 accounting and qualification remain available in [PR 2](https://github.com/lumirth/giscusflare/pull/2). They do not qualify version 4.
