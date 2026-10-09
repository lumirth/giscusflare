import {API_PREFIX} from '../contracts/protocol.js';

/** Session and count owners share HTTP mechanics, never authority or observation state. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly phase: 'not-issued' | 'unknown' = 'not-issued') { super(message); }
}
export function validateService(service: string): void {
  const url = new URL(service);
  if (url.origin !== service || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new TypeError('Use an HTTPS comments service origin.');
}
export async function requestJSON<T>(service: string, path: string, input: unknown, options: {
  method?: 'GET' | 'POST'; postFallback?: boolean; signal?: AbortSignal; bearer?: string; cache?: RequestCache; failurePhase?: 'not-issued' | 'unknown';
} = {}): Promise<T> {
  const phase = options.failurePhase || 'not-issued';
  if (!/^[a-z]+(?:\/[a-z]+)?$/.test(path)) throw new ApiError('Invalid API operation.', 0, 'BAD_INPUT');
  let body: string;
  try { options.signal?.throwIfAborted(); body = JSON.stringify(input); if (body === undefined) throw new Error('Invalid API request.'); }
  catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'Invalid API request.', 0, 'BAD_INPUT'); }
  const endpoint = service + API_PREFIX + '/' + path, query = endpoint + '?' + new URLSearchParams({input:body});
  const read = options.method === 'GET' && (!options.postFallback || query.length <= 8192);
  let response: Response;
  try { response = await fetch(read ? query : endpoint, {
    method: read ? 'GET' : 'POST', headers: {...(read ? {} : {'Content-Type': options.method === 'GET' ? 'text/plain' : 'application/json'}), ...(options.bearer ? {Authorization:'Bearer ' + options.bearer} : {})},
    ...(read ? {} : {body}), credentials:'omit', cache:options.cache, signal:options.signal,
  }); } catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'The comments service could not be reached.', 0, 'UPSTREAM', phase); }
  let data: unknown; try { data = await response.json(); }
  catch { throw new ApiError('The comments service returned an invalid response.', response.status, 'UPSTREAM', phase); }
  if (!response.ok) {
    const error = data && typeof data === 'object' ? (data as {error?: {message?: unknown;code?: unknown;phase?: unknown}}).error : undefined;
    throw new ApiError(typeof error?.message === 'string' ? error.message : 'Request failed.', response.status, typeof error?.code === 'string' ? error.code : 'UPSTREAM', error?.phase === 'not-issued' || error?.phase === 'unknown' ? error.phase : phase);
  }
  return data as T;
}
