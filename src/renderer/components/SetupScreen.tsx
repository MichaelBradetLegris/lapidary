import { useState } from 'react';
import type { RuntimeStatus } from '../../shared/ipc';
import { Command } from './Command';

type Platform = 'windows-powershell' | 'windows-cmd' | 'macos-linux';

interface Props {
  runtime: RuntimeStatus;
  checking: boolean;
  onCheckAgain: () => void;
  onClose?: () => void;
}

const TABS: Array<{ id: Platform; label: string }> = [
  { id: 'windows-powershell', label: 'Windows PowerShell' },
  { id: 'windows-cmd', label: 'Windows CMD' },
  { id: 'macos-linux', label: 'macOS, Linux, WSL' }
];

const INSTALL: Record<Platform, string[]> = {
  'windows-powershell': ['irm https://claude.ai/install.ps1 | iex'],
  'windows-cmd': [
    'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd'
  ],
  'macos-linux': ['curl -fsSL https://claude.ai/install.sh | bash']
};

const ALTERNATIVES = [
  'brew install --cask claude-code',
  'winget install Anthropic.ClaudeCode',
  'npm install -g @anthropic-ai/claude-code'
];

function defaultPlatform(): Platform {
  if (navigator.userAgent.includes('Windows')) return 'windows-powershell';
  return 'macos-linux';
}

/**
 * Shown when the Claude Code runtime is missing or not signed in. The app never
 * offers its own sign-in: the author signs in with Anthropic's own flow, and
 * this screen only says how (plan section 5.6).
 */
export function SetupScreen({ runtime, checking, onCheckAgain, onClose }: Props): React.JSX.Element {
  const [platform, setPlatform] = useState<Platform>(defaultPlatform());
  const missing = runtime.state === 'missing-binary';

  return (
    <div className="setup">
      <h1>
        {missing
          ? 'Install Claude Code'
          : runtime.state === 'error'
            ? 'Claude is not ready'
            : 'Sign in to Claude'}
      </h1>
      {runtime.message ? <p className="side__empty">{runtime.message}</p> : null}

      {missing ? (
        <>
          <p>
            This app runs the unmodified Claude Code binary. Install it once, then sign in with your own
            account.
          </p>
          <div className="setup__tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={platform === tab.id ? 'setup__tab--active' : ''}
                onClick={() => setPlatform(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {INSTALL[platform].map((command) => (
            <Command key={command} text={command} />
          ))}
          <h3>Alternatives</h3>
          {ALTERNATIVES.map((command) => (
            <Command key={command} text={command} />
          ))}
          <h3>Then</h3>
          <p>Check the install, then sign in:</p>
          <Command text="claude --version" />
          <Command text="claude" />
        </>
      ) : (
        <>
          <p>
            Open a terminal, run <code>claude</code>, and sign in with your Claude account in the browser. A
            Pro, Max, Team, Enterprise or Console account is required; the free plan does not include Claude
            Code.
          </p>
          <Command text="claude" />
          <p>
            Alternatively, set <code>ANTHROPIC_API_KEY</code> in the environment before launching this app.
            The key takes precedence over the subscription login.
          </p>
          <p>Then come back here and check again.</p>
        </>
      )}

      <p className="side__empty">
        This app never sees your credentials. Sign-in happens entirely inside Claude Code.{' '}
        <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">
          Setup documentation
        </a>
      </p>

      <div className="modal__actions">
        <button type="button" className="primary" onClick={onCheckAgain} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}
