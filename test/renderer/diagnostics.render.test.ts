import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiagnosticsDialog } from '../../src/renderer/components/DiagnosticsDialog';
import { DiagnosticsPanel } from '../../src/renderer/components/DiagnosticsPanel';
import { SetupScreen } from '../../src/renderer/components/SetupScreen';
import type { RuntimeStatus } from '../../src/shared/ipc';
import {
  COPY_DIAGNOSTICS,
  DIAGNOSTICS_INTRO,
  DIAGNOSTICS_LOADING,
  SETUP_DIAGNOSTICS_TEXT,
  diagnosticsCopyLine
} from '../../src/shared/ui/diagnostics';

/* hardening.5: the Diagnostics dialog and Setup's Copy diagnostics, rendered
   with react-dom/server. Effects do not run here, so the dialog shows the
   report still being gathered, and nothing is asked of main or the
   clipboard. Type-checked with the renderer's project (tsconfig.web.json). */

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const say = (text: string): string => escape(text).replace(/'/g, '&#x27;');

const REPORT =
  'Lapidary diagnostics\n\nApp\n  OpenAI package: 7.15.0\n  Claude Code: 2.1.302, found by name in a terminal\n';

function panel(patch: Partial<Parameters<typeof DiagnosticsPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(DiagnosticsPanel, {
      text: REPORT,
      error: null,
      copyState: 'idle',
      onCopy: () => undefined,
      onRetry: () => undefined,
      ...patch
    })
  );
}

describe('DiagnosticsPanel', () => {
  it('shows what it holds, a Copy, and the text exactly as it will be copied', () => {
    const html = panel();
    expect(html).toContain(say(DIAGNOSTICS_INTRO));
    expect(html).toMatch(new RegExp(`<button type="button" class="primary">${COPY_DIAGNOSTICS}</button>`));
    expect(html).toContain(
      `<pre class="diagnostics__text" tabindex="0" aria-label="Diagnostics text">${escape(REPORT)}</pre>`
    );
    // Nothing is said of a copy before one.
    expect(html).toContain('<span class="diagnostics__copied" role="status"></span>');
  });

  it('holds Copy, rather than disabling it, while the report is gathered', () => {
    const html = panel({ text: null });
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(DIAGNOSTICS_LOADING);
  });

  it('says how the copy went, a refusal in red with what to do instead', () => {
    expect(panel({ copyState: 'copied' })).toContain(
      `<span class="diagnostics__copied" role="status">${say(diagnosticsCopyLine('copied') ?? '')}</span>`
    );
    expect(panel({ copyState: 'failed' })).toContain(
      `<span class="diagnostics__copied diagnostics__copied--failed" role="status">${say(diagnosticsCopyLine('failed') ?? '')}</span>`
    );
    expect(diagnosticsCopyLine('idle')).toBeNull();
  });

  it("gives main's words and Try again when the report could not be made", () => {
    const html = panel({ text: null, error: 'Something went wrong.' });
    expect(html).toContain('Something went wrong.');
    expect(html).toContain('>Try again</button>');
    expect(html).not.toContain('<pre');
  });
});

describe('DiagnosticsDialog', () => {
  it('is a modal named Diagnostics, with the panel and Close', () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticsDialog, { copyOnOpen: true, onClose: () => undefined })
    );
    expect(html).toMatch(
      /^<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Diagnostics">/
    );
    expect(html).toContain('<div class="modal modal--diagnostics" tabindex="-1"><h2>Diagnostics</h2>');
    expect(html).toContain(DIAGNOSTICS_LOADING);
    expect(html).toContain('>Close</button>');
  });
});

describe("Setup's Copy diagnostics", () => {
  const runtime: RuntimeStatus = {
    provider: 'claude',
    state: 'missing-binary',
    message: 'Claude Code is not installed. Open Setup to install it, then check again.'
  };
  const setup = (onCopyDiagnostics?: () => void): string =>
    renderToStaticMarkup(
      createElement(SetupScreen, {
        runtime,
        lastFailure: null,
        checking: false,
        os: 'windows',
        host: 'windows',
        onCheckAgain: () => undefined,
        onClose: () => undefined,
        ...(onCopyDiagnostics ? { onCopyDiagnostics } : {})
      })
    );

  it('is a link-styled button that names what it does, just above the privacy footer', () => {
    const html = setup(() => undefined);
    const line = `<p class="setup__diagnostics"><button type="button" class="link" data-opens="diagnostics">${COPY_DIAGNOSTICS}</button> ${say(SETUP_DIAGNOSTICS_TEXT)}</p>`;
    expect(html).toContain(line);
    expect(html.indexOf(line)).toBeLessThan(html.indexOf('<p class="setup__footer">'));
    expect(SETUP_DIAGNOSTICS_TEXT).toMatch(/no chapter text, email address or key/);
  });

  it('is not drawn when the page gives no way to open the dialog', () => {
    expect(setup()).not.toContain('setup__diagnostics');
  });
});
