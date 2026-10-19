/**
 * The parts of Electron's `shell` that main uses to hand something to the
 * system: a link to the browser or to Obsidian, a file to its app, a file
 * shown in its folder. Electron-free, so tests stand in for it.
 *
 * Under the development switch `MANUSCRIPT_REVIEW_DEV_SHELL_STUB`
 * (`dev:clean --shell-stub`, src/main/devSwitches.ts) main uses
 * `recordingShell` instead: it opens nothing and writes what it would have
 * opened to the terminal. A verification run can then press Open in
 * Obsidian, Open or Show in folder in a test window without starting
 * Obsidian, an editor or Explorer on the machine of an author who is working
 * at it (setup.10b, Appendix C "A shell that opens nothing").
 */
export interface ShellApi {
  openExternal(url: string): Promise<void>;
  /** resolves to '' on success, or to the reason the OS gave */
  openPath(file: string): Promise<string>;
  showItemInFolder(file: string): void;
}

/** The start of each line `recordingShell` writes, for a test run to find. */
export const SHELL_STUB_PREFIX = '[shell stub]';

/** A shell that opens nothing and says what it was asked to open, one line per call. */
export function recordingShell(write: (line: string) => void): ShellApi {
  return {
    openExternal: (url) => {
      write(`${SHELL_STUB_PREFIX} openExternal ${url}`);
      return Promise.resolve();
    },
    openPath: (file) => {
      write(`${SHELL_STUB_PREFIX} openPath ${file}`);
      return Promise.resolve('');
    },
    showItemInFolder: (file) => {
      write(`${SHELL_STUB_PREFIX} showItemInFolder ${file}`);
    }
  };
}

/** Electron's shell, or the recording one when the switch is on. */
export function pickShell(real: ShellApi, stub: boolean, write: (line: string) => void): ShellApi {
  return stub ? recordingShell(write) : real;
}
