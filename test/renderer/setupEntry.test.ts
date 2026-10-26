import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* setup.7: how the page reaches the Setup screen and what it draws there.
   Source checks, as the tests run without a DOM: the pure rules are tested in
   test/shared/setup.test.ts, the screen itself in setupScreen.render.test.ts,
   and the window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
/* The Setup screen and the welcome guide share a layout (setup.11), Setup
   first: `singleScreen` is `setupOpen || welcomeOpen`. */
const SETUP = APP.slice(APP.indexOf('if (singleScreen) {'), APP.lastIndexOf('return ('));
const MAIN = APP.slice(APP.lastIndexOf('return ('));

describe('every layout has the cards, the dialogs and the question (setup.7)', () => {
  it('finds the Setup layout before the main one', () => {
    expect(SETUP).toContain('<SetupScreen');
    expect(MAIN).toContain('<ReviewPane');
    expect(APP.indexOf('if (singleScreen) {')).toBeGreaterThan(APP.indexOf('const inert = shellInert('));
  });

  for (const [name, layout] of [
    ['Setup', SETUP],
    ['main', MAIN]
  ] as const) {
    it(`${name}: cards with their buttons, Settings and the other dialogs, the question last but focus mode's hold`, () => {
      expect(layout).toContain('<NotificationCards onAction={onCardAction} />');
      expect(layout).toContain('<div className="app-shell__page" inert={inert.page}>');
      expect(layout).toMatch(
        // (each `{}` is a JSX comment with its text taken out; focus.1's overlay covers even the question)
        /<div className="app-shell__dialogs" inert=\{inert\.dialogs\}>\s*\{newChapterDialog\}\s*\{manualReviewDialog\}\s*\{reviewDialog\}\s*\{settingsDialog\}\s*\{diagnosticsDialog\}\s*\{aboutDialog\}\s*<\/div>\s*\{updateOverlay\}\s*(\{\s*\}\s*)?<ConfirmDialog \/>\s*(\{\s*\}\s*)?<FocusOverlay \/>\s*<\/div>\s*\);/
      );
      expect(layout).toMatch(
        /<StatusBar\s+review=\{review\}\s+\{\.\.\.statusRuntime\}\s+rateLimit=\{usageNotice\}\s+plan=\{claudeRuntime\?\.subscriptionType\}\s*\/>/
      );
    });
  }

  it('puts the cards at the top of the Setup column, before the screen, which scrolls across the whole width', () => {
    // Before it in the flow, so a card raised over Setup, such as the one a
    // failed review opens it with, is above its title and never covers Close
    // (setup.7 review: drawn after it, the cards sat at the foot).
    expect(SETUP).toMatch(
      /<div className="body body--single">\s*<NotificationCards onAction=\{onCardAction\} \/>\s*\{setupOpen && setupFor === 'chatgpt' \? \(\s*<ChatGptSetup[\s\S]*?\/>\s*\) : setupOpen \? \(\s*<SetupScreen\s/
    );
    const css = withoutComments(readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8'));
    const rule = (selector: string): string =>
      css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.>]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`))?.[1] ??
      '';
    expect(rule('.body--single > .notes')).not.toContain('order:');
    expect(rule('.body--single > .notes')).toContain('flex: none;');
    // The scroller is the full width under the cards; the page in it is the centred column.
    expect(rule('.setup')).toContain('overflow: auto;');
    expect(rule('.setup')).toContain('width: 100%;');
    expect(rule('.setup')).not.toContain('max-width');
    expect(rule('.setup__page')).toContain('max-width: 720px;');
    expect(rule('.setup__page')).toContain('margin: 0 auto;');
    expect(read('components/SetupScreen.tsx')).toMatch(
      /<div ref=\{pageRef\} className="setup" data-view=\{view\}>\s*<div className="setup__page">/
    );
  });

  it('shows Setup whenever it is open, the first check still running included', () => {
    expect(SETUP).toMatch(/<SetupScreen\s+runtime=\{claudeRuntime\}\s+lastFailure=\{ai\.lastFailure\}/);
    expect(APP).not.toContain('setupOpen && claudeRuntime');
  });

  it('offers "Try the review anyway" with a chapter open and nothing the check found in the way', () => {
    expect(SETUP).toContain(
      '{...(review?.sourcePath && canTryReviewAnyway(claudeRuntime, ai.lastFailure)\n                  ? { onTryAnyway: tryReviewAnyway }\n                  : {})}'
    );
    const tryAnyway = APP.slice(
      APP.indexOf('const tryReviewAnyway = '),
      APP.indexOf('const activeRuntime = ')
    );
    expect(tryAnyway).toMatch(/setSetupOpen\(false\);\s*openReviewDialog\(\);/);
  });
});

describe('gating and entry points (setup.7)', () => {
  it('opens Setup from Review with AI only when reviewGate says so', () => {
    const open = APP.slice(APP.indexOf('const openReviewFor = '), APP.indexOf('const startReview = '));
    expect(open).toMatch(
      /if \(provider === 'claude' && reviewGate\(claudeRuntime\) === 'setup'\) \{\s*openSetup\(\);\s*return;\s*\}/
    );
    expect(open).not.toContain("state !== 'ready'");
    // codex.3: the Review menu's item makes its provider the dialog's, and Setup's
    // Try the review anyway opens the dialog on the provider already chosen.
    expect(open).toContain('void chooseReviewProvider(provider, SETTINGS_WRITE_IO);');
    expect(open).toMatch(
      /const openReviewDialog = useCallback\(\s*\(\) => openReviewFor\(useApp\.getState\(\)\.settings\?\.provider \?\? 'claude'\),\s*\[openReviewFor\]\s*\);/
    );
    expect(APP).toContain('onReviewWith={openReviewFor}');
  });

  it("opens ChatGPT's view in place of the dialog only when no ChatGPT sign-in is kept (codex.3)", () => {
    const open = APP.slice(APP.indexOf('const openReviewFor = '), APP.indexOf('const startReview = '));
    // Before main has answered, the dialog opens, its account line saying "not read yet".
    expect(open).toMatch(
      /if \(provider === 'chatgpt' && chatgpt\.status !== null && !chatgpt\.status\.signedIn\) \{\s*openChatGptSetup\(\);\s*return;\s*\}/
    );
  });

  it('opens Setup from the card, the status bar, Settings and the dialog, and withdraws the launch card', () => {
    const showSetup = APP.slice(APP.indexOf('const showSetup = '), APP.indexOf('const openSetup = '));
    expect(showSetup).toContain("if (view === 'claude') dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);");
    // The store opens it, closing Review with AI and Settings (setup.19, test/renderer/setupLeave.test.ts).
    expect(showSetup).toContain('openSetupScreen(view, from);');
    expect(APP).toContain(
      "const openSetup = useCallback(() => showSetup('claude', 'elsewhere'), [showSetup]);"
    );
    expect(APP).toMatch(/case 'open-setup':\s*openSetup\(\);/);
    // codex.3: ChatGPT's label opens its own view; since codex.6 no label opens Settings.
    expect(APP).toMatch(/onRuntime:\s*activeProvider === 'chatgpt'\s*\?\s*openChatGptSetup\s*:\s*openSetup,/);
    expect(APP).toContain('runtimeTitle: RUNTIME_BUTTON_TITLE');
    expect(APP).not.toContain('openSettings');
    // Settings' Setup; the dialog's Open Setup goes back to the dialog (setup.19).
    expect(APP.match(/onOpenSetup=\{openSetup\}/g)).toHaveLength(1);
    expect(APP.match(/onOpenSetup=\{openSetupFromDialog\}/g)).toHaveLength(1);
  });

  it("opens the ChatGPT view from Settings' ChatGPT account row, leaving Claude's launch card (codex.2)", () => {
    const showSetup = APP.slice(APP.indexOf('const showSetup = '), APP.indexOf('const openSetup = '));
    // The launch card goes for Claude's view only.
    expect(showSetup).toContain("if (view === 'claude') dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);");
    expect(showSetup.match(/CLAUDE_RUNTIME_CARD/g)).toHaveLength(1);
    expect(APP).toContain(
      "const openChatGptSetup = useCallback(() => showSetup('chatgpt', 'elsewhere'), [showSetup]);"
    );
    // Settings' row; since codex.3, Review with AI's account row, which goes back to
    // the dialog (setup.19); and the welcome guide's step, which goes back to the guide.
    expect(APP.match(/onOpenChatGptSetup=\{openChatGptSetup\}/g)).toHaveLength(1);
    expect(APP.match(/onOpenChatGptSetup=\{openChatGptSetupFromDialog\}/g)).toHaveLength(1);
    expect(APP.match(/onSetUpChatGpt=\{openChatGptSetupFromWelcome\}/g)).toHaveLength(1);
    expect(SETUP).toMatch(
      /<ChatGptSetup\s+status=\{chatgpt\.status\}\s+waiting=\{chatgpt\.waiting\}\s+busy=\{chatgpt\.busy\}\s+outcome=\{chatgpt\.outcome\}/
    );
    // Done, Close and Escape leave for where Setup was opened from (setup.19).
    expect(SETUP.match(/onClose=\{leaveSetup\}/g)).toHaveLength(2);
    expect(SETUP).not.toContain('onClose={() => setSetupOpen(false)}');
  });

  it('raises the launch card under its key with Open Setup, and withdraws it by the key', () => {
    const card = APP.slice(
      APP.indexOf('const runtimeCardPastLaunch = '),
      APP.indexOf('const { recheckOnFocus } = ai;')
    );
    expect(card).toContain('const runtimeCardPastLaunch = useRef(false);');
    expect(card).toContain('const card = runtimeCard(claudeView, claudeRuntime);');
    expect(card).toContain(
      'const showing = useApp.getState().notifications.some((n) => n.key === CLAUDE_RUNTIME_CARD);'
    );
    // What to do comes from runtimeCardAction (test/shared/setup.test.ts). Only
    // the first check may raise it, so the run is marked past launch after
    // every check that reaches the decision (setup.7 review): without that, a
    // card closed with its X came back on the next check.
    expect(card).toMatch(
      /const action = runtimeCardAction\(\{\s*card,\s*showing,\s*pastLaunch: runtimeCardPastLaunch\.current,\s*provider: activeProvider,\s*setupOpen: claudeSetupOpen,\s*welcomeOpen\s*\}\);\s*runtimeCardPastLaunch\.current = true;/
    );
    expect(card).toMatch(
      /if \(action === 'withdraw'\) \{\s*dismissNotificationsByKey\(CLAUDE_RUNTIME_CARD\);\s*\} else if \(card && \(action === 'raise' \|\| action === 'update'\)\) \{\s*upsertNotification\(CLAUDE_RUNTIME_CARD, card\.tone, card\.text, 'open-setup'\);/
    );
    // A switch to ChatGPT, and Setup or the welcome guide opening, run the decision again.
    expect(card).toMatch(
      /\}, \[\s*claudeRuntime,\s*claudeView,\s*settingsLoaded,\s*activeProvider,\s*claudeSetupOpen,\s*welcomeOpen,\s*upsertNotification,\s*dismissNotificationsByKey\s*\]\);/
    );
  });

  it('checks again as the window comes back to the front, through focusRecheckDue', () => {
    expect(APP).toMatch(
      /const onFocus = \(\): void => recheckOnFocus\(claudeInUse, claudeView\);\s*window\.addEventListener\('focus', onFocus\);\s*return \(\) => window\.removeEventListener\('focus', onFocus\);/
    );
    expect(APP).toContain("const claudeSetupOpen = setupOpen && setupFor === 'claude';");
    expect(APP).toContain("const claudeInUse = activeProvider === 'claude' || claudeSetupOpen;");
    const ai = read('state/useAi.ts');
    const recheck = ai.slice(
      ai.indexOf('const recheckOnFocus = '),
      ai.indexOf('const chatGptAccountChanged = ')
    );
    expect(recheck).toContain('inFlight: claudeChecking.current > 0,');
    expect(recheck).toContain('lastCheckAt: claudeCheckAt.current,');
    expect(recheck).toContain("if (due) check('claude');");
    // Every check of Claude counts, the one at launch included.
    expect(ai.match(/claudeCheckAt\.current = Date\.now\(\);/g)).toHaveLength(2);
    expect(ai.match(/claudeChecking\.current \+= 1;/g)).toHaveLength(2);
    expect(ai.match(/claudeChecking\.current -= 1;/g)).toHaveLength(2);
  });

  it('tells the review dialog the last failure, for its warning, and how to open Setup', () => {
    expect(APP).toMatch(/claudeLastFailure=\{ai\.lastFailure\}\s*onOpenSetup=\{openSetupFromDialog\}/);
    const dialog = read('components/ReviewDialog.tsx');
    // Claude's alone since codex.3: ChatGPT has none.
    expect(dialog).toContain("const isClaude = provider === 'claude';");
    expect(dialog).toContain(
      'const claudeWarning = isClaude ? reviewDialogWarning(runtime, claudeLastFailure) : null;'
    );
  });
});

describe('Copy says when it fails (setup.7)', () => {
  const command = read('components/Command.tsx');

  it('reports a refused copy on the button and in a line of its own', () => {
    expect(command).toContain(".catch(() => setState('failed'));");
    expect(command).toContain("state === 'failed' ? 'Copy failed'");
    expect(command).toMatch(/<span className="cmd__failed" role="alert">\s*\{COPY_FAILED_TEXT\}\s*<\/span>/);
    expect(command).not.toContain('.catch(() => undefined)');
  });

  it('lets a click select the whole command for copying by hand', () => {
    const css = withoutComments(readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8'));
    expect(css).toMatch(/\.cmd code \{[^}]*user-select: all;/);
  });
});

describe('Test the connection, from the button to main and back (setup.8)', () => {
  it('gives the Setup screen the test, whether one is running and how the last went', () => {
    expect(SETUP).toMatch(
      /onTest=\{testClaude\}\s*testing=\{ai\.testing\.claude \?\? false\}\s*testOutcome=\{ai\.testOutcomes\.claude \?\? null\}\s*(rateLimit=\{ai\.rateLimit\}\s*)?(onCopyDiagnostics=\{\(\) => setDiagnosticsOpen\('copy'\)\}\s*)?(version=\{updateStatus\?\.current \?\? null\}\s*)?\/>/
    );
    const test = APP.slice(APP.indexOf('const testClaude = '), APP.indexOf('const refuseWhileEditing = '));
    expect(test).toContain("void testConnection('claude').then((result) => {");
    // A failure Setup can fix checks again, as a review's does (setup.5).
    expect(test).toContain(
      "if (result?.error && SETUP_FAILURES.has(result.error.code)) checkRuntime('claude');"
    );
    expect(APP).toContain('const { testConnection, check: checkRuntime } = ai;');
  });

  it('asks main once at a time, and moves the last failure through testSetupEvent', () => {
    const ai = read('state/useAi.ts');
    const test = ai.slice(ai.indexOf('const testConnection = '), ai.indexOf('const cancel = '));
    expect(test).toContain('if (testsRunning.current.has(provider)) return null;');
    expect(test).toContain("result = await call('ai:test', { provider });");
    expect(test).toMatch(
      /if \(result\.rateLimit\) \{\s*rateLimitNow\.current = result\.rateLimit;\s*setRateLimit\(result\.rateLimit\);\s*\}/
    );
    expect(test).toMatch(
      /if \(provider === 'claude'\) \{\s*const event = testSetupEvent\(result, claudeRuntime\.current\);\s*if \(event\) setLastFailure\(\(prev\) => nextLastFailure\(prev, event\)\);\s*\}/
    );
    expect(test).toContain('finishedAt: new Date().toISOString()');
  });

  it('is answered in main by testConnection, with its controller tracked so quitting ends it', () => {
    const main = withoutComments(readFileSync(path.join(RENDERER, '../main/ipc.ts'), 'utf8'));
    // Main's last failure moves with the answer the page gets (hardening.3b review).
    expect(main).toContain(
      "handle('ai:test', async ({ provider }) => {\n    const result = await testConnection(providers().get(provider), { track: registerController });\n    noteTest(provider, result);"
    );
    const claude = withoutComments(readFileSync(path.join(RENDERER, '../main/providers/claude.ts'), 'utf8'));
    // The same Claude Code, flags, environment and folder as a review (CLAUDE.md rule 6).
    expect(claude).toContain('return runCliTest(cliDeps(executableCache), hooks);');
    expect(claude).toMatch(/review: reviewChapter,\s*test: testClaude\s*\};/);
  });

  it('holds Check again and Test the connection through heldButton, never disabled, so they keep the focus', () => {
    // setup.8 review: a disabled button loses the focus in Chromium; heldButton
    // marks it aria-disabled and drops its click handler instead.
    const screen = read('components/SetupScreen.tsx');
    const actions = screen.slice(
      screen.indexOf('<div className="setup__status-actions">'),
      screen.indexOf('{onTryAnyway ? (')
    );
    expect(actions).toContain('{...heldButton(checkBusy, onCheckAgain)}');
    expect(actions).toContain('<button type="button" {...heldButton(testing, onTest)}>');
    expect(actions).not.toMatch(/disabled=|onClick=/);
    expect(screen).toContain("const checkBusy = checking || view === 'checking';");
    // Drawn as a disabled button, and not lit up under the mouse.
    const css = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(
      /button:disabled,\s*button\[aria-disabled='true'\] \{\s*opacity: 0\.45;\s*cursor: default;\s*\}/
    );
    expect(css).toContain("button:hover:not(:disabled, [aria-disabled='true']) {");
    expect(css).toContain("button.primary:hover:not(:disabled, [aria-disabled='true']),");
    expect(css).toContain("button.primary:active:not(:disabled, [aria-disabled='true']),");
  });
});

describe("Claude's usage on the page (setup.9)", () => {
  it('words the notice in the status bar while Claude is in use, and gives Setup the notice too', () => {
    // The ChatGPT plan's notice in its place while ChatGPT is in use (codex.3).
    expect(APP).toContain(
      'const usageNotice = chatGptInUse ? ai.chatGptRateLimit : claudeInUse ? ai.rateLimit : null;'
    );
    expect(APP).toContain("const claudeSetupOpen = setupOpen && setupFor === 'claude';");
    expect(APP).toContain("const claudeInUse = activeProvider === 'claude' || claudeSetupOpen;");
    expect(APP).toContain("const chatGptSetupOpen = setupOpen && setupFor === 'chatgpt';");
    expect(APP).toContain(
      "const chatGptInUse = chatGptSetupOpen || (activeProvider === 'chatgpt' && !claudeSetupOpen);"
    );
    expect(SETUP).toMatch(
      /testOutcome=\{ai\.testOutcomes\.claude \?\? null\}\s*rateLimit=\{ai\.rateLimit\}\s*(onCopyDiagnostics=\{\(\) => setDiagnosticsOpen\('copy'\)\}\s*)?(version=\{updateStatus\?\.current \?\? null\}\s*)?\/>/
    );
    const bar = read('components/StatusBar.tsx');
    // With the plan, on which the weekly Sonnet limit's name depends (setup.9 review).
    expect(bar).toContain('{rateLimit ? <UsageNotice info={rateLimit} plan={plan} /> : null}');
    expect(bar).toContain('const text = describeRateLimit(info, now, plan);');
    expect(bar).toContain('title={rateLimitTitle(info, now, plan) ?? undefined}');
    // Worded again while it shows, so the time left keeps up and it goes at the reset.
    expect(bar).toMatch(
      /useEffect\(\(\) => \{\s*if \(!showing\) return;\s*const timer = window\.setInterval\(\(\) => setTick\(\(n\) => n \+ 1\), USAGE_NOTICE_TICK_MS\);\s*return \(\) => window\.clearInterval\(timer\);\s*\}, \[showing\]\);/
    );
    expect(bar).toContain('const USAGE_NOTICE_TICK_MS = 30_000;');
    const screen = read('components/SetupScreen.tsx');
    expect(screen).toContain('const status = setupStatus(view, runtime, lastFailure, rateLimit);');
  });

  it("puts up the usage-limit card with Claude Code's words and the advice, from the notice as it arrived", () => {
    const start = APP.slice(
      APP.indexOf('const startReview = '),
      APP.indexOf('const reviewDialogStillOpen = ')
    );
    expect(start).toMatch(
      /if \(err instanceof ApiError && err\.code === 'claude-usage-limit'\) \{\s*notify\(\s*'error',\s*usageLimitCard\(err\.message, ai\.latestRateLimit\(\), ai\.runtimes\.claude\?\.subscriptionType\)\s*\);\s*return;\s*\}/
    );
    // Every notice is kept at once beside the state, for that card: the broadcast,
    // a review's answer and a test's.
    const ai = read('state/useAi.ts');
    // The failure is recorded with the card's decision, from the same notice, read at once,
    // so Setup says what the card said (setup.9 review).
    const failed = ai.slice(ai.indexOf('} catch (err) {', ai.indexOf('const runReview = ')));
    expect(failed).toMatch(
      /const event = failureSetupEvent\(err\.code, err\.message, rateLimitNow\.current, claudeRuntime\.current\);\s*setLastFailure\(\(prev\) => nextLastFailure\(prev, event\)\);/
    );
    expect(ai.match(/type: 'failure'/g)).toBeNull();
    // A ChatGPT plan's notice is kept apart, never as Claude's (codex.3).
    expect(ai).toMatch(
      /window\.api\.on\('ai:rate-limit', \(info\) => \{\s*if \(info\.provider === 'chatgpt'\) \{\s*chatGptRateLimitNow\.current = info;\s*setChatGptRateLimit\(info\);\s*return;\s*\}\s*rateLimitNow\.current = info;\s*setRateLimit\(info\);\s*\}\);/
    );
    expect(ai).toMatch(
      /if \(response\.rateLimit\?\.provider === 'chatgpt'\) \{\s*chatGptRateLimitNow\.current = response\.rateLimit;\s*setChatGptRateLimit\(response\.rateLimit\);\s*\} else if \(response\.rateLimit\) \{\s*rateLimitNow\.current = response\.rateLimit;\s*setRateLimit\(response\.rateLimit\);\s*\}/
    );
    expect(ai).toContain('const latestRateLimit = useCallback(() => rateLimitNow.current, []);');
    expect(ai.match(/setRateLimit\(/g)).toHaveLength(3);
    expect(ai.match(/rateLimitNow\.current = /g)).toHaveLength(3);
    expect(ai.match(/chatGptRateLimitNow\.current = /g)).toHaveLength(2);
  });
});

describe('Copy diagnostics, from Setup and from a card (hardening.5)', () => {
  it("gives Setup the link, which opens Diagnostics to copy, and a card's Show diagnostics to show", () => {
    expect(SETUP).toContain("onCopyDiagnostics={() => setDiagnosticsOpen('copy')}");
    const cards = APP.slice(APP.indexOf('const onCardAction = '), APP.indexOf('const statusRuntime = '));
    expect(cards).toMatch(/case 'show-diagnostics':\s*setDiagnosticsOpen\('show'\);\s*break;/);
  });

  it('draws the dialog only while it is open, copying at once only for the link, and closes it', () => {
    expect(APP).toContain('const diagnosticsOpen = useApp((s) => s.diagnosticsOpen);');
    expect(APP).toMatch(
      /const diagnosticsDialog = diagnosticsOpen \? \(\s*<DiagnosticsDialog copyOnOpen=\{diagnosticsOpen === 'copy'\} onClose=\{\(\) => setDiagnosticsOpen\(null\)\} \/>\s*\) : null;/
    );
  });

  it('asks main once as it opens, copies the report it got, and only once on its own', () => {
    const dialog = read('components/DiagnosticsDialog.tsx');
    // The report's request and copy moved to a hook with hardening.4, which the crash page shares.
    const report = read('state/diagnosticsReport.ts');
    expect(dialog).toContain('const report = useDiagnosticsReport(copyOnOpen);');
    expect(report).toContain("call('app:diagnostics', undefined)");
    // Only the latest answer counts, so what is shown is what was copied (StrictMode asks twice).
    expect(report).toMatch(
      /useEffect\(\(\) => \{\s*fetchReport\(\);\s*return \(\) => \{\s*latest\.current \+= 1;/
    );
    expect(report).toMatch(/if \(request === latest\.current\) setText\(report\.text\);/);
    expect(report).toMatch(
      /if \(!copyOnOpen \|\| text === null \|\| copiedOnOpen\.current\) return;\s*copiedOnOpen\.current = true;\s*copyText\(text\);/
    );
    expect(report).toContain('navigator.clipboard.writeText(report)');
    expect(dialog).toContain('useDialogEscape(boxRef, onClose);');
    expect(dialog).toContain('useDialogFocus(boxRef, DIAGNOSTICS_LINK_SELECTOR, copyRef);');
  });
});
