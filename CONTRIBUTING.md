# Contributing

This file is for people who build the app, change it or send a pull request. Users read [README.md](README.md). The design log, with every decision and task, is [PLAN.md](PLAN.md). The repository's rules are in [CLAUDE.md](CLAUDE.md): they are written for coding agents, but they bind every change. [AGENTS.md](AGENTS.md) points other agents there.

## What you need

- Windows 10 or 11, x64. The app is built and tried only on Windows. The source has macOS and Linux code paths, but nothing is built or tested there.
- Node.js `^22.18.0 || ^24.0.0 || >=26.0.0`, as `engines` in package.json says: 22.18 or later on the 22 line, 24, or 26 and later. Not 23 or 25, which vitest 5 does not support, and not 22.17 or older, which cannot run TypeScript files such as `scripts/check-public.ts` and the OpenAI mock without a flag. The maintainer uses Node 24.21.0 and npm 11.19.0.
- npm, which comes with Node.
- Git. `npm run check:public` asks git which files to scan.
- Python 3 with Pillow, only for `npm run icons`.
- Claude Code or a ChatGPT plan only for real reviews, set up as the README says. The tests need neither.

## Getting started

```powershell
npm ci
npx install-electron
npm test
npm run dev:clean
```

In PowerShell, plain `npm` runs `npm.ps1`, which Windows' default execution policy blocks. If PowerShell says that running scripts is disabled on this system, type `npm.cmd` and `npx.cmd` in place of `npm` and `npx`, here and below, or use Command Prompt.

`npm ci` installs exactly what `package-lock.json` lists. npm 11 warns that the install scripts of `electron-winstaller` and `esbuild` are "not yet covered by allowScripts"; the tests and the build work as they are. The Electron package has no install step, so `npm ci` does not fetch the Electron binary, and neither does starting the app: electron-vite, which `dev`, `dev:clean` and `start` run, looks only for the `node_modules/electron/path.txt` that fetching the binary writes, and without it stops with "Electron uninstall". `npx install-electron`, the Electron package's own `install.js`, fetches the binary for the version `package-lock.json` pins and writes that file. Run it after every `npm ci`, which empties `node_modules` first, and after any install that changes Electron's version; `package` fetches its own copy. It needs an internet connection the first time for each version, and later uses Electron's cache. The tests and `build` do not need the binary.

## npm scripts

Run each with `npm run <name>`; `npm test` and `npm start` also work without `run`.

Running the app:

- `dev`: electron-vite in development mode, with hot reload. It uses your real data folder, `%APPDATA%\ai-grammar-checker`, unless the variable `MANUSCRIPT_REVIEW_USER_DATA` names another, so your own settings, saved key and reviews are in play. Prefer `dev:clean`.
- `dev:clean`: the same run in a cleaned environment (`scripts/dev-clean.cjs`). It removes every variable whose name starts with `CLAUDE`, `ANTHROPIC` or `DISABLE_` and prints their names, never their values. It uses the git-ignored `.dev-userdata` folder as the data folder and opens DevTools on port 9222. A shell inside a Claude Code session carries variables that change what the app's own Claude Code does, so use this for every verification run. `npm run dev:clean -- --help` lists its options, which the header of `scripts/dev-clean.cjs` explains: another or a fresh data folder, another or an empty Claude Code configuration (signed out), a dummy API key or auth token, no Claude Code at all, a quiet window that never takes the foreground, a shell that opens nothing and prints what it would have opened, the fake update in place of GitHub (`--fake-update 1.0.1`, which the check finds 15 seconds after the start and which then downloads and installs, the last by quitting the app; see the header for the plans that fail), or a packaged exe instead of the development build. CLAUDE.md lists them with the development switches they set.
- `start`: `electron-vite preview`, which builds the app without the type check and runs the build. Like `dev`, it uses your real data folder.

Building:

