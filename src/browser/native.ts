import { mountPresentation, type ConversationOptions } from "./headless.js";
import { createStandardPresentation } from "./standard/view.js";
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
  options: ConversationOptions,
  parts: StandardParts = {},
) {
  return mountPresentation(target, options, createStandardPresentation(parts));
}
