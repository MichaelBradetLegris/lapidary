import { describe, expect, it } from 'vitest';
import type { RateLimitInfo } from '../../src/shared/ipc';
import {
  OTHER_MODELS_ADVICE,
  USAGE_NOTICE_FROM,
  USING_EXTRA_USAGE,
  WAIT_ADVICE,
  describeRateLimit,
  isPlanLimit,
  limitName,
  rateLimitTitle,
  resetTime,
  resetTimeInWords,
  untilPhrase,
  usageLimitAdvice,
  usageLimitCard
} from '../../src/shared/ui/usage';

/* setup.9: Claude's usage in words. Times are built from local dates, as the
   status bar shows the computer's own clock, so the tests hold in any time
   zone. "Now" is Thursday 22 October 2026, 13:35 local time. */

const NOW = new Date(2026, 9, 22, 13, 35);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A local time as the ISO string main sends. */
const at = (...parts: [number, number, number, number, number]): string => new Date(...parts).toISOString();

/** Later today, at 15:45: 2 hours and 10 minutes from now. */
const TODAY_1545 = at(2026, 9, 22, 15, 45);

function notice(fields: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return { status: 'allowed', resetsAt: TODAY_1545, kind: 'five_hour', ...fields };
}

describe('describeRateLimit', () => {
  it('says how much of a limit is used, from 80%, with its reset (the task wording)', () => {
    expect(USAGE_NOTICE_FROM).toBe(80);
    expect(describeRateLimit(notice({ utilization: 0.85 }), NOW)).toBe('5-hour limit 85% used, resets 15:45');
    expect(describeRateLimit(notice({ status: 'allowed_warning', utilization: 0.8 }), NOW)).toBe(
      '5-hour limit 80% used, resets 15:45'
    );
  });

  it('says nothing under 80% with no extra usage, whatever Claude Code calls the status', () => {
    for (const status of ['allowed', 'allowed_warning', 'unknown', undefined]) {
      const base = status === undefined ? {} : { status };
      expect(describeRateLimit({ ...notice(base), utilization: 0.79 }, NOW), status).toBeNull();
      expect(describeRateLimit({ ...notice(base), utilization: 0.25 }, NOW), status).toBeNull();
      expect(describeRateLimit({ ...notice(base), utilization: 0 }, NOW), status).toBeNull();
    }
    // Rounded down, as Claude Code words its own warning, so 79.6% is 79% and says nothing.
    expect(describeRateLimit(notice({ utilization: 0.794 }), NOW)).toBeNull();
    expect(describeRateLimit(notice({ utilization: 0.796 }), NOW)).toBeNull();
    expect(describeRateLimit(notice({ utilization: 0.8 }), NOW)).toBe('5-hour limit 80% used, resets 15:45');
    expect(describeRateLimit(notice({ utilization: 0.829 }), NOW)).toBe(
      '5-hour limit 82% used, resets 15:45'
    );
    // Claude Code takes the share to a tenth of a percent first: 0.7996 is 80.0%.
    expect(describeRateLimit(notice({ utilization: 0.7996 }), NOW)).toBe(
      '5-hour limit 80% used, resets 15:45'
    );
  });

  it('says nothing when Claude Code gave no share, unless a limit is reached or extra usage is paying', () => {
    expect(describeRateLimit(notice(), NOW)).toBeNull();
    expect(describeRateLimit(notice({ status: 'allowed_warning' }), NOW)).toBeNull();
    expect(describeRateLimit(notice({ status: 'rejected' }), NOW)).toBe('5-hour limit reached, resets 15:45');
    expect(describeRateLimit(notice({ usingOverage: true }), NOW)).toBe(USING_EXTRA_USAGE);
  });

  it('caps the share at 100%: usage can run past a limit', () => {
    expect(describeRateLimit(notice({ utilization: 1 }), NOW)).toBe('5-hour limit 100% used, resets 15:45');
    expect(describeRateLimit(notice({ utilization: 1.08 }), NOW)).toBe(
      '5-hour limit 100% used, resets 15:45'
    );
  });

  it('never says 100% of a limit not reached: 99.5% is 99%, as Claude Code says it', () => {
    expect(describeRateLimit(notice({ utilization: 0.995 }), NOW)).toBe(
      '5-hour limit 99% used, resets 15:45'
    );
    expect(describeRateLimit(notice({ utilization: 0.999 }), NOW)).toBe(
      '5-hour limit 99% used, resets 15:45'
    );
  });

  it('says a limit is reached, whatever share it gives', () => {
    expect(describeRateLimit(notice({ status: 'rejected', utilization: 1 }), NOW)).toBe(
      '5-hour limit reached, resets 15:45'
    );
    expect(describeRateLimit(notice({ status: 'rejected', utilization: 0.4 }), NOW)).toBe(
      '5-hour limit reached, resets 15:45'
    );
  });

  it('says extra usage is in use, which may be billed, before anything else', () => {
    expect(USING_EXTRA_USAGE).toBe('Using extra usage (may be billed)');
    for (const info of [
      notice({ usingOverage: true }),
      notice({ usingOverage: true, utilization: 0.3 }),
      notice({ usingOverage: true, utilization: 0.95 }),
      notice({ usingOverage: true, status: 'rejected' }),
      notice({ usingOverage: true, kind: 'overage' }),
      { usingOverage: true }
    ]) {
      expect(describeRateLimit(info, NOW), JSON.stringify(info)).toBe('Using extra usage (may be billed)');
    }
    expect(describeRateLimit(notice({ usingOverage: false, utilization: 0.3 }), NOW)).toBeNull();
  });

  it('names each limit Claude Code reports, and any other as a usage limit', () => {
    const cases: Array<[string | undefined, string]> = [
      ['five_hour', '5-hour limit 90% used'],
      ['seven_day', 'Weekly limit 90% used'],
      ['seven_day_opus', 'Weekly Opus limit 90% used'],
      ['seven_day_sonnet', 'Weekly Sonnet limit 90% used'],
      ['seven_day_overage_included', 'Weekly model limit 90% used'],
      ['overage', 'Extra usage limit 90% used'],
      ['ten_minute', 'Usage limit 90% used'],
      [undefined, 'Usage limit 90% used']
    ];
    for (const [kind, words] of cases) {
      const info: RateLimitInfo = { status: 'allowed', utilization: 0.9, ...(kind ? { kind } : {}) };
      expect(describeRateLimit(info, NOW), kind).toBe(words);
    }
  });

  it('names the weekly Sonnet limit as Claude Code does on the plan: the weekly limit on Pro and Enterprise', () => {
    const sonnet: RateLimitInfo = { status: 'rejected', kind: 'seven_day_sonnet' };
    for (const plan of ['pro', 'Pro', 'enterprise']) {
      expect(describeRateLimit(sonnet, NOW, plan), plan).toBe('Weekly limit reached');
    }
    for (const plan of ['max', 'team', 'free', undefined]) {
      expect(describeRateLimit(sonnet, NOW, plan), plan).toBe('Weekly Sonnet limit reached');
    }
    // The other limits are named the same on every plan.
    expect(describeRateLimit({ status: 'rejected', kind: 'seven_day_opus' }, NOW, 'pro')).toBe(
      'Weekly Opus limit reached'
    );
    expect(describeRateLimit({ status: 'rejected', kind: 'five_hour' }, NOW, 'enterprise')).toBe(
      '5-hour limit reached'
    );
  });

  it('ends at the limit when there is no reset, or one that cannot be read', () => {
    const noReset: RateLimitInfo = { status: 'allowed', utilization: 0.92, kind: 'seven_day' };
    expect(describeRateLimit(noReset, NOW)).toBe('Weekly limit 92% used');
    expect(describeRateLimit({ ...noReset, resetsAt: 'soon' }, NOW)).toBe('Weekly limit 92% used');
    expect(describeRateLimit({ ...noReset, status: 'rejected' }, NOW)).toBe('Weekly limit reached');
  });

  it('says nothing once the reset has passed, in every branch: the limit has started again', () => {
    const past = at(2026, 9, 22, 13, 30);
    for (const fields of [
      { utilization: 0.95 },
      { status: 'rejected' },
      { usingOverage: true },
      { utilization: 0.95, resetsAt: NOW.toISOString() }
    ]) {
      expect(
        describeRateLimit(notice({ resetsAt: past, ...fields }), NOW),
        JSON.stringify(fields)
      ).toBeNull();
    }
    expect(describeRateLimit(notice({ utilization: 0.95 }), new Date(NOW.getTime() + 3 * HOUR))).toBeNull();
  });

  it('says nothing without a notice', () => {
    expect(describeRateLimit(null, NOW)).toBeNull();
    expect(describeRateLimit(undefined, NOW)).toBeNull();
    expect(describeRateLimit({}, NOW)).toBeNull();
  });

  it('gives a weekly reset its day, so it is never read as today', () => {
    const weekly = (resetsAt: string): string | null =>
      describeRateLimit({ status: 'allowed', kind: 'seven_day', utilization: 0.85, resetsAt }, NOW);
    expect(weekly(at(2026, 9, 23, 9, 0))).toBe('Weekly limit 85% used, resets tomorrow 09:00');
    expect(weekly(at(2026, 9, 24, 9, 0))).toBe('Weekly limit 85% used, resets Sat 09:00');
    expect(weekly(at(2026, 9, 29, 9, 0))).toBe('Weekly limit 85% used, resets 29 Oct 09:00');
  });
});

