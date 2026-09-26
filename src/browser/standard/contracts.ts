import type { ConversationRuntime } from "../headless.js";
import type { Comment, Discussion } from "../../contracts/github.js";

export interface Part<T> {
  element: HTMLElement;
  update(value: T): void;
  dispose(): void;
}
export interface StandardContext {
  runtime: ConversationRuntime;
  report(error: unknown): void;
}
export type ComposerFactory = (
  context: StandardContext,
  name: string,
) => Part<void>;
export interface ReactionInput {
  subject: Comment | Discussion | null;
  position: "top" | "bottom";
}
export type ReactionFactory = (context: StandardContext) => Part<ReactionInput>;
export interface HeaderInput {
  comment: Comment;
  reply: boolean;
}
export type HeaderFactory = (context: StandardContext) => Part<HeaderInput>;
/** Optional component replacements. Full presentation replacement uses headless. */
export interface StandardParts {
  composer?: ComposerFactory;
  reactions?: ReactionFactory;
  header?: HeaderFactory;
}
