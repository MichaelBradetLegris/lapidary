import { app, safeStorage } from 'electron';
import { openAiKey, openAiKeyStatus } from '../secrets';
import { claudeProvider } from './claude';
import { registerController } from './controllers';
import { createOpenAiProvider } from './openai';
import { createRegistry, type ProviderRegistry } from './registry';

/**
 * The app's providers. The OpenAI one is handed functions that read the key
 * from the encrypted secrets file at call time, so no provider ever holds a
 * credential between calls.
 */

let registry: ProviderRegistry | null = null;

export function providers(): ProviderRegistry {
  registry ??= createRegistry([
    claudeProvider,
    createOpenAiProvider({
      key: () => openAiKey(safeStorage, app.getPath('userData')),
      status: () => openAiKeyStatus(safeStorage, app.getPath('userData'))
    })
  ]);
  return registry;
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
