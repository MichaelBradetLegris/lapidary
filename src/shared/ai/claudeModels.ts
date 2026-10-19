/**
 * The Claude model list, as the review dialog and Settings show it (round 5).
 *
 * Claude Code's model list (the `initialize` reply, formerly the Agent SDK's
 * `supportedModels()`) names each entry by family only ("Opus",
 * "Sonnet"), and the version sits in fields the dialog never showed: the
 * resolved model id and the start of the description ("Opus 5.5 · Best for
 * ..."). Claude Code's picker also keeps only the newest model of each family,
 * so the previous Opus is not offered at all. This module labels every entry
 * with its version and adds the earlier versions worth keeping in reach.
 *
 * Pure, so it can be tested (CLAUDE.md rule 4).
 */

import type { ModelInfo } from '../ipc';

/** The fields of one model entry in Claude Code's list that this module reads. */
export interface SdkModel {
  value: string;
  displayName?: string;
  description?: string;
  /** the model id an alias points at, e.g. "claude-opus-5-5" */
  resolvedModel?: string;
}

/**
 * Earlier versions offered next to the newest one of their family. Each is a
 * full model id, which the CLI accepts as a model setting; `claude-opus-5` was
 * checked against a Claude subscription on 2026-09-27. Add a row here to offer
 * another.
 */
export const EARLIER_CLAUDE_MODELS: readonly { value: string; family: string; version: string }[] = [
  { value: 'claude-opus-5', family: 'Opus', version: '5' }
];

const FAMILIES = ['Opus', 'Fable', 'Mythos', 'Sonnet', 'Haiku'] as const;

/**
 * "Opus 5.5" from "claude-opus-5-5", "Haiku 4.5" from
 * "claude-haiku-4-5-20251001". A date suffix and a "[1m]" suffix are ignored.
 * Null when the id is not a recognisable Claude model id.
 */
export function versionFromModelId(id: string): string | null {
  const match = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?(?:\[1m\])?$/.exec(id.trim());
  if (!match) return null;
  const family = FAMILIES.find((f) => f.toLowerCase() === match[1]);
  if (!family || !match[2]) return null;
  return `${family} ${match[2].split('-').join('.')}`;
}

/**
 * "Opus 5.5" from "Opus 5.5 · Best for everyday, complex tasks", and
 * "Opus 5" from "Opus 5 with 1M context · ...". Null when the description does
 * not start with a family name and a number.
 */
export function versionFromDescription(description: string | undefined): string | null {
  if (!description) return null;
  const head = description.split(' · ')[0]?.trim() ?? '';
  const match = /^([A-Z][a-z]+) (\d+(?:\.\d+)*)\b/.exec(head);
  if (!match || !FAMILIES.some((f) => f === match[1])) return null;
  return `${match[1]} ${match[2] ?? ''}`;
}

/**
 * Only when the CLI itself says so. A "[1m]" suffix on a value is not enough:
 * Fable 5.1 carries one although 1M is simply its context size, and tagging it
 * would be noise.
 */
function hasLongContext(model: SdkModel): boolean {
  return /1M context/i.test(model.description ?? '');
}

/** The version a model entry runs, from whichever field says it. */
export function modelVersion(model: SdkModel): string | null {
  return (
    versionFromDescription(model.description) ??
    (model.resolvedModel ? versionFromModelId(model.resolvedModel) : null) ??
    versionFromModelId(model.value)
  );
}

/**
 * The label for one entry: "Opus 5.5", "Opus 5 (1M context)", or
 * "Default: Opus 5.5" for the account's default. Falls back to the SDK's own
 * name when no version can be found, so an unfamiliar model still shows.
 */
export function claudeModelLabel(model: SdkModel): string {
  const version = modelVersion(model);
  const name = version ?? model.displayName ?? model.value;
  const long = version && hasLongContext(model) ? ' (1M context)' : '';
  if (model.value === 'default')
    return version ? `Default: ${version}${long}` : (model.displayName ?? 'Default');
  return `${name}${long}`;
}

/** "Opus 5.5" -> ["Opus", [5, 5]]. */
function splitVersion(version: string | null): { family: string; numbers: number[] } | null {
  if (!version) return null;
  const [family, number] = version.split(' ');
  if (!family || !number) return null;
  return { family, numbers: number.split('.').map(Number) };
}

