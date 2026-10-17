import { describe, expect, it } from 'vitest';
import {
  EARLIER_CLAUDE_MODELS,
  claudeModelLabel,
  claudeModelOptions,
  versionFromDescription,
  versionFromModelId,
  type SdkModel
} from '../../src/shared/ai/claudeModels';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  canZoom,
  nextZoom,
  normalizeZoom,
  zoomLabel
} from '../../src/shared/ui/zoom';

/* What supportedModels() returned on 2026-09-27, trimmed to the fields read. */
const SDK_0_3_283: SdkModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    description: 'Opus 5.5 · Best for everyday, complex tasks'
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus',
    description: 'Opus 5.5 · Best for everyday, complex tasks'
  },
  {
    value: 'claude-fable-5-1[1m]',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks'
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks'
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers'
  }
];

/* The older SDK the app shipped with, where Opus was 5 and carried 1M context. */
const SDK_0_3_266: SdkModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks'
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks'
  }
];

describe('model versions (round 5)', () => {
  it('reads the version from a model id, ignoring date and context suffixes', () => {
    expect(versionFromModelId('claude-opus-5-5')).toBe('Opus 5.5');
    expect(versionFromModelId('claude-opus-5')).toBe('Opus 5');
    expect(versionFromModelId('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(versionFromModelId('claude-fable-5-1[1m]')).toBe('Fable 5.1');
    expect(versionFromModelId('opus')).toBeNull();
    expect(versionFromModelId('gpt-5-mini')).toBeNull();
  });

  it('reads the version from the start of a description', () => {
    expect(versionFromDescription('Opus 5.5 · Best for everyday, complex tasks')).toBe('Opus 5.5');
    expect(versionFromDescription('Opus 5 with 1M context · Best for everyday')).toBe('Opus 5');
    expect(versionFromDescription('Best for everyday tasks')).toBeNull();
    expect(versionFromDescription(undefined)).toBeNull();
  });

  it('labels every entry with its version', () => {
    expect(claudeModelOptions(SDK_0_3_283).map((m) => m.label)).toEqual([
      'Default: Opus 5.5',
      'Opus 5.5',
      'Opus 5',
      'Fable 5.1',
      'Sonnet 5',
      'Haiku 4.5'
    ]);
  });

  it('adds Opus 5 by its full id, right after the newest Opus', () => {
    const options = claudeModelOptions(SDK_0_3_283);
    expect(options[2]).toEqual({ value: 'claude-opus-5', label: 'Opus 5' });
    expect(options.find((m) => m.value === 'default')?.isDefault).toBe(true);
  });

  it('does not add an earlier version the list already covers through an alias', () => {
    const labels = claudeModelOptions(SDK_0_3_266).map((m) => m.label);
    expect(labels).toEqual(['Default: Opus 5 (1M context)', 'Opus 5 (1M context)']);
    // No separate "Opus 5" row: the list's own Opus already is Opus 5.
    expect(labels.filter((l) => l.startsWith('Opus 5'))).toEqual(['Opus 5 (1M context)']);
  });

  it('still shows a model it cannot read a version from', () => {
    expect(claudeModelLabel({ value: 'mystery', displayName: 'Mystery' })).toBe('Mystery');
    expect(claudeModelLabel({ value: 'mystery' })).toBe('mystery');
  });

  it('puts an earlier version at the end when its family is not listed at all', () => {
    const options = claudeModelOptions([SDK_0_3_283[3] as SdkModel]);
    expect(options.map((m) => m.value)).toEqual(['sonnet', ...EARLIER_CLAUDE_MODELS.map((e) => e.value)]);
  });
});

describe('the list the app actually received (2026-09-27)', () => {
  // Inside the app the SDK also listed older versions, all at the end.
  const received: SdkModel[] = [
    ...SDK_0_3_283.slice(0, 2),
    { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable' },
    ...SDK_0_3_283.slice(3),
    { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5' },
    { value: 'claude-fable-5', resolvedModel: 'claude-fable-5', displayName: 'Fable 5' },
    { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8' },
    { value: 'claude-opus-4-7', resolvedModel: 'claude-opus-4-7', displayName: 'Opus 4.7' },
    { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6' },
    { value: 'claude-sonnet-4-6', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' }
  ];

  it('groups each family together, newest first, with the default on top', () => {
    expect(claudeModelOptions(received).map((m) => m.label)).toEqual([
      'Default: Opus 5.5',
      'Opus 5.5',
      'Opus 5',
      'Opus 4.8',
      'Opus 4.7',
      'Opus 4.6',
      'Fable 5.1',
      'Fable 5',
      'Sonnet 5',
      'Sonnet 4.6',
      'Haiku 4.5'
    ]);
  });

  it('adds nothing the SDK already lists', () => {
    const values = claudeModelOptions(received).map((m) => m.value);
    expect(values.filter((v) => v === 'claude-opus-5')).toHaveLength(1);
    expect(values).toHaveLength(received.length);
  });
});

describe('zoom (round 5)', () => {
  it('starts at normal size', () => {
    expect(DEFAULT_ZOOM).toBe(1);
    expect(DEFAULT_SETTINGS.zoom).toBe(1);
    expect(ZOOM_STEPS).toContain(1);
  });

  it('steps through the levels and stops at either end', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1.1, 'in')).toBe(1.25);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(2, 'in')).toBe(2);
    expect(nextZoom(0.8, 'out')).toBe(0.8);
    expect(nextZoom(1.75, 'reset')).toBe(1);
  });

  it('snaps anything a settings file might hold to a real level', () => {
    expect(normalizeZoom(1.3)).toBe(1.25);
    expect(normalizeZoom(7)).toBe(2);
    expect(normalizeZoom(0)).toBe(1);
    expect(normalizeZoom('big')).toBe(1);
    expect(normalizeZoom(Number.NaN)).toBe(1);
    expect(nextZoom(1.3, 'in')).toBe(1.5);
  });

  it('labels and limits the buttons', () => {
    expect(zoomLabel(1.25)).toBe('125%');
    expect(zoomLabel(1)).toBe('100%');
    expect(canZoom(2, 'in')).toBe(false);
    expect(canZoom(2, 'out')).toBe(true);
    expect(canZoom(0.8, 'out')).toBe(false);
  });
});
