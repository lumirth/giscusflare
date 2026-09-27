import {conversationSettings,type Page,type Appearance} from "./options.js";
import {
  createConversation,
  type ConversationOptions,
  type Conversation,
} from "./runtime.js";

/** A renderer owns its DOM, styles and subscriptions, but never the runtime. */
export interface Presentation {
  mount(
    target: HTMLElement,
    runtime: Conversation,
  ): {
    update(appearance:Appearance):void;
    dispose(): void;
  };
}
export interface MountedConversation extends Conversation {
  updateAppearance(appearance:Partial<Appearance>):void;
  replacePage(page:Page):void;
}
/** Renderer-independent lifecycle. This module imports no default UI or CSS. */
export function mountPresentation(
  target: HTMLElement,
  options: ConversationOptions,
  presentation: Presentation,
): MountedConversation {
  let current={...options,page:{...options.page},appearance:{...options.appearance}};
  let runtime: Conversation,
    view: ReturnType<Presentation["mount"]>,
    disposed = false;
  const mount = () => {
    runtime = createConversation(current);
    view = presentation.mount(target, runtime);
  };
  mount();
  return {
    get page(){return runtime.page;},
    get appearance(){return runtime.appearance;},
    get interactions() {
      return runtime.interactions;
    },
    get state() { return runtime.state; },
    get editors() { return runtime.editors; },
    get signedIn() { return runtime.signedIn; },
    get signingIn() { return runtime.signingIn; },
    get authenticationError() { return runtime.authenticationError; },
    get renderContent() {
      return runtime.renderContent;
    },
    subscribe: (...args) => runtime.subscribe(...args),
    subscribeDrafts: (...args) => runtime.subscribeDrafts(...args),
    load: (...args) => runtime.load(...args),
    refresh: (...args) => runtime.refresh(...args),
    loadMore: (...args) => runtime.loadMore(...args),
    setOrder: (...args) => runtime.setOrder(...args),
    loadReplies: (...args) => runtime.loadReplies(...args),
    revealReplies: (...args) => runtime.revealReplies(...args),
    draft: (...args) => runtime.draft(...args),
    setDraft: (...args) => runtime.setDraft(...args),
    beginReply: (...args) => runtime.beginReply(...args),
    beginEdit: (...args) => runtime.beginEdit(...args),
    closeEditor: (...args) => runtime.closeEditor(...args),
    operationFor: (...args) => runtime.operationFor(...args),
    submit: (...args) => runtime.submit(...args),
    preview: (...args) => runtime.preview(...args),
    removeComment: (...args) => runtime.removeComment(...args),
    moderateComment: (...args) => runtime.moderateComment(...args),
    setReaction: (...args) => runtime.setReaction(...args),
    retryReaction: (...args) => runtime.retryReaction(...args),
    signIn: (...args) => runtime.signIn(...args),
    signOut: (...args) => runtime.signOut(...args),
    initialize(data) {
      runtime.initialize(data);
    },
    saveDrafts() {
      runtime.saveDrafts();
    },
    setFetching(value) {
      runtime.setFetching(value);
    },
    updateAppearance(appearance){
      if(disposed)throw new Error('Cannot update disposed comments.');
      const next=conversationSettings(runtime.page,{...runtime.appearance,...appearance});
      Object.assign(runtime.appearance,next.appearance);
      current.appearance={...runtime.appearance};
      view.update(runtime.appearance);
    },
    replacePage(page){
      if(disposed)throw new Error('Cannot update disposed comments.');
      const next=conversationSettings(page,current.appearance);
      runtime.saveDrafts();view.dispose();runtime.dispose();
      current={...current,...next,bootstrap:undefined};mount();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.saveDrafts();
      view.dispose();
      runtime.dispose();
    },
  };
}
