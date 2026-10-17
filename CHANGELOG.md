# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Work towards 1.0.

### Added

- Dark mode. The app follows your computer's light or dark setting, and the window's title bar follows with it.
- An Appearance setting in Settings: Match system, Light or Dark. The window switches as soon as you choose, and the choice is kept for the next start.
- Reviews follow their chapter. When you rename or move a chapter in Obsidian, or move the whole vault, open the chapter again from the list and its reviews come with it; a card says where they were. A renamed or moved chapter is recognised by its text, so this works only when the text has not changed since the app last read it. A chapter in a moved vault is recognised by its file name and the name of its folder.
- The review dialog says when your Claude Code is older than 2.1.283 and may not offer the newest models. It shows `claude update` ready to copy, the same command by full path for a terminal that does not find `claude`, and Check again.
- On a Claude Pro plan, a new user gets Sonnet preselected once, and the review dialog notes that Opus models, Default included, use your limits fastest.
- A review that fails because Claude Code is out of date or its sign-in has ended now also checks Claude again and opens the Setup screen, as a missing or signed-out Claude Code already did.
- The status bar tells more Claude states apart: not installed, out of date, not signed in, sign-in ended, usage limit reached, could not check, and ready through an API key.
- A log file, `logs/main.log` in the app's data folder, records when the app starts and quits, and problems it works around, such as a settings file it could not read. It is rotated at 1 MiB, and keys, email addresses and your home folder are scrubbed from it.
- The MIT licence.
- Ctrl+S saves to the chapter, as Save to chapter does. It does nothing while a dialog, a question or Settings is open, or when there is nothing to save. In a paragraph box it says to press Done first, and with the suggestion editor open it says to press the editor's Save first.
- Backups. Before every Save to chapter, the version of the chapter it replaces is copied to the app's data folder, into `backups`, in a folder of that chapter's own, named by the time of the save. For each chapter, the copies from the last 20 saves are kept, plus the first of each day for 30 days. If the copy cannot be made, nothing is written and a card says why. Backups never go into your manuscript folder.
- The status bar counts the changes the chapter file does not have yet, as in "3 not saved to chapter", in orange, beside the pending, accepted and dismissed counts.

### Changed

- Save to chapter with nothing to save says "The chapter already matches the page." and leaves the file untouched, its modified time included; it used to write the same text again. It no longer asks about paragraph boxes you opened but did not change.
- The card shown when the chapter changed on disk now also says how many decisions changed to match the file, as when you made or undid a suggested change in Obsidian. So does the card Save to chapter shows when it finds the chapter changed.
- In the light theme, faint grey text and the brown of warnings and word-choice suggestions are a little darker, so they are easier to read. Links are in the app's blue, and text fields and drop-down lists use the same near-black text as the rest of the app. The OpenAI key field in Settings has the same thin frame and rounded corners as the other fields.
- The focused suggestion has a thin gold outline when it sits in the paragraph of the comment you have selected, where its yellow was hard to tell from the paragraph's own yellow.
- The app is now called Lapidary; it was Stet. Settings, the stored OpenAI key and reviews in the default folder stay where they were. The Windows installer replaces an installed Stet, which has the same app id, and keeps its data folder.
- Claude reviews run through the Claude Code you install and sign in to yourself, and Lapidary includes no Anthropic software. It looks for Claude Code where Anthropic's installer puts it, then on your PATH. It needs version 2.1.266 or newer; an older copy is reported as out of date, with `claude update` as the fix. On Windows only `claude.exe` is used, so a copy installed only through npm is reported as not installed.
- The review dialog's provider list says "Claude" rather than "Claude (subscription)", since Claude Code can run on a Claude plan or an API key.
- Checking Claude at start-up no longer sends anything to the model, so it uses none of your plan's usage. It asks Claude Code for its version, its sign-in status and its model list instead.
- The Claude model list comes from your installed Claude Code, so new models arrive when Claude Code updates, without a new version of Lapidary.
- New settings use Claude Code's Default model, which leaves the choice to Claude Code and your account, instead of Opus. A settings file that already names a model keeps it.
- A chapter opens on the review you last worked in: making a decision in an older review from History makes it the current one.
- Save to chapter writes only `.md` and `.txt` chapters inside the manuscript folder, or ones opened from it earlier in the session, and never the guidelines file.
- Starting Lapidary while it is already running brings the open window forward instead of starting a second copy.
- New guidelines files tell the reviewer to leave Obsidian syntax alone: links, embeds, tags, block ids, footnotes, callouts, comments, code, maths, URLs and HTML. The visible text of a link can still be corrected. The style sheet now asks to be filled in before the first review. An existing `GUIDELINES.md` is never changed, so copy these lines across if you want them.
- Opening the guidelines file shows it in its folder, and says why, when no app is set to open that type of file.
- OpenAI requests always go to api.openai.com. The `OPENAI_BASE_URL`, `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` environment variables are ignored.
- Save to chapter shows how many changes it will write, as in "Save 3 changes to chapter", and its tooltip says what pressing it does. The dot that says something is not saved to the chapter is now orange and sits before the chapter name, and it shows only while there is something to save: it used to show after any decision, even one you turned back, or a comment you resolved. A long chapter name ends in "…" so the toolbar stays on one row; the full name is in its tooltip.
- The status bar says "Decisions kept" and the time in hours and minutes where it said "Review saved", which read as if the chapter had been saved. Its tooltip says the chapter file changes only when you press Save to chapter.
- The legend behind the status bar's ? button explains the orange dot, says the e key rewrites the focused suggestion, and no longer mentions editing selected words with e, which the pen beside each paragraph replaced. It scrolls when the window is too short to show it whole.

