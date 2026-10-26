import type { Provider } from '../../shared/types';
import { createSettingWrites, type SettingIo } from './settingWrites';

/*
 * The provider an item of the Review menu chooses (codex.3): Claude or
 * ChatGPT, each opening Review with AI with it. The page takes
 * the choice at once, so the dialog opens on it, and main writes it after,
 * as the dialog's own Provider list would (`createSettingWrites`, one write
 * at a time, the last choice winning). A close waits for the write
 * (state/pageIo.ts).
 */

const writes = createSettingWrites('provider');

/** Make `provider` the one Review with AI starts with. Never rejects. */
export function chooseProvider(provider: Provider, io: SettingIo): Promise<void> {
  return writes.save(provider, io);
}

/** The write under way, for a close to wait for with the others. */
export function flushProviderWrites(): Promise<void> {
  return writes.flush();
}
