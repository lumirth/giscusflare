import * as v from 'valibot';
import { MutationResult } from './results.js';
import { Capability, Count, Digest, Origin, PageURL, PositiveInteger, RepositoryName, Timestamp, Token, User } from './primitives.js';
export const EncryptedRecord = v.strictObject({ version: v.literal(2), ciphertext: v.pipe(v.string(), v.maxLength(200000)) });
export const InstallationRecord = v.strictObject({ token: Token, expires: Timestamp });
export const Session = v.strictObject({
  accessToken: Token, accessExpires: Timestamp, refreshToken: v.nullable(Token), refreshExpires: Timestamp,
  user: User, repo: RepositoryName, origin: Origin, expires: Timestamp,
});
export const OAuthAttempt = v.strictObject({
  version: v.literal(2), challenge: Digest, cookieHash: Digest, githubVerifier: Capability,
  repo: RepositoryName, origin: Origin, returnURL: PageURL, mode: v.picklist(['popup', 'redirect']), openerOrigin: v.optional(Origin),
  created: Timestamp, expires: Timestamp, status: v.picklist(['pending', 'exchanging', 'ready', 'denied']),
  credentials: v.nullable(Session), ticket: v.nullable(Capability),
});
export const Mapping = v.strictObject({ version: v.literal(2), number: PositiveInteger });
export const Creation = v.strictObject({ version: v.literal(2), started: Timestamp });
export const Receipt = v.strictObject({
  version: v.literal(2), fingerprint: Digest, state: v.picklist(['pending', 'done']),
  result: v.nullable(MutationResult),
});
export const RateWindow = v.strictObject({ count: Count, resets: Timestamp });
export const ActorIdentity = v.strictObject({ version: v.literal(2), repo: RepositoryName, appId: v.string() });
export type Session = v.InferOutput<typeof Session>;
export type OAuthAttempt = v.InferOutput<typeof OAuthAttempt>;

export const Tombstone=v.strictObject({number:PositiveInteger});

export const CommentCount = v.strictObject({ count: Count });