### Fixed

- The legend behind the status bar's ? button wraps its text inside its box instead of running across the chapter.
- Comments and suggestion labels stay beside their quotes after a Save that splits, joins or deletes a paragraph. Comments that had already shifted move back beside their quotes when the review opens.
- Chapters with the same name in different folders no longer share reviews, and a Save in one can no longer write the other's accepted changes.
- A decision made just before opening another chapter or a History entry is no longer lost.
- A chapter that is not UTF-8 is refused with a message saying what it most likely is (UTF-16, an older encoding such as Windows-1252, a few damaged characters, or not text at all) and how to fix it. It used to open with replacement characters that Save would then have written into the file. Files over 4 MiB are refused too.
- Save waits out a chapter that another program, such as a virus scanner, OneDrive or Obsidian, holds open for a moment, trying for about a second and a half. If the chapter changes meanwhile, the save stops and the other program's version stays. If it still cannot save, the message says why in plain words, including how to let Lapidary through Windows Controlled folder access.
- `.txt` chapters changed in another program reload like `.md` ones, and a deleted `.txt` chapter leaves the list. An editor that saves by replacing the file now reloads the open chapter too, and changes to other files no longer refresh the list.
- Claude is no longer reported ready while Claude Code is signed out, and Claude Code's "Not logged in" answer to a review is reported as not signed in.
- A Claude error that mentioned the word "author" is no longer taken for a sign-in problem.
- Copying text from the chapter gives plain text: no hidden word "insertion", no blank line before each suggestion, and none of the app's formatting. Find no longer matches that hidden word either.
- The installed app could run without showing its window. The window now appears within about 3 seconds at most.
- The app no longer overwrites a settings file it could not read, such as one another program holds open. It leaves the file alone, and changing a setting in Settings or the review dialog, or choosing the manuscript folder, says why it could not be saved; a zoom change still applies until the app closes. A damaged settings file is copied aside as `settings.json.corrupt-<time>` before the defaults replace it, and the log says so if the copy fails.
- Dropping a file onto the window no longer replaces the app, which lost any open paragraph boxes. Dragging text inside the page still works.
- The side panel no longer shows two scrollbars side by side. The suggestions list and the part below it (the focused suggestion's details, comments, Unanchored and History) now scroll separately, so the details stay in view while you step through the list with j and k, and come back into view if you had scrolled that part down. When the window is short, as at 175% zoom and above in a window of the default size, the panel scrolls as one.
- On a standard-resolution screen, text in the manuscript no longer switches between two kinds of font smoothing while it scrolls, which could make it look heavier until it stopped. The suggestions list's text now uses the same ClearType smoothing as the rest of the window; it was greyscale.
- Questions such as "Replace the open review?" and the Bulk confirmations open in front of everything else. They could open hidden behind Submit manual review or the suggestion editor, where Enter still answered them. The button Enter picks shows its focus ring even when you opened the question with the mouse.
- A suggestion accepted, or another chapter opened, at the moment Save to chapter was writing the file could be counted as saved without being in the chapter. Decisions now wait until the save is done, and a chapter or History entry you open meanwhile opens once it is.
- A Save to chapter that failed left its card on screen after the next save, so repeated tries piled up identical red cards, even above "Saved to the chapter file.". Each save's card now replaces the last one's. The card saying the chapter changed on disk and was rebased still stays, since it counts the suggestions lost.
- Rewriting a suggestion you had already saved to the chapter showed the new words on the page, but Save to chapter kept the old ones in the file. The new words now count as a change that is not saved yet, and Save writes them. With Accept now unticked, the saved words stay and your words wait as a suggestion; Save used to put the original words back.
- A suggestion rewritten to the words the chapter already holds no longer counts as a change to save when you turn it back or dismiss it afterwards. Save to chapter offered to write one change, then said the chapter already matched the page.
- After the chapter changed on disk, a deletion you had saved, such as one word of a doubled "the the", could come back as a suggestion to delete the word that remained, or another word like it, which accepting and saving would have deleted. It now stays saved. A deletion you had accepted and also made in the file, in Obsidian for example, could make Save to chapter delete the word left beside it; it is now taken as made.
- After the chapter changed on disk, a suggestion to add words could be taken as already made wherever those words appeared in the chapter, and turning it back would then have removed them there. It now stays where it was suggested. A suggestion to add or delete words whose place can no longer be told for certain, as when the words either side of it changed, moves to Unanchored instead of being placed by a guess, and Save to chapter writes nothing for it. The guess could fall inside a word, so that accepting the suggestion and saving wrote its words into the middle of another, as in "quite gvery ood".

### Removed

- The copy of Claude Code that came inside the app with the Claude Agent SDK. Install Claude Code with Anthropic's installer; the Setup screen shows how.

## [0.1.0] - 2026-09-27

Private builds for the author, under the name Stet.

### Added

- Open a folder of Markdown (`.md`) and plain-text (`.txt`) chapters anywhere on disk, such as an Obsidian vault, and review one chapter at a time.
- Review with Claude on your own Claude subscription or an `ANTHROPIC_API_KEY`, through the Claude Agent SDK and the copy of Claude Code it included, or with OpenAI on an API key that is stored encrypted on the computer. A review dialog chooses the provider, model and effort and shows the chapter's size, the guidelines file and the previous review. A Setup screen says how to sign in to Claude.
- Every suggested change floats above the words it would replace, with a category and a reason. Accept or dismiss each one, in either direction, by mouse or with `j`, `k`, `a`, `d` and `u`.
- A suggestions list beside the chapter, filter chips by category, and Accept all, Dismiss all and Reset behind a confirmation. Accept all and Dismiss all only move undecided suggestions.
- Comments on continuity, plot and flow, as notes in the margin beside their paragraphs and in the side panel, with paragraph numbers beside the text. Comments can be resolved and unresolved.
- Edit a paragraph in place, or the text of any suggestion. Your own edits become suggestions like the model's.
- Submit manual review: paste or load a corrected copy of the chapter, and every difference becomes a suggestion.
- New chapter creates a `.md` or `.txt` chapter in the manuscript folder, and never overwrites an existing file.
- Save to chapter writes the accepted changes into the file, keeping its line endings, byte order mark and final newline. Nothing else writes to an existing chapter. Copy result puts the corrected text on the clipboard.
- Reviews are saved automatically after the model answers and after every decision, with a History list per chapter.
- A chapter changed in Obsidian reloads, and its suggestions find their place again, with a note of any that could not be found. The chapter under review is read-only until the result arrives, and other chapters stay open.
- A guidelines file, `GUIDELINES.md`, created in the manuscript folder from a template and sent with every review.
- Find with Ctrl+F, and window zoom from 80% to 200%, kept between sessions.
- A Windows installer and a portable exe.