describe('resetTime and resetTimeInWords: the time format', () => {
  const cases: Array<[string, Date, string, string]> = [
    ['later today', new Date(2026, 9, 22, 15, 45), '15:45', 'at 15:45'],
    ['two digits, the 24-hour clock', new Date(2026, 9, 22, 21, 5), '21:05', 'at 21:05'],
    ['a minute from now', new Date(2026, 9, 22, 13, 36), '13:36', 'at 13:36'],
    ['the last minute of today', new Date(2026, 9, 22, 23, 59), '23:59', 'at 23:59'],
    ['midnight is tomorrow', new Date(2026, 9, 23, 0, 0), 'tomorrow 00:00', 'tomorrow at 00:00'],
    ['tomorrow morning', new Date(2026, 9, 23, 9, 0), 'tomorrow 09:00', 'tomorrow at 09:00'],
    ['in two days, by its weekday', new Date(2026, 9, 24, 9, 0), 'Sat 09:00', 'on Saturday at 09:00'],
    ['in six days', new Date(2026, 9, 28, 18, 30), 'Wed 18:30', 'on Wednesday at 18:30'],
    ['in seven days, by its date', new Date(2026, 9, 29, 13, 35), '29 Oct 13:35', 'on 29 October at 13:35'],
    ['into the next month', new Date(2026, 10, 2, 7, 0), '2 Nov 07:00', 'on 2 November at 07:00']
  ];
  for (const [name, reset, short, long] of cases) {
    it(name, () => {
      expect(resetTime(reset, NOW)).toBe(short);
      expect(resetTimeInWords(reset, NOW)).toBe(long);
    });
  }

  it('counts calendar days across the end of a month and of a year', () => {
    const newYearsEve = new Date(2026, 11, 31, 22, 0);
    expect(resetTime(new Date(2027, 0, 1, 3, 0), newYearsEve)).toBe('tomorrow 03:00');
    expect(resetTime(new Date(2027, 0, 2, 3, 0), newYearsEve)).toBe('Sat 03:00');
    expect(resetTime(new Date(2026, 10, 1, 8, 0), new Date(2026, 9, 31, 23, 0))).toBe('tomorrow 08:00');
  });

  it('counts calendar days across a change of the clocks', () => {
    // A day the clocks go forward is 23 hours long, and one they go back 25,
    // so the days are counted by date. Each pair crosses such a day in some
    // zones and none in others, and must read the same everywhere; the test
    // bites in any zone that changes its clocks on one of these dates.
    const tomorrowAcross: Array<[Date, Date]> = [
      // Europe, forward on 28 March 2027 and back on 25 October 2026
      [new Date(2027, 2, 28, 0, 30), new Date(2027, 2, 29, 0, 30)],
      [new Date(2026, 9, 25, 0, 30), new Date(2026, 9, 26, 0, 30)],
      // North America, forward on 14 March 2027 and back on 1 November 2026
      [new Date(2027, 2, 14, 0, 30), new Date(2027, 2, 15, 0, 30)],
      [new Date(2026, 10, 1, 0, 30), new Date(2026, 10, 2, 0, 30)],
      // Australia's south-east, forward on 4 October 2026; New Zealand, 27 September 2026
      [new Date(2026, 9, 4, 0, 30), new Date(2026, 9, 5, 0, 30)],
      [new Date(2026, 8, 27, 0, 30), new Date(2026, 8, 28, 0, 30)]
    ];
    for (const [now, reset] of tomorrowAcross) {
      expect(resetTime(reset, now), now.toDateString()).toBe('tomorrow 00:30');
    }
    expect(resetTime(new Date(2026, 9, 26, 9, 0), new Date(2026, 9, 24, 23, 30))).toBe('Mon 09:00');
    expect(resetTime(new Date(2027, 2, 16, 9, 0), new Date(2027, 2, 13, 23, 30))).toBe('Tue 09:00');
  });
});

