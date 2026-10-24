import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BASE_CLAUDE_ARGS, buildClaudeEnv, claudeArgs } from '../../src/main/providers/claudeOptions';

/* setup.1a: exactly how the app runs Claude Code. A change here changes what the
   user's Claude Code is allowed to do, so the lists are pinned. */

describe('claudeArgs', () => {
  it('always removes tools, MCP, settings and session files, and answers prompts with no', () => {
    expect(BASE_CLAUDE_ARGS).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--setting-sources=',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk'
    ]);
    expect(claudeArgs()).toEqual([...BASE_CLAUDE_ARGS]);
  });

  it('adds the model, effort, turns and streaming in a fixed order', () => {
    expect(claudeArgs({ model: 'opus', effort: 'high', maxTurns: 3, partialMessages: true })).toEqual([
      ...BASE_CLAUDE_ARGS,
      '--model',
      'opus',
      '--effort',
      'high',
      '--max-turns',
      '3',
      '--include-partial-messages'
    ]);
  });

  it('passes no model for Default or an empty setting', () => {
    expect(claudeArgs({ model: 'default' })).toEqual([...BASE_CLAUDE_ARGS]);
    expect(claudeArgs({ model: '  ' })).toEqual([...BASE_CLAUDE_ARGS]);
  });

  it('never uses --bare, which would turn off subscription sign-in', () => {
    expect(claudeArgs({ model: 'opus', effort: 'max', maxTurns: 1, partialMessages: true })).not.toContain(
      '--bare'
    );
  });
});

describe('buildClaudeEnv', () => {
  const base = {
    PATH: 'C:\\Windows',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ANTHROPIC_MODEL: 'claude-forced',
    OPENAI_API_KEY: 'sk-openai',
    CLAUDE_CONFIG_DIR: 'C:\\cfg',
    claude_code_simple: '1',
    MANUSCRIPT_REVIEW_OPENAI_BASE_URL: 'http://127.0.0.1:4599/v1',
    MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL: 'http://127.0.0.1:4600',
    MREV_VERBOSE: '1',
    HTTPS_PROXY: 'http://proxy:8080',
    UNSET: undefined
  };

  it('removes exactly the forced model, the OpenAI key, bare mode and the dev switches', () => {
    expect(buildClaudeEnv(base)).toEqual({
      PATH: 'C:\\Windows',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      CLAUDE_CONFIG_DIR: 'C:\\cfg',
      HTTPS_PROXY: 'http://proxy:8080',
      CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1'
    });
  });

  it('does not change the environment it was given', () => {
    const copy = { ...base };
    buildClaudeEnv(base);
    expect(base).toEqual(copy);
  });

  /* The Usage Policy bars services that "misrepresent the product or client being
     used" (PLAN Appendix A). The app never sets or overrides Claude Code's client
     or entrypoint identity (CLAUDE.md rule 6): the one variable it adds reports
     start-up failures, and every other variable is the user's own, unchanged. */
  const ADDED = 'CLAUDE_CODE_STARTUP_FAILURE_RESULTS';

  it('adds no variable but the start-up failure switch, so no entrypoint or user-agent appears', () => {
    expect(buildClaudeEnv({})).toEqual({ [ADDED]: '1' });
  });

  it('never gives any other variable a value of its own, whatever the environment', () => {
    const name = fc
      .oneof(
        fc.constantFrom(
          'CLAUDE_CODE_ENTRYPOINT',
          'CLAUDE_AGENT_SDK_VERSION',
          'ANTHROPIC_CUSTOM_HEADERS',
          'CLAUDECODE',
          'PATH',
          ADDED.toLowerCase()
        ),
        fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/)
      )
      .filter((key) => key !== '__proto__');
    fc.assert(
      fc.property(fc.dictionary(name, fc.string()), (env) => {
        for (const [key, value] of Object.entries(buildClaudeEnv(env))) {
          expect(value).toBe(key === ADDED ? '1' : env[key]);
        }
      })
    );
  });
});
