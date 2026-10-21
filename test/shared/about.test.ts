import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_REPOSITORY } from '../../src/shared/branding';
import type { AppInfo, RuntimeStatus } from '../../src/shared/ipc';
import {
  ABOUT_BUTTON,
  ABOUT_TITLE,
  NOTICES_BUTTON,
  aboutVersionLine,
  claudeCodeLine,
  componentLines,
  setupFooterText,
  whatsNewUrl
} from '../../src/shared/ui/about';

/* release.9: what the About dialog says about the app and what it runs on,
   and the Setup screen's last line. */

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

const INFO: AppInfo = {
  name: APP_NAME,
  version: '1.0.0',
  packaged: true,
  electron: '44.3.0',
  chromium: '142.0.7444.59',
  node: '24.11.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.26300',
  openai: '6.3.0',
  claudeCode: { state: 'found', version: '2.1.302', onPath: true },
  claudeCodeMin: '2.1.266'
};

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return { provider: 'claude', state: 'ready', executablePath: PATH, cliVersion: '2.1.302', ...patch };
}

describe('the version line', () => {
  it('names the version, says so of a development run, and waits for app:info', () => {
    expect(aboutVersionLine(INFO)).toBe('Version 1.0.0');
    expect(aboutVersionLine({ ...INFO, packaged: false, version: '0.1.0' })).toBe(
      'Version 0.1.0, a development run'
    );
    expect(aboutVersionLine(null)).toBe('Version …');
  });
});

describe('the Claude Code line', () => {
  it("gives the version and the path from Claude's live status", () => {
    expect(claudeCodeLine(claude(), INFO.claudeCode)).toBe(`Claude Code 2.1.302, installed at ${PATH}`);
    // A check that failed still knows which Claude Code it found.
    expect(claudeCodeLine(claude({ state: 'error', cliVersion: '2.1.290' }), null)).toBe(
      `Claude Code 2.1.290, installed at ${PATH}`
    );
    expect(claudeCodeLine(claude({ state: 'not-signed-in' }), null)).toBe(
      `Claude Code 2.1.302, installed at ${PATH}`
    );
  });

  it('says when it is not installed, whatever the last lookup said', () => {
    expect(claudeCodeLine({ provider: 'claude', state: 'missing-binary' }, INFO.claudeCode)).toBe(
      'Claude Code: not installed'
    );
    expect(claudeCodeLine(null, { state: 'not-installed' })).toBe('Claude Code: not installed');
  });

  it('says when the version could not be read', () => {
    expect(claudeCodeLine(claude({ cliVersion: undefined }), null)).toBe(
      `Claude Code, version not known, installed at ${PATH}`
    );
    expect(claudeCodeLine(null, { state: 'found', version: null, onPath: false })).toBe(
      'Claude Code, version not known'
    );
  });

  it('falls back on the last lookup before the first check has answered, and says when there was none', () => {
    expect(claudeCodeLine(null, INFO.claudeCode)).toBe('Claude Code 2.1.302');
    expect(claudeCodeLine(null, { state: 'not-checked' })).toBe('Claude Code: not checked yet');
    expect(claudeCodeLine(null, null)).toBe('Claude Code: not checked yet');
    // A status that knows nothing of the binary yet, and OpenAI's, are not Claude Code's word.
    expect(claudeCodeLine({ provider: 'claude', state: 'error' }, INFO.claudeCode)).toBe(
      'Claude Code 2.1.302'
    );
    expect(claudeCodeLine({ provider: 'openai', state: 'ready' }, { state: 'not-installed' })).toBe(
      'Claude Code: not installed'
    );
  });
});

describe('the versions it runs on', () => {
  it('lists Electron, Chromium, Node.js, the OpenAI library and Claude Code, a line each', () => {
    expect(componentLines(INFO, claude())).toEqual([
      'Electron 44.3.0',
      'Chromium 142.0.7444.59',
      'Node.js 24.11.0',
      'OpenAI library 6.3.0',
      `Claude Code 2.1.302, installed at ${PATH}`
    ]);
    expect(componentLines({ ...INFO, openai: null }, null)).toContain('OpenAI library not found');
  });

  it('lists nothing until app:info has answered', () => {
    expect(componentLines(null, claude())).toEqual([]);
  });
});

describe('links and labels', () => {
  it("opens What's new on the release page of the version running", () => {
    expect(whatsNewUrl('1.0.0')).toBe(`https://github.com/${APP_REPOSITORY}/releases/tag/v1.0.0`);
    expect(whatsNewUrl('v1.0.1')).toBe(`https://github.com/${APP_REPOSITORY}/releases/tag/v1.0.1`);
  });

  it('names the dialog after the app, and spells licences the British way', () => {
    expect(ABOUT_TITLE).toBe(`About ${APP_NAME}`);
    expect(ABOUT_BUTTON).toBe('About');
    expect(NOTICES_BUTTON).toBe('Licences and notices');
  });

  it("ends the Setup screen with the app's name and version", () => {
    expect(setupFooterText('1.0.0')).toBe(`${APP_NAME} 1.0.0`);
  });
});