describe('untilPhrase: singular and plural, the minutes counted up', () => {
  const cases: Array<[number, string]> = [
    [-5000, 'in less than a minute'],
    [0, 'in less than a minute'],
    [1, 'in 1 minute'],
    [59_999, 'in 1 minute'],
    [MINUTE, 'in 1 minute'],
    [MINUTE + 1, 'in 2 minutes'],
    [2 * MINUTE - 1, 'in 2 minutes'],
    [2 * MINUTE, 'in 2 minutes'],
    [59 * MINUTE, 'in 59 minutes'],
    [HOUR - 1, 'in 1 hour'],
    [HOUR, 'in 1 hour'],
    [HOUR + MINUTE, 'in 1 hour and 1 minute'],
    [HOUR + 45 * MINUTE, 'in 1 hour and 45 minutes'],
    [2 * HOUR, 'in 2 hours'],
    [2 * HOUR + MINUTE, 'in 2 hours and 1 minute'],
    [2 * HOUR + 9 * MINUTE + 40_000, 'in 2 hours and 10 minutes'],
    [2 * HOUR + 10 * MINUTE, 'in 2 hours and 10 minutes'],
    [23 * HOUR + 59 * MINUTE, 'in 23 hours and 59 minutes'],
    [24 * HOUR - 1, 'in 1 day'],
    [24 * HOUR, 'in 1 day'],
    [25 * HOUR, 'in 1 day and 1 hour'],
    [26 * HOUR - 5, 'in 1 day and 2 hours'],
    [26 * HOUR + 30 * MINUTE, 'in 1 day and 2 hours'],
    [48 * HOUR + 30 * MINUTE, 'in 2 days'],
    [3 * 24 * HOUR + HOUR, 'in 3 days and 1 hour'],
    [6 * 24 * HOUR + 5 * HOUR, 'in 6 days and 5 hours']
  ];
  for (const [ms, words] of cases) {
    it(`${ms} ms: ${words}`, () => expect(untilPhrase(ms)).toBe(words));
  }
});

