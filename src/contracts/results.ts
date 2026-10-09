import * as v from 'valibot';
import type { Patch } from './document.js';
import { NodeID, PositiveInteger } from './primitives.js';
/** Cloneable public data and its original cache deadline. */
export interface ReadValue<T> {
    value: T;
    expires: number;
}
/** Durable external confirmation, independent of every later observation. */
export const EffectResult = v.strictObject({ id: NodeID, number: PositiveInteger, parentId:v.optional(NodeID),account:v.optional(v.custom<import('./document.js').AccountPatch>(value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)))),patch: v.optional(v.custom<Patch>(value => Boolean(value && typeof value === 'object' && !Array.isArray(value)))) });
export type EffectResult = v.InferOutput<typeof EffectResult>;
