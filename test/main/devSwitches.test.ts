import { describe, expect, it } from 'vitest';
import {
  DEV_SWITCH_NAMES,
  NO_DEV_SWITCHES,
  getDevSwitches,
  httpUrl,
  readDevSwitches,
  setDevSwitches
} from '../../src/main/devSwitches';

/* hardening.1: development switches are honoured only by development builds. */

const EVERY_SWITCH = {
  MANUSCRIPT_REVIEW_USER_DATA: 'C:/scratch/userdata',
  MANUSCRIPT_REVIEW_OPENAI_BASE_URL: 'http://127.0.0.1:4599/v1',
  MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE: '1',
  MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE: '1.0.1',
  MREV_VERBOSE: '1'
};

describe('readDevSwitches in a development build', () => {
  it('honours every switch', () => {
    expect(readDevSwitches({ env: EVERY_SWITCH, packaged: false, isolatedUserData: null })).toEqual({
      packaged: false,
      userDataDir: 'C:/scratch/userdata',
      openAiBaseUrl: 'http://127.0.0.1:4599/v1',
      noClaudeCode: true,
      fakeUpdate: '1.0.1',
      verbose: true,
      ignored: []
    });
  });

  it('turns everything off when nothing is set', () => {
    expect(readDevSwitches({ env: {}, packaged: false, isolatedUserData: null })).toEqual({
      ...NO_DEV_SWITCHES,
      packaged: false
    });
  });

  it('lets the command-line flag win over the variable', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: false, isolatedUserData: 'D:/flag' });
    expect(s.userDataDir).toBe('D:/flag');
  });

  it('reads "0", "false", "no" and "off" as off, and blank values as unset', () => {
    for (const off of ['0', 'false', 'No', 'OFF', '', '   ']) {
      const s = readDevSwitches({ env: { MREV_VERBOSE: off }, packaged: false, isolatedUserData: null });
      expect(s.verbose).toBe(false);
    }
    const blank = readDevSwitches({
      env: { MANUSCRIPT_REVIEW_USER_DATA: '  ', MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE: '' },
      packaged: false,
      isolatedUserData: '  '
    });
    expect(blank.userDataDir).toBeNull();
    expect(blank.fakeUpdate).toBeNull();
  });
});

describe('readDevSwitches in a packaged build', () => {
  it('ignores every variable and names the ones it saw', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: true, isolatedUserData: null });
    expect(s).toEqual({ ...NO_DEV_SWITCHES, packaged: true, ignored: [...DEV_SWITCH_NAMES] });
  });

  it('still honours --isolated-user-data', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: true, isolatedUserData: 'C:/test-run' });
    expect(s.userDataDir).toBe('C:/test-run');
    expect(s.openAiBaseUrl).toBeNull();
  });

  it('does not list a variable that is set but blank', () => {
    const s = readDevSwitches({ env: { MREV_VERBOSE: ' ' }, packaged: true, isolatedUserData: null });
    expect(s.ignored).toEqual([]);
  });
});

describe('the OpenAI base URL switch', () => {
  it('accepts only absolute http and https URLs', () => {
    expect(httpUrl(' https://example.test/v1 ')).toBe('https://example.test/v1');
    expect(httpUrl('http://127.0.0.1:4599/v1')).toBe('http://127.0.0.1:4599/v1');
    expect(httpUrl('ftp://example.test')).toBeNull();
    expect(httpUrl('file:///C:/x')).toBeNull();
    expect(httpUrl('127.0.0.1:4599')).toBeNull();
    expect(httpUrl('not a url')).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
  });
});

describe('the current switches', () => {
  it('are all off until startup sets them', () => {
    setDevSwitches(NO_DEV_SWITCHES);
    expect(getDevSwitches()).toEqual(NO_DEV_SWITCHES);
    expect(getDevSwitches().packaged).toBe(true);
    const dev = readDevSwitches({ env: { MREV_VERBOSE: '1' }, packaged: false, isolatedUserData: null });
    setDevSwitches(dev);
    expect(getDevSwitches().verbose).toBe(true);
    setDevSwitches(NO_DEV_SWITCHES);
  });
});
