import type { ContributionResult } from '../contracts/document.js';

export type WritingTarget = { kind: 'comment' } | { kind: 'reply' | 'edit'; id: string };
export interface WritingFailure { status: 'failed' | 'uncertain'; message: string }
export type WritingOutcome = { status: 'saved'; result: ContributionResult }
  | { status: 'failed'; error: WritingFailure } | { status: 'blocked'; reason: string };
interface IssuedWriting { target: WritingTarget; body: string; key: string; principal: string }
export interface SavedWriting {
  id: string; target: WritingTarget; text: string; open: boolean; undo?: string;
  issued?: IssuedWriting; error?: WritingFailure;
}
export interface WritingOwner {
  changed(redraw?: boolean): void;
  eligible(target: WritingTarget): boolean;
  principal(): string | null;
  initialText(target: WritingTarget): string;
  contribute(issued: IssuedWriting): Promise<ContributionResult>;
}
export const writingTargetKey = (target: WritingTarget): string => target.kind === 'comment' ? 'main' : target.kind + ':' + target.id;
export function contributionFailure(cause: unknown): WritingFailure {
  const value = Object(cause), status = Number(value.status ?? 0);
  return { status: !status || status >= 500 || ['WRITE_UNCERTAIN', 'OPERATION_EXPIRED'].includes(value.code) ? 'uncertain' : 'failed',
    message: cause instanceof Error ? cause.message : 'Unable to complete the action.' };
}
const unresolved = (): WritingFailure => ({ status: 'uncertain', message: 'This submission may already be on GitHub. Retry it to recover its outcome.' });

