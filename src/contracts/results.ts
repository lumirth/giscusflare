import * as v from 'valibot';
import { NodeID, PositiveInteger } from './primitives.js';
/** Cloneable public data and its original cache deadline. */
export interface ReadValue<T> {
    value: T;
    expires: number;
}
/** Durable external confirmation, independent of every later observation. */
export const EffectResult = v.strictObject({ id: NodeID, number: PositiveInteger, parentId: v.optional(NodeID) });
export type EffectResult = v.InferOutput<typeof EffectResult>;
