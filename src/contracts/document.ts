import type {CountTarget} from './count.js';
/** Portable public records are owned here; provider schemas normalize into them. */
export type Reaction = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';
export interface Person { login: string; avatarUrl: string; url: string }
export type Reactions = Partial<Record<Reaction, { count: number }>>;
export type SelectedReactions = Partial<Record<Reaction, boolean>>;
export interface Comment {
  id: string; body: string; url: string; parentId: string | null;
  createdAt: string; lastEditedAt: string | null; deletedAt: string | null;
  author: Person | null; authorAssociation: string;
  isMinimized: boolean; minimizedReason: string | null;
  reactions: Reactions; upvotes: number;
}
export interface Discussion {
  id: string; number: number; title: string; url: string;
  locked: boolean; closed: boolean; answerId: string | null; reactions: Reactions;
}
export interface CountObservation {
  target: CountTarget;
  count: number;
  discussion: { id: string; number: number } | null;
  observedAt: number;
  expiresAt: number;
}
export interface Window {
  ids: string[];
  cursor: string | null;
  /** A provider-observed total; membership remains the captured reading traversal. */
  count: CountObservation | null;
}
export type Viewer = Person & { id: string };
export interface Permissions {
  didAuthor: boolean; canUpdate: boolean; canDelete: boolean; canMinimize: boolean; canUnminimize: boolean;
}
export interface AccessAvailability {
  archived: boolean; unavailable: boolean;
  thread: Pick<Discussion, 'id' | 'number' | 'locked' | 'closed'> | null;
}
export interface ViewerState {
  principal: string;
  /** Bound to the provider identity, or the public target acquired before a denied observation. */
  availability?: AccessAvailability & {target: string | null};
  permissions: Record<string, Permissions>;
  reactions: Record<string, SelectedReactions>;
  threadReactions: SelectedReactions;
}
export interface AccountPatch {
  principal: string; observedAt: number;
  permissions?: Record<string, Permissions>;
  reactions?: Record<string, SelectedReactions>;
  threadReactions?: SelectedReactions;
}
/** Account authority is acquired independently of public reading and content. */
export interface AccessResult {
  observedAt: number;
  principal: string;
  permissions: Record<string, Permissions>;
  reactions: Record<string, SelectedReactions>;
  threadReactions: SelectedReactions;
  availability: AccessAvailability;
}
export interface Metadata {
  thread: Discussion | null; archived: boolean; unavailable: boolean; profiles: string[];
}
export interface PageDocument {
  nodes: Record<string, Comment>;
  roots: Window;
  replies: Record<string, Window>;
  metadata: Metadata;
}
/** One public reading observation. Its age survives reuse unchanged. */
export interface ContentHint { markdown: string; html: string }
export interface AcceptedObservation { contentHints?: Record<string, ContentHint> }
export interface WindowPage {
  contentHints?: Record<string, ContentHint>;
  nodes: Record<string, Comment>;
  window: Window;
  replies?: Record<string, Window>;
  metadata?: Metadata;
  observedAt: number;
}
export interface WindowDelta { add?: string[]; remove?: string[]; count?: CountObservation; cursor?: string | null }
/** Narrow provider facts established alongside a confirmed effect, never the receipt itself. */
export interface Patch {
  invalidatedCounts?: CountTarget[];
  contentHints?: Record<string, ContentHint>;
  nodes?: Record<string, Partial<Comment> | null>;
  reactions?: Record<string, Reactions>;
  roots?: WindowDelta;
  replies?: Record<string, WindowDelta>;
  metadata?: Partial<Omit<Metadata, 'thread'>> & {thread?: Partial<Discussion> | null};
  /** Actual discussion creation can precede the contribution that confirms its first comment. */
  metadataObservedAt?: number;
  observedAt?: number;
}
export type EffectPhase = 'not-issued' | 'confirmed' | 'unknown';
export interface ContributionResult {
  phase: 'confirmed';
  replayed: boolean;
  account?: AccountPatch;
  id: string;
  number: number;
  parentId?: string;
  patch?: Patch;
}
