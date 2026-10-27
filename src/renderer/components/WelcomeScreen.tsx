import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../shared/ipc';
import type { Provider, Settings } from '../../shared/types';
import { FOCUS_HOLD_SECONDS, focusHoldLabel, normalizeFocusHold } from '../../shared/ui/focusMode';
import { openedGuidelinesNote } from '../../shared/ui/guidelines';
import {
  APPEARANCE_LABEL,
  APPEARANCE_NOTE,
  FOCUS_HOLD_AFTER,
  FOCUS_HOLD_BEFORE,
  FOCUS_MODE_LABEL,
  FOCUS_MODE_NOTE
} from '../../shared/ui/settingsDialog';
import type { LastFailure, SetupFor } from '../../shared/ui/setup';
import { normalizeTheme, THEME_LABELS, THEMES } from '../../shared/ui/theme';
import {
  FOLDER_PICKER_TITLES,
  FOLDER_SETTINGS,
  OPTIONAL,
  WELCOME_INTRO,
  WELCOME_SKIP,
  WELCOME_SKIP_TITLE,
  WELCOME_START,
  WELCOME_TITLE,
  welcomeLandingAction,
  welcomeProviderFor,
  welcomeStart,
  welcomeSteps,
  type WelcomeAction,
  type WelcomeActionId,
  type WelcomeFolderId,
  type WelcomeInput,
  type WelcomeLook,
  type WelcomeStep
} from '../../shared/ui/welcome';
import { call, errorMessage } from '../state/client';
import { IconCheck } from './icons';

/** A line under the style sheet's buttons: what the last of them did, or why it did nothing. */
export interface WelcomeNote {
  tone: 'info' | 'error';
  text: string;
}

interface PageProps {
  steps: WelcomeStep[];
  /** under the style sheet's buttons */
  note?: WelcomeNote | null;
  /** under a folder row: why its Change was refused, as main put it (setup.18) */
  rowNotes?: Partial<Record<WelcomeFolderId, string>>;
  /** under step 3's rows: why a change there was refused, as main put it (setup.20) */
  lookNote?: string | null;
  onAction: (id: WelcomeActionId) => void;
  /** a change in step 3's rows: the one setting it writes, as Settings writes it (setup.20) */
  onChoose: (patch: Partial<WelcomeLook>) => void;
  onStart: () => void;
  onSkip: () => void;
}

/** "(optional)" after a title, read as part of it. */
function Optional(): React.JSX.Element {
  return <span className="welcome__optional"> ({OPTIONAL})</span>;
}

function Buttons({
  actions,
  onAction
}: {
  actions: WelcomeAction[];
  onAction: (id: WelcomeActionId) => void;
}): React.JSX.Element {
  return (
    <div className="welcome__actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-action={action.id}
          className={action.primary ? 'primary' : undefined}
          disabled={action.disabled}
          title={action.title}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/** Step 3's ids: one guide at a time, and Settings, which can open over it, takes its ids from useId. */
const lookId = (part: string): string => `welcome-look-${part}`;

/**
 * Step 3's two rows (setup.20): Appearance and Focus mode, each with the
 * control and the note Settings' App section has, in the same words, the
 * row's name labelling the list or the box as it does there. A change writes
 * its setting at once. No hooks, so the tests can call it as a function.
 */
function LookRows({
  look,
  onChoose
}: {
  look: WelcomeLook;
  onChoose: (patch: Partial<WelcomeLook>) => void;
}): React.JSX.Element {
  return (
    <div className="welcome__choices">
      <div className="welcome__choice" data-choice="appearance">
        <div className="welcome__choice-head">
          <h3>
            <label htmlFor={lookId('appearance')}>{APPEARANCE_LABEL}</label>
          </h3>
          <select
            id={lookId('appearance')}
            value={look.theme}
            aria-describedby={lookId('appearance-note')}
            onChange={(e) => onChoose({ theme: normalizeTheme(e.target.value) })}
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
        </div>
        <p className="welcome__choice-note" id={lookId('appearance-note')}>
          {APPEARANCE_NOTE}
        </p>
      </div>
      <div className="welcome__choice" data-choice="focus-mode">
        <div className="welcome__choice-head">
          <h3>
            <label htmlFor={lookId('focus')}>{FOCUS_MODE_LABEL}</label>
          </h3>
          <span className="welcome__focus">
            <input
              id={lookId('focus')}
              type="checkbox"
              checked={look.focusMode}
              aria-describedby={lookId('focus-note')}
              onChange={(e) => onChoose({ focusMode: e.target.checked })}
            />
            <label htmlFor={lookId('focus-hold')}>{FOCUS_HOLD_BEFORE}</label>
            <select
              id={lookId('focus-hold')}
              value={look.focusHoldSeconds}
              aria-describedby={lookId('focus-note')}
              onChange={(e) => onChoose({ focusHoldSeconds: normalizeFocusHold(Number(e.target.value)) })}
            >
              {FOCUS_HOLD_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {focusHoldLabel(seconds)}
                </option>
              ))}
            </select>
            <span>{FOCUS_HOLD_AFTER}</span>
          </span>
        </div>
        <p className="welcome__choice-note" id={lookId('focus-note')}>
          {FOCUS_MODE_NOTE}
        </p>
      </div>
    </div>
  );
}