describe('rateLimitTitle: the tooltip', () => {
  it('says the share in full, when it resets and how long that is', () => {
    expect(rateLimitTitle(notice({ utilization: 0.85 }), NOW)).toBe(
      "85% of your Claude plan's 5-hour limit is used. It resets at 15:45, in 2 hours and 10 minutes."
    );
    expect(rateLimitTitle(notice({ utilization: 0.99, resetsAt: at(2026, 9, 22, 14, 36) }), NOW)).toBe(
      "99% of your Claude plan's 5-hour limit is used. It resets at 14:36, in 1 hour and 1 minute."
    );
  });

  it('gives the time left to the clock time it follows, whatever the seconds of either', () => {
    // The status bar reads the clock with its seconds: 13:35:20 here.
    const later = new Date(2026, 9, 22, 13, 35, 20);
    const title = (resetsAt: Date): string | null =>
      rateLimitTitle(notice({ utilization: 0.9, resetsAt: resetsAt.toISOString() }), later);
    expect(title(new Date(2026, 9, 22, 15, 45))).toBe(
      "90% of your Claude plan's 5-hour limit is used. It resets at 15:45, in 2 hours and 10 minutes."
    );
    expect(title(new Date(2026, 9, 22, 15, 45, 30))).toBe(
      "90% of your Claude plan's 5-hour limit is used. It resets at 15:45, in 2 hours and 10 minutes."
    );
    expect(title(new Date(2026, 9, 22, 13, 36, 0))).toBe(
      "90% of your Claude plan's 5-hour limit is used. It resets at 13:36, in 1 minute."
    );
    expect(title(new Date(2026, 9, 22, 13, 35, 50))).toBe(
      "90% of your Claude plan's 5-hour limit is used. It resets at 13:35, in less than a minute."
    );
    // Past a day, whole hours: 26 hours less 5 ms is tomorrow at 15:35, 26 hours on the clock.
    expect(title(new Date(later.getTime() + 26 * HOUR - 5))).toBe(
      "90% of your Claude plan's 5-hour limit is used. It resets tomorrow at 15:35, in 1 day and 2 hours."
    );
  });

  it('says a reached limit stops reviews until it resets, with the one model a one-model limit holds', () => {
    expect(
      rateLimitTitle(
        { status: 'rejected', kind: 'seven_day_opus', resetsAt: at(2026, 9, 24, 9, 0), utilization: 1 },
        NOW
      )
    ).toBe(
      "Your Claude plan's weekly Opus limit is used up, so reviews with Opus stop until it resets on Saturday at 09:00, in 1 day and 19 hours."
    );
    expect(rateLimitTitle({ status: 'rejected', kind: 'seven_day_sonnet', resetsAt: TODAY_1545 }, NOW)).toBe(
      "Your Claude plan's weekly Sonnet limit is used up, so reviews with Sonnet stop until it resets at 15:45, in 2 hours and 10 minutes."
    );
    expect(
      rateLimitTitle({ status: 'rejected', kind: 'seven_day_overage_included', resetsAt: TODAY_1545 }, NOW)
    ).toBe(
      "Your Claude plan's weekly model limit is used up, so reviews with that model stop until it resets at 15:45, in 2 hours and 10 minutes."
    );
    // On Pro and Enterprise Claude Code counts the weekly Sonnet limit as the weekly limit.
    for (const plan of ['pro', 'enterprise']) {
      expect(
        rateLimitTitle({ status: 'rejected', kind: 'seven_day_sonnet', resetsAt: TODAY_1545 }, NOW, plan),
        plan
      ).toBe(
        "Your Claude plan's weekly limit is used up, so reviews with Claude stop until it resets at 15:45, in 2 hours and 10 minutes."
      );
    }
    expect(rateLimitTitle({ status: 'rejected', kind: 'seven_day', resetsAt: TODAY_1545 }, NOW)).toBe(
      "Your Claude plan's weekly limit is used up, so reviews with Claude stop until it resets at 15:45, in 2 hours and 10 minutes."
    );
    expect(rateLimitTitle({ status: 'rejected', kind: 'overage', resetsAt: TODAY_1545 }, NOW)).toBe(
      'Your extra usage limit is used up, so reviews with Claude stop until it resets at 15:45, in 2 hours and 10 minutes.'
    );
    expect(rateLimitTitle({ status: 'rejected' }, NOW)).toBe(
      "Your Claude plan's usage limit is used up, so reviews with Claude stop until it resets."
    );
  });

  it('says extra usage may be billed, and when the plan limit comes back', () => {
    // As Claude Code 2.1.302 sends it: the plan's limit refused, extra usage paying. Not "reviews stop".
    const extraUsage: RateLimitInfo = {
      status: 'rejected',
      kind: 'five_hour',
      usingOverage: true,
      resetsAt: at(2026, 9, 23, 9, 0)
    };
    expect(describeRateLimit(extraUsage, NOW)).toBe(USING_EXTRA_USAGE);
    expect(rateLimitTitle(extraUsage, NOW)).toBe(
      "Your Claude plan's 5-hour limit is used up, so Claude Code is using extra usage, which may be billed. The limit resets tomorrow at 09:00, in 19 hours and 25 minutes."
    );
    expect(rateLimitTitle({ ...extraUsage, kind: 'seven_day_opus' }, NOW)).toBe(
      "Your Claude plan's weekly Opus limit is used up, so Claude Code is using extra usage, which may be billed. The limit resets tomorrow at 09:00, in 19 hours and 25 minutes."
    );
    // The same words for an `allowed` notice with extra usage, which 2.1.302 does not send.
    expect(rateLimitTitle(notice({ usingOverage: true, resetsAt: at(2026, 9, 23, 9, 0) }), NOW)).toBe(
      "Your Claude plan's 5-hour limit is used up, so Claude Code is using extra usage, which may be billed. The limit resets tomorrow at 09:00, in 19 hours and 25 minutes."
    );
    // "overage" names extra usage itself, not the plan's limit that ran out.
    expect(rateLimitTitle({ status: 'allowed', kind: 'overage', usingOverage: true }, NOW)).toBe(
      "Your Claude plan's usage limit is used up, so Claude Code is using extra usage, which may be billed."
    );
  });

  it('ends at the share when there is no reset', () => {
    expect(rateLimitTitle({ status: 'allowed', kind: 'seven_day', utilization: 0.9 }, NOW)).toBe(
      "90% of your Claude plan's weekly limit is used."
    );
  });

  it('is there exactly when the status bar shows a notice', () => {
    expect(rateLimitTitle(notice({ utilization: 0.5 }), NOW)).toBeNull();
    expect(rateLimitTitle(notice({ utilization: 0.95, resetsAt: at(2026, 9, 22, 13, 0) }), NOW)).toBeNull();
    expect(rateLimitTitle(null, NOW)).toBeNull();
  });
});

