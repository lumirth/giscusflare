import * as v from 'valibot';
import { EffectResult } from './results.js';
import { Capability, Ciphertext, Count, Digest, Origin, PageURL, PositiveInteger, NodeID, RepositoryName, Timestamp, Token } from './primitives.js';
export const EncryptedRecord=Ciphertext;
export const InstallationRecord = v.strictObject({ token:Token,expires:Timestamp,installationId:PositiveInteger });
export const Session = v.strictObject({
  principal: NodeID,
  credentials:v.nullable(v.strictObject({accessToken:Token,accessExpires:Timestamp,refreshToken:v.nullable(Token),refreshExpires:Timestamp})),
  origin: Origin, expires: Timestamp,
});
/** A pending exchange owns its browser binding and future capability hash. */
export const OAuthAttempt = v.strictObject({
  sessionID: Capability, cookieHash: Digest, githubVerifier: Capability,
  origin: Origin, returnURL: PageURL, mode: v.picklist(['popup', 'redirect']), openerOrigin: v.optional(Origin),
  created: Timestamp, expires: Timestamp, status: v.picklist(['pending', 'exchanging']),
});
export const Mapping = v.strictObject({id:NodeID,number:PositiveInteger});
export const Creation = v.strictObject({ started: Timestamp });
export const Receipt = v.strictObject({
  owner: NodeID, fingerprint: Digest,
  result: v.nullable(EffectResult),
});
export const RateWindow = v.strictObject({ count: Count, resets: Timestamp });
export const ActorIdentity=v.strictObject({repo:RepositoryName,repositoryId:NodeID});
export type ActorIdentity = v.InferOutput<typeof ActorIdentity>;
export type Session = v.InferOutput<typeof Session>;
export type OAuthAttempt = v.InferOutput<typeof OAuthAttempt>;
