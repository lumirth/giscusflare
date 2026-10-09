import type { ContributionResult } from '../contracts/document.js';

export interface EffectFailure { status: 'failed' | 'uncertain'; message: string }
export type Issued<Input> = Readonly<Input & {key: string; principal: string}>;
export type Settlement = {status: 'saved'; result: ContributionResult}
  | {status: 'failed'; error: EffectFailure; cause: unknown};
export function contributionFailure(cause: unknown): EffectFailure {
  return {status: Object(cause).phase === 'not-issued' ? 'failed' : 'uncertain',
    message: cause instanceof Error ? cause.message : 'Unable to complete the action.'};
}
/** One immutable effect survives uncertainty; its original author alone can retry it. */
export class IssuedEffect<Input> {
  issued?: Issued<Input>;
  error?: EffectFailure;
  pending?: Promise<Settlement>;
  constructor(private principal: () => string | null, private changed: () => void) {}
  #notify(): void {
    try { this.changed(); } catch (error) { console.error('An effect subscriber failed.', error); }
  }
  run(input: Input, dispatch: (issued: Issued<Input>) => Promise<ContributionResult>): Promise<Settlement> {
    if (this.pending) return this.pending;
    const recovering = Boolean(this.issued);
    this.issued ??= Object.freeze({...input, key: '3.' + Date.now() + '.' + crypto.randomUUID(), principal: this.principal()!});
    const issued = this.issued;
    this.error = undefined;
    this.pending = Promise.resolve().then(() => {
      if (!issued.principal || issued.principal !== this.principal()) throw Object.assign(new Error('Sign in as the original author to continue this contribution.'), {code: 'AUTHOR_CHANGED', phase: 'not-issued'});
      return dispatch(issued);
    }).then(result => ({status: 'saved', result} as const), cause => ({status: 'failed', error: contributionFailure(cause), cause} as const)).then(outcome => {
      this.error = outcome.status === 'failed' ? outcome.error : undefined;
      if (recovering && this.error) this.error.status = 'uncertain';
      if (!this.error || this.error.status === 'failed') this.issued = undefined;
      this.pending = undefined; this.#notify(); return outcome;
    });
    this.#notify(); return this.pending;
  }
}
