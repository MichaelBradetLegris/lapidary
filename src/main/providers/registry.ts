import { PROVIDERS, type Provider } from '../../shared/types';
import { fail } from '../errors';
import type { ReviewProvider } from './types';

/**
 * The providers the app knows, keyed by id. Kept free of Electron so the rules
 * (every id in PROVIDERS is served, nothing else is) are testable on their own;
 * `providers/index.ts` builds the real one.
 */
export interface ProviderRegistry {
  get(id: Provider): ReviewProvider;
  ids(): Provider[];
}

export function createRegistry(providers: readonly ReviewProvider[]): ProviderRegistry {
  const byId = new Map<Provider, ReviewProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) throw new Error(`Provider registered twice: ${provider.id}`);
    byId.set(provider.id, provider);
  }
  const missing = PROVIDERS.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`No provider registered for: ${missing.join(', ')}`);

  return {
    get(id: Provider): ReviewProvider {
      const provider = byId.get(id);
      // The renderer is typed, but IPC payloads are still data from another process.
      if (!provider) throw fail('invalid-input', `Unknown AI provider: ${String(id)}`);
      return provider;
    },
    ids(): Provider[] {
      return [...byId.keys()];
    }
  };
}
