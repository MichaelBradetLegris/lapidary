import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../shared/ipc';
import type { Provider, Settings } from '../../shared/types';
import { openedGuidelinesNote } from '../../shared/ui/guidelines';
import type { LastFailure } from '../../shared/ui/setup';
import {
  WELCOME_INTRO,
  WELCOME_SKIP,
  WELCOME_SKIP_TITLE,
  WELCOME_START,
  WELCOME_TITLE,
  welcomeStart,
  welcomeSteps,
  type WelcomeActionId,
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
  onAction: (id: WelcomeActionId) => void;
  onStart: () => void;
  onSkip: () => void;
}

/**
 * The welcome guide as it is drawn, from its steps (`welcomeSteps`): a title
 * with Skip, the three steps, each with where it stands and its buttons, and
 * Start under them. It uses the Setup screen's scroller and centred column
 * (`.setup`, `.setup__page`), so it scrolls across the window as Setup does.
 */
export function WelcomePage({ steps, note = null, onAction, onStart, onSkip }: PageProps): React.JSX.Element {
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
                <h2>{step.title}</h2>
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
                <div className="welcome__actions">
                  {step.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={action.primary ? 'primary' : undefined}
                      disabled={action.disabled}
                      title={action.title}
                      onClick={() => onAction(action.id)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
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
  /** the ChatGPT sign-in, for the first step while ChatGPT is the provider (codex.3) */
  chatgpt?: ChatGptStatus | null;
  /** the Setup screen (setup.7), over the guide until it is closed */
  onSetUpClaude: () => void;
  /** the Setup screen's ChatGPT view (codex.3), over the guide in the same way */
  onSetUpChatGpt?: () => void;
  /** Use ChatGPT instead, and Use Claude instead: the provider setting */
  onUseProvider: (provider: Provider) => void;
  /** the folder picker, which sets the manuscript folder and reads the chapter list */
  onChooseFolder: () => void;
  /** Start and Skip both put the guide away for good (`onboardingDone`) */
  onStart: () => void;
  onSkip: () => void;
}

/**
 * The welcome guide for a fresh install (setup.11, PLAN section 7), in place
 * of the chapter list, the prose and the side panel while `onboardingDone` is
 * false. Claude's step follows App's checks; the folder and style-sheet steps
 * read where the app keeps things (`settings:effective`) and the guidelines
 * file's status (`guidelines:status`) as the guide opens, whenever the folder
 * or the guidelines file changes in the settings, after each of the style
 * sheet's buttons, and whenever the window gets the focus back, as when the
 * author returns from filling the style sheet in. The style sheet's buttons,
 * Open and Open folder, go through `guidelines:open` and `shell:reveal`, as
 * Settings' do (polish.3), each creating the file from the template first
 * when it is missing.
 */
export function WelcomeScreen({
  settings,
  claude,
  claudeLastFailure,
  chatgpt = null,
  onSetUpClaude,
  onSetUpChatGpt,
  onUseProvider,
  onChooseFolder,
  onStart,
  onSkip
}: Props): React.JSX.Element {
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  const [guidelines, setGuidelines] = useState<GuidelinesStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<WelcomeNote | null>(null);
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

  const { manuscriptFolder, guidelinesPath, reviewsFolder } = settings;
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
  }, [manuscriptFolder, guidelinesPath, reviewsFolder, readGuidelines]);

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

  const onAction = (id: WelcomeActionId): void => {
    switch (id) {
      case 'set-up-claude':
        onSetUpClaude();
        break;
      case 'set-up-chatgpt':
        onSetUpChatGpt?.();
        break;
      case 'use-chatgpt':
        onUseProvider('chatgpt');
        break;
      case 'use-claude':
        onUseProvider('claude');
        break;
      case 'choose-folder':
        onChooseFolder();
        break;
      case 'open-guidelines':
        openGuidelines();
        break;
      case 'open-guidelines-folder':
        showGuidelines();
        break;
    }
  };

  const steps = welcomeSteps({
    provider: settings.provider,
    claude,
    claudeLastFailure,
    chatgpt,
    manuscriptFolder,
    guidelinesSetting: guidelinesPath,
    paths,
    guidelines,
    guidelinesProblem: problem
  });

  return <WelcomePage steps={steps} note={note} onAction={onAction} onStart={onStart} onSkip={onSkip} />;
}
