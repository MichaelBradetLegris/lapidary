import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../../src/renderer/components/SetupScreen';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import type { RateLimitInfo, RuntimeStatus } from '../../src/shared/ipc';
import { OTHER_USAGE_LIMIT_TEXT, USAGE_LIMIT_TEXT } from '../../src/shared/ui/setup';
import { OTHER_MODELS_ADVICE, WAIT_ADVICE } from '../../src/shared/ui/usage';

/* setup.9: Claude's usage in the status bar, and the Setup screen's advice
   for a usage limit, rendered with react-dom/server. The bar reads the clock
   as it draws, so the clock is set: Thursday 22 October 2026, 13:35 local
   time. The 30 s re-wording is an effect, which does not run here. This file
   is type-checked with the renderer's project (tsconfig.web.json), as it
   renders components. */

const NOW = new Date(2026, 9, 22, 13, 35);
const TODAY_1545 = new Date(2026, 9, 22, 15, 45).toISOString();

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function bar(rateLimit: RateLimitInfo | null, plan?: string): string {
  return decode(
    renderToStaticMarkup(
      createElement(StatusBar, { review: null, runtimeLabel: 'Claude ready', rateLimit, plan })
    )
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the status bar's usage notice", () => {
  it('says how much of the limit is used and when it resets, with the whole sentence as its tooltip', () => {
    const html = bar({
      status: 'allowed_warning',
      resetsAt: TODAY_1545,
      kind: 'five_hour',
      utilization: 0.85
    });
    expect(html).toContain(
      `<span class="statusbar__warn" data-testid="status-usage" title="85% of your Claude plan's 5-hour limit is used. It resets at 15:45, in 2 hours and 10 minutes.">5-hour limit 85% used, resets 15:45</span>`
    );
  });

  it('says when extra usage is in use, which may be billed', () => {
    // As Claude Code 2.1.302 sends it: the plan's limit refused, extra usage paying.
    const html = bar({ status: 'rejected', resetsAt: TODAY_1545, kind: 'five_hour', usingOverage: true });
    expect(html).toContain(
      `<span class="statusbar__warn" data-testid="status-usage" title="Your Claude plan's 5-hour limit is used up, so Claude Code is using extra usage, which may be billed. The limit resets at 15:45, in 2 hours and 10 minutes.">Using extra usage (may be billed)</span>`
    );
    expect(html).not.toContain('stop until');
    const allowed = bar({ status: 'allowed', resetsAt: TODAY_1545, kind: 'five_hour', usingOverage: true });
    expect(allowed).toContain('>Using extra usage (may be billed)</span>');
    expect(allowed).toContain('which may be billed. The limit resets at 15:45, in 2 hours and 10 minutes."');
  });

  it('names the weekly Sonnet limit as Claude Code does on the plan it is given', () => {
    const sonnet: RateLimitInfo = { status: 'rejected', resetsAt: TODAY_1545, kind: 'seven_day_sonnet' };
    expect(bar(sonnet, 'pro')).toContain(
      `title="Your Claude plan's weekly limit is used up, so reviews with Claude stop until it resets at 15:45, in 2 hours and 10 minutes.">Weekly limit reached, resets 15:45</span>`
    );
    expect(bar(sonnet, 'max')).toContain(
      `title="Your Claude plan's weekly Sonnet limit is used up, so reviews with Sonnet stop until it resets at 15:45, in 2 hours and 10 minutes.">Weekly Sonnet limit reached, resets 15:45</span>`
    );
  });

  it("never shows Claude Code's status and type names, which it used to", () => {
    for (const info of [
      { status: 'allowed_warning', kind: 'seven_day', utilization: 0.25, resetsAt: TODAY_1545 },
      { status: 'allowed_warning', kind: 'seven_day', utilization: 0.95, resetsAt: TODAY_1545 },
      { status: 'rejected', kind: 'seven_day_opus', resetsAt: TODAY_1545 }
    ]) {
      const html = bar(info);
      expect(html, JSON.stringify(info)).not.toMatch(/allowed_warning|seven_day|rejected|five_hour/);
    }
  });

  it('shows nothing under 80%, after the reset, or without a notice', () => {
    for (const info of [
      { status: 'allowed_warning', kind: 'seven_day', utilization: 0.25, resetsAt: TODAY_1545 },
      {
        status: 'allowed',
        kind: 'five_hour',
        utilization: 0.95,
        resetsAt: new Date(2026, 9, 22, 13, 0).toISOString()
      },
      null
    ]) {
      const html = bar(info);
      expect(html, JSON.stringify(info)).not.toContain('statusbar__warn');
      expect(html).not.toContain('status-usage');
    }
  });
});

describe("the Setup screen's usage-limit card (setup.9)", () => {
  const runtime: RuntimeStatus = {
    provider: 'claude',
    state: 'ready',
    credential: 'subscription',
    executablePath: '/home/ann/.local/bin/claude', // check-public: allow
    cliVersion: '2.1.302'
  };

  const setup = (rateLimit?: RateLimitInfo, planLimit = true, plan?: string): string =>
    decode(
      renderToStaticMarkup(
        createElement(SetupScreen, {
          runtime: plan ? { ...runtime, subscriptionType: plan } : runtime,
          lastFailure: { code: 'claude-usage-limit', planLimit },
          checking: false,
          os: 'linux',
          host: 'linux',
          onCheckAgain: () => undefined,
          onClose: () => undefined,
          ...(rateLimit ? { rateLimit } : {})
        })
      )
    );

  it('advises waiting, with Sonnet and Haiku to make the limits last', () => {
    const html = setup();
    expect(html).toContain(`<p>${USAGE_LIMIT_TEXT}</p><p>${WAIT_ADVICE}</p>`);
  });

  it('points at Sonnet and Haiku when the weekly Opus limit is the one reached', () => {
    const html = setup({ status: 'rejected', kind: 'seven_day_opus', resetsAt: TODAY_1545 });
    expect(html).toContain(`<p>${USAGE_LIMIT_TEXT}</p><p>${OTHER_MODELS_ADVICE.seven_day_opus}</p>`);
  });

  it('advises waiting for the weekly Sonnet limit on a Pro plan, where Claude Code calls it the weekly limit', () => {
    const sonnet: RateLimitInfo = { status: 'rejected', kind: 'seven_day_sonnet', resetsAt: TODAY_1545 };
    expect(setup(sonnet, true, 'pro')).toContain(`<p>${USAGE_LIMIT_TEXT}</p><p>${WAIT_ADVICE}</p>`);
    expect(setup(sonnet, true, 'max')).toContain(
      `<p>${USAGE_LIMIT_TEXT}</p><p>${OTHER_MODELS_ADVICE.seven_day_sonnet}</p>`
    );
  });

  it("gives no advice for a usage limit that is not one of the plan's, as the review's card gave none", () => {
    const html = setup({ status: 'rejected', kind: 'overage', resetsAt: TODAY_1545 }, false);
    expect(html).toContain(`<p>${OTHER_USAGE_LIMIT_TEXT}</p>`);
    expect(html).not.toContain(USAGE_LIMIT_TEXT);
    expect(html).not.toContain(WAIT_ADVICE);
  });
});
