import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_FIELD_CHARS,
  formatFields,
  loggableErrorFields,
  scrub,
  stackFrames,
  truncate
} from '../../src/shared/diagnostics/redact';

/* hardening.2: what may reach the log. Profile paths below are fixtures. */

const HOME = 'C:\\Users\\Ann Example'; // check-public: allow
const ctx = { home: HOME };

describe('scrub', () => {
  it('removes OpenAI and Anthropic key shapes', () => {
    expect(scrub('key sk-proj-abcdefghijklmnop1234 in use')).toBe('key [key] in use'); // check-public: allow
    expect(scrub('sk-ant-api03-ABCDEFGHIJKLMNOPQRST_xyz')).toBe('[key]'); // check-public: allow
    expect(scrub('task-abcdefghijklmnopqrst stays')).toBe('task-abcdefghijklmnopqrst stays');
    expect(scrub('sk-short')).toBe('sk-short');
  });

  it('removes Bearer tokens and email addresses', () => {
    expect(scrub('Authorization: Bearer abc.def-ghi_jkl')).toBe('Authorization: Bearer [token]');
    expect(scrub('signed in as ann.o.example+books@mail.example.com.')).toBe('signed in as [email].');
  });

  it('removes the home directory in every spelling, whatever its case', () => {
    expect(scrub('C:\\Users\\Ann Example\\Vault\\Ch 1.md', ctx)).toBe('~\\Vault\\Ch 1.md'); // check-public: allow
    expect(scrub('c:/users/ann example/Vault', ctx)).toBe('~/Vault'); // check-public: allow
    expect(scrub('{"path":"C:\\\\Users\\\\Ann Example\\\\Vault"}', ctx)).toBe('{"path":"~\\\\Vault"}'); // check-public: allow
    expect(scrub('file:///C:/Users/Ann%20Example/Vault/x.md', ctx)).toBe('file:///~/Vault/x.md'); // check-public: allow
    expect(scrub('C%3A%5CUsers%5CAnn%20Example%5Cx', ctx)).toBe('~%5Cx'); // check-public: allow
  });

  it('leaves a longer name that only starts like the home directory', () => {
    expect(scrub('C:\\Users\\Ann Examples\\x', ctx)).toBe('C:\\Users\\Ann Examples\\x'); // check-public: allow
  });

  it('leaves package paths with an @ in them alone', () => {
    const p = 'node_modules\\@anthropic-ai\\claude-agent-sdk\\sdk.mjs and node_modules/@openai/x';
    expect(scrub(p)).toBe(p);
  });

  it('never lets a key or an email through, whatever surrounds it', () => {
    const keyChars = fc.stringMatching(/^[A-Za-z0-9_-]{16,40}$/);
    const local = fc.stringMatching(/^[a-z0-9._%+-]{1,12}$/);
    const domain = fc.stringMatching(/^[a-z0-9-]{1,10}\.[a-z]{2,6}$/);
    fc.assert(
      fc.property(fc.string(), keyChars, local, domain, fc.string(), (before, key, user, host, after) => {
        const secret = `sk-${key}`;
        const email = `${user}@${host}`;
        const out = scrub(`${before} ${secret} ${email} ${after}`);
        expect(out).not.toContain(secret);
        expect(out).not.toContain(email);
      })
    );
  });
});

