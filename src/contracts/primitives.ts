import * as v from 'valibot';

export function isWebURL(value: string): boolean {
  try {
    if (value !== value.trim()) return false;
    const u = new URL(value);
    return !u.username && !u.password && (u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}
export function isOrigin(value: string): boolean {
  try { return isWebURL(value) && new URL(value).origin === value; } catch { return false; }
}
export const SafeLine = v.pipe(v.string(), v.maxLength(2048), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
export const PageURL = v.pipe(SafeLine, v.check(isWebURL));
export const Origin = v.pipe(PageURL, v.check(isOrigin));
export const RepositoryName = v.pipe(v.string(), v.maxLength(140),
  v.regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/),
  v.check(s => !s.endsWith('/.') && !s.endsWith('/..')), v.transform(s => s.toLowerCase()));
export const NodeID = v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.regex(/^[A-Za-z0-9_+=:/.-]+$/));
export const EmptyNodeID = v.union([v.literal(''), NodeID]);
export const Capability = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/));
export const EmptyCapability = v.union([v.literal(''), Capability]);
export const IdempotencyKey = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,100}$/));
export const Digest = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/));
export const Timestamp = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export const PositiveInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
export const Count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export const DiscussionNumber = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(2147483647));
export const Cursor = v.pipe(v.string(), v.maxLength(1024), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
export const CategoryName = v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
export const Markdown = v.pipe(v.string(), v.minLength(1), v.maxLength(60000),
  v.check(s => s.trim().length > 0), v.check(s => new TextEncoder().encode(s).length <= 60000));
export const Order = v.picklist(['oldest', 'newest']);
export const Reaction = v.picklist(['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES']);
export const Language = v.pipe(v.string(), v.regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/), v.maxLength(20));
export const Theme = v.pipe(v.string(), v.minLength(1), v.maxLength(2048),
  v.check(s => ['light', 'dark', 'preferred_color_scheme'].includes(s) || isWebURL(s)));
export const Ciphertext = v.pipe(v.string(), v.minLength(20), v.maxLength(200000));
export const Token = v.pipe(v.string(), v.minLength(1), v.maxLength(4096), v.check(s => !/[\u0000-\u0020\u007f]/u.test(s)));
export const ISODate = v.pipe(v.string(), v.maxLength(64), v.check(s => Number.isFinite(Date.parse(s))));
export const HttpsURL = v.pipe(v.string(), v.maxLength(8192), v.check(s => {
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}));
export const User = v.object({ login: v.pipe(v.string(), v.minLength(1), v.maxLength(100)), avatarUrl: HttpsURL, url: HttpsURL });
export type User = v.InferOutput<typeof User>;
