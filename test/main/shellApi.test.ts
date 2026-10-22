import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDevSwitches } from '../../src/main/devSwitches';
import { openGuidelinesFile } from '../../src/main/openGuidelines';
import { SHELL_STUB_PREFIX, pickShell, recordingShell, type ShellApi } from '../../src/main/shellApi';

/* setup.10b: under `dev:clean --shell-stub` main opens nothing outside the
   app, so a verification run can press Open, Open folder and Show in folder
   in a test window without starting Obsidian, an editor or Explorer on the
   author's machine. What would have been opened is printed instead. */

const MAIN = path.join(__dirname, '../../src/main');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const source = (file: string): string => withoutComments(readFileSync(path.join(MAIN, file), 'utf8'));

describe('recordingShell', () => {
  it('opens nothing and writes one line per call', async () => {
    const lines: string[] = [];
    const shell = recordingShell((line) => lines.push(line));
    await shell.openExternal('https://example.com/help');
    expect(await shell.openPath('C:\\Vault\\GUIDELINES.md')).toBe('');
    shell.showItemInFolder('C:\\Vault\\GUIDELINES.md');
    expect(lines).toEqual([
      '[shell stub] openExternal https://example.com/help',
      '[shell stub] openPath C:\\Vault\\GUIDELINES.md',
      '[shell stub] showItemInFolder C:\\Vault\\GUIDELINES.md'
    ]);
    expect(lines.every((line) => line.startsWith(`${SHELL_STUB_PREFIX} `))).toBe(true);
  });

  it("stands in for Electron's shell only when the switch is on", async () => {
    const calls: string[] = [];
    const real: ShellApi = {
      openExternal: (url) => (calls.push(`real ${url}`), Promise.resolve()),
      openPath: (file) => (calls.push(`real ${file}`), Promise.resolve('')),
      showItemInFolder: (file) => void calls.push(`real ${file}`)
    };
    const lines: string[] = [];
    expect(pickShell(real, false, (line) => lines.push(line))).toBe(real);
    await openGuidelinesFile(
      'C:\\Vault\\GUIDELINES.md',
      pickShell(real, true, (l) => lines.push(l))
    );
    expect(calls).toEqual([]);
    expect(lines).toEqual(['[shell stub] openPath C:\\Vault\\GUIDELINES.md']);
  });

  it('is a development switch, which a packaged build ignores', () => {
    const env = { MANUSCRIPT_REVIEW_DEV_SHELL_STUB: '1' };
    expect(readDevSwitches({ env, packaged: false, isolatedUserData: null }).shellStub).toBe(true);
    const packaged = readDevSwitches({ env, packaged: true, isolatedUserData: null });
    expect(packaged.shellStub).toBe(false);
    expect(packaged.ignored).toEqual(['MANUSCRIPT_REVIEW_DEV_SHELL_STUB']);
  });
});

describe('where main hands things to the system', () => {
  it("goes through systemShell, never Electron's shell directly", () => {
    const ipc = source('ipc.ts');
    const index = source('index.ts');
    expect(ipc).toContain(
      'return pickShell(shell, getDevSwitches().shellStub, (line) => console.log(line));'
    );
    for (const text of [ipc, index]) {
      expect(text).not.toMatch(/\bshell\.(openExternal|openPath|showItemInFolder)\(/);
    }
    // guidelines:open is openGuidelines, tested in guidelines.test.ts, with the real shell or the stub.
    expect(ipc).toMatch(
      /handle\('guidelines:open', async \(\) =>\s*openGuidelines\(await loadSettings\(\), guidelinesTemplate\(\), systemShell\(\)\)\s*\);/
    );
    expect(ipc).toContain('const system = systemShell();');
    expect(index.match(/void systemShell\(\)\.openExternal\(/g)).toHaveLength(2);
    expect(index).not.toMatch(/import \{[^}]*\bshell\b[^}]*\} from 'electron'/);
    // Main says it is on as it starts, so a test run can wait for that before pressing anything.
    expect(index).toContain(
      'if (switches.shellStub) console.log(`${SHELL_STUB_PREFIX} on: nothing is opened outside the app`);'
    );
  });

  it('maps dev:clean --shell-stub to the switch', () => {
    const script = readFileSync(path.join(__dirname, '../../scripts/dev-clean.cjs'), 'utf8');
    expect(script).toMatch(/'--shell-stub'/);
    expect(script).toContain("env.MANUSCRIPT_REVIEW_DEV_SHELL_STUB = '1';");
  });
});
