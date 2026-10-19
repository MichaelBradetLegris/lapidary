import { describe, expect, it } from 'vitest';
import {
  endedWithoutResult,
  readRateLimit,
  resultToError,
  startupReasonOf
} from '../../src/main/providers/claudeResult';
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

describe('readRateLimit (setup.9)', () => {
  const RESET = new Date(1790000000 * 1000).toISOString();

  it('keeps the status, the reset, the limit, the share used and extra usage, and nothing else', () => {
    // Claude Code 2.1.302's rate_limit_info, with fields the app does not read.
    expect(
      readRateLimit({
        status: 'allowed_warning',
        resetsAt: 1790000000,
        rateLimitType: 'seven_day',
        utilization: 0.85,
        isUsingOverage: false,
        overageStatus: 'rejected',
        overageDisabledReason: 'org_level_disabled',
        surpassedThreshold: 0.75,
        unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1790000000 } }
      })
    ).toEqual({
      status: 'allowed_warning',
      resetsAt: RESET,
      kind: 'seven_day',
      utilization: 0.85,
      usingOverage: false
    });
  });

  it('keeps extra usage in use, and a share past the whole limit', () => {
    // As Claude Code 2.1.302 sends it: the plan's limit refused, extra usage paying.
    expect(
      readRateLimit({
        status: 'rejected',
        resetsAt: 1790000000,
        rateLimitType: 'five_hour',
        isUsingOverage: true,
        overageStatus: 'allowed'
      })
    ).toEqual({ status: 'rejected', resetsAt: RESET, kind: 'five_hour', usingOverage: true });
    expect(
      readRateLimit({
        status: 'allowed',
        rateLimitType: 'five_hour',
        utilization: 1.08,
        isUsingOverage: true
      })
    ).toEqual({ status: 'allowed', kind: 'five_hour', utilization: 1.08, usingOverage: true });
  });

  it('leaves out a field of the wrong type rather than guessing, and reads no status as unknown', () => {
    expect(
      readRateLimit({
        resetsAt: '1790000000',
        rateLimitType: 7,
        utilization: '85%',
        isUsingOverage: 'yes'
      })
    ).toEqual({ status: 'unknown' });
    expect(
      readRateLimit({ status: 'allowed', resetsAt: Number.NaN, rateLimitType: '', utilization: -0.1 })
    ).toEqual({
      status: 'allowed'
    });
    expect(readRateLimit({ status: 'allowed', utilization: Number.POSITIVE_INFINITY })).toEqual({
      status: 'allowed'
    });
    expect(readRateLimit({ status: 'allowed', utilization: 0 })).toEqual({
      status: 'allowed',
      utilization: 0
    });
  });

  it('reads anything that is not an object as a notice with no status', () => {
    for (const value of [undefined, null, 'rejected', 42, []]) {
      expect(readRateLimit(value), String(value)).toEqual({ status: 'unknown' });
    }
  });
});
