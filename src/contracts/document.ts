import type { Comment as ProviderComment } from './github.js';
import type { InferOutput } from 'valibot';
import type { Reaction as ReactionSchema } from './primitives.js';

export type Reaction = InferOutput<typeof ReactionSchema>;
export type Person = NonNullable<ProviderComment['author']>;
export type Reactions = Partial<Record<Reaction, { count: number; selected: boolean }>>;
/** The canonical node shared by service, native view and custom consumers. */
export interface Comment extends Omit<ProviderComment, 'reactionGroups' | 'replyTo' | 'isAnswer' | 'upvoteCount'> {
  parentId: string | null;
  reactions: Reactions;
  upvotes: number;
}
export interface Discussion {
  id: string;
  number: number;
  title: string;
  url: string;
  locked: boolean;
  closed: boolean;
  answerId: string | null;
  reactions: Reactions;
}
export interface Window {
  ids: string[];
  cursor: string | null;
  /** Null means no authoritative observation has been obtained. */
  total: number | null;
}
export interface Metadata {
  thread: Discussion | null;
  viewer: Person | null;
  archived: boolean;
  unavailable: boolean;
  profiles: string[];
}
export interface PageDocument {
  nodes: Record<string, Comment>;
  roots: Window;
  replies: Record<string, Window>;
  metadata: Metadata;
}
/** One acquired root, reply or ranked-ID window. IDs are in reader order. */
export interface WindowPage {
  nodes: Record<string, Comment>;
  window: Window;
  replies?: Record<string, Window>;
  metadata?: Metadata;
}
export interface WindowDelta {
  add?: string[];
  remove?: string[];
  total?: number;
  cursor?: string | null;
}
/** An observation accompanies a confirmed effect; it is never its receipt. */
export interface Patch {
  nodes?: Record<string, Comment | null>;
  roots?: WindowDelta;
  replies?: Record<string, WindowDelta>;
  metadata?: Partial<Metadata>;
}
export interface ContributionResult {
  id: string;
  number: number;
  parentId?: string;
  patch?: Patch;
}
