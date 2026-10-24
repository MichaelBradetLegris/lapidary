import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* codex.3: how the page wires ChatGPT's reviews in. Source checks, as the
   tests run without a DOM: what it shows is decided by the pure functions in
   src/shared/ui/chatgpt.ts (test/shared/chatgptReviews.test.ts), and what the
   dialog and the view draw is in chatgptReview.render.test.ts. The window
   checks are in PLAN. */

describe('how the page wires ChatGPT in (codex.3)', () => {
  const RENDERER = path.join(__dirname, '../../src/renderer');
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));
  const APP = read('App.tsx');

  it('opens the ChatGPT view, with the words under its buttons and no card, for a sign-in that is not there and for the box', () => {
    const start = APP.slice(
      APP.indexOf('const startReview = '),
      APP.indexOf('const reviewDialogStillOpen = ')
    );
    expect(start).toMatch(
      /if \(err instanceof ApiError && settings\.provider === 'chatgpt'\) \{\s*const route = chatGptFailureRoute\(err\.code\);\s*if \(route === 'setup'\) \{\s*chatgpt\.refresh\(\);\s*chatgpt\.say\(\{ tone: 'warn', text: err\.message \}\);\s*openChatGptSetup\(\);\s*return;\s*\}/
    );
    // Before Claude's routes and the failed review's card.
    expect(start.indexOf("settings.provider === 'chatgpt'")).toBeLessThan(
      start.indexOf('SETUP_FAILURES.has(')
    );
    expect(start.indexOf("settings.provider === 'chatgpt'")).toBeLessThan(start.indexOf('fail(err);'));
  });

  it("puts up the usage limit's card with Manage usage, with the notice as it arrived", () => {
    expect(APP).toMatch(
      /if \(route === 'usage-card'\) \{\s*notify\(\s*'error',\s*chatGptUsageLimitCard\(err\.message, ai\.latestChatGptRateLimit\(\), new Date\(\)\),\s*'chatgpt-usage',\s*'chatgpt-usage'\s*\);\s*return;\s*\}/
    );
    expect(APP).toMatch(
      /case 'chatgpt-usage':\s*void call\('shell:open-external', \{ page: 'chatgpt-usage' \}\)\.catch\(fail\);\s*break;/
    );
  });

  it('keeps the sign-in and its runtime together, and gives the view its welcome until Got it', () => {
    expect(APP).toMatch(
      /if \(!chatGptSeen\.current\) \{\s*chatGptSeen\.current = true;\s*return;\s*\}\s*chatGptAccountChanged\(\);\s*\}, \[chatGptSignedIn, chatGptPlan, chatGptAccountChanged\]\);/
    );
    expect(APP).toMatch(
      /if \(chatGptRuntimeState === 'not-signed-in'\) refreshChatGpt\(\);\s*\}, \[chatGptRuntimeState, refreshChatGpt\]\);/
    );
    expect(APP).toContain('welcome={planWelcomeShown(chatgpt.status, settings?.dismissedHints)}');
    expect(APP).toContain('onWelcomeDone={() => void dismissHint(PLAN_WELCOME_HINT, HINT_IO)}');
  });

  it("keeps the dialog's warning once the box is ticked in it, so the box keeps its place and its focus", () => {
    const dialog = read('components/ReviewDialog.tsx');
    expect(dialog).toContain('const showTrainingWarning = isChatGpt && (needsBox || tickedHere);');
    expect(dialog).toMatch(
      /const confirmDataSettings = \(confirmed: boolean\): void => \{\s*setTickedHere\(true\);\s*onConfirmDataSettings\?\.\(confirmed\);\s*\};/
    );
    expect(dialog).toContain('onConfirm={confirmDataSettings}');
  });
});

describe("the ChatGPT view's welcome (codex.3)", () => {
  it('hands the focus back to the account button when Got it takes the welcome away', () => {
    const view = readFileSync(path.join(__dirname, '../../src/renderer/components/ChatGptSetup.tsx'), 'utf8');
    expect(view).toMatch(
      /const hadWelcome = useRef\(welcome\);\s*useEffect\(\(\) => \{\s*if \(hadWelcome\.current && !welcome && document\.activeElement === document\.body\) \{\s*accountButton\.current\?\.focus\(\);\s*\}\s*hadWelcome\.current = welcome;\s*\}, \[welcome\]\);/
    );
  });
});
