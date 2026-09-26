# Public APIs

The API is experimental. Custom presentations are ordinary build-time imports.

## Own the presentation

```ts
import {mountPresentation, bindComposer, type Presentation} from 'giscusflare/headless';

const presentation: Presentation = {
  mount(target, runtime) {
    const form = document.createElement('form');
    const textarea = document.createElement('textarea');
    form.append(textarea);
    target.append(form);
    const composer = bindComposer(runtime, 'main', {form, textarea});
    // Add consumer-owned Write/Preview/Submit controls using composer methods.
    // Keep textarea mounted; hide it during Preview.
    const stop = composer.subscribe(() => { /* render composer.state */ });
    return {
      update(config) { /* appearance changed; runtime/editor identity is stable */ },
      dispose() { stop(); composer.dispose(); form.remove(); }
    };
  }
};
const mounted = mountPresentation(target, {service, config}, presentation);
```

[The independent example](../examples/custom.ts) implements a live conversation, reactions, pagination, editing and composing with only public imports. Its own stylesheet is intentionally unrelated to Giscus. `headless` does not import or register the default UI, and a build assertion enforces that boundary.

## Model commands

Read `runtime.controller.state` and subscribe to updates. Treat snapshots as immutable. Use `beginReply`, `beginEdit`, `closeEditor`, `setDraft`, `submit`, `setReaction`, `retryReaction`, `removeComment`, `moderateComment`, `changeDiscussion`, `blockAuthor`, `setOrder`, `refresh` and `revealReplies`.

`operationFor(kind, id)` exposes `pending`, `failed` or `uncertain` state. For composer operations, the ID is the draft name returned by `beginReply`/`beginEdit`, or `main`. Uncertain submission retries retain the original durable receipt key. Reaction intent remains separate from canonical server data.

`bindComposer` owns input synchronization, Preview races, keyboard submission, pending/read-only state, cancel behavior and listener cleanup. Its state includes mode, preview body/HTML, fixed-width preference, pending and error. It never invents a DOM structure or changes CSS. `bindDismissableMenu` is optional. `runtime.interactions.register` lets other controls supply focus/active behavior without coupling the runtime to their selectors.

## Fetching

```ts
{ fetching: {
    onFocus: true, onReconnect: true,
    staleAfterMs: 60_000, pollIntervalMs: false, replyPrefetch: 5
} }
```

`fetching:false` disables opportunistic refresh. `runtime.setFetching(...)` validates and replaces the policy. Polling, when enabled, must be at least 30 seconds; hidden/offline suspension and backoff always apply. Server query/rate limits still win. The iframe loader accepts the same JSON through `data-fetching`.

## Recovery and authentication

`draftRecovery:false` disables persistence. Otherwise `{retentionMs, store}` configures recovery; `DraftStore` has synchronous `load/save/remove`. The default is five-minute localStorage recovery with graceful storage failure. Iframe host equivalents are `data-draft-recovery="off"` and `data-draft-retention-ms`.

`session.signIn()` uses same-window navigation. `signIn('popup')` is an explicit alternative; blocked popups fall back to the configured host navigation. `SessionHost` owns host communication/navigation, not GitHub credentials. Native mode shares the host's JavaScript/storage trust boundary.

## Rendering and lifecycle

`createContentRenderer` sanitizes HTML and supports replaceable math/code behavior. Heavy math loads only when needed. `math:'source'` and `codeCopy:false` are explicit reduced profiles. A fully replaced `renderContent` is trusted application code and must return safe DOM.

Keep the textarea and its surrounding decoration nodes stable during typing. WebKit can split native undo groups when nearby nodes are replaced, even if the textarea itself stays mounted.

Appearance updates preserve runtime/draft identity. Discussion identity changes save and dispose the previous runtime. Disposal is idempotent. All subscriptions/bindings created by a presentation must be disposed with it. Frameworks managing their own lifecycle can use `createConversation` directly.

## Replace a standard presentation part

`mountComments(target, options, parts)` and `createStandardPresentation(parts)` accept optional `composer`, `reactions`, and `header` factories. Each factory receives the same public runtime and an error reporter. It returns `{element, update(value), dispose()}`. The standard view owns placement and lifetime; the replacement owns its markup, listeners and styling. `Part`, factory and context types are exported from `giscusflare`.

Use this level for a changed editor, reaction affordance or author header. For a different conversation layout, import `mountPresentation` from `giscusflare/headless`; do not rearrange nodes produced by the standard view. The standard templates use Lit, but the headless graph contains no Lit or standard UI module. The build checks both the headless bundle and the independent example for that boundary.
