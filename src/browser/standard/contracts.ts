import type { Writing } from "../../conversation/writing.js";
import type { Conversation } from "../headless.js";
import type { ResourceScope } from '../presentation.js';
import type { Comment, Discussion } from "../../contracts/document.js";
import type { TemplateResult } from 'lit-html';
import type { DirectiveResult } from 'lit-html/directive.js';
export type StandardValue = TemplateResult | DirectiveResult | Node | string | number | null | undefined;
export interface StandardContext {
  runtime: Conversation;
  scope: ResourceScope;
  contentReady(id: string, ready: boolean): void;
  report(error: unknown): void;
}
export type ComposerSlot = (
  context: StandardContext,
  writing: Writing,
) => StandardValue;
export interface ReactionInput {
  subject: Comment | Discussion | null;
  position: "top" | "bottom";
}
export type ReactionSlot = (context: StandardContext, input: ReactionInput) => StandardValue;
export type HeaderSlot = (context: StandardContext, comment: Comment) => StandardValue;
/** Optional component replacements. Full presentation replacement uses headless. */
export interface StandardParts {
  composer?: ComposerSlot;
  reactions?: ReactionSlot;
  header?: HeaderSlot;
}
