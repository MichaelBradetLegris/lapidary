import type { ModelInfo } from '../../shared/ipc';

/**
 * The stored model may be an alias the CLI accepts but does not list, such as
 * `opus`. Keep it in the dropdown so the setting on screen is the setting in
 * use, rather than silently showing the first row instead.
 *
 * An empty stored value means "the provider's default" (the OpenAI model
 * setting starts empty), so there is nothing to prepend.
 */
export function modelOptions(models: readonly ModelInfo[], current: string): ModelInfo[] {
  if (current === '' || models.some((m) => m.value === current)) return [...models];
  return [{ value: current, label: `${current} (current)` }, ...models];
}

/**
 * The model a select should show: the stored choice, or the list's default when
 * nothing is stored yet, or the first row.
 */
export function selectedModel(models: readonly ModelInfo[], current: string): string {
  if (current !== '') return current;
  return models.find((m) => m.isDefault)?.value ?? models[0]?.value ?? '';
}
