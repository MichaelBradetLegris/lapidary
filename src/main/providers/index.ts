import { app, safeStorage } from 'electron';
import type { RuntimeStatus } from '../../shared/ipc';
import type { Provider } from '../../shared/types';
import type { LastFailure } from '../../shared/ui/setup';
import { log } from '../log';
import { openAiKey, openAiKeyStatus } from '../secrets';
import { claudeProvider } from './claude';
import { registerController } from './controllers';
import { withLogging, type LoggedProvider } from './logged';
import { createOpenAiProvider } from './openai';
import { createRegistry, type ProviderRegistry } from './registry';

/**
 * The app's providers. The OpenAI one is handed functions that read the key
 * from the encrypted secrets file at call time, so no provider ever holds a
 * credential between calls. Each is wrapped in `withLogging` (logged.ts),
 * which logs its calls as counts and remembers its last runtime status and
 * failure (hardening.3b).
 */

let logged: readonly LoggedProvider[] | null = null;
let registry: ProviderRegistry | null = null;

function loggedProviders(): readonly LoggedProvider[] {
  logged ??= [
    claudeProvider,
    createOpenAiProvider({
      key: () => openAiKey(safeStorage, app.getPath('userData')),
      status: () => openAiKeyStatus(safeStorage, app.getPath('userData'))
    })
  ].map((provider) => withLogging(provider, { log }));
  return logged;
}

export function providers(): ProviderRegistry {
  registry ??= createRegistry(loggedProviders());
  return registry;
}

/** What the last runtime check of `id` found, without running another; null before the first. */
export function lastRuntime(id: Provider): RuntimeStatus | null {
  return (
    loggedProviders()
      .find((provider) => provider.id === id)
      ?.lastRuntime() ?? null
  );
}

/** The last failure of `id` that says something about setup (`nextLastFailure`), or null. */
export function lastFailure(id: Provider): LastFailure | null {
  return (
    loggedProviders()
      .find((provider) => provider.id === id)
      ?.lastFailure() ?? null
  );
}

/* In-flight reviews, so Cancel can reach whichever provider is running. Each
   controller is also registered for quitting (controllers.ts). */
const inFlight = new Map<string, { controller: AbortController; release: () => void }>();

export function beginRequest(requestId: string): AbortSignal {
  const controller = new AbortController();
  inFlight.set(requestId, { controller, release: registerController(controller) });
  return controller.signal;
}

export function endRequest(requestId: string): void {
  inFlight.get(requestId)?.release();
  inFlight.delete(requestId);
}

export function cancelRequest(requestId: string): void {
  inFlight.get(requestId)?.controller.abort();
  inFlight.delete(requestId);
}
