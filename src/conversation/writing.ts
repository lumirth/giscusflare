import type { ContributionResult } from '../contracts/document.js';
import { IssuedEffect, type EffectFailure } from './issued.js';
export { contributionFailure } from './issued.js';

export type WritingTarget = { kind: 'comment' } | { kind: 'reply' | 'edit'; id: string };
export type WritingFailure = EffectFailure;
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
  authorized(): boolean;
  initialText(target: WritingTarget): string;
  contribute(issued: IssuedWriting): Promise<ContributionResult>;
}
export const writingTargetKey = (target: WritingTarget): string => target.kind === 'comment' ? 'main' : target.kind + ':' + target.id;
const unresolved = (): WritingFailure => ({ status: 'uncertain', message: 'This submission may already be on GitHub. Retry it to recover its outcome.' });

/** A contribution retains its destination and issued identity independently of its editor. */
export class Writing {
  readonly id: string;
  readonly target: WritingTarget;
  #text: string;
  #touched = false;
  #open: boolean;
  #undo?: string;
  #effect: IssuedEffect<{target: WritingTarget; body: string}>;
  constructor(target: WritingTarget, private owner: WritingOwner, text = '', id: string = crypto.randomUUID()) {
    this.target = Object.freeze(target.kind === 'comment' ? {kind:'comment'} : {kind:target.kind,id:target.id});this.id = id;
    this.#text = text;this.#open = target.kind === 'comment';
    this.#effect = new IssuedEffect(() => owner.principal(), () => owner.changed(!this.pending));
  }
  get text(): string { return this.#text; }
  get touched(): boolean { return this.#touched; }
  get open(): boolean { return this.#open; }
  get pending(): boolean { return Boolean(this.#effect.pending); }
  get error(): WritingFailure | undefined { return this.#effect.error; }
  get protected(): boolean { return this.pending || Boolean(this.#effect.issued); }
  get actions() {
    const editable = !this.protected, eligible = this.owner.eligible(this.target), signedIn = Boolean(this.owner.principal()), authorized = signedIn && this.owner.authorized();
    return { edit: editable, hide: this.target.kind !== 'comment', clear: editable && Boolean(this.#text),
      undoClear: editable && this.#undo !== undefined, abandon: !this.pending && Boolean(this.#effect.issued),
      signIn: this.#open && !this.pending && (!signedIn || !this.#effect.issued && !authorized) && Boolean(this.#text.trim()) && (editable && eligible || Boolean(this.#effect.issued)),
      submit: this.#open && editable && eligible && authorized && Boolean(this.#text.trim()),
      retry: this.#open && !this.pending && Boolean(this.#effect.issued) && this.#effect.issued?.principal === this.owner.principal() };
  }
  update(text: string): void {
    if (text === this.#text) return;
    if (!this.actions.edit) throw new Error('Recover the issued submission before changing its writing.');
    this.#touched = true;this.#text = text;this.#undo = undefined;this.#effect.error = undefined;this.owner.changed();
  }
  show(): Writing {
    if (!this.#open && this.target.kind === 'edit' && !this.#text && !this.protected && this.#undo === undefined) this.#text = this.owner.initialText(this.target);
    this.#open = true;this.owner.changed(true);return this;
  }
  hide(): void { if (this.target.kind !== 'comment') { this.#open = false;this.owner.changed(true); } }
  clear(): boolean {
    if (!this.actions.clear) return false;
    this.#undo = this.#text;this.#text = '';this.#effect.error = undefined;this.owner.changed();return true;
  }
  undoClear(): boolean {
    if (!this.actions.undoClear) return false;
    this.#text = this.#undo!;this.#undo = undefined;this.owner.changed();return true;
  }
  /** The host must obtain a deliberate decision before abandoning an unknown outcome. */
  abandon(): boolean {
    if (!this.actions.abandon) return false;
    this.#effect.issued = undefined;this.#effect.error = undefined;this.owner.changed();return true;
  }
  identityChanged(): void { if (this.#effect.issued) { this.#effect.error = unresolved();this.owner.changed(); } }
  save(): SavedWriting {
    return { id: this.id, target: this.target, text: this.#text, open: this.#open, undo: this.#undo, issued: this.#effect.issued,
      error: this.#effect.issued ? this.#effect.error ?? unresolved() : this.#effect.error };
  }
  recover(saved: SavedWriting): void {
    if (this.protected || saved.id !== this.id || writingTargetKey(saved.target) !== writingTargetKey(this.target)) return;
    this.#text = saved.text;this.#open = this.target.kind === 'comment' || saved.open;
    this.#undo = saved.undo;this.#effect.issued = saved.issued && Object.freeze({ ...saved.issued, target: Object.freeze({ ...saved.issued.target }) });
    this.#effect.error = saved.issued ? { status: 'uncertain', message: saved.error?.message ?? unresolved().message } : saved.error;
  }
  submit(): Promise<WritingOutcome> {
    if (this.#effect.pending) return this.#effect.pending;
    if (!(this.#effect.issued ? this.actions.retry : this.actions.submit)) {
      const reason = this.#effect.issued && this.#effect.issued.principal !== this.owner.principal()
        ? 'Sign in as the original author to recover this submission.'
        : !this.#open ? 'Open this writing before submitting.'
        : !this.#text.trim() ? 'Write a comment before submitting.' : 'This contribution is currently unavailable.';
      return Promise.resolve({ status: 'blocked', reason });
    }
    return this.#effect.run({target: this.target, body: this.#text}, issued => this.owner.contribute(issued).then(result => {
      this.#text = '';this.#undo = undefined;this.#open = this.target.kind === 'comment';return result;
    }));
  }
}

/** Reject malformed recovery as a whole; recovered identities never come from editor state. */
export function recoveredWriting(value: unknown): SavedWriting[] {
  try {
    if (!Array.isArray(value)) return [];
    const target = (v: WritingTarget): boolean => Boolean(v && (v.kind === 'comment' ||
      (['reply', 'edit'].includes(v.kind) && 'id' in v && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 256)));
    const text = (v: unknown): boolean => typeof v === 'string' && v.length <= 60000;
    for (const saved of value as SavedWriting[]) {
      if (typeof saved.id !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(saved.id) || !target(saved.target) || !text(saved.text) || typeof saved.open !== 'boolean' || saved.undo !== undefined && !text(saved.undo)) return [];
      const issued = saved.issued;
      if (issued && (!target(issued.target) || writingTargetKey(issued.target) !== writingTargetKey(saved.target) || !text(issued.body) || issued.body !== saved.text ||
        !/^3\.\d{13}\.[A-Za-z0-9_-]{16,86}$/.test(issued.key) || typeof issued.principal !== 'string' || !issued.principal || issued.principal.length > 256)) return [];
      if (saved.error && (!['failed', 'uncertain'].includes(saved.error.status) || typeof saved.error.message !== 'string')) return [];
    }
    return value;
  } catch { return []; }
}
