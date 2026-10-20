# Contributing

This file is for people who build the app, change it or send a pull request. Users read [README.md](README.md). The design log, with every decision and task, is [PLAN.md](PLAN.md). The repository's rules are in [CLAUDE.md](CLAUDE.md): they are written for coding agents, but they bind every change. [AGENTS.md](AGENTS.md) points other agents there.

## What you need

- Windows 10 or 11, x64. The app is built and tried only on Windows. The source has macOS and Linux code paths, but nothing is built or tested there.
- Node.js `^22.18.0 || ^24.0.0 || >=26.0.0`, as `engines` in package.json says: 22.18 or later on the 22 line, 24, or 26 and later. Not 23 or 25, which vitest 5 does not support, and not 22.17 or older, which cannot run TypeScript files such as `scripts/check-public.ts` and the OpenAI mock without a flag. The maintainer uses Node 24.21.0 and npm 11.19.0.
- npm, which comes with Node.
- Git. `npm run check:public` asks git which files to scan.
- Python 3 with Pillow, only for `npm run icons`.
- Claude Code or an OpenAI key only for real reviews, set up as the README says. The tests need neither.

## Getting started

```powershell
npm ci
npm test
npm run dev:clean
```

In PowerShell, plain `npm` runs `npm.ps1`, which Windows' default execution policy blocks. If PowerShell says that running scripts is disabled on this system, type `npm.cmd` in place of `npm`, here and below, or use Command Prompt.

`npm ci` installs exactly what `package-lock.json` lists. npm 11 warns that the install scripts of `electron-winstaller` and `esbuild` are "not yet covered by allowScripts"; the tests and the build work as they are. The Electron package has no install step of its own: it downloads the Electron binary the first time the app is started (`dev`, `dev:clean` or `start`), and `package` fetches its own copy. Those first runs need an internet connection; later ones use Electron's cache. The tests and `build` do not need the binary.

## npm scripts

Run each with `npm run <name>`; `npm test` and `npm start` also work without `run`.

Running the app:

- `dev`: electron-vite in development mode, with hot reload. It uses your real data folder, `%APPDATA%\ai-grammar-checker`, unless the variable `MANUSCRIPT_REVIEW_USER_DATA` names another, so your own settings, saved key and reviews are in play. Prefer `dev:clean`.
- `dev:clean`: the same run in a cleaned environment (`scripts/dev-clean.cjs`). It removes every variable whose name starts with `CLAUDE`, `ANTHROPIC` or `DISABLE_` and prints their names, never their values. It uses the git-ignored `.dev-userdata` folder as the data folder and opens DevTools on port 9222. A shell inside a Claude Code session carries variables that change what the app's own Claude Code does, so use this for every verification run. `npm run dev:clean -- --help` lists its options, which the header of `scripts/dev-clean.cjs` explains: another or a fresh data folder, another or an empty Claude Code configuration (signed out), a dummy API key or auth token, no Claude Code at all, a quiet window that never takes the foreground, a shell that opens nothing and prints what it would have opened, or a packaged exe instead of the development build. CLAUDE.md lists them with the development switches they set.
- `start`: `electron-vite preview`, which builds the app without the type check and runs the build. Like `dev`, it uses your real data folder.

Building:

- `build`: `typecheck`, then `electron-vite build` into `out/`.
- `typecheck`: `tsc --build --force` over `tsconfig.node.json` (main, preload, shared, scripts and tests) and `tsconfig.web.json` (the renderer). It writes only to `node_modules/.tmp`.
- `package`: `build`, then electron-builder into `dist/`: an NSIS installer and a portable exe, both x64 and unsigned. It never publishes (`--publish never`). npm runs `prepackage` first, which is `node scripts/sync-branding.cjs`: it copies the app's name and repository from `src/shared/branding.ts` into package.json, writing only a field that differs.
- `icons`: regenerates `resources/icon/` from `scripts/make-icons.py`. Needs `python` on PATH with Pillow.

Checks:

