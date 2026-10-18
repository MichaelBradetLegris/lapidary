# CLAUDE.md

Lapidary (formerly Stet) is a desktop app for reviewing AI-suggested copyedits to novel chapters stored as Markdown in an Obsidian vault. The full design and phase plan is in `PLAN.md`. Read it before starting any phase and tick its checkboxes as phases land.

## Stack

Electron + electron-vite + React + TypeScript. AI reviews go through a provider layer in `src/main/providers/` (one `ReviewProvider` interface, one set of `ai:*` IPC channels). Claude is called only by running the Claude Code the user installed (`src/main/providers/claudeCli.ts`, flags in `claudeOptions.ts`); the app ships nothing of Anthropic's, neither a binary nor a library; OpenAI only through the official `openai` package's Responses API. Both run in the Electron main process. Text algorithms live in `src/shared` and are pure TypeScript with vitest coverage.

The app's display name is `APP_NAME` in `src/shared/branding.ts` and nowhere else; the same file holds `APP_ID` and `APP_REPOSITORY`, both frozen from 1.0, and `scripts/branding.cjs` reads all three for the build. The window title, `index.html` (through a vite `transformIndexHtml` plugin), `package.json`'s `productName`, `repository`, `homepage` and `bugs` (through `scripts/sync-branding.cjs`, run by `npm run package` and checked by `npm run branding:check`) and the electron-builder config all read it from there, so renaming the app is one edit. `APP_DATA_DIR` in the same file pins the userData folder to a name of its own, so a rename never moves the author's settings or their saved reviews. The icon is generated from one geometry spec by `scripts/make-icons.py` into `resources/icon/`.

## Commands

```
npm install
npm run dev        # electron-vite dev with HMR
npm run dev:clean  # the same with Claude variables removed and scratch userData, for verification runs (C.43)
npm test           # vitest
npm run lint
npm run build      # electron-vite build
npm run package    # sync productName, build, then electron-builder into dist/
npm run icons      # regenerate resources/icon/ from scripts/make-icons.py (needs Pillow)
npm run branding:check  # exit 1 if package.json has drifted from src/shared/branding.ts; writes nothing
npm run check:public    # exit 1 if a file git would commit holds a profile path, an email or a key shape
```

Test fixtures stay fit to publish: emails use `@example.com`, and a line with a placeholder profile path (`C:\Users\<name>`, `/home/<name>`) ends with a comment that starts with `check-public: allow`, as does a line with a long dummy key. The marker exempts its own line only, and only right after a comment opener (`//`, `/*`, `#`, `<!--` or a leading `*`), so prose that names it is still scanned.

## Hard rules

