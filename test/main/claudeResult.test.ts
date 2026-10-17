import { describe, expect, it } from 'vitest';
import { endedWithoutResult, resultToError, startupReasonOf } from '../../src/main/providers/claudeResult';
import { LOGIN_EXPIRED_MESSAGE, NOT_SIGNED_IN_MESSAGE } from '../../src/shared/ai/claudeStatus';

/* setup.5: what a Claude Code result means for the review. */

describe('resultToError', () => {
  it('reads the verified signed-out result: a success with is_error', () => {
    // What Claude Code 2.1.266 sent with an empty config folder (C.42, C.47).
    const error = resultToError(
      { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' },
      {}
    );
    expect(error).toMatchObject({
      code: 'claude-not-signed-in',
      message: NOT_SIGNED_IN_MESSAGE,
      detail: 'Not logged in · Please run /login'
    });
  });

  it('lets a usable success through, unless its text is a usage limit', () => {
    expect(resultToError({ subtype: 'success', is_error: false, result: '' }, {})).toBeNull();
    expect(
      resultToError({ subtype: 'success', result: "You've hit your limit · resets 3pm" }, {})
    ).toMatchObject({
      code: 'claude-usage-limit',
      message: "You've hit your limit · resets 3pm"
    });
  });

  it('puts a refusal first, whatever else went wrong', () => {
    const context = { refusal: 'The model declined.', assistantError: 'rate_limit' };
    expect(resultToError({ subtype: 'error_during_execution' }, context)).toMatchObject({
      code: 'claude-refusal'
    });
    expect(resultToError({ subtype: 'success', is_error: true, result: 'x' }, context)).toMatchObject({
      code: 'claude-refusal',
      message: 'The model declined.'
    });
  });

  it('maps error subtypes, with the errors as detail', () => {
    expect(
      resultToError({ subtype: 'error_max_turns', errors: ['Reached maximum number of turns (3)'] }, {})
    ).toMatchObject({
      code: 'claude-failed',
      message: 'Claude ran out of turns before producing a result.',
      detail: 'Reached maximum number of turns (3)'
    });
    expect(resultToError({ subtype: 'error_max_structured_output_retries' }, {})).toMatchObject({
      code: 'claude-invalid-output'
    });
  });

  it('maps an assistant error on either shape', () => {
    expect(
      resultToError({ subtype: 'error_during_execution' }, { assistantError: 'billing_error' })
    ).toMatchObject({
      code: 'claude-billing'
    });
    expect(
      resultToError({ subtype: 'success', is_error: true, result: '' }, { assistantError: 'rate_limit' })
    ).toMatchObject({
      code: 'claude-rate-limit'
    });
  });

  it('says a sign-in ended rather than that it never happened', () => {
    expect(
      resultToError(
        { subtype: 'success', is_error: true, result: 'OAuth token has expired. Please run /login' },
        {}
      )
    ).toMatchObject({ code: 'claude-login-expired', message: LOGIN_EXPIRED_MESSAGE });
  });

  it('recognises a start-up failure reason wherever the result carries it', () => {
    const result = { subtype: 'error_during_execution', errors: ['startup: cli_version_too_old'] };
    expect(startupReasonOf(result)).toBe('cli_version_too_old');
    expect(resultToError(result, {})).toMatchObject({ code: 'claude-outdated' });
    expect(
      resultToError(
        { subtype: 'error_during_execution', startup_failure: { reason: 'org_verify_failed' } },
        {}
      )
    ).toMatchObject({
      code: 'claude-login-expired'
    });
  });

  it('keeps Claude Code s words for anything it does not recognise', () => {
    expect(
      resultToError({ subtype: 'success', is_error: true, result: 'Something odd happened' }, {})
    ).toMatchObject({
      code: 'claude-failed',
      message: 'Claude reported: Something odd happened'
    });
  });
});

describe('endedWithoutResult', () => {
  it('reads stderr, then says plainly that there was no result', () => {
    expect(endedWithoutResult({}, 'Not logged in · Please run /login', 0)).toMatchObject({
      code: 'claude-not-signed-in'
    });
    expect(endedWithoutResult({}, '', 2)).toMatchObject({
      code: 'claude-failed',
      message: 'Claude ended without returning a result. (2 unreadable lines)'
    });
    expect(endedWithoutResult({ assistantError: 'overloaded' }, '', 0)).toMatchObject({
      code: 'claude-rate-limit'
    });
    expect(endedWithoutResult({ refusal: 'Declined.' }, 'Not logged in', 0)).toMatchObject({
      code: 'claude-refusal'
    });
  });
});
