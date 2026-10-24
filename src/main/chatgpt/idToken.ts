import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { chatGptPlanLabel } from '../../shared/ui/chatgpt';
import { sameSecret } from './oauth';

/**
 * The ID token's checks (PLAN 5.7; OpenAI's sign-in page, read 2026-10-24):
 * its RS256 signature against the keys OpenAI publishes, the issuer, the
 * audience, which must be the client id the code was exchanged for, the
 * expiry and the nonce of this attempt. Only then is its `sub` the account,
 * and its plan, when it names one, the plan the page is told.
 */

export type IdTokenProblem =
  /** not three base64url parts of JSON */
  | 'shape'
  /** signed with anything but RS256 */
  | 'algorithm'
  /** no published key fits it */
  | 'key'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'nonce'
  /** no account id */
  | 'subject';

export interface IdTokenIdentity {
  /** the account: the token's `sub` */
  subject: string;
  /** the plan's name, when the token names one (`chatgpt_plan_type`) */
  plan: string | null;
}

export type IdTokenCheck = { ok: true; identity: IdTokenIdentity } | { ok: false; problem: IdTokenProblem };

export interface IdTokenExpectations {
  issuer: string;
  clientId: string;
  nonce: string;
  now: Date;
}

/** How far a token's expiry may lie in the past, for a clock that is a little off. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Where OpenAI keeps the ChatGPT account's facts in its tokens. */
export const AUTH_CLAIM = 'https://api.openai.com/auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function part(encoded: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The public key that signed a token with this header, from a JWKS document. */
function signingKey(jwks: unknown, header: Record<string, unknown>): KeyObject | null {
  const keys = isRecord(jwks) && Array.isArray(jwks['keys']) ? (jwks['keys'] as unknown[]) : [];
  const rsa = keys.filter(
    (key): key is Record<string, unknown> =>
      isRecord(key) && key['kty'] === 'RSA' && (key['use'] === undefined || key['use'] === 'sig')
  );
  const kid = header['kid'];
  const chosen =
    typeof kid === 'string' ? rsa.find((key) => key['kid'] === kid) : rsa.length === 1 ? rsa[0] : undefined;
  if (!chosen) return null;
  try {
    return createPublicKey({ key: chosen as JsonWebKey, format: 'jwk' });
  } catch {
    return null;
  }
}

/** Whether the token's audience is the client id, alone or among others with it as the authorised party. */
function forClient(payload: Record<string, unknown>, clientId: string): boolean {
  const aud = payload['aud'];
  const azp = payload['azp'];
  if (azp !== undefined && azp !== clientId) return false;
  if (typeof aud === 'string') return aud === clientId;
  return Array.isArray(aud) && aud.includes(clientId);
}

/**
 * The account and the plan an ID token names, read without its checks, or
 * null when it names no account. For the ID token a renewal of the access
 * token brings (codex.3): it comes straight from OpenAI's token endpoint, in
 * answer to the app's own request over HTTPS, and carries no nonce of an
 * attempt to check, so its account is compared with the kept sign-in's
 * before the renewal is kept, and its plan replaces the kept one.
 */
export function readIdTokenIdentity(token: string): IdTokenIdentity | null {
  const pieces = token.split('.');
  if (pieces.length !== 3) return null;
  const payload = part(pieces[1] ?? '');
  const subject = payload?.['sub'];
  if (!payload || typeof subject !== 'string' || subject.length === 0) return null;
  const auth = payload[AUTH_CLAIM];
  return { subject, plan: isRecord(auth) ? chatGptPlanLabel(auth['chatgpt_plan_type']) : null };
}

export function checkIdToken(token: string, jwks: unknown, expected: IdTokenExpectations): IdTokenCheck {
  const pieces = token.split('.');
  if (pieces.length !== 3) return { ok: false, problem: 'shape' };
  const [rawHeader = '', rawPayload = '', rawSignature = ''] = pieces;
  const header = part(rawHeader);
  const payload = part(rawPayload);
  if (!header || !payload || rawSignature.length === 0) return { ok: false, problem: 'shape' };
  if (header['alg'] !== 'RS256') return { ok: false, problem: 'algorithm' };

  const key = signingKey(jwks, header);
  if (!key) return { ok: false, problem: 'key' };
  let signed: boolean;
  try {
    signed = verify(
      'sha256',
      Buffer.from(`${rawHeader}.${rawPayload}`, 'utf8'),
      key,
      Buffer.from(rawSignature, 'base64url')
    );
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, problem: 'signature' };

  if (payload['iss'] !== expected.issuer) return { ok: false, problem: 'issuer' };
  if (!forClient(payload, expected.clientId)) return { ok: false, problem: 'audience' };
  const exp = payload['exp'];
  if (typeof exp !== 'number' || exp * 1000 + CLOCK_SKEW_MS <= expected.now.getTime()) {
    return { ok: false, problem: 'expired' };
  }
  const nonce = payload['nonce'];
  if (typeof nonce !== 'string' || !sameSecret(nonce, expected.nonce)) return { ok: false, problem: 'nonce' };
  const subject = payload['sub'];
  if (typeof subject !== 'string' || subject.length === 0) return { ok: false, problem: 'subject' };

  const auth = payload[AUTH_CLAIM];
  return {
    ok: true,
    identity: { subject, plan: isRecord(auth) ? chatGptPlanLabel(auth['chatgpt_plan_type']) : null }
  };
}