/** Newer first: 5.5 before 5 before 4.8. */
function compareNewestFirst(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The full list for the dialog. Every SDK entry is labelled with its version,
 * earlier versions from `EARLIER_CLAUDE_MODELS` are added when the SDK does not
 * already list them (by value, or by what an alias resolves to), and the whole
 * list is grouped by family: families in the order the SDK first names them,
 * newest version first within each. The SDK tacks older versions on at the
 * end, which put Opus 5 at the bottom, far from Opus 5.5. The account's default
 * stays on top, and anything without a readable version keeps its place after
 * the rest.
 */
export function claudeModelOptions(models: readonly SdkModel[]): ModelInfo[] {
  const listed = new Set(models.flatMap((m) => [m.value, (m.resolvedModel ?? '').replace(/\[1m\]$/, '')]));

  const rows: { info: ModelInfo; version: string | null }[] = models.map((model) => ({
    info: {
      value: model.value,
      label: claudeModelLabel(model),
      ...(model.description ? { description: model.description } : {}),
      ...(model.value === 'default' ? { isDefault: true } : {})
    },
    version: model.value === 'default' ? null : modelVersion(model)
  }));
  for (const e of EARLIER_CLAUDE_MODELS) {
    if (listed.has(e.value)) continue;
    const version = `${e.family} ${e.version}`;
    rows.push({ info: { value: e.value, label: version }, version });
  }

  const familyRank = new Map<string, number>();
  for (const row of rows) {
    const family = splitVersion(row.version)?.family;
    if (family && !familyRank.has(family)) familyRank.set(family, familyRank.size);
  }

  const defaults = rows.filter((r) => r.info.value === 'default');
  const rest = rows
    .filter((r) => r.info.value !== 'default')
    .map((row, order) => ({ row, order, parsed: splitVersion(row.version) }))
    .sort((a, b) => {
      const rankA = a.parsed ? (familyRank.get(a.parsed.family) ?? Infinity) : Infinity;
      const rankB = b.parsed ? (familyRank.get(b.parsed.family) ?? Infinity) : Infinity;
      if (rankA !== rankB) return rankA - rankB;
      if (a.parsed && b.parsed) {
        const byVersion = compareNewestFirst(a.parsed.numbers, b.parsed.numbers);
        if (byVersion !== 0) return byVersion;
      }
      return a.order - b.order;
    })
    .map(({ row }) => row);

  return [...defaults, ...rest].map((r) => r.info);
}

/**
 * The `--model` flag for a model setting (setup.1). `default` and an empty
 * setting pass no flag at all, so Claude Code uses the account's own default,
 * which is what "Default" in the list means.
 */
export function modelArgs(model: string): string[] {
  const value = model.trim();
  return value === '' || value === 'default' ? [] : ['--model', value];
}

/* ------------------------------------------------------------------ */
/* Pro plans (setup.1, Appendix D 12)                                   */
/* ------------------------------------------------------------------ */

/** Claude Code's `subscriptionType` for a Pro plan ("pro"), however it is cased. */
export function isProPlan(subscriptionType: string | undefined): boolean {
  return subscriptionType !== undefined && /\bpro\b/i.test(subscriptionType);
}

/**
 * Recorded in `dismissedHints` once Sonnet was preselected, so it happens only
 * once, and by Show the welcome guide again (`welcomeAgainPatch`), so a guide
 * brought back never preselects.
 */
export const PRO_PRESELECT_HINT = 'pro-model-preselected';

export const PRO_PLAN_NOTE =
  'On a Pro plan, Opus models (including Default) use your limits fastest. Sonnet is usually enough for copyediting.';

/** Whether the model setting is Sonnet or Haiku, which the Pro note has nothing to say about. */
function isLighterModel(model: string): boolean {
  return /sonnet|haiku/i.test(model);
}

/** The Pro note for the review dialog, or null when it does not apply. */
export function proPlanNote(subscriptionType: string | undefined, model: string): string | null {
  return isProPlan(subscriptionType) && !isLighterModel(model) ? PRO_PLAN_NOTE : null;
}

/**
 * The settings patch that preselects Sonnet for a new user on a Pro plan, or
 * null. Only once, only while the model is still the untouched `default`, and
 * only while the first welcome guide is open (`guideOpen`, the page's
 * `welcomeShown`): an existing settings file, or a model the author picked, is
 * never changed. Start and Skip close the guide for good, so a check that
 * finds Claude ready only after them leaves the model as it is, and Show the
 * welcome guide again settles the preselection in the same write that brings
 * the guide back (`welcomeAgainPatch`), so the guide shown again never
 * preselects (`setup.11` review, PLAN C.67).
 */
export function proPreselection(
  settings: { model: string; onboardingDone: boolean; dismissedHints: readonly string[] },
  subscriptionType: string | undefined,
  guideOpen: boolean
): { model: string; dismissedHints: string[] } | null {
  if (!isProPlan(subscriptionType)) return null;
  if (!guideOpen || settings.onboardingDone || settings.model !== 'default') return null;
  if (settings.dismissedHints.includes(PRO_PRESELECT_HINT)) return null;
  return { model: 'sonnet', dismissedHints: [...settings.dismissedHints, PRO_PRESELECT_HINT] };
}