- `build`: `typecheck`, then `electron-vite build` into `out/`.
- `typecheck`: `tsc --build --force` over `tsconfig.node.json` (main, preload, shared, scripts and tests) and `tsconfig.web.json` (the renderer). It writes only to `node_modules/.tmp`.
- `package`: `build`, then `notices`, then electron-builder into `dist/`: a one-click NSIS installer for x64, unsigned, named `<APP_NAME>-Setup-<version>.exe`, with its `.blockmap` and `latest.yml`, and in `dist/win-unpacked` the app it installs, whose `resources/app-update.yml` names the repository the updater will read. There is no portable exe. It never publishes (`--publish never`). npm runs `prepackage` first, which is `node scripts/sync-branding.cjs`: it copies the app's name and repository from `src/shared/branding.ts` into package.json, writing only a field that differs. Afterwards npm runs `postpackage`, which is `verify:package -- --installer`, so a build that fails the checks fails the command.
- `package:dir`: the same, but electron-builder stops at the unpacked app in `dist/win-unpacked`, with no installer, and so with no `app-update.yml` either. It never publishes either, and npm runs `prepackage:dir`, the same sync, first. Nothing runs after it: run `verify:package` yourself, as CI does.
- `notices`: writes `out/THIRD_PARTY_NOTICES.txt` (`scripts/third-party-notices.ts`), which the installer puts beside the app with `LICENSE` as `LICENSE.txt`: Electron, the packages electron-builder copies into the asar and the packages Vite bundled, each with the licence and notice files it comes with. Each build records its bundled packages in `out/<main|preload|renderer>/bundled-packages.json` (`scripts/bundled-packages.ts`), so it needs `build` first. It removes the notices an earlier run wrote before it starts, so when it fails it leaves none: when a package's licence is not MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0, BlueOak-1.0.0, Python-2.0 or an SPDX expression made only of them, when a package has no licence file (apart from those listed by name and version in `SUPPLIED_MIT_LICENCES`, which declare MIT and ship no text, so the notices give them the MIT License's text with their author, as for electron-updater's `lazy-val`), or when a build's record or a dependency is missing.
- `verify:package`: checks `dist/win-unpacked` (`scripts/verify-package.ts`): the asar holds the main script and package.json and nothing from `samples`, `test`, `src`, `dist` or `.dev-userdata`; there is no `@anthropic-ai` package and no file named `claude.exe` or `claude` anywhere in the package; the notices, `LICENSE.txt`, the guidelines template and the window's `icon.ico` are beside the asar, and the notices name every package in it. With `-- --installer` it also checks `app-update.yml`, and `latest.yml` against the installer's name, size and sha512. `-- --dist <folder>` checks another output folder. It exits 1 with a line for each problem.
- `release:check`: `npm run release:check -- v<x.y.z>` checks that a tag can be released (`scripts/check-release.cjs`): the tag is `v` and a version such as `v1.0.0` or `v1.1.0-rc.1`; package.json's version and package-lock.json's two are that version; and CHANGELOG.md has one section for it, headed `## [x.y.z] - YYYY-MM-DD` with a real date, that lists at least one change. It exits 1 with a line for each problem and writes nothing. It uses only Node's own modules, since the release workflow runs it before `npm ci`.
- `release:notes`: `npm run release:notes -- v<x.y.z>` prints the release's notes (`scripts/release-notes.cjs`), and `-- v<x.y.z> --out <file>` writes them to a file: that version's CHANGELOG section, a rule, and `.github/release-footer.md`, whose `{version}`, `{tag}`, `{name}`, `{installer}` and `{repo}` it fills in. It exits 1 and writes nothing when the section is missing, undated or lists no change, or when the footer has a `{word}` it has no value for.
- `icons`: regenerates `resources/icon/` from `scripts/make-icons.py`: the SVG, 16 PNGs from 16 to 1024 px, `icon.png` and the 14-frame `icon.ico`. Needs `python` on PATH with Pillow. `python scripts/make-icons.py --sheet` writes a contact sheet of the sizes to `dist/icon-preview/` instead and leaves `resources/icon/` alone.

Checks:

- `test`: vitest over `test/`, except the slow tests.
- `test:slow`: the timing tests in `test/slow/`, which watch the real file system.
- `test:watch`: vitest in watch mode.
- `lint`, `lint:fix`: ESLint, and ESLint fixing what it can.
- `format`, `format:check`: Prettier writing, or only checking, every file except those in `.prettierignore` (PLAN.md, CLAUDE.md, the guidelines template, `samples/`, the lockfile and build output).
- `branding:check`: exits 1 if package.json's `productName`, `repository`, `homepage` or `bugs` differ from `src/shared/branding.ts`. It writes nothing.
- `check:public`: exits 1 if a file git would commit holds a profile path, an email address or something shaped like a key. It prints file, line and kind, never the value.

Before you commit, these must pass: `typecheck`, `lint`, `format:check`, `test`, `branding:check` and `check:public`. Run `test:slow` too when you touch the watcher. CI (`.github/workflows/ci.yml`) runs the same checks and the build on Windows and Linux for every pull request and every push to `main`. Once both pass, it runs `package:dir` and then `verify:package` on Windows: the unpacked app is built and checked, but no installer is made and nothing is published.