describe('limitName', () => {
  it('names the limits, and nothing it does not know, even a name every object has', () => {
    expect(limitName('five_hour')).toBe('5-hour limit');
    expect(limitName('seven_day')).toBe('weekly limit');
    expect(limitName(undefined)).toBe('usage limit');
    expect(limitName('toString')).toBe('usage limit');
    expect(limitName('')).toBe('usage limit');
  });
});

describe('usageLimitAdvice: wait, or Sonnet and Haiku', () => {
  it('advises waiting, and Sonnet or Haiku to make the limits last, for a limit every model shares', () => {
    expect(WAIT_ADVICE).toContain('Wait until the limit resets');
    expect(WAIT_ADVICE).toContain('Sonnet and Haiku use your limits more slowly than Opus models');
    expect(WAIT_ADVICE).toContain('under Model in Review with AI');
    for (const info of [
      null,
      undefined,
      { status: 'rejected', kind: 'five_hour' },
      { status: 'rejected', kind: 'seven_day' },
      { status: 'rejected', kind: 'overage' },
      { status: 'rejected' },
      // Not reached: the notice is an earlier one.
      { status: 'allowed', kind: 'seven_day_opus', utilization: 0.9 },
      // Extra usage is paying, so it is not that limit that stopped the review.
      { status: 'rejected', kind: 'seven_day_opus', usingOverage: true }
    ]) {
      expect(usageLimitAdvice(info), JSON.stringify(info)).toBe(WAIT_ADVICE);
    }
  });

  it('points at the models a one-model limit leaves free', () => {
    expect(usageLimitAdvice({ status: 'rejected', kind: 'seven_day_opus' })).toBe(
      'Sonnet and Haiku do not count against the weekly Opus limit: choose one under Model in Review with AI to go on now, or wait until the limit resets.'
    );
    expect(usageLimitAdvice({ status: 'rejected', kind: 'seven_day_sonnet' })).toBe(
      OTHER_MODELS_ADVICE.seven_day_sonnet
    );
    expect(OTHER_MODELS_ADVICE.seven_day_sonnet).toContain(
      'Haiku and Opus do not count against the weekly Sonnet limit'
    );
    // The weekly limit of one model, which Claude Code names after it ("Fable limit").
    expect(usageLimitAdvice({ status: 'rejected', kind: 'seven_day_overage_included' })).toBe(
      'Other models do not count against this weekly model limit: choose another under Model in Review with AI to go on now, or wait until the limit resets.'
    );
  });

  it('advises waiting for the weekly Sonnet limit on Pro and Enterprise, where it is the weekly limit', () => {
    const sonnet: RateLimitInfo = { status: 'rejected', kind: 'seven_day_sonnet' };
    for (const plan of ['pro', 'enterprise']) {
      expect(usageLimitAdvice(sonnet, plan), plan).toBe(WAIT_ADVICE);
    }
    for (const plan of ['max', 'team', undefined]) {
      expect(usageLimitAdvice(sonnet, plan), plan).toBe(OTHER_MODELS_ADVICE.seven_day_sonnet);
    }
    expect(usageLimitAdvice({ status: 'rejected', kind: 'seven_day_opus' }, 'pro')).toBe(
      OTHER_MODELS_ADVICE.seven_day_opus
    );
  });
});

