/**
 * The one place the application's display name is written down.
 *
 * "Lapidary" is the craft of cutting and polishing stone, obsidian included, and
 * lapidary prose is polished and concise, as if cut in stone: shaped by many
 * small, deliberate passes, which is what this app is for. It was called "Stet"
 * until the 1.0 release plan (PLAN 11). Nothing anywhere else may spell the name
 * out, and `test/branding.test.ts` fails if something does. The window title, the
 * HTML title, package.json's productName and the electron-builder config all take
 * it from here; `scripts/branding.cjs` reads this file for the consumers that
 * cannot import TypeScript.
 *
 * This module must not import Node or DOM APIs (CLAUDE.md rule 4).
 */
export const APP_NAME = 'Lapidary';

/**
 * The folder under %APPDATA% that holds settings and the default reviews
 * folder. It deliberately does NOT follow APP_NAME: Electron derives userData
 * from the application name, so renaming the app would otherwise move the
 * author's settings and orphan every review saved in the default folder.
 */
export const APP_DATA_DIR = 'ai-grammar-checker';

/**
 * Frozen from 1.0. The NSIS uninstall entry and the Windows taskbar identity
 * (AUMID) derive from it, so changing it would leave every installed copy behind
 * as a separate app that the updater can no longer reach.
 */
export const APP_ID = 'dev.bradetlegris.manuscript-review';

/**
 * Frozen from 1.0. Every installed copy's update feed names this repository, so
 * moving it strands installs that cannot learn the new address.
 */
export const APP_REPOSITORY = 'MichaelBradetLegris/lapidary';

/** One line for the About-style places that want a sentence rather than a name. */
export const APP_TAGLINE = 'Review suggested copyedits one change at a time.';

/**
 * What the app is, and is not, in one paragraph for the README and the About
 * dialog (opensource.6, release.9). "Runs Claude Code" is the plain-text wording
 * Anthropic's legal page allows for a product that uses Claude Code; the name
 * and logo carry no Claude, Anthropic or OpenAI marks (PLAN Appendix A, section
 * 9 risk 8). `test/branding.test.ts` checks that README.md carries it word for
 * word.
 */
export const DISCLAIMER = `${APP_NAME} is an independent open-source project. It runs Claude Code, made by Anthropic, which each user installs and signs in to themselves. It can also review with ChatGPT, on each user's own ChatGPT plan, through OpenAI's Sign in with ChatGPT. ${APP_NAME} is not made, endorsed or sponsored by Anthropic or OpenAI, and it includes no Anthropic software.`;

/**
 * The caution that goes with every review, for the README, the About dialog and
 * the review dialog (release.9). Plain good practice for a language model's
 * output. `test/branding.test.ts` checks that README.md carries it word for word.
 */
export const AI_OUTPUT_NOTICE =
  'Suggestions and comments come from an AI model and can be wrong or misleading. Check each one, and verify any factual claim, before you accept it.';