## Where things are

```
src/
  main/            Electron main process (Node)
    index.ts         start-up, the window and its security settings
    ipc.ts           IPC handlers, typed against src/shared/ipc.ts (ipcEnvelope.ts logs a failed request)
    files.ts         list and read chapters, Save, New chapter
    atomic.ts        the atomic write behind Save: temporary file, then rename
    watcher.ts       watches the manuscript folder
    reviews.ts       the review store
    settings.ts      settings.json, through settingsStore.ts
    secrets.ts       secrets.json, where the ChatGPT sign-in is kept encrypted
    chatgpt/         Sign in with ChatGPT: the browser sign-in, its tokens and their renewal
    guidelines.ts    the guidelines file (openGuidelines.ts opens it)
    navigation.ts    the window refuses navigation and file drops
    devSwitches.ts   development switches, ignored by packaged builds
    log.ts           logs/main.log
    providers/       one ReviewProvider interface, one set of ai:* IPC channels
      claude.ts        Claude, through the user's Claude Code
      claudeBinary.ts  finds claude.exe; the only file that starts a process
      claudeOptions.ts Claude Code's flags and environment
      claudeCli.ts     the stream-json protocol: the review run and the handshake
      claudeResult.ts  which error a review run's result stands for, if any
      claudeRuntime.ts the launch check (claudeHandshake.ts)
      chatgpt.ts       ChatGPT, on the user's plan, with the sign-in's token
      openai.ts        the Responses API request ChatGPT sends
      logged.ts        logs each provider's calls as counts, never their text
  preload/         the typed bridge the window receives, and nothing else
  renderer/        React UI with no Node access: App.tsx, components/, state/, styles/
  shared/          pure TypeScript, no Node or DOM imports, all unit-tested
    branding.ts      the app's name and fixed ids, and the only place the name is written
    ipc.ts           IPC channel names and payload types
    types.ts         reviews, hunks, comments, settings
    text/            paragraphs, line endings and byte order marks, encodings
    diff/            word diff, anchoring, compose, rebase
    prompt/          the system prompt, the chapter as the model sees it, the output schema
    ai/              Claude Code's status and models, the OpenAI request's and ChatGPT's helpers
    ui/              pure helpers for the window
    diagnostics/     log scrubbing
scripts/           build and check scripts
test/              vitest; helpers/ holds the OpenAI and ChatGPT sign-in mocks and a fake Claude Code
resources/         the guidelines template and the icons
samples/           a small manuscript to try the app on
```

## Hard rules

[CLAUDE.md](CLAUDE.md) has the full text. In brief:

1. Only Save, in `src/main/files.ts`, changes a chapter, atomically and keeping its line endings, byte order mark and final newline. New chapter and the guidelines file only ever create.
2. The app never reads, stores, displays or proxies Claude credentials and never starts a Claude sign-in. The ChatGPT sign-in is the one credential it stores, encrypted, and it never reaches the window.
3. The renderer has no Node access. Everything else goes through typed IPC in `src/shared/ipc.ts`.
4. `src/shared` imports no Node or DOM APIs, and every algorithm there has unit tests.
5. Hunks never overlap, offsets refer to the review's LF-normalised base text, and the output is a pure function of base and decisions.
6. Claude Code runs with no built-in tools, no user settings, never `--bare`, never the vault as its working directory, and never a changed client identity.
7. PLAN.md is the source of truth: a design change edits it in the same commit.
8. Every user-visible change adds a line to CHANGELOG.md in the same commit (below).
9. The log records what happened, never content: a log call takes scalar fields, and an error goes in only through `loggableErrorFields`. That keeps an app error's message, so a `fail` message never quotes chapter text, a prompt, the guidelines or a reply; such text goes in `detail`, which is never logged.

## Testing without an account

**ChatGPT.** `test/helpers/mockChatGptAuth.ts` stands in for OpenAI's sign-in server and `test/helpers/mockOpenAi.ts` for the two endpoints a ChatGPT review uses. Vitest starts them in-process. To drive the real app against them, run each mock in a PowerShell window of its own, naming the scenario the sign-in's tokens are to carry:

```powershell
node test/helpers/mockChatGptAuth.ts --port 4600 --api-scenario slow
```

```powershell
node test/helpers/mockOpenAi.ts --port 4599
```

and the app in a third:

```powershell
$env:MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL = 'http://127.0.0.1:4600'
$env:MANUSCRIPT_REVIEW_OPENAI_BASE_URL = 'http://127.0.0.1:4599/v1'
npm run dev:clean -- --shell-stub
```