- `test`: vitest over `test/`, except the slow tests.
- `test:slow`: the timing tests in `test/slow/`, which watch the real file system.
- `test:watch`: vitest in watch mode.
- `lint`, `lint:fix`: ESLint, and ESLint fixing what it can.
- `format`, `format:check`: Prettier writing, or only checking, every file except those in `.prettierignore` (PLAN.md, CLAUDE.md, the guidelines template, `samples/`, the lockfile and build output).
- `branding:check`: exits 1 if package.json's `productName`, `repository`, `homepage` or `bugs` differ from `src/shared/branding.ts`. It writes nothing.
- `check:public`: exits 1 if a file git would commit holds a profile path, an email address or something shaped like a key. It prints file, line and kind, never the value.

Before you commit, these must pass: `typecheck`, `lint`, `format:check`, `test`, `branding:check` and `check:public`. Run `test:slow` too when you touch the watcher. CI (`.github/workflows/ci.yml`) runs the same checks and the build on Windows and Linux for every pull request and every push to `main`.

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
    secrets.ts       the encrypted OpenAI key
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
      openai.ts        OpenAI, through the Responses API
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
    ai/              Claude Code's status and models, OpenAI helpers, the price table
    ui/              pure helpers for the window
    diagnostics/     log scrubbing
scripts/           build and check scripts
test/              vitest; helpers/ holds the OpenAI mock and a fake Claude Code
resources/         the guidelines template and the icons
samples/           a small manuscript to try the app on
```

## Hard rules

[CLAUDE.md](CLAUDE.md) has the full text. In brief:

1. Only Save, in `src/main/files.ts`, changes a chapter, atomically and keeping its line endings, byte order mark and final newline. New chapter and the guidelines file only ever create.
2. The app never reads, stores, displays or proxies Claude credentials and never starts a sign-in. The OpenAI key is the one credential it stores, encrypted, and it never reaches the window.
3. The renderer has no Node access. Everything else goes through typed IPC in `src/shared/ipc.ts`.
4. `src/shared` imports no Node or DOM APIs, and every algorithm there has unit tests.
5. Hunks never overlap, offsets refer to the review's LF-normalised base text, and the output is a pure function of base and decisions.
6. Claude Code runs with no built-in tools, no user settings, never `--bare`, never the vault as its working directory, and never a changed client identity.
7. PLAN.md is the source of truth: a design change edits it in the same commit.
8. Every user-visible change adds a line to CHANGELOG.md in the same commit (below).
9. The log records what happened, never content: a log call takes scalar fields, and an error goes in only through `loggableErrorFields`. That keeps an app error's message, so a `fail` message never quotes chapter text, a prompt, the guidelines or a reply; such text goes in `detail`, which is never logged.

## Testing without a key

**OpenAI.** `test/helpers/mockOpenAi.ts` stands in for the two OpenAI endpoints the app uses. Vitest starts it in-process. To drive the real app against it, run the mock in one PowerShell window:

```powershell
node test/helpers/mockOpenAi.ts --port 4599
```

and the app in another:

```powershell
$env:MANUSCRIPT_REVIEW_OPENAI_BASE_URL = 'http://127.0.0.1:4599/v1'
npm run dev:clean
```

Then save any key in Settings. The key picks what the mock does: one containing `unauthorized` gets a 401, `ratelimit` a 429, `servererror` a 500, `malformed` a reply that is not JSON, `prose` a reply written as prose, `wrongshape` JSON of the wrong shape, `slow` a reply that trickles in over several seconds (to try Cancel), `obsidian` a review of `Chapter 03 - Obsidian.md` in which some suggestions reach into its Obsidian syntax, `outputlimit` a reply cut off at the model's output limit, `unverified` the refusal OpenAI gives a streamed request from an organisation that has not verified its identity, `skippedonly` a model list holding only models the default usually passes over, and anything else a canned review of Chapter 01. CLAUDE.md says what each does in full. The address variable is a development switch: a packaged build ignores it, like every other switch in `src/main/devSwitches.ts`.

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

No release has been made yet, and the release workflow is still planned (PLAN section 11.3 (n) and the checklist in 11.4). These rules hold already:

- First the CHANGELOG's Unreleased section becomes that version's dated section. Then `npm version <x.y.z> -m "Release %s"` sets the version, commits, and tags the commit `v<x.y.z>`.
- Push the branch, then that one tag: `git push origin main`, then `git push origin v<x.y.z>`.
- Never `git push --tags` or `git push --all`. A pushed version tag will start a release build, so tags go up one at a time, on purpose.
