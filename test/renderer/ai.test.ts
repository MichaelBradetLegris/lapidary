import { beforeEach, describe, expect, it } from 'vitest';
import { modelOptions, selectedModel } from '../../src/renderer/state/models';
import { useApp } from '../../src/renderer/state/store';

/* Renderer pieces Phase 5c added: the model select for a provider whose setting
   starts empty, and a notification card that can point at Settings. */

const OPENAI_MODELS = [
  { value: 'gpt-6-preview-mock', label: 'gpt-6-preview-mock' },
  { value: 'gpt-5.5', label: 'gpt-5.5 (default)', isDefault: true },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' }
];

describe('model select with an empty setting', () => {
  it('shows the list default rather than an empty "(current)" row', () => {
    expect(modelOptions(OPENAI_MODELS, '')).toEqual(OPENAI_MODELS);
    expect(selectedModel(OPENAI_MODELS, '')).toBe('gpt-5.5');
  });

  it('shows a stored choice, even one the list does not have', () => {
    expect(selectedModel(OPENAI_MODELS, 'gpt-5-mini')).toBe('gpt-5-mini');
    expect(modelOptions(OPENAI_MODELS, 'gpt-4.1')[0]).toEqual({
      value: 'gpt-4.1',
      label: 'gpt-4.1 (current)'
    });
  });

  it('falls back to the first row, or nothing, when there is no default', () => {
    expect(selectedModel([{ value: 'o3', label: 'o3' }], '')).toBe('o3');
    expect(selectedModel([], '')).toBe('');
  });
});

describe('notification actions', () => {
  beforeEach(() => useApp.getState().clearNotifications());

  it('carries an open-settings action and replaces an older card with the same key', () => {
    const { notify } = useApp.getState();
    notify('warn', 'OpenAI needs an API key.', 'openai-key', 'open-settings');
    notify('error', 'OpenAI rejected the API key.', 'openai-key', 'open-settings');
    const notes = useApp.getState().notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tone: 'error', action: 'open-settings', key: 'openai-key' });
  });

  it('leaves ordinary cards without an action', () => {
    useApp.getState().notify('info', 'Saved.');
    expect(useApp.getState().notifications[0]?.action).toBeUndefined();
  });
});
