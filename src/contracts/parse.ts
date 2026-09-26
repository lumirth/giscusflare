import * as v from 'valibot';
import { AppError } from '../domain/errors.js';
export type Schema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
export function parse<S extends Schema>(schema: S, input: unknown, boundary: 'input' | 'config' | 'storage' | 'upstream' = 'input'): v.InferOutput<S> {
  const result = v.safeParse(schema, input, { abortEarly: true });
  if (result.success) return result.output;
  const mapping = {
    input: [400, 'BAD_INPUT', 'The request contains missing or invalid fields.'],
    config: [503, 'CONFIGURATION', 'The service configuration is invalid.'],
    storage: [503, 'STORAGE', 'The service could not read a stored record.'],
    upstream: [502, 'UPSTREAM_SCHEMA', 'GitHub returned an invalid response.'],
  } as const;
  const [status, code, message] = mapping[boundary];
  // Error details can contain credentials or comment text.
  throw new AppError(status, code, message);
}
export function parseJSON(text: string, boundary: 'input' | 'config' | 'storage' | 'upstream' = 'input'): unknown {
  try { return JSON.parse(text) as unknown; }
  catch {
    const status = boundary === 'input' ? 400 : boundary === 'upstream' ? 502 : 503;
    throw new AppError(status, boundary === 'input' ? 'BAD_INPUT' : boundary === 'upstream' ? 'UPSTREAM_SCHEMA' : boundary === 'config' ? 'CONFIGURATION' : 'STORAGE', 'Invalid JSON.');
  }
}
