import type { Page } from "./options.js";
import type { Conversation } from "./runtime.js";

export interface ResourceScope {
  readonly signal: AbortSignal;
  /** Register acquisition cleanup; the returned release may retire the child early. */
  own(cleanup: () => void): () => void;
}
/** The view scope can retire independently of the page's data and writing. */
export type Presentation = (target: HTMLElement, conversation: Conversation, scope: ResourceScope) => void;
export interface MountedConversation {
  readonly conversation: Conversation;
  replacePage(page: Page): void;
  replacePresentation(presentation: Presentation): void;
  dispose(): void;
}
/** The owner replaces pages; each conversation belongs to one page lifetime. */
export { mountPresentation } from "./runtime.js";
