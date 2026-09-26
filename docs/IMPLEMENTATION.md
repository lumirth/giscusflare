# Giscusflare implementation plan

Type: task
Status: claimed

Planning artifact from the ongoing design interview. Implementation authorized and started. Core naming, compatibility priorities, customization/embedding, Kukas direct-in-page rendering and its separate deployment repository are accepted. The user confirmed the full design.

## 1. Establish the core and acceptance reference

Use the reviewed `giscus-workers-v2` as the recommended starting point, with selective improvements from `giscus-workers 3`. This is a foundation choice, not an assertion that the downloaded UI or supported feature set meets the agreed scope.

Create a source-grounded capability matrix against a pinned upstream Giscus version. Distinguish implemented reader capabilities, integration contracts, GitHub-only functionality and currently disabled controls. Include rich content, preview, localization, themes, automatic refresh and exceptional conversation states. Verify licensing of any reused source/assets, especially vendored content renderers. Pin the acceptance reference and maintain an explicit difference list as upstream evolves.

## 2. Strengthen the backend boundary

Retain the separate repository engine, authentication, storage, GitHub transport and Cloudflare adapter. Harden durable transitions around external writes/token refresh and verify restart recovery. Use official/generated platform types at the deployment boundary and preserve independently testable domain code. Validate scope/permissions, canonical mutation results, and runtime response contracts. Measure/correct repeated metadata reads, cache boundaries and resource budgets; personalized permission/reaction data must remain correctly scoped.

Include API-supported author editing/deletion and discussion moderation in the release scope; see [API verification](GITHUB-API.md). Verify each action with GitHub App user tokens and permission-denied cases. Do not substitute installation authority for reader authority. Model moderation reasons, wiped parents with preserved replies, locked versus closed states, accepted answers and mapping behavior after discussion deletion explicitly. Native upvotes require separate token verification and remain distinct from emoji reactions. Include account/organization blocking where supported by the acting user/app permissions and appropriate to a contextual comment action. Reader/moderator actions use app-issued user tokens; individual PATs are not a fallback. Use clearly labeled contextual GitHub action links for unsupported operations or broader administration workflows, including reporting unless a submission API is established. Avoid duplicate standalone handoff links and a sprawling administration UI.

## 3. Build the supported conversation model

Own canonical comments/replies and stable identities, pagination cursors, pending operation intents, durable retry keys, drafts, open editors, sort order and expanded thread state. Provide state subscriptions and controlled actions without requiring consumers to reproduce authentication or network/retry logic.

Successful mutations reconcile the affected entity and reveal the posted result while preserving the reader's chosen order and expanded content. Retrying an uncertain write retains its original identity. Incoming updates must not destroy drafts, focus or pagination. Define lifecycle cancellation/disposal and stale-response handling explicitly. Refresh behavior must satisfy the capability inventory within measured resource limits, rather than inheriting either candidate's timing policy without examination.

## 4. Build the shared rich-content pipeline and standard interface

Posted content and previews use consistent content processing, safe rendering and enhancement rules. Markdown, code blocks/windows, highlighting, math and other verified supported patterns are baseline functionality. Make capability implementations replaceable, with full default support and on-demand capable fallbacks; explicitly reduced profiles are opt-in.

Use the public conversation and rendering APIs for the standard interface. Match the Giscus/GitHub Discussions appearance and interaction closely, allowing deliberate ergonomic and correctness improvements. Component replacement, icons, layouts and whole-interface replacement should be supported without fragile dependence on private DOM descendants.

Do not freeze speculative API signatures before the complete standard interface and the actual Kukas use cases exercise them. Keep server-only credentials and dependencies out of consumer browser modules.

## 5. Support both embedding modes

Provide the default iframe integration and an optional direct-in-page integration over the same conversation model. Each needs explicit mount/update/dispose, authentication handoff, origin/session policy, navigation and theme behavior. Direct rendering is a real integration mode with its own tested boundary, not removal of the iframe tag from the existing implementation.

Distribute custom code through ordinary build-time imports. Permit runtime configuration to choose installed presentations/capability profiles. Establish public API/versioning boundaries before declaring a stable release; ordinary internal implementation changes remain private.

## 6. Implement the Kukas consumer

Create a thin `kukas-giscusflare` repository containing site-specific components/renderers, profile choices and deployment/integration configuration, depending on the core rather than copying it. Kukas uses direct-in-page rendering.

Carry forward the accepted comments design and Toast mapping. Keep anonymous Post/Note Toast participation in its existing separate service. Exercise deep customization through public core interfaces; any required private shortcut is evidence that an interface needs improvement.

Normal production comments remain disabled until visual design approval. This plan does not authorize restoring that flag merely because a new backend works.

## 7. Acceptance before production readiness

- Verify mapped existing GitHub discussions, real OAuth/session renewal, permissions and posting in the already authorized development fixture or other explicitly authorized staging scope.
- Test lost responses, reloaded drafts, repeated submissions, restart during external transitions, pending failures and deleted/changed targets.
- Test long/paginated reply conversations, incoming updates during composition, sorting, focus and selection continuity, and both embedding lifecycles.
- Exercise a rich-content corpus through preview and posted rendering, lazy enhancement, fallbacks, loading failures, overflow and security boundaries.
- Inspect actual default and Kukas interfaces in light/dark, wide/narrow layouts and iOS; test controls rather than substitute static mockups.
- Measure deployed CPU, upstream/API requests, storage operations and browser resources before making Free-tier capacity claims.
- Publish a compatibility matrix and deployment/extension documentation that distinguish demonstrated support from open work.

These gates are a proposed implementation sequence within the accepted goals, not a claim that any downloaded candidate has already passed them.