/** Claude Code 2.1.302's usage-limit messages for one of the plan's limits (its `AS`, `lt` and `hie`). */
const PLAN_LIMIT_MESSAGES = [
  "You've hit your limit · resets 3pm",
  "You've hit your session limit · resets 3pm",
  "You've hit your weekly limit · resets Oct 24, 9am",
  "You've hit your Opus limit · resets Oct 24, 9am",
  "You've hit your Sonnet limit · resets Oct 24, 9am · progress saved",
  "You've hit your Fable limit · resets Oct 24, 9am"
];

/** Its usage-limit messages for anything else: budgets, spend limits, usage credits, seats. */
const OTHER_LIMIT_MESSAGES = [
  "You're out of usage credits",
  'Your org is out of usage · add funds to continue',
  "Your seat type doesn't include usage",
  "You're out of extra usage",
  "You've hit your team's shared budget. Switch to another model to continue.",
  "You've hit your team's shared budget. /model to switch models.",
  "You've hit your monthly spend limit. Switch to another model to continue.",
  "You've hit your channel's monthly spend limit. Switch to another model to continue.",
  "You've hit your org's monthly spend limit · ask your admin to raise it",
  "You've reached your Fable limit. Switch to another model to continue.",
  "You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch models."
];

describe("isPlanLimit: one of the plan's limits, which waiting mends", () => {
  it("knows Claude Code's words for the plan's limits, with no notice or an earlier one", () => {
    for (const message of PLAN_LIMIT_MESSAGES) {
      expect(isPlanLimit(message, null), message).toBe(true);
      expect(isPlanLimit(message, { status: 'allowed', kind: 'five_hour' }), message).toBe(true);
    }
  });

  it('takes nothing else for one, with no notice, an earlier one or one about extra usage', () => {
    for (const message of OTHER_LIMIT_MESSAGES) {
      for (const info of [
        null,
        { status: 'allowed', utilization: 0.9 },
        { status: 'rejected', kind: 'overage' },
        { status: 'rejected', kind: 'five_hour', usingOverage: true },
        { status: 'rejected', usingOverage: true }
      ]) {
        expect(isPlanLimit(message, info), `${message} ${JSON.stringify(info)}`).toBe(false);
      }
    }
  });

  it('follows a notice that says a plan limit was reached, unless the words say to switch model', () => {
    const reached: RateLimitInfo = { status: 'rejected', kind: 'five_hour' };
    expect(isPlanLimit('Limit reached', reached)).toBe(true);
    // Claude Code's words when the plan's limit and the extra usage behind it both ran out.
    expect(isPlanLimit("You're out of usage credits · resets 3pm", reached)).toBe(true);
    expect(isPlanLimit("You've hit your team's shared budget · your session limit resets 3pm", reached)).toBe(
      true
    );
    expect(
      isPlanLimit("You've hit your team's shared budget. Switch to another model to continue.", reached)
    ).toBe(false);
    // Extra usage, even under a plan limit's words.
    expect(isPlanLimit(PLAN_LIMIT_MESSAGES[0] ?? '', { status: 'rejected', kind: 'overage' })).toBe(false);
  });
});