/** A contribution retains its destination and issued identity independently of its editor. */
export class Writing {
  readonly id: string;
  readonly target: WritingTarget;
  #text: string;
  #open: boolean;
  #undo?: string;
  #issued?: IssuedWriting;
  #error?: WritingFailure;
  #pending?: Promise<WritingOutcome>;
  constructor(target: WritingTarget, private owner: WritingOwner, text = '', id: string = crypto.randomUUID()) {
    this.target = Object.freeze({ ...target });this.id = id;
    this.#text = text;this.#open = target.kind === 'comment';
  }
  get text(): string { return this.#text; }
  get open(): boolean { return this.#open; }
  get pending(): boolean { return Boolean(this.#pending); }
  get error(): WritingFailure | undefined { return this.#error; }
  get protected(): boolean { return this.pending || Boolean(this.#issued); }
  get actions() {
    const editable = !this.protected, eligible = this.owner.eligible(this.target), signedIn = Boolean(this.owner.principal());
    return { edit: editable, hide: this.target.kind !== 'comment', clear: editable && Boolean(this.#text),
      undoClear: editable && this.#undo !== undefined, abandon: !this.pending && Boolean(this.#issued),
      signIn: this.#open && !this.pending && !signedIn && Boolean(this.#text.trim()) && (editable && eligible || Boolean(this.#issued)),
      submit: this.#open && editable && eligible && signedIn && Boolean(this.#text.trim()),
      retry: this.#open && !this.pending && Boolean(this.#issued) && this.#issued?.principal === this.owner.principal() };
  }
  update(text: string): void {
    if (text === this.#text) return;
    if (!this.actions.edit) throw new Error('Recover the issued submission before changing its writing.');
    this.#text = text;this.#undo = undefined;this.#error = undefined;this.owner.changed();
  }
  show(): Writing {
    if (!this.#open && this.target.kind === 'edit' && !this.#text && !this.protected && this.#undo === undefined) this.#text = this.owner.initialText(this.target);
    this.#open = true;this.owner.changed(true);return this;
  }
  hide(): void { if (this.target.kind !== 'comment') { this.#open = false;this.owner.changed(true); } }
  clear(): boolean {
    if (!this.actions.clear) return false;
    this.#undo = this.#text;this.#text = '';this.#error = undefined;this.owner.changed();return true;
  }
  undoClear(): boolean {
    if (!this.actions.undoClear) return false;
    this.#text = this.#undo!;this.#undo = undefined;this.owner.changed();return true;
  }
  /** The host must obtain a deliberate decision before abandoning an unknown outcome. */
  abandon(): boolean {
    if (!this.actions.abandon) return false;
    this.#issued = undefined;this.#error = undefined;this.owner.changed();return true;
  }
  identityChanged(): void { if (this.#issued) { this.#error = unresolved();this.owner.changed(); } }
  save(): SavedWriting {
    return { id: this.id, target: this.target, text: this.#text, open: this.#open, undo: this.#undo, issued: this.#issued,
      error: this.#issued ? this.#error ?? unresolved() : this.#error };
  }
  recover(saved: SavedWriting): void {
    if (this.protected || saved.id !== this.id || writingTargetKey(saved.target) !== writingTargetKey(this.target)) return;
    this.#text = saved.text;this.#open = this.target.kind === 'comment' || saved.open;
    this.#undo = saved.undo;this.#issued = saved.issued && Object.freeze({ ...saved.issued, target: Object.freeze({ ...saved.issued.target }) });
    this.#error = saved.issued ? { status: 'uncertain', message: saved.error?.message ?? unresolved().message } : saved.error;
  }
  submit(): Promise<WritingOutcome> {
    if (this.#pending) return this.#pending;
    if (!(this.#issued ? this.actions.retry : this.actions.submit)) {
      const reason = this.#issued && this.#issued.principal !== this.owner.principal()
        ? 'Sign in as the original author to recover this submission.'
        : !this.#open ? 'Open this writing before submitting.'
        : !this.#text.trim() ? 'Write a comment before submitting.' : 'This contribution is currently unavailable.';
      return Promise.resolve({ status: 'blocked', reason });
    }
    const recovering = Boolean(this.#issued);
    this.#issued ??= Object.freeze({ target: this.target, body: this.#text,
      key: '3.' + Date.now() + '.' + crypto.randomUUID(), principal: this.owner.principal()! });
    const issued = this.#issued;
    this.#error = undefined;
    this.#pending = Promise.resolve().then(() => this.owner.contribute(issued)).then(result => {
      this.#text = '';this.#undo = undefined;this.#issued = undefined;this.#error = undefined;
      this.#open = this.target.kind === 'comment';return { status: 'saved', result } as WritingOutcome;
    }, cause => {
      const error = contributionFailure(cause);
      if (recovering) error.status = 'uncertain';
      this.#error = error;
      if (error.status === 'failed') this.#issued = undefined;
      return { status: 'failed', error } as WritingOutcome;
    }).finally(() => { this.#pending = undefined;this.owner.changed(true); });
    this.owner.changed();return this.#pending;
  }
}

/** Reject malformed recovery as a whole; recovered identities never come from editor state. */
export function recoveredWriting(raw: string): SavedWriting[] {
  try {
    const value = JSON.parse(raw);
    if (value.version !== 5 || !Array.isArray(value.writing)) return [];
    const target = (v: WritingTarget): boolean => Boolean(v && (v.kind === 'comment' ||
      (['reply', 'edit'].includes(v.kind) && 'id' in v && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 256)));
    const text = (v: unknown): boolean => typeof v === 'string' && v.length <= 60000;
    for (const saved of value.writing as SavedWriting[]) {
      if (typeof saved.id !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(saved.id) || !target(saved.target) || !text(saved.text) || typeof saved.open !== 'boolean' || saved.undo !== undefined && !text(saved.undo)) return [];
      const issued = saved.issued;
      if (issued && (!target(issued.target) || writingTargetKey(issued.target) !== writingTargetKey(saved.target) || !text(issued.body) || issued.body !== saved.text ||
        !/^3\.\d{13}\.[A-Za-z0-9_-]{16,86}$/.test(issued.key) || typeof issued.principal !== 'string' || !issued.principal || issued.principal.length > 256)) return [];
      if (saved.error && (!['failed', 'uncertain'].includes(saved.error.status) || typeof saved.error.message !== 'string')) return [];
    }
    return value.writing;
  } catch { return []; }
}
