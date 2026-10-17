# Lapidary

[![CI](https://github.com/MichaelBradetLegris/lapidary/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelBradetLegris/lapidary/actions/workflows/ci.yml)

A Windows desktop app for reviewing AI-suggested copyedits to novel chapters kept as Markdown (`.md`) or plain text (`.txt`), for example in an Obsidian vault.

You open a chapter, ask for a review, and every suggested change floats above the words it would replace. You accept or dismiss each one, in either direction, as often as you like. Larger issues (continuity, pacing, point of view) arrive as comments in the margin. Nothing is written to your chapter until you press **Save to chapter**.

Two services can do the reviewing. You need one of them:

- **Claude**, through the Claude Code you install and sign in to yourself, on your own Claude plan or an Anthropic API key.
- **OpenAI**, on an API key you paste into Settings, billed per token to your OpenAI account.

## Requirements

- Windows 10 or 11, 64-bit (x64). No builds are made for other systems.
- For Claude: Claude Code 2.1.266 or newer, signed in with a Claude plan that includes Claude Code (Pro, Max, Team or Enterprise; the free plan does not), or with an Anthropic Console account or API key. Run `claude update` now and then to get the newest models.
- For OpenAI: an OpenAI API key, on an account with credit.
- To build the app yourself: Node.js 24, or 26 and later, or 22.18 and later on the 22 line. Versions 23 and 25 do not work. Git only if you clone the repository.

## Build from source

There is no released installer yet. Until there is, build one yourself:

1. Install [Node.js](https://nodejs.org/), the version the site marks LTS. Its installer offers optional tools for native modules; you do not need them.
2. Get the source code: on the repository's GitHub page click **Code**, then **Download ZIP**, and unzip it. If you use Git, clone the repository instead.
3. Open the unzipped folder that holds `package.json`; it may sit inside a folder of the same name. Right-click an empty space in it and choose **Open in Terminal**. On Windows 10, hold Shift while you right-click and choose **Open PowerShell window here**.
4. Type these two commands, pressing Enter after each:

   ```powershell
   npm.cmd ci
   npm.cmd run package
   ```

   Type `npm.cmd`, not `npm`: Windows blocks PowerShell scripts by default, and plain `npm` would start one. The commands need an internet connection and take a few minutes. npm prints several warnings about deprecated packages and install scripts; these are expected. The build worked if no line starts with `npm error`.

5. Open the `dist` folder inside it. Double-click `Lapidary-<version>-x64.exe` and follow its steps to install the app; it adds a Start menu entry and a desktop shortcut. Or run `Lapidary-<version>-portable.exe`, which needs no installing. These builds are not code-signed, so if Windows says it protected your PC, click **More info**, then **Run anyway**.

To update later, get the newest source the same way, run the two commands again and run the new installer.

## Connecting Claude

The app does not include Claude Code. You install it once and sign in with your own account:

1. Open PowerShell: click Start, type `PowerShell` and press Enter. Paste this line (Ctrl+V) and press Enter:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

2. Sign in. In the same window, run:

   ```powershell
   & "$env:USERPROFILE\.local\bin\claude.exe" auth login
   ```

   or open a new PowerShell window and run `claude auth login`. A browser opens: sign in with your Claude account. For an Anthropic Console account billed per token, end the command with `--console`, as in `claude auth login --console`.

3. Check it worked: in a new PowerShell window, `claude auth status --text` shows your account.
4. Start the app. The status bar at the bottom says "Claude ready" followed by your account's email. If the app was already open, open **Settings**, click **Setup** beside "Claude account", and click **Check again**.

Before your first review, decide whether Anthropic may train its models on your chapters: see **Model training** under [Privacy](#privacy).

The app's Setup screen does not show these steps yet. It says to run `claude` and sign in there, which works too, and it lists other ways to install Claude Code. Use the PowerShell installer above: the app does not find a copy installed with npm.

### With an Anthropic API key instead

1. Create a key in the Claude Console. Reviews are then billed per token to that Console account, not to a Claude plan.
2. Add it as a Windows environment variable: open the Start menu, search for "environment variables", and choose **Edit environment variables for your account**. Under "User variables", click **New**, enter the name `ANTHROPIC_API_KEY`, paste the key as the value, and click **OK**. Then click **OK** again to close the Environment Variables window; closing it any other way loses the change.
3. Start the app, or quit it and start it again if it was running. Claude Code uses the key ahead of any sign-in, and the status bar says "Claude ready (API key)". Delete the variable to go back to your plan.

The key must be a real environment variable, set before the app starts. Claude Code settings in `~/.claude/settings.json`, such as an `env` block or `apiKeyHelper`, are not read, because the app starts Claude Code without your settings files.

## Connecting OpenAI

1. Create a key at https://platform.openai.com/api-keys. It belongs to an OpenAI Platform account, which is separate from a ChatGPT subscription and is billed per token. Make sure the account has credit.
2. In the app, open **Settings**, paste the key into the **OpenAI API key** field, and click **Save key**. The field empties at once and the status line changes to "saved in Settings, encrypted (ends xxxx)".
3. In **Review with AI**, choose **OpenAI (API key)** as the provider.

Alternatively, set `OPENAI_API_KEY` as an environment variable, the same way as `ANTHROPIC_API_KEY` above, before starting the app. It is used only when no key is saved, and Settings says which one is active. **Remove key** deletes the saved key.

## First run

1. Click **Settings**, then **Change** beside **Manuscript folder**, and choose the folder that holds your novel's chapters. The app lists every `.md` and `.txt` file in it and its subfolders, skipping folders whose names start with a dot, such as `.obsidian` and `.trash`. So choose the novel's own folder rather than a whole vault of other notes. Reviews are saved in the app's data folder unless you also choose a **Reviews folder**.
2. Connect at least one provider, as above.
3. Fill in the guidelines file.

## The guidelines file

`GUIDELINES.md` in your manuscript folder is sent with every review, after the app's own instructions. It is created from a template the first time you start a review or open it from Settings, and **Settings > Open guidelines file** opens it. Fill in your style sheet: spelling variant, Oxford comma, character names, invented words, anything the reviewer must not "fix". Both providers read the same file.

## Reviewing a chapter

1. Pick a chapter on the left.
2. Click **Review with AI**. The dialog shows the chapter's size, the provider, model and effort, your guidelines file, and what happened last time. For OpenAI it also shows where the key comes from; **Start review** stays disabled until there is one.
3. While it runs, a card at the bottom of the page shows progress and a **Cancel review** button. A review usually takes a minute or two. The chapter is read-only until it finishes, because the result replaces the current set of suggestions; you can open other chapters meanwhile. If the page has changes that are not saved to the chapter yet, the dialog says so, because the review reads the chapter file: **Save 3 changes, then review** writes them into the chapter and then starts, so the review sees them (if the save does not go through, nothing is sent and the dialog says why), and **Review without them** asks first, then leaves them in the old review, which you can reopen from History.
4. When it finishes, each suggestion appears in the text:
   - **Pending**: your original, underlined in the category colour, with the suggestion above it.
   - **Accepted**: the suggestion, with a plain grey underline; your original floats above it after "was".
   - **Dismissed**: your original, under a dotted grey line, with the suggestion faded above it.
5. Click a suggestion to accept or undo it. The small x beside the floating text, a right-click, or `d` dismisses. `j` and `k` move between suggestions, `a` accepts, `u` sets a suggestion back to pending, `n` jumps to the next paragraph with a comment, and Ctrl+F finds text.
6. Comments sit in the margin beside their paragraph and in the side panel. Resolving one greys it out; it does not disappear.
7. **Bulk** accepts or dismisses every pending suggestion, or resets decisions, after telling you exactly how many will change.

**Text size.** Ctrl+plus and Ctrl+minus zoom the whole window from 80% to 200%, Ctrl+0 goes back to 100%, and Ctrl+wheel works too. The same control sits at the right of the status bar. The level is remembered.

**Models.** The review dialog lists the models the provider offers. For Claude the list comes from your installed Claude Code, so it depends on its version and your plan, and each model shows its version (such as Opus 5.5 or Sonnet 5). "Default" is whatever Claude Code currently recommends for your account.

The status bar shows which provider and model answered and what it cost. Claude's figure is Claude Code's own estimate at API prices; on a Claude plan it is not what you pay. OpenAI's is marked "estimate": it is this app's arithmetic from a price table, and it is left out for models the table does not know. Every review is kept in **History** in the side panel, labelled with its provider and model.

**Submit manual review** turns a corrected copy of the chapter (pasted, or loaded from a file) into the same kind of suggestions, so you can review someone else's edits the same way. The copy is compared with the chapter file, so when the page has changes the file does not have yet, Build review asks first: save them, then build; build without them; or cancel.

## Editing in the app

You can write your own words as well as accept suggested ones:

- the faint pen beside a paragraph's number opens the whole paragraph for editing in place; several can be open at once, and **Done** (or Ctrl+Enter) applies each one;
- the pencil on any suggestion rewrites its replacement (`e` does the same for the focused one);
- **Edit text** on a comment opens its paragraph with the quoted words selected.

Each word or phrase you change becomes its own suggestion, already accepted and marked "you", and can be undone the same way. A suggestion your change runs into moves to the Unanchored list with its reasoning kept. Typing exactly what a suggestion proposed simply accepts that suggestion. Emptying the box deletes the paragraph.

Paragraphs are numbered from 1 beside the text, and the AI is shown the same numbers, so "paragraph 12" in a comment means the one labelled 12.

## Saving to the chapter

**Save to chapter** is the only thing that writes to your manuscript. It writes the text as it currently reads, with every accepted change applied, in one atomic step that keeps the file's line endings and encoding. **Copy result** puts the same text on the clipboard instead. Selecting part of the page and copying it gives just those words, as they currently read, in plain text: none of the floating suggestions or labels come with them.

If the chapter changes on disk while it is open (for example, you edit it in Obsidian), the app notices, re-anchors the suggestions onto the new text and tells you how many it could not place. Avoid editing the same chapter in Obsidian while you are accepting changes here.

Your decisions are kept in the review automatically as you go; there is nothing to save there, and the status bar says when they were last kept ("Decisions kept 14:02"). Until you press **Save to chapter**, the button counts the changes the chapter file does not have yet ("Save 3 changes to chapter"), a dot sits before the chapter name, and the status bar says "3 not saved to chapter". The same dot marks the chapter in the list on the left, and stays there when you open another chapter or restart the app, so you can see which chapters still have changes to save. Ctrl+S saves too. Opening another chapter, or a review from History, while changes are not saved asks first: save them, keep them for later, or stay. Keep for later keeps your decisions in the review and any paragraph you are editing, which opens again when you come back to the chapter. Closing the window asks the same: save and close, close and keep them for later, or cancel.

## Privacy

**The app itself** has no analytics, no crash reporting and no update check. Links you click open in your web browser.

**What a review sends, and when.** Only when you start a review in the Review with AI dialog (**Start review**, or, when the page has changes not saved to the chapter, **Save 3 changes, then review** once the save has gone through, or **Review without them** once you have answered its question) does the app send the provider you chose:

- the app's own review instructions;
- your guidelines file;
- the chapter's text as saved on disk, without its frontmatter, as numbered paragraphs;
- the chapter's file name, without its folder or extension.

It does not send the folder's path, other chapters, earlier reviews, your decisions or your settings. For OpenAI, the app also asks OpenAI for its list of models, which sends no chapter text, when the review dialog shows OpenAI or after you save a key.

**Claude Code at launch.** Each time the app starts, whichever provider you use, it runs your Claude Code to check its version and sign-in and to get its list of models. It sends no prompt, so this uses none of your plan's usage. Claude Code itself may contact Anthropic whenever it runs, as it does in a terminal.

**Claude Code's own data collection.** Claude Code reports usage metrics, which Anthropic says never include your prompts, code or file paths, and, for Pro and Max sign-ins, error reports. That is Claude Code's doing, not the app's. To turn them off, add these Windows environment variables, the same way as `ANTHROPIC_API_KEY` above, and then start the app:

- `DISABLE_TELEMETRY` with the value `1`;
- `DISABLE_ERROR_REPORTING` with the value `1`.

They apply to Claude Code everywhere, not only in this app. Setting them in `~/.claude/settings.json` has no effect here, because the app starts Claude Code without your settings files. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off both and more, but it also stops Claude Code updating itself.

**Model training.** On a Pro or Max plan, Anthropic trains its models on your Claude Code sessions, these reviews included, when the model-improvement setting in your Claude account is on. Check it at [claude.ai/settings/data-privacy-controls](https://claude.ai/settings/data-privacy-controls). Anthropic keeps the data for 5 years with the setting on, and for 30 days with it off. Team, Enterprise and API accounts are not used for training unless the organisation chooses to share its data.

**No transcripts.** The app runs Claude Code with `--no-session-persistence`, so Claude Code saves no transcript of a review on your computer.

**OpenAI.** Requests are sent with `store: false`, so OpenAI does not keep the response for later retrieval. OpenAI says it does not train on API data by default, but it may keep abuse-monitoring logs for up to 30 days.

**Credentials.**

- **Claude**: the app never reads, stores, displays or proxies your Claude credentials. You sign in through Anthropic's own flow in Claude Code. An `ANTHROPIC_API_KEY` or other Claude Code sign-in variable in your environment reaches Claude Code unread and unchanged, because Claude Code inherits the app's environment.
- **OpenAI**: your API key is the one credential the app stores. It is encrypted with Windows' data protection for your login (Electron `safeStorage`) and written to `secrets.json` in the app's data folder, never to `settings.json`. Only the app's background process decrypts it, at the moment of a request. It is never shown again and never sent to the app's window, which only learns whether a key exists and its last four characters. If Windows cannot encrypt, the app refuses to save the key and tells you to use `OPENAI_API_KEY` instead.
- The app offers no "Sign in with ChatGPT": OpenAI documents API keys as the route for third-party apps, and a ChatGPT subscription does not pay for API use.

**Where the app keeps its data.** In `%APPDATA%\ai-grammar-checker` (its name dates from before the app was renamed):

- `settings.json`: your settings. If it was ever unreadable, a copy named `settings.json.corrupt-<time>` sits beside it.
- `secrets.json`: the encrypted OpenAI key. It exists only once you have saved a key.
- `reviews\`: your reviews, unless you chose another reviews folder in Settings. Each review holds the full text of its chapter.
- `logs\main.log`, and `main.1.log` once it fills: a short record of events, such as start, quit and problems the app worked around. It never holds chapter text, prompts, replies, keys or email addresses, and your user folder appears in it as `~`.
- Folders that Electron keeps for itself, such as caches.

Your chapters change only when you click **Save to chapter**. Besides them, the app adds to your manuscript folder only `GUIDELINES.md`, once and never overwritten, the chapters you make with **New chapter** and, if you chose a reviews folder inside it, your reviews. Claude Code keeps its own sign-in and settings; the app holds none of them.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and the rules for changes. To report a security problem, see [SECURITY.md](SECURITY.md). The design log is [PLAN.md](PLAN.md), and the rules for coding agents are in [CLAUDE.md](CLAUDE.md).

## Licence and disclaimer

MIT licence; see [LICENSE](LICENSE).

Lapidary is an independent open-source project. It runs Claude Code, made by Anthropic, which each user installs and signs in to themselves. It can also use OpenAI's API. Lapidary is not made, endorsed or sponsored by Anthropic or OpenAI, and it includes no Anthropic software.

Suggestions and comments come from an AI model and can be wrong or misleading. Check each one, and verify any factual claim, before you accept it.
