import { describe, expect, it } from 'vitest';
import { readIdTokenIdentity } from '../../src/main/chatgpt/idToken';
import {
  ENDED_REFRESH_ERRORS,
  RENEW_BEFORE_MS,
  needsRenewal,
  readRefreshAnswer,
  refreshFields
} from '../../src/main/chatgpt/oauth';
import type { SessionTokens } from '../../src/main/chatgpt/store';

/* codex.3: renewing a ChatGPT sign-in's access token, as OpenAI's page on
   sessions and its page on errors give it (Appendix A, read 2026-10-24). The
   renewal end to end, against test/helpers/mockChatGptAuth.ts, is in
   test/main/chatgptProvider.test.ts. */

const NOW = new Date('2026-10-24T12:00:00.000Z');

const KEPT: SessionTokens = {
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  idToken: 'id-old',
  scope: 'openid chatgpt.tokens.use.direct',
  expiresAt: '2026-10-24T11:00:00.000Z'
};

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(payload)}.c2lnbmF0dXJl`;
}

describe('the renewal request', () => {
  it('posts the refresh token, the issued client id and the resource, and no scope', () => {
    expect(refreshFields('oaiapp_1', 'rt-1')).toEqual({
      grant_type: 'refresh_token',
      client_id: 'oaiapp_1',
      refresh_token: 'rt-1',
      resource: 'https://api.openai.com/v1'
    });
  });

  it("takes as ended every refresh error OpenAI's page lists, and the registration refused", () => {
    expect([...ENDED_REFRESH_ERRORS].sort()).toEqual(
      [
        'invalid_client',
        'invalid_grant',
        'invalid_refresh_token',
        'refresh_token_expired',
        'refresh_token_invalidated',
        'refresh_token_reused',
        'token_expired'
      ].sort()
    );
    expect(ENDED_REFRESH_ERRORS.has('server_error')).toBe(false);
  });
});

describe('the renewal answer', () => {
  it('replaces the access token, and the refresh token, which rotates, with its new end', () => {
    expect(
      readRefreshAnswer(
        {
          access_token: 'at-new',
          refresh_token: 'rt-new',
          id_token: 'id-new',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct email'
        },
        NOW,
        KEPT
      )
    ).toEqual({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      idToken: 'id-new',
      scope: 'openid chatgpt.tokens.use.direct email',
      expiresAt: '2026-10-24T13:00:00.000Z'
    });
  });

  it('keeps the refresh token, the ID token and the scopes an answer leaves out, and an hour for no end', () => {
    expect(readRefreshAnswer({ access_token: 'at-new' }, NOW, KEPT)).toEqual({
      ...KEPT,
      accessToken: 'at-new',
      expiresAt: '2026-10-24T13:00:00.000Z'
    });
  });

  it('is no answer without an access token, or with a type other than Bearer', () => {
    expect(readRefreshAnswer({ refresh_token: 'rt-new' }, NOW, KEPT)).toBeNull();
    expect(readRefreshAnswer({ access_token: 'at', token_type: 'mac' }, NOW, KEPT)).toBeNull();
    expect(readRefreshAnswer('junk', NOW, KEPT)).toBeNull();
    expect(readRefreshAnswer(null, NOW, KEPT)).toBeNull();
  });
});

describe('when a token is renewed', () => {
  it(`renews within ${RENEW_BEFORE_MS / 1000} s of its end, after it, and when its end cannot be read`, () => {
    const at = (ms: number): string => new Date(NOW.getTime() + ms).toISOString();
    expect(needsRenewal(at(10 * 60_000), NOW)).toBe(false);
    expect(needsRenewal(at(RENEW_BEFORE_MS + 1000), NOW)).toBe(false);
    expect(needsRenewal(at(RENEW_BEFORE_MS), NOW)).toBe(true);
    expect(needsRenewal(at(-1000), NOW)).toBe(true);
    expect(needsRenewal('', NOW)).toBe(true);
    expect(needsRenewal('soon', NOW)).toBe(true);
  });
});

describe("a renewal's ID token", () => {
  it('names the account and the plan, read as it came from the token endpoint', () => {
    expect(
      readIdTokenIdentity(jwt({ sub: 'user-1', 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }))
    ).toEqual({ subject: 'user-1', plan: 'Pro' });
    expect(readIdTokenIdentity(jwt({ sub: 'user-1' }))).toEqual({ subject: 'user-1', plan: null });
  });

  it('names no one for a token without an account, or one that is not a token', () => {
    expect(readIdTokenIdentity(jwt({ email: 'writer@example.com' }))).toBeNull();
    expect(readIdTokenIdentity(jwt({ sub: '' }))).toBeNull();
    expect(readIdTokenIdentity('not.a')).toBeNull();
    expect(readIdTokenIdentity('a.b.c')).toBeNull();
  });
});