describe('formatFields', () => {
  it('keeps scalars, quotes what needs quoting and drops everything else', () => {
    expect(
      formatFields({
        count: 3,
        ok: true,
        none: null,
        name: 'Chapter 12.md',
        plain: 'abc',
        nested: { text: 'chapter prose' },
        list: ['chapter prose'],
        fn: () => 1
      })
    ).toBe('count=3 ok=true none=null name="Chapter 12.md" plain=abc');
  });

  it('scrubs and cuts every string', () => {
    const line = formatFields({ who: 'ann@example.com', long: 'x'.repeat(1000) });
    expect(line).toContain('who=[email]');
    expect(line.length).toBeLessThan(MAX_FIELD_CHARS + 20);
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('loggableErrorFields', () => {
  it('never logs the text JSON.parse failed on', () => {
    let caught: unknown;
    try {
      JSON.parse('Here is the review you asked for');
    } catch (err) {
      caught = err;
    }
    const fields = loggableErrorFields(caught, ctx);
    expect(fields['name']).toBe('SyntaxError');
    expect(JSON.stringify(fields)).not.toContain('Here is');
  });

  it('never takes a quoted line that starts with "at" for a frame (hardening.3b)', () => {
    // V8 quotes about ten characters of the input with their line breaks, so
    // its message can hold a line that looks like a frame.
    for (const input of ['\nat ZQX', 'X\n at ZQX', '{"a":\n  at ZQX']) {
      let caught: unknown;
      try {
        JSON.parse(input);
      } catch (err) {
        caught = err;
      }
      const stack = (caught as Error).stack ?? '';
      expect(stack.split('\n').some((line) => /^\s*at ZQX/.test(line))).toBe(true);
      const fields = loggableErrorFields(caught, ctx);
      expect(fields['name']).toBe('SyntaxError');
      expect(String(fields['frames'])).toMatch(/^at JSON\.parse/);
      expect(JSON.stringify(fields)).not.toContain('ZQX');
    }
  });

  it('logs only the code of an app error that quotes model output, and never its detail', () => {
    const reply = Object.assign(new Error('The model said: Dear diary...'), {
      name: 'AppFailure',
      code: 'claude-invalid-output',
      detail: 'Dear diary, full chapter text'
    });
    expect(loggableErrorFields(reply)).toEqual({ code: 'claude-invalid-output' });
    const refusal = Object.assign(new Error('Refused: chapter excerpt'), {
      name: 'AppFailure',
      code: 'claude-refusal'
    });
    expect(loggableErrorFields(refusal)).toEqual({ code: 'claude-refusal' });
    const io = Object.assign(new Error('Could not save.'), {
      name: 'AppFailure',
      code: 'io',
      detail: 'secret'
    });
    expect(loggableErrorFields(io)).toEqual({ code: 'io', message: 'Could not save.' });
  });

  it('logs an errno error without its path', () => {
    const err = Object.assign(new Error(`ENOENT: no such file, open '${HOME}\\Vault\\Ch.md'`), {
      code: 'ENOENT',
      errno: -4058,
      syscall: 'open',
      path: `${HOME}\\Vault\\Ch.md`
    });
    expect(loggableErrorFields(err, ctx)).toEqual({
      name: 'Error',
      code: 'ENOENT',
      errno: -4058,
      syscall: 'open'
    });
  });

  it('logs other errors with a scrubbed message and their frames', () => {
    const err = new TypeError('bad thing for ann@example.com');
    const fields = loggableErrorFields(err, ctx);
    expect(fields['name']).toBe('TypeError');
    expect(fields['message']).toBe('bad thing for [email]');
    expect(typeof fields['frames']).toBe('string');
  });

  it('handles values that are not errors', () => {
    expect(loggableErrorFields('sk-abcdefghijklmnopqrstu leaked')).toEqual({ error: '[key] leaked' }); // check-public: allow
  });
});

describe('stackFrames', () => {
  it('keeps only "at" lines, scrubbed and capped', () => {
    const stack = [
      'Error: message with chapter text',
      '    at read (C:\\Users\\Ann Example\\app\\main.js:1:2)', // check-public: allow
      ...Array.from({ length: 20 }, (_, i) => `    at f${i} (x.js:${i}:1)`)
    ].join('\n');
    const frames = stackFrames(stack, ctx);
    expect(frames[0]).toBe('at read (~\\app\\main.js:1:2)');
    expect(frames).toHaveLength(8);
    expect(frames.join(' ')).not.toContain('chapter text');
  });
});
