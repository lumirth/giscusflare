export type ErrorCode =
  | 'BAD_INPUT' | 'BODY_TOO_LARGE' | 'MEDIA_TYPE' | 'CONFIGURATION' | 'ORIGIN' | 'METHOD'
  | 'AUTH_REQUIRED' | 'SESSION' | 'OAUTH' | 'NOT_FOUND' | 'PERMISSION' | 'PUBLIC_ONLY'
  | 'CATEGORY' | 'LOCKED' | 'ARCHIVED' | 'RATE_LIMIT' | 'GITHUB_AUTH' | 'UPSTREAM'
  | 'VERSION_MISMATCH' | 'OPERATION_EXPIRED' | 'UPSTREAM_SCHEMA' | 'WRITE_UNCERTAIN' | 'CONFLICT' | 'STORAGE' | 'INTERNAL';
export class AppError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly retryAfter?: number) {
    super(message); this.name = 'AppError';
  }
}
export function requireCondition(condition: unknown, status: number, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export interface Failure { status: number; code: ErrorCode; message: string; retryAfter?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };
export function failure(error: unknown): Failure {
  if (error instanceof AppError) return { status: error.status, code: error.code, message: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) };
  return { status: 500, code: 'INTERNAL', message: 'The comments service could not complete the request.' };
}
export async function result<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (error) { return { ok: false, error: failure(error) }; }
}
export function unwrap<T>(value: Result<T>): T {
  if (value.ok) return value.value;
  throw new AppError(value.error.status, value.error.code, value.error.message, value.error.retryAfter);
}