describe('usageLimitCard: the card a review that stopped at a usage limit puts up', () => {
  const HIT = "You've hit your limit · resets 3pm";

  it("keeps Claude Code's words, which name the reset, then advises", () => {
    expect(usageLimitCard(HIT, null)).toBe(`${HIT}. ${WAIT_ADVICE}`);
    expect(usageLimitCard("You've hit your weekly limit.", null)).toBe(
      `You've hit your weekly limit. ${WAIT_ADVICE}`
    );
    expect(usageLimitCard(`  ${HIT}\n`, null)).toBe(`${HIT}. ${WAIT_ADVICE}`);
    for (const message of PLAN_LIMIT_MESSAGES) {
      expect(usageLimitCard(message, null), message).toBe(`${message}. ${WAIT_ADVICE}`);
    }
  });

  it('advises as Claude Code names the limit on the plan: the weekly limit on Pro, Sonnet on Max', () => {
    const sonnet: RateLimitInfo = { status: 'rejected', kind: 'seven_day_sonnet' };
    expect(usageLimitCard("You've hit your weekly limit · resets Oct 24, 9am", sonnet, 'pro')).toBe(
      `You've hit your weekly limit · resets Oct 24, 9am. ${WAIT_ADVICE}`
    );
    expect(usageLimitCard("You've hit your Sonnet limit · resets Oct 24, 9am", sonnet, 'max')).toBe(
      `You've hit your Sonnet limit · resets Oct 24, 9am. ${OTHER_MODELS_ADVICE.seven_day_sonnet}`
    );
    expect(
      usageLimitCard("You've hit your Fable limit · resets Oct 24, 9am", {
        status: 'rejected',
        kind: 'seven_day_overage_included'
      })
    ).toBe(
      `You've hit your Fable limit · resets Oct 24, 9am. ${OTHER_MODELS_ADVICE.seven_day_overage_included}`
    );
  });

  it('advises from the notice that came before the failure, which names the limit', () => {
    expect(
      usageLimitCard("You've hit your Opus limit · resets Oct 24, 9am", {
        status: 'rejected',
        kind: 'seven_day_opus'
      })
    ).toBe(`You've hit your Opus limit · resets Oct 24, 9am. ${OTHER_MODELS_ADVICE.seven_day_opus}`);
    // A plan limit by the notice alone, in words this app does not know.
    expect(usageLimitCard('Limit reached', { status: 'rejected', kind: 'five_hour' })).toBe(
      `Limit reached. ${WAIT_ADVICE}`
    );
    expect(usageLimitCard('', { status: 'rejected', kind: 'five_hour' })).toBe(WAIT_ADVICE);
  });

  it("adds nothing to a usage limit that is not one of the plan's: Claude Code's words say what to do", () => {
    for (const message of OTHER_LIMIT_MESSAGES) {
      expect(usageLimitCard(message, null), message).toBe(message);
      expect(usageLimitCard(message, { status: 'allowed', utilization: 0.9 }), message).toBe(message);
      expect(usageLimitCard(message, { status: 'rejected', kind: 'overage' }), message).toBe(message);
      expect(usageLimitCard(message, { status: 'rejected', usingOverage: true }), message).toBe(message);
      expect(
        usageLimitCard(message, { status: 'rejected', kind: 'five_hour', usingOverage: true }),
        message
      ).toBe(message);
    }
  });

  it('advises when a plan limit and the extra usage behind it ran out together, as the notice says', () => {
    // Claude Code 2.1.302 then gives the plan's reset, and the notice names the plan's limit.
    expect(
      usageLimitCard("You're out of usage credits · resets 3pm", { status: 'rejected', kind: 'five_hour' })
    ).toBe(`You're out of usage credits · resets 3pm. ${WAIT_ADVICE}`);
  });
});
