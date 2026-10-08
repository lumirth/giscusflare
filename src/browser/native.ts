import { mountPresentation, type ConversationOptions } from "./headless.js";
import { createStandardPresentation } from "./standard/view.js";
import { githubContent } from './github-content.js';
import type { StandardParts } from "./standard/contracts.js";
export * from "./headless.js";
export { themes } from "../themes.js";
export { createStandardPresentation };
export type {
  StandardParts,
  StandardContext,
  ComposerSlot,
  ReactionSlot,
  HeaderSlot,
} from "./standard/contracts.js";
export function mountComments(
  target: HTMLElement,
  options: Omit<ConversationOptions, "content"> & { content?: ConversationOptions["content"] },
  parts: StandardParts = {},
) {
  return mountPresentation(target, { ...options, content: options.content ?? githubContent() }, createStandardPresentation(parts));
}