Open Settings, then Setup beside ChatGPT account, and click Sign in with ChatGPT. With `--shell-stub` the app prints the address it would open in the browser instead; open that address yourself, and the mock signs the app in. Tick I have confirmed my data settings, then review with ChatGPT. The scenario decides what the mock answers: `malformed` a reply that is not JSON, `prose` a reply written as prose, `wrongshape` JSON of the wrong shape, `slow` a reply that trickles in over several seconds (to try Cancel), `obsidian` a review of `Chapter 03 - Obsidian.md` in which some suggestions reach into its Obsidian syntax, `outputlimit` a reply cut off at the model's output limit, `unauthorized`, `ratelimit` and `servererror` a 401, a 429 and a 500, `usagelimit` the plan's usage limit, `nearlimit` a limit 85% used, and anything else a canned review of Chapter 01. To change it without signing in again, send the new name to the API mock: `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4599/mock/scenario -Body malformed`. CLAUDE.md lists every scenario and says what each does in full. Both address variables are development switches: a packaged build ignores them, like every other switch in `src/main/devSwitches.ts`.

**Claude.** The tests use `test/helpers/fakeClaude.ts`, which speaks Claude Code's stream-json protocol, and `test/main/claudeCli.test.ts` pins that protocol. When Claude Code changes it, update both, and `MIN_CLAUDE_CODE` in `src/shared/ai/claudeStatus.ts`. In the app, `dev:clean`'s options show the Setup screen's states without touching your own sign-in: `--claude-config-empty` (signed out), `--no-claude-code` (not installed) and `--api-key-dummy` (an API key in use).

## Test fixtures

Everything in the repository is public, so fixtures must not hold anything real:

- email addresses use `@example.com`;
- a line that has to keep a placeholder profile path or a long dummy key ends with a comment that starts with `check-public: allow`. The marker covers its own line only, and only right after a comment opener (`//`, `/*`, `#`, `<!--` or a leading `*`).

For example:

```ts
const chapter = 'C:/Users/alice/vault/Chapter 1.md'; // check-public: allow (placeholder profile)
```

A path written with a placeholder such as `C:\Users\<name>` needs no marker. `npm run check:public` enforces all of this.

## CHANGELOG

[CHANGELOG.md](CHANGELOG.md) follows Keep a Changelog 1.1.0. Every change a user can see adds a line under `## [Unreleased]` in the same commit, in its group: Added, Changed, Deprecated, Removed, Fixed or Security. Write it for the people who use the app. Refactors, tests and plan edits get no line.

## Releasing

No release has been made yet. [docs/RELEASING.md](docs/RELEASING.md) is the routine for every release: versioning, cutting a release, fixing one that went wrong, the checks of Claude Code and of electron-builder and electron-updater that come round with each release, and the smoke checklist. A pushed version tag runs the release workflow (`.github/workflows/release.yml`, PLAN section 11.3 (n)). In brief:

- First the CHANGELOG's Unreleased section becomes that version's dated section. Then `npm version <x.y.z> -m "Release %s"` sets the version, commits, and tags the commit `v<x.y.z>`. `npm run release:check -- v<x.y.z>` then runs the check the release workflow starts with, and `npm run release:notes -- v<x.y.z>` shows the notes it will publish.
- Push the branch, then that one tag: `git push origin main`, then `git push origin v<x.y.z>`.
- The workflow runs `release:check` on the tag before it installs anything, then `lint`, `test` and `package` with the verifier, and makes a draft release of four files: the installer, its `.blockmap`, `latest.yml` and `SHA256SUMS.txt`, with the notes `release:notes` writes. A version with a hyphen, such as `1.1.0-rc.1`, is marked a prerelease. It publishes nothing: read the draft, then publish it with `gh release edit v<x.y.z> --draft=false --latest`, or a prerelease without `--latest`, as GitHub never makes a prerelease the latest release. The updater never sees a draft.
- When the check fails, nothing has been built: delete the tag (`git push origin --delete v<x.y.z>`, then `git tag -d v<x.y.z>`), fix what it names, and tag again.
- Never `git push --tags` or `git push --all`. A pushed version tag will start a release build, so tags go up one at a time, on purpose.
- Never move a published tag, and never delete a published release or its `.blockmap`: a broken release is fixed by the next version.

Dependabot (`.github/dependabot.yml`) opens pull requests four times a year: for `openai`, `electron`, `electron-builder` and `electron-updater` among the npm packages, never a new major of the last three, and for the actions the workflows use. None merges on its own; docs/RELEASING.md says what to check before merging each by hand.
