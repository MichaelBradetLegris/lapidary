# Security policy

## Reporting a problem

Please report security problems privately, not in a public issue.

Use GitHub's private vulnerability reporting: on the repository's main page, open the **Security and quality** tab (it may be under the **...** menu) and click **Report a vulnerability**. If there is no **Report a vulnerability** button, private reporting is not turned on: open an issue that asks for a private contact, and put no details in it.

Say what you found, which version or commit it affects, how to reproduce it and what an attacker could do with it. Leave out real API keys, chapter text and anything else private; a made-up value shows the problem just as well.

The project has one maintainer, so please allow some time for a reply. Until 1.0, fixes go into the newest code only.

## In scope

The app's own code, in particular:

- the window's sandbox: context isolation, the sandbox, no Node integration, the Content Security Policy in `src/renderer/index.html`, and the preload bridge;
- the navigation guard in `src/main/navigation.ts`, which keeps the window on the app, sends web links to the browser and refuses file drops;
- the IPC surface between the window and the main process (`src/shared/ipc.ts`, `src/main/ipc.ts`);
- the Save path (`src/main/files.ts`, `src/main/atomic.ts`), which alone changes chapter files, and only `.md` and `.txt` chapters in the manuscript folder or opened from it, never the guidelines file;
- the stored OpenAI key (`src/main/secrets.ts`): encrypted with Electron's `safeStorage`, decrypted only in the main process, never sent to the window, and sent only to api.openai.com;
- how Claude Code is found and started (`src/main/providers/claudeBinary.ts`, `claudeOptions.ts`, `claudeCli.ts`): which executable runs, with which arguments and environment;
- the development switches in `src/main/devSwitches.ts`, which a packaged build must ignore;
- log scrubbing (`src/shared/diagnostics/redact.ts`, `src/main/log.ts`): the log must never hold chapter text, prompts, replies, keys or email addresses;
- a dependency or Electron version with a known vulnerability that the app ships.

## Out of scope: report these elsewhere

- **Claude Code itself.** It is Anthropic's program, which each user installs. Report to Anthropic through its HackerOne programme: [submission form](https://hackerone.com/4f1f16ba-10d3-4d09-9ecc-c721aad90f24/embedded_submissions/new), [programme page](https://hackerone.com/anthropic).
- **OpenAI's API and the `openai` package.** Report to OpenAI through its [coordinated vulnerability disclosure policy](https://openai.com/policies/coordinated-vulnerability-disclosure-policy).
- **Electron and Chromium.** Report to Electron through its [security advisories](https://github.com/electron/electron/security/advisories/new). A fixed Electron release that this app has not adopted yet is in scope here.
