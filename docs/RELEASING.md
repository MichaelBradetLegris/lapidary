# Releasing

How a release of the app is made and looked after: the version number, cutting a release, what to do when one goes wrong, and the checks that come round with every release. It is for the maintainer. The design behind it is in [PLAN.md](../PLAN.md): section 11.3 (n) for the release workflow and the updater, 11.4 for the 1.0.0 checklist that this routine repeats for every release. [CONTRIBUTING.md](../CONTRIBUTING.md) describes each npm script named here.

Steps marked **(author)** are the repository owner's alone: pushing to GitHub, publishing a release, merging or closing a pull request, updating their own Claude Code, running a live review (it spends their plan's usage), and everything done on the test Windows account. A coding agent prepares the rest, stops before them, and carries on from what the owner reports of them.

## Versioning

- One number, `version` in package.json, drives everything: the installer's name, About, the release notes and the updater. `npm version` sets it there and in package-lock.json's two copies.
- Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html), read from what the people who use the app notice. A **patch** (1.0.1) fixes something and adds nothing. A **minor** (1.1.0) adds something, and everything that worked before still works the same way. A **major** (2.0.0) takes something away or changes something people rely on, such as a setting, a Windows version or a way of signing in.
- The tag is `v` and the version: `v1.0.0`. A version with a hyphen, such as `1.1.0-rc.1`, is a pre-release: the release workflow marks its draft as one, it is published without `--latest` (step 12 of [Cutting a release](#cutting-a-release)), and the updater never offers it (`allowPrerelease` is false), so only someone who downloads it by hand gets it.
- Numbers only go up. The updater never offers a version lower than the one installed (`allowDowngrade` is false), so the way back from a bad release is always a higher number ([Fixing forward](#fixing-forward)).
- The CHANGELOG follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Each change people can see adds its line under `## [Unreleased]` in the commit that makes it (CLAUDE.md rule 8). A release turns that section into `## [x.y.z] - YYYY-MM-DD`, and the section's body becomes the release notes, with `.github/release-footer.md` after it.
- Some identifiers never change, whatever the version: `APP_ID`, `APP_DATA_DIR` and `APP_REPOSITORY` in `src/shared/branding.ts`, and package.json's `name` (PLAN 11.1, Frozen identifiers). The installer, the install folder, the updater's cache and every installed copy's update feed are named from them.

## Cutting a release

PLAN 11.4 is this list as it was written for 1.0.0, with the 1.0-only steps in it. Here `x.y.z` is the new version.

Before the cut:

1. The checks that come round with each release are done: [the Claude Code check](#a-claude-code-check-each-release) and [the packages checked by hand](#packages-checked-by-hand-each-release). **(author)** Merge or close each open Dependabot pull request.
2. The pages in PLAN Appendix A are read again for changes that bear on the app, and the date of the reading is recorded there (PLAN 11.4 step 3).
3. The CHANGELOG's `## [Unreleased]` section lists every change people can see since the last release, each in its group, written for them. README.md says nothing that the release makes untrue.
4. In a new, empty folder, a fresh clone of `main` passes every check and builds the installer:

   ```powershell
   git clone --branch main https://github.com/MichaelBradetLegris/lapidary.git <new folder>
   cd <new folder>
   npm ci
   npm run branding:check
   npm run check:public
   npm run lint
   npm run format:check
   npm test
   npm run build
   npm run package
   ```

   `npm run package` ends with `verify:package -- --installer` (its `postpackage`), which must pass. Among its checks: no Claude Code binary and no `@anthropic-ai` package anywhere in the package.

The cut, in the working copy of `main`:

5. Rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` with today's date, put a new, empty `## [Unreleased]` above it, and commit. `npm version` refuses to run while the working tree has changes.
6. `npm version x.y.z -m "Release %s"` sets the version in package.json and package-lock.json, commits, and tags that commit `vx.y.z`.
7. `npm run release:check -- vx.y.z` must pass: it is the release workflow's first step. `npm run release:notes -- vx.y.z` prints the notes the draft will carry; read them through.
8. **(author)** `git push origin main`, then `git push origin vx.y.z`. One tag at a time: never `git push --tags` or `git push --all`, since every version tag pushed starts a release build.
9. The Release workflow (`.github/workflows/release.yml`) checks the tag, runs the checks, builds and verifies the installer, and makes a draft release of exactly four files: the installer `<APP_NAME>-Setup-x.y.z.exe`, its `.blockmap`, `latest.yml` and `SHA256SUMS.txt`. `gh run list --workflow release.yml` shows the run. When it fails, see [Fixing forward](#fixing-forward).
10. Download the draft's files into an empty folder with `gh release download vx.y.z --dir <folder>`, then, in Git Bash in that folder, `sha256sum -c SHA256SUMS.txt`, which must say OK for each of its three files. PowerShell's `Get-FileHash` prints the same hashes in capitals.
11. [The smoke checklist](#the-smoke-checklist), up to its publishing step.
12. **(author)** Publish: `gh release edit vx.y.z --draft=false --latest`. The updater sees nothing of a draft; once it is published, every installed copy finds it at its next check. A pre-release is published without `--latest`, as `gh release edit vx.y.z --draft=false`: GitHub never makes a pre-release the latest release, so the latest stays the last stable one, which is the release the updater reads.
13. The rest of the smoke checklist, which needs the release published.

## Fixing forward

A published release is never changed or taken back:

- **Never move a published tag**: no `git tag -f`, no forced push of a tag, no deleting it and pushing it again. The release and its notes point at it, and so does every copy that installed it.
- **Never delete a published release, or its `.blockmap`.** To update a copy, the updater compares the new release's `.blockmap` with the `.blockmap` of the version installed, which it keeps from an earlier update or else downloads from that version's release, and fetches only the blocks that differ. Without it, the update from that version is a full download of the installer, about 109 MiB (PLAN 11.5).
- **Never publish a version lower than one already published.** Nobody would be offered it.

The repository has immutable releases turned on, so GitHub keeps a published release's tag and files as they are in any case.

When a published release is broken, fix the fault on `main`, or revert the change that caused it, and release the next patch version through every step of [Cutting a release](#cutting-a-release). Copies on the broken version are offered the fix at their next check: 15 seconds after the app starts, then every 24 hours.

A version is spent once its release is published. Until then:

- **The workflow failed before making a draft.** **(author)** delete the tag on GitHub, `git push origin --delete vx.y.z`; then `git tag -d vx.y.z`. Fix what the failing step names, commit, tag the new commit with `git tag vx.y.z -m "Release x.y.z"`, run `npm run release:check -- vx.y.z` again, and push `main` and the tag as in step 8. When the first step failed, the tag and the files disagreed and nothing was built.
- **A draft was made, and it or the workflow failed afterwards**, or the draft failed a check or the smoke test. **(author)** delete the draft and its tag, `gh release delete vx.y.z --cleanup-tag --yes`; then `git tag -d vx.y.z`, and go on as above. Add the fix to the `## [x.y.z]` section first if people would notice it.

A failed run stays in the Actions history, and the files it uploaded until they expire a day after the run (PLAN C.93).

## A Claude Code check each release

The app runs the Claude Code each user installed for themselves (PLAN 11.3 q), and Claude Code updates itself on its own schedule. Before each release, check the app against the current Claude Code. **(author)** Bring your own copy up to date first with `claude update`, then note what `claude --version` says. Steps 1, 2 and 6 only read `claude --help`, the CLI reference and Claude Code's changelog, so an agent can make them. Steps 3 and 5 happen in the author's own run, and the agent makes step 4, and any fix they call for, from what the author reports.

1. **Every flag the app passes still exists**, with the meaning the app relies on. Look each one up in `claude --help`; for a flag that `--help` leaves out, look in the [CLI reference](https://code.claude.com/docs/en/cli-reference), which says that `--help` does not list every flag. `src/main/providers/claudeOptions.ts` builds the command line from these:
   - `-p`, `--input-format stream-json`, `--output-format stream-json` and `--verbose`;
   - `--tools ""` (no built-in tools), `--setting-sources=` (no settings files), `--strict-mcp-config`, `--no-session-persistence` and `--permission-mode dontAsk`;
   - `--model <model>`, which the app leaves out for Default, `--effort <level>` with every level the app offers (`low`, `medium`, `high`, `xhigh` and `max`), and `--include-partial-messages`;
   - `--max-turns`, which `--help` has left out since at least 2.1.302: the CLI reference lists it.

   The app also runs `claude --version` and `claude auth status --json` for its launch check, and Setup shows `claude auth login` and `claude update`: `claude auth --help`, `claude auth status --help` and `claude update --help` show they are still there. `--bare` must never be among the flags: it turns off signing in with a Claude plan (CLAUDE.md rule 6). A flag that has gone or changed is fixed before the release, in `claudeOptions.ts`, `test/main/claudeOptions.test.ts` and PLAN 11.3 (q).

2. **`MIN_CLAUDE_CODE` is still right.** It is in `src/shared/ai/claudeStatus.ts`: the oldest Claude Code the app works with, which Setup calls out of date below it. Raise it when the app has come to rely on a flag, a value or a message that older copies lack. The CLI reference's "Requires Claude Code v..." notes and Claude Code's [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) say when each arrived. Raising it is a change people see: it gets a CHANGELOG line, and README.md's Requirements and the Claude Code version example in `.github/ISSUE_TEMPLATE/bug_report.yml` name the new version, which `test/scripts/docs.test.ts` checks.

3. **One live review.** **(author)** Start a development run with a new data folder, `npm run dev:clean -- --user-data-fresh`, which prints the folder's path. It keeps Claude Code's own sign-in but leaves out every `CLAUDE` and `ANTHROPIC` variable, an `ANTHROPIC_API_KEY` among them. In the welcome steps choose a copy of `samples/manuscript` as the manuscript folder, never your vault. Review one chapter with Claude and the Default model. The progress label moves while it runs, the suggestions come back, and `logs/main.log` in the data folder has an `ai.review.done` line and no `ai.review.failed`. Give the agent the version, what the review did and that log, which holds no chapter text (CLAUDE.md rule 9). A review that fails where it used to work, or a reply part the app no longer reads, is a change in Claude Code's stream-json protocol: fix `src/main/providers/claudeCli.ts`, `test/helpers/fakeClaude.ts` and `test/main/claudeCli.test.ts` together, and raise `MIN_CLAUDE_CODE` if older copies cannot take the fix (PLAN C.42).

4. **`RECOMMENDED_CLAUDE_CODE` moves to the current version** once that review has passed on it. It is in `src/shared/ai/claudeStatus.ts`, and the review dialog shows `claude update` to anyone on an older copy, since it may not offer the newest models. One test spells the version: the pin at the top of the `claudeUpdateAdvice` tests in `test/shared/claudeStatus.test.ts`, which moves with it. The fixtures that stand for an up-to-date Claude Code, in `test/shared/setup.test.ts` and `test/renderer/setupScreen.render.test.ts`, read the constant. The review dialog's note names the new version, so this is a change people see: a CHANGELOG line under Changed.

5. **The model list's labels** (`src/shared/ai/claudeModels.ts`). **(author)** In the same run, open the model list in Review with AI and in Settings, and give the agent a screenshot of each. Each entry should read as a family and a version, such as "Default: Opus 5.5" or "Sonnet 5.5", with Default on top and each family's newest version first. An entry that shows only a family name or a model id means Claude Code's list has changed shape, or names a family the app does not know: `versionFromDescription`, `versionFromModelId` and `FAMILIES` read it. The earlier versions the app adds itself (`EARLIER_CLAUDE_MODELS`) come out when Anthropic retires them.

6. **The usage-limit wording.** `USAGE_LIMIT_ERROR_PREFIXES`, `USAGE_WARNING_PREFIXES` and `USAGE_TRANSITION_PREFIXES` in `src/shared/ai/claudeStatus.ts` recognise Claude Code's usage messages by their first words. Read Claude Code's changelog since the last release for any change to those messages, and add a changed one to its list, with a test.

Record what the check found in PLAN: the Claude Code version, and anything changed because of it.

## Packages checked by hand each release

Dependabot (`.github/dependabot.yml`) opens pull requests four times a year: among the npm packages for `openai`, `electron`, `electron-builder` and `electron-updater` only, and for the actions the workflows use. It offers patches and minors of Electron, electron-builder and electron-updater, never a new major, which is a planned task with its own tests; `openai` can come at any version. Nothing merges itself: **(author)** merge or close each pull request by hand, merging once CI has passed and the checks below for its package are done. Security alerts and security updates are turned on or off in the repository's settings, not in that file.

electron-builder and electron-updater also need a look by hand before each release. Their fixes for the line the app is on ship under npm's `v26` tag, while `latest` stays on an older version, so Dependabot may not offer them, and an install that names no version goes back to `latest`. On 2026-10-21 electron-builder's `latest` was 26.15.3 and its `v26` 26.18.0, and electron-updater's `latest` 6.8.9 and its `v26` 6.8.11.

```powershell
npm view electron-builder dist-tags
npm view electron-updater dist-tags
npm view electron@44 version
```

The last line of the third is the newest Electron on the major the app is on.

To take a newer version, by hand or from a Dependabot pull request:

1. Read its release notes for anything that touches the NSIS installer, `latest.yml`, the `.blockmap`, the GitHub provider or the updater's events.
2. By hand, install it with its version: `npm install --save-exact electron-builder@<version>`, and the same for electron-updater or Electron. Without the version, npm takes `latest`.
3. Raise the package's floor in `EXACT_PINS` (`test/scripts/packageScripts.test.ts`) to the new version, and edit PLAN 11.1's Updates row (electron-builder, electron-updater) or Electron row, in the same commit or pull request (CLAUDE.md rule 7).
4. The checks that CONTRIBUTING says must pass before a commit, then `npm run package`, which runs the verifier. For electron-updater, `test/shared/updates.test.ts` drives its real GitHub provider, and `npm run notices` lists the licences of its dependencies; a dependency that ships no licence file is named in `SUPPLIED_MIT_LICENCES` with its version (PLAN C.96). For Electron, start the packaged build once with a new data folder: `npm run dev:clean -- --user-data-fresh --exe dist/win-unpacked/<APP_NAME>.exe`.
5. For `openai`, the tests run against the mock in `test/helpers/mockOpenAi.ts`; run one review against it in the app as CONTRIBUTING's "Testing without a key" describes. The package's own types, `node_modules/openai/resources/responses/responses.d.ts`, say what the Responses API takes.
6. For an action, read its release notes. The release workflow runs only on a version tag, so a change to its actions is first used by the next release.

## The smoke checklist

**(author)**, on a Windows account kept for testing, never the one that holds your chapters: a local standard account (Settings > Accounts > Other users > "Add a user without a Microsoft account"), as in PLAN 11.4. For 1.0.0 it has no Claude Code, no `.claude` folder and no Node; later releases find it as the last one left it. Screenshots and pasted text go to the agent, which checks them and records the results in PLAN.

From the draft, before publishing:

1. Download the installer from the draft in Edge, with a screenshot of every prompt the browser shows. The agent compares them with the steps in `.github/release-footer.md` and corrects the footer, and the draft's notes, where they differ. `Get-FileHash` of the file matches its line in `SHA256SUMS.txt`.
2. Run it, with a screenshot of SmartScreen. After More info and Run anyway there should be only a progress bar: no administrator prompt. A new install goes to `%LOCALAPPDATA%\Programs\manuscript-review`, adds shortcuts with the app's name and starts the app. Its taskbar icon is legible on a light and on a dark taskbar.
3. About shows the new version. Setup describes this account's Claude Code as it is: not installed, on a new account. The theme follows Windows. Opening the app again from a shortcut brings the first window forward.
4. Where Claude Code is not installed yet, install it and sign in by following the Setup screen alone (for 1.0.0, PLAN `setup.14`), and record the lines it printed. The app says Connected once its window has the focus again, and Test the connection works.
5. Copy `samples/manuscript` into Documents and choose it in the welcome steps. Review a chapter with the Default model; accept one suggestion and dismiss another; edit a paragraph; close the window with a paragraph box open, which asks first, and press Cancel; then Save to chapter. A backup appears in `%APPDATA%\ai-grammar-checker\backups`, and Notepad shows the chapter with its line endings. Copy diagnostics and paste the text for the agent, which checks it for the versions and for anything secret.
6. With development switches set in the environment, such as `MANUSCRIPT_REVIEW_USER_DATA` and `MANUSCRIPT_REVIEW_OPENAI_BASE_URL`, the app ignores them, and its `main.log` names them in a `devswitch.ignored` line.
7. Uninstall it from Settings > Apps: the app's folder goes, and `%APPDATA%\ai-grammar-checker` and the updater's cache, `%LOCALAPPDATA%\manuscript-review-updater`, stay. Install the new release again from the same installer and, with Appearance set to Dark, start it: there is no light flash.
8. Uninstall it again and install the previous release's installer from its release page, so that step 9 has a version to update. For 1.0.0 there is none: leave 1.0.0 installed.

Publish (step 12 of [Cutting a release](#cutting-a-release)), then:

9. The update, on the copy of the previous release from step 8. Within 15 seconds of a start it offers the new version with its size, and Download shows its progress. Close the app and start it again: at the check 15 seconds after the start, the update is ready to install again, from the copy already downloaded, with no second download. Restart now while a review runs is refused. Restart now with a paragraph box open asks the close question first; once the box is closed, the overlay and the installer's progress window appear, and the app opens again as the new version, with no administrator prompt and no SmartScreen. Settings and reviews are as they were. The agent reads the download's sizes, "Full: X, To download: Y", from the pasted `main.log` and records them in PLAN.
10. About's Check for updates then says the app is up to date.

For 1.0.0 there is no earlier release to update from: 1.0.0, installed again in step 7 and left there in step 8, says it is up to date, and PLAN 11.4's updater proof does step 9 with 1.0.1.

Steps 7 and 8 split PLAN 11.4 step 14, which was written for 1.0.0, where the copy installed again is the release being cut. For a later release the dark start and the reinstall come before the previous release goes back on, so that they test the release being cut and not the one before it.