/**
 * The welcome guide as it is drawn, from its steps (`welcomeSteps`): a title
 * with Skip, the four steps, each with where it stands and its buttons, the
 * first with its two folder rows, the second with its two sections
 * (setup.18) and the third with Appearance and Focus mode (setup.20), and
 * Start under them. It uses the Setup screen's scroller and centred column
 * (`.setup`, `.setup__page`), so it scrolls across the window as Setup does.
 */
export function WelcomePage({
  steps,
  note = null,
  rowNotes = {},
  lookNote = null,
  onAction,
  onChoose,
  onStart,
  onSkip
}: PageProps): React.JSX.Element {
  const start = welcomeStart(steps);
  return (
    <div className="setup welcome">
      <div className="setup__page">
        <div className="setup__head">
          <h1>{WELCOME_TITLE}</h1>
          <button type="button" title={WELCOME_SKIP_TITLE} onClick={onSkip}>
            {WELCOME_SKIP}
          </button>
        </div>
        <p className="welcome__intro">{WELCOME_INTRO}</p>

        <ol className="welcome__steps">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`welcome__step welcome__step--${step.done ? 'done' : 'todo'}`}
              data-step={step.id}
            >
              <span
                className="welcome__mark"
                role="img"
                aria-label={step.done ? `Step ${index + 1}, done` : `Step ${index + 1}, to do`}
              >
                {step.done ? <IconCheck size={14} /> : index + 1}
              </span>
              <div className="welcome__body">
                <h2>
                  {step.title}
                  {step.optional ? <Optional /> : null}
                </h2>
                {/* Where the step stands follows what the app finds, such as
                    each check of Claude, so it is read out when it changes. */}
                <p className="welcome__status" aria-live="polite">
                  {step.status}
                </p>
                {step.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {step.facts.length > 0 ? (
                  <ul className="welcome__facts">
                    {step.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                ) : null}
                {step.actions.length > 0 ? <Buttons actions={step.actions} onAction={onAction} /> : null}
                {/* Where reviews and backups are kept, each in the app's data
                    folder unless Change chooses another (setup.18). */}
                {step.rows.length > 0 ? (
                  <div className="welcome__rows">
                    {step.rows.map((row) => {
                      const refused = rowNotes[row.id];
                      return (
                        <div key={row.id} className="welcome__row" data-row={row.id}>
                          <div className="welcome__row-text">
                            <h3>
                              {row.label}
                              <Optional />
                            </h3>
                            <p className="welcome__row-value" title={row.path ?? undefined}>
                              {row.value}
                            </p>
                            <p className="welcome__row-note">{row.note}</p>
                          </div>
                          <Buttons actions={row.actions} onAction={onAction} />
                          {refused ? (
                            <p className="welcome__note welcome__note--error" role="alert">
                              {refused}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* Claude and ChatGPT, each with where it stands, in its Setup
                    view's own words, read out as it changes (setup.18). */}
                {step.sections.length > 0 ? (
                  <div className="welcome__sections">
                    {step.sections.map((section) => (
                      <section
                        key={section.id}
                        className={`welcome__section welcome__section--${section.done ? 'done' : 'todo'}`}
                        data-section={section.id}
                        aria-label={section.title}
                      >
                        <h3>{section.title}</h3>
                        <p className="welcome__section-status" aria-live="polite">
                          {section.status}
                        </p>
                        {section.lines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                        <Buttons actions={section.actions} onAction={onAction} />
                      </section>
                    ))}
                  </div>
                ) : null}
                {/* Appearance and Focus mode, as Settings' App section has
                    them (setup.20); main's refusal of a change under them. */}
                {step.look ? <LookRows look={step.look} onChoose={onChoose} /> : null}
                {step.id === 'look' && lookNote ? (
                  <p className="welcome__note welcome__note--error" role="alert">
                    {lookNote}
                  </p>
                ) : null}
                {step.id === 'style-sheet' && note ? (
                  <p
                    className={`welcome__note welcome__note--${note.tone}`}
                    role={note.tone === 'error' ? 'alert' : 'status'}
                  >
                    {note.text}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <div className="welcome__foot">
          {start.note ? <p className="welcome__start-note">{start.note}</p> : null}
          <button type="button" className="primary" disabled={start.disabled} onClick={onStart}>
            {WELCOME_START}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  settings: Settings;
  /** Claude's last check, null until the first one answers */
  claude: RuntimeStatus | null;
  claudeLastFailure: LastFailure | null;
  /** the ChatGPT sign-in, for its section (codex.3, setup.18) */
  chatgpt?: ChatGptStatus | null;
  /** a ChatGPT sign-in waits for the browser, as the ChatGPT view shows it */
  chatgptWaiting?: boolean;
  /** the Setup screen (setup.7), over the guide until it is closed */
  onSetUpClaude: () => void;
  /** the Setup screen's ChatGPT view (codex.3), over the guide in the same way */
  onSetUpChatGpt?: () => void;
  /** the ChatGPT view, over the guide, with its sign-in started (setup.18) */
  onSignInChatGpt?: () => void;
  /** the provider setting, which a section's button may change (`welcomeProviderFor`, setup.18) */
  onUseProvider: (provider: Provider) => void;
  /** the folder picker, which sets the manuscript folder and reads the chapter list */
  onChooseFolder: () => void;
  /** the settings as main saved them, after a folder row's Change (setup.18) */
  onApply?: (next: Settings) => void;
  /** Start and Skip both put the guide away for good (`onboardingDone`) */
  onStart: () => void;
  onSkip: () => void;
  /**
   * The view of the Setup screen the author has just left by Done, Close or
   * Escape, when the guide's own button opened it (setup.19): that section's
   * button takes the focus as the guide shows again. Read as the guide is
   * drawn.
   */
  landOn?: SetupFor | null;
}

/**
 * The welcome guide for a fresh install (setup.11, PLAN section 7), in place
 * of the chapter list, the prose and the side panel while `onboardingDone` is
 * false. The folder and style-sheet steps read where the app keeps things
 * (`settings:effective`) and the guidelines file's status
 * (`guidelines:status`) as the guide opens, whenever a folder or the
 * guidelines file changes in the settings, after each of the style sheet's
 * buttons, and whenever the window gets the focus back, as when the author
 * returns from filling the style sheet in; the AI agents' sections follow
 * App's checks of Claude and ChatGPT. The folder rows' Change picks a folder
 * and saves it as Settings does, showing main's refusal under the row
 * (setup.18). Step 3's Appearance and Focus mode save each change as
 * Settings' App section does, so main switches the theme as it answers and
 * Settings shows the choice (setup.20). The style sheet's buttons, Open and
 * Open folder, go through `guidelines:open` and `shell:reveal`, as Settings'
 * do (polish.3), each creating the file from the template first when it is
 * missing.
 */
export function WelcomeScreen({
  settings,
  claude,
  claudeLastFailure,
  chatgpt = null,
  chatgptWaiting = false,
  onSetUpClaude,
  onSetUpChatGpt,
  onSignInChatGpt,
  onUseProvider,
  onChooseFolder,
  onApply,
  onStart,
  onSkip,
  landOn = null
}: Props): React.JSX.Element {
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  const [guidelines, setGuidelines] = useState<GuidelinesStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<WelcomeNote | null>(null);
  const [rowNotes, setRowNotes] = useState<Partial<Record<WelcomeFolderId, string>>>({});
  const [lookNote, setLookNote] = useState<string | null>(null);
  /* Only the newest answer of each read counts, so a slow one cannot put
     back what a later one, after the folder changed, has replaced. */
  const pathsSeq = useRef(0);
  const statusSeq = useRef(0);

  const readGuidelines = useCallback((): void => {
    const ticket = ++statusSeq.current;
    call('guidelines:status', undefined).then(
      (status) => {
        if (ticket !== statusSeq.current) return;
        setGuidelines(status);
        setProblem(null);
      },
      (err: unknown) => {
        if (ticket !== statusSeq.current) return;
        setGuidelines(null);
        setProblem(errorMessage(err));
      }
    );
  }, []);

  const { manuscriptFolder, guidelinesPath, reviewsFolder, backupsFolder } = settings;
  useEffect(() => {
    const ticket = ++pathsSeq.current;
    call('settings:effective', undefined).then(
      (next) => {
        if (ticket === pathsSeq.current) setPaths(next);
      },
      () => {
        if (ticket === pathsSeq.current) setPaths(null);
      }
    );
    readGuidelines();
  }, [manuscriptFolder, guidelinesPath, reviewsFolder, backupsFolder, readGuidelines]);

  /* Back from Obsidian or the editor where the style sheet was filled in. */
  useEffect(() => {
    window.addEventListener('focus', readGuidelines);
    return () => window.removeEventListener('focus', readGuidelines);
  }, [readGuidelines]);

  const openGuidelines = (): void => {
    setNote(null);
    call('guidelines:open', undefined).then(
      (result) => {
        setNote({ tone: 'info', text: openedGuidelinesNote(result) });
        readGuidelines();
      },
      (err: unknown) => setNote({ tone: 'error', text: errorMessage(err) })
    );
  };

  const showGuidelines = (): void => {
    setNote(null);
    // Main creates the file from the template first when it is missing.
    call('shell:reveal', { target: 'guidelines' }).then(
      () => readGuidelines(),
      (err: unknown) => setNote({ tone: 'error', text: errorMessage(err) })
    );
  };

  /* A folder row's Change (setup.18): the folder picker, then the setting, as
     Settings' Change does. Main refuses a backups folder that is the
     manuscript folder or inside it, and keeps the one chosen before; its words
     stand under the row until the row's next Change. */
  const changeFolder = (row: WelcomeFolderId): void => {
    const key = FOLDER_SETTINGS[row];
    setRowNotes((notes) => ({ ...notes, [row]: undefined }));
    const current = settings[key];
    call('dialog:pick-folder', {
      title: FOLDER_PICKER_TITLES[row],
      ...(current ? { defaultPath: current } : {})
    })
      .then((folder) => (folder ? call('settings:set', { [key]: folder }) : null))
      .then((next) => {
        if (next) onApply?.(next);
      })
      .catch((err: unknown) => setRowNotes((notes) => ({ ...notes, [row]: errorMessage(err) })));
  };

  /* Step 3's rows (setup.20): each change writes its one setting through
     settings:set, as Settings' App section does, so main switches the theme
     as it answers and Settings shows the choice. A refusal stands under the
     rows until the next change. */
  const choose = (patch: Partial<WelcomeLook>): void => {
    setLookNote(null);
    call('settings:set', patch)
      .then((next) => onApply?.(next))
      .catch((err: unknown) => setLookNote(errorMessage(err)));
  };

  const input: WelcomeInput = {
    provider: settings.provider,
    claude,
    claudeLastFailure,
    chatgpt,
    chatgptWaiting,
    manuscriptFolder,
    reviewsSetting: reviewsFolder,
    backupsSetting: backupsFolder,
    guidelinesSetting: guidelinesPath,
    paths,
    guidelines,
    guidelinesProblem: problem,
    look: {
      theme: settings.theme,
      focusMode: settings.focusMode,
      focusHoldSeconds: settings.focusHoldSeconds
    }
  };

  /* A section's button makes its agent the provider Review with AI starts
     with while the provider is the other one and cannot review
     (`welcomeProviderFor`, setup.18), then opens its Setup view. */
  const chooseFor = (section: SetupFor): void => {
    const provider = welcomeProviderFor(section, input);
    if (provider) onUseProvider(provider);
  };

  const onAction = (id: WelcomeActionId): void => {
    switch (id) {
      case 'choose-folder':
        onChooseFolder();
        break;
      case 'change-reviews-folder':
        changeFolder('reviews');
        break;
      case 'change-backups-folder':
        changeFolder('backups');
        break;
      case 'set-up-claude':
        chooseFor('claude');
        onSetUpClaude();
        break;
      case 'sign-in-chatgpt':
        chooseFor('chatgpt');
        onSignInChatGpt?.();
        break;
      case 'set-up-chatgpt':
        chooseFor('chatgpt');
        onSetUpChatGpt?.();
        break;
      case 'open-guidelines':
        openGuidelines();
        break;
      case 'open-guidelines-folder':
        showGuidelines();
        break;
    }
  };

  const steps = welcomeSteps(input);

  /* Back from the Setup screen a section's button opened (setup.19): the
     focus goes to that section's button, Set up Claude, or Sign in with
     ChatGPT or Set up ChatGPT, whichever it shows now (`welcomeLandingAction`),
     so the keyboard carries on from the section. Read as the guide is drawn,
     so a development run's second pretend drawing hands it over again. */
  const [landing] = useState(() => (landOn ? welcomeLandingAction(landOn, steps) : null));
  useEffect(() => {
    if (landing === null) return;
    document.querySelector<HTMLElement>(`.welcome [data-action="${landing}"]`)?.focus();
  }, [landing]);

  return (
    <WelcomePage
      steps={steps}
      note={note}
      rowNotes={rowNotes}
      lookNote={lookNote}
      onAction={onAction}
      onChoose={choose}
      onStart={onStart}
      onSkip={onSkip}
    />
  );
}
