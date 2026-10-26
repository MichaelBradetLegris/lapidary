import { beforeEach, describe, expect, it } from 'vitest';
import { modelOptions, selectedModel } from '../../src/renderer/state/models';
import { useApp } from '../../src/renderer/state/store';

/* Renderer pieces Phase 5c added: the model select for a provider whose setting
   starts empty, ChatGPT's since codex.6 took out the OpenAI API key's, and a
   notification card that carries a button. */

const CHATGPT_MODELS = [
  { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex', description: 'gpt-5.5-codex' },
  { value: 'gpt-5.5', label: 'GPT-5.5 (default)', isDefault: true, description: 'gpt-5.5' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini', description: 'gpt-5-mini' }
];

describe('model select with an empty setting', () => {
  it('shows the list default rather than an empty "(current)" row', () => {
    expect(modelOptions(CHATGPT_MODELS, '')).toEqual(CHATGPT_MODELS);
    expect(selectedModel(CHATGPT_MODELS, '')).toBe('gpt-5.5');
  });

  it('shows a stored choice, even one the list does not have', () => {
    expect(selectedModel(CHATGPT_MODELS, 'gpt-5-mini')).toBe('gpt-5-mini');
    expect(modelOptions(CHATGPT_MODELS, 'gpt-4.1')[0]).toEqual({
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

  it('carries an action and replaces an older card with the same key', () => {
    const { notify } = useApp.getState();
    notify('warn', 'A usage limit is near.', 'chatgpt-usage', 'chatgpt-usage');
    notify('error', 'The usage limit has been reached.', 'chatgpt-usage', 'chatgpt-usage');
    const notes = useApp.getState().notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tone: 'error', action: 'chatgpt-usage', key: 'chatgpt-usage' });
  });

  it('leaves ordinary cards without an action', () => {
    useApp.getState().notify('info', 'Saved.');
    expect(useApp.getState().notifications[0]?.action).toBeUndefined();
  });
});