1. Never change a manuscript file except through the Save action in `src/main/files.ts`. There is no autosave: the toolbar's Save to chapter, Ctrl+S and the Save in the review dialogs and the leave and close prompts all run the one `saveChapter` (PLAN 6.3). Writes are atomic (temp file then rename) and preserve the file's EOL style, BOM, and trailing newline, and bytes equal to the file's are not written at all. Before a save replaces a file, the bytes it replaces are copied to `<userData>/backups` (`chapterBackupHooks` in `src/main/backups.ts`, PLAN 6.5), never into the manuscript folder or the chapter's own folder; when the copy cannot be made, nothing is written. Main checks every target it is handed: `files:save` refuses the guidelines file and anything but a `.md` or `.txt` chapter that lies in the manuscript folder or was opened from it in this run (`assertSavableChapter`); `reviews:save` writes to the path it is given only when that is a `.review.json` directly in its chapter's folder in the reviews folder and holds no other chapter's review, and puts anything else in a new entry there instead (`saveReview` in `src/main/reviews.ts`). Besides Save, two things may add a file to the manuscript folder, and they only create, so neither can ever modify an existing file: `createChapter` in the same file, which writes with the exclusive-create flag (`wx`), and `ensureGuidelinesFile` in `src/main/guidelines.ts`, which copies the template with `COPYFILE_EXCL`. The one other writer there is the review store, and only when the author keeps the reviews folder inside the manuscript folder (PLAN 6.1): it then saves over, moves and removes its own `.review.json` files, the `.last-open.json` in each chapter's folder and its `.adoption.json` inside that folder, as it would anywhere else, and `listChapters` skips that folder, so none of them is ever a chapter. Everything the author edits inside the app, including text they type themselves, becomes a hunk and reaches the file only through Save.
2. Credentials, two facts. (a) Nothing in the app reads, stores, displays, or proxies Claude credentials. Sign-in happens in the Claude Code CLI or via `ANTHROPIC_API_KEY`; the app only shows instructions and account status from Claude Code's own `initialize` reply and `claude auth status`, keeping only the whitelisted fields (`parseAuthStatus`, `toAccount`), and it never starts a sign-in: `runClaudeCli` runs nothing but `--version` and `auth status --json`. (b) The OpenAI API key is the one credential the app stores. `src/main/secrets.ts` encrypts it with Electron's `safeStorage` into `secrets.json` beside `settings.json` (never inside it), refuses to store it when encryption is unavailable, and decrypts it only in the main process at call time. It is never displayed and never sent to the renderer, which receives only `{configured, source, last4}`. `OPENAI_API_KEY` from the environment is the fallback when nothing is stored.
3. The renderer has no Node access. All file system, watcher, settings, and SDK work goes through typed IPC declared in `src/shared/ipc.ts`.
4. `src/shared` must not import Node or DOM APIs. Every algorithm there gets unit tests, including property-style round trips for compose and rebase.
5. Hunks never overlap, offsets always refer to the review's LF-normalized base text, and the composed output is a pure function of base plus hunk decisions.
6. Claude calls remove every built-in tool (`--tools ""`), load no user settings (`--setting-sources=`), never use `--bare` (it turns off subscription sign-in), and never use the vault as `cwd`. They never set or override Claude Code's client or entrypoint identity (Anthropic's Usage Policy bars services that misrepresent the product or client): no entrypoint, user-agent or header variable, no flag that names a client. `buildClaudeEnv` adds only `CLAUDE_CODE_STARTUP_FAILURE_RESULTS` and passes everything else through unchanged or removes it, and `test/main/claudeOptions.test.ts` pins that.
7. Keep `PLAN.md` as the source of truth. If a design decision changes during implementation, edit the plan in the same commit.
8. Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md` in the same commit, in the group it belongs to (Keep a Changelog 1.1.0: Added, Changed, Deprecated, Removed, Fixed, Security). Write it for the people who use the app; internal refactors, tests and plan edits get no line.

## Reference docs

- Claude Code CLI reference and headless mode: https://code.claude.com/docs/en/cli-reference , https://code.claude.com/docs/en/headless . The installed `claude --help` is authoritative over memory. The stream-json protocol the app relies on is pinned by `test/helpers/fakeClaude.ts` and `test/main/claudeCli.test.ts`; when Claude Code changes it, update both with `MIN_CLAUDE_CODE` (C.42).
- OpenAI structured outputs and Responses API: https://developers.openai.com/api/docs/guides/structured-outputs , https://platform.openai.com/docs/api-reference/responses . Local types are authoritative here too: `node_modules/openai/resources/responses/responses.d.ts`
- The OpenAI path is tested without a key against `test/helpers/mockOpenAi.ts` (vitest imports it; `node test/helpers/mockOpenAi.ts --port 4599` runs it for the app, started with `MANUSCRIPT_REVIEW_OPENAI_BASE_URL=http://127.0.0.1:4599/v1`). That variable and the other development switches (`MANUSCRIPT_REVIEW_USER_DATA`, `MREV_VERBOSE` and the rest) are read only in `src/main/devSwitches.ts`, and a packaged build ignores them all; the one exception is the `--isolated-user-data=<dir>` flag. Add any new switch there, never as a bare `process.env` read. The key picks the scenario: `unauthorized`, `ratelimit`, `servererror`, `malformed`, `wrongshape`, `slow`, else success.
