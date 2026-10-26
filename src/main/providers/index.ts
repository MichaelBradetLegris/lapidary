import type { ConnectionTestResult, RuntimeStatus } from '../../shared/ipc';
import type { Provider } from '../../shared/types';
import type { LastFailure } from '../../shared/ui/setup';
import type { ChatGptAuth } from '../chatgpt';
import { log } from '../log';
import { createChatGptProvider } from './chatgpt';
import { claudeProvider } from './claude';
import { registerController } from './controllers';
import { withLogging, type LoggedProvider } from './logged';
import { createRegistry, type ProviderRegistry } from './registry';

/**
 * The app's providers: Claude, and ChatGPT (codex.3), which is handed the
 * sign-in, which gives it the access token at call time, so no provider ever
 * holds a credential between calls. The OpenAI API key's provider went in
 * codex.6. Each is wrapped in `withLogging` (logged.ts), which logs its calls
 * as counts and remembers its last runtime status and failure (hardening.3b).
 */

let logged: readonly LoggedProvider[] | null = null;
let registry: ProviderRegistry | null = null;

/** The one ChatGPT sign-in, which ipc.ts makes (codex.2) and hands over as it registers its handlers. */
let chatGptAuth: (() => ChatGptAuth) | null = null;

/** ipc.ts hands over the ChatGPT sign-in, so the ChatGPT provider asks it for the bearer (codex.3). */
export function setChatGptAuth(get: () => ChatGptAuth): void {
  chatGptAuth = get;
}

function chatGptSession(): ChatGptAuth {
  if (!chatGptAuth) throw new Error('The ChatGPT sign-in was asked for before ipc.ts handed it over.');
  return chatGptAuth();
}

function loggedProviders(): readonly LoggedProvider[] {
  logged ??= [claudeProvider, createChatGptProvider({ session: chatGptSession })].map((provider) =>
    withLogging(provider, { log })
  );
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

/** The Claude Code the last lookup found and its version (setup.3), without looking again (hardening.5). */
export { installedCli } from './claude';

/** The last failure of `id` that says something about setup (`nextLastFailure`), or null. */
export function lastFailure(id: Provider): LastFailure | null {
  return (
    loggedProviders()
      .find((provider) => provider.id === id)
      ?.lastFailure() ?? null
  );
}

/**
 * A connection test of `id` answered the page with `result` (`testConnection`):
 * its last failure moves as the renderer's does (`LoggedProvider.noteTest`).
 */
export function noteTest(id: Provider, result: ConnectionTestResult): void {
  loggedProviders()
    .find((provider) => provider.id === id)
    ?.noteTest(result);
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
