import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICES_FILE, noticesPath, openNotices } from '../../src/main/notices';
import type { ShellApi } from '../../src/main/shellApi';
import { AppFailure } from '../../src/main/errors';

/* release.9: About's Licences and notices opens THIRD_PARTY_NOTICES.txt
   (opensource.5) with the shell's openPath, beside the asar once installed and
   in out/ in a development run. */

const RESOURCES = 'C:\\Program Files\\App\\resources'; // check-public: allow
const PROJECT = 'C:\\dev\\app'; // check-public: allow

function shellLog(openProblem = ''): { shell: ShellApi; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shell: {
      openExternal: (url) => {
        calls.push(`openExternal ${url}`);
        return Promise.resolve();
      },
      openPath: (file) => {
        calls.push(`openPath ${file}`);
        return Promise.resolve(openProblem);
      },
      showItemInFolder: (file) => {
        calls.push(`showItemInFolder ${file}`);
      }
    }
  };
}

describe('noticesPath', () => {
  it('finds the notices beside the asar once installed, and in out/ in a development run', () => {
    expect(noticesPath({ packaged: true, resourcesPath: RESOURCES, appPath: PROJECT })).toBe(
      path.join(RESOURCES, 'THIRD_PARTY_NOTICES.txt')
    );
    expect(noticesPath({ packaged: false, resourcesPath: RESOURCES, appPath: PROJECT })).toBe(
      path.join(PROJECT, 'out', 'THIRD_PARTY_NOTICES.txt')
    );
  });

  it('uses the name electron-builder copies them under, and the notices script writes', () => {
    const require = createRequire(import.meta.url);
    const config = require('../../electron-builder.config.cjs') as {
      extraResources: { from: string; to: string }[];
    };
    expect(config.extraResources).toContainEqual({ from: `out/${NOTICES_FILE}`, to: NOTICES_FILE });
    const script = readFileSync(path.join(__dirname, '../../scripts/third-party-notices.ts'), 'utf8');
    expect(script).toContain(`'${NOTICES_FILE}'`);
  });
});

describe('openNotices', () => {
  it("opens the file in the system's app for .txt files", async () => {
    const { shell, calls } = shellLog();
    const file = path.join(RESOURCES, NOTICES_FILE);
    const answer = await openNotices({
      packaged: true,
      resourcesPath: RESOURCES,
      appPath: PROJECT,
      exists: (f) => f === file,
      shell
    });
    expect(answer).toEqual({ path: file });
    expect(calls).toEqual([`openPath ${file}`]);
  });

  it('shows it in its folder when no app opens .txt files', async () => {
    const { shell, calls } = shellLog('There is no application associated with the file.');
    const file = path.join(PROJECT, 'out', NOTICES_FILE);
    await openNotices({
      packaged: false,
      resourcesPath: RESOURCES,
      appPath: PROJECT,
      exists: () => true,
      shell
    });
    expect(calls).toEqual([`openPath ${file}`, `showItemInFolder ${file}`]);
  });

  it('says how to get a missing file back, and opens nothing', async () => {
    const { shell, calls } = shellLog();
    const installed = openNotices({
      packaged: true,
      resourcesPath: RESOURCES,
      appPath: PROJECT,
      exists: () => false,
      shell
    });
    await expect(installed).rejects.toBeInstanceOf(AppFailure);
    await expect(installed).rejects.toMatchObject({
      code: 'not-found',
      message: expect.stringContaining('is missing from') as unknown
    });
    await expect(
      openNotices({ packaged: false, resourcesPath: RESOURCES, appPath: PROJECT, exists: () => false, shell })
    ).rejects.toThrow('npm run notices');
    expect(calls).toEqual([]);
  });
});

describe('the app:open-notices handler', () => {
  const ipc = readFileSync(path.join(__dirname, '../../src/main/ipc.ts'), 'utf8');

  it("goes through systemShell, so --shell-stub opens nothing, with the app's facts", () => {
    expect(ipc).toMatch(
      /handle\('app:open-notices', \(\) =>\s*openNotices\(\{\s*packaged: app\.isPackaged,\s*resourcesPath: process\.resourcesPath,\s*appPath: app\.getAppPath\(\),\s*exists: existsSync,\s*shell: systemShell\(\)\s*\}\)\s*\);/
    );
  });

  it("opens the data folder itself for About's Open data folder, and the log folder with main.log selected", () => {
    expect(ipc).toMatch(
      /if \(target === 'data'\) \{\s*const folder = await userDataTarget\('data'\);\s*const problem = await system\.openPath\(folder\);\s*if \(problem\) system\.showItemInFolder\(folder\);\s*return \{ path: folder \};\s*\}/
    );
    expect(ipc).toMatch(/if \(target === 'logs'\) \{\s*const log = path\.join\(folder, 'main\.log'\);/);
  });
});
