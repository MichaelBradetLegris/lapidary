/**
 * npm run dev:clean -- [options]
 *
 * Starts the app for a verification run in a cleaned environment (PLAN
 * `setup.15`, C.43). Every variable whose name starts with CLAUDE, ANTHROPIC or
 * DISABLE_ is removed first, and their names (never their values) are printed.
 * A shell inside a Claude Code session carries dozens of them, and some change
 * what the app's own Claude Code child does: `ANTHROPIC_BASE_URL` sends its
 * requests through the session's proxy, and `CLAUDE_CODE_SIMPLE` turns off
 * subscription sign-in.
 *
 * The run always uses a scratch userData folder, never the author's real
 * settings, and opens DevTools on port 9222.
 *
 * Options:
 *   --user-data <dir>      use this userData folder (default: .dev-userdata)
 *   --user-data-fresh      use a new, empty userData folder, as on a first run
 *   --claude-config-empty  point Claude Code at a new, empty config folder: not signed in
 *   --claude-config <dir>  point Claude Code at this config folder
 *   --api-key-dummy        set ANTHROPIC_API_KEY to a dummy key: "API key in use"
 *   --no-claude-code       behave as if Claude Code were not installed (development builds only)
 *   --quiet                a quiet test window: shown without taking the foreground, and kept
 *                          rendering while covered (development builds only; PLAN dev.1)
 *   --exe <path>           run a packaged build instead of `npm run dev`
 */
const { spawn } = require('node:child_process');
const { mkdirSync, mkdtempSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appName } = require('./branding.cjs');

const ROOT = path.join(__dirname, '..');
const PREFIX = appName().toLowerCase();
const args = process.argv.slice(2);
const WITH_VALUE = new Set(['--user-data', '--claude-config', '--exe']);
const FLAGS = new Set([
  '--user-data-fresh',
  '--claude-config-empty',
  '--api-key-dummy',
  '--no-claude-code',
  '--quiet'
]);

function usage(problem) {
  if (problem) console.error(problem);
  console.error(
    'Usage: npm run dev:clean -- [--user-data <dir> | --user-data-fresh] [--claude-config-empty | --claude-config <dir>] [--api-key-dummy] [--no-claude-code] [--quiet] [--exe <path>]'
  );
  process.exit(problem ? 1 : 0);
}

const options = {};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') usage();
  if (WITH_VALUE.has(arg)) {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) usage(`${arg} needs a value.`);
    options[arg] = value;
    i += 1;
  } else if (FLAGS.has(arg)) {
    options[arg] = true;
  } else {
    usage(`Unknown option: ${arg}`);
  }
}
if (options['--user-data'] && options['--user-data-fresh'])
  usage('Choose --user-data or --user-data-fresh, not both.');
if (options['--claude-config'] && options['--claude-config-empty'])
  usage('Choose --claude-config or --claude-config-empty, not both.');

const env = { ...process.env };
const removed = Object.keys(env)
  .filter((name) => /^(CLAUDE|ANTHROPIC|DISABLE_)/i.test(name))
  .sort();
for (const name of removed) delete env[name];
console.log(
  removed.length > 0
    ? `Removed from the environment: ${removed.join(', ')}`
    : 'Nothing to remove from the environment.'
);

const userData = options['--user-data']
  ? path.resolve(options['--user-data'])
  : options['--user-data-fresh']
    ? mkdtempSync(path.join(os.tmpdir(), `${PREFIX}-dev-`))
    : path.join(ROOT, '.dev-userdata');
mkdirSync(userData, { recursive: true });
env.MANUSCRIPT_REVIEW_USER_DATA = userData;
env.REMOTE_DEBUGGING_PORT = '9222';
console.log(`userData: ${userData}`);

if (options['--claude-config-empty']) {
  env.CLAUDE_CONFIG_DIR = mkdtempSync(path.join(os.tmpdir(), `${PREFIX}-claude-config-`));
  console.log(`CLAUDE_CONFIG_DIR (empty): ${env.CLAUDE_CONFIG_DIR}`);
} else if (options['--claude-config']) {
  env.CLAUDE_CONFIG_DIR = path.resolve(options['--claude-config']);
  console.log(`CLAUDE_CONFIG_DIR: ${env.CLAUDE_CONFIG_DIR}`);
}
if (options['--api-key-dummy']) {
  env.ANTHROPIC_API_KEY = 'sk-ant-dummy-key-for-verification-only'; // check-public: allow
  console.log('ANTHROPIC_API_KEY: a dummy key');
}
if (options['--no-claude-code']) {
  env.MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE = '1';
  console.log('Behaving as if Claude Code were not installed.');
}
if (options['--quiet']) {
  env.MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW = '1';
  console.log('Quiet window: shown without taking the foreground, and kept rendering while covered.');
}

let child;
if (options['--exe']) {
  for (const flag of ['--no-claude-code', '--quiet']) {
    if (options[flag]) console.log(`Note: a packaged build ignores ${flag}, like every development switch.`);
  }
  child = spawn(
    path.resolve(options['--exe']),
    [`--isolated-user-data=${userData}`, '--remote-debugging-port=9222'],
    {
      env,
      stdio: 'inherit'
    }
  );
} else {
  child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'dev'],
    {
      cwd: ROOT,
      env,
      stdio: 'inherit'
    }
  );
}
child.on('exit', (code) => process.exit(code ?? 0));
