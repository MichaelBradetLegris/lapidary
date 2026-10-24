import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, REQUEST_CHANNELS } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, EFFORT_LEVELS } from '../../src/shared/types';

describe('ipc contract', () => {
  it('lists every request channel exactly once', () => {
    expect(new Set(REQUEST_CHANNELS).size).toBe(REQUEST_CHANNELS.length);
  });

  it('lists every event channel exactly once', () => {
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
  });

  it('never reuses a name across requests and events', () => {
    const overlap = REQUEST_CHANNELS.filter((c) => (EVENT_CHANNELS as readonly string[]).includes(c));
    expect(overlap).toEqual([]);
  });

  it('has a default effort that is a legal effort level', () => {
    expect(EFFORT_LEVELS).toContain(DEFAULT_SETTINGS.effort);
  });

  it('has no channel for an OpenAI API key, the provider codex.6 took out', () => {
    expect(REQUEST_CHANNELS.filter((c) => c.startsWith('secrets:') || c.includes('openai'))).toEqual([]);
  });
});
