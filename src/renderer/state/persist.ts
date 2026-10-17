/**
 * Debounced writes, one queue per key (apply.1).
 *
 * The review on screen used to be saved by an effect whose cleanup cancelled
 * the pending timer whenever the review changed, so a decision followed by a
 * switch to another chapter within the debounce never reached disk. Here every
 * key keeps its own timer, and scheduling one key never touches another.
 *
 * Per key: the newest value wins, at most one write is in flight, and a value
 * scheduled during a write is written after it, so the last write is always
 * the newest value. `flush` writes what is waiting now and resolves once it is
 * on disk. A failure is reported once per distinct message, not once per
 * keystroke, and is forgotten after the next success.
 */

export interface KeyedWriterOptions<V> {
  delayMs: number;
  write: (key: string, value: V) => Promise<void>;
  onError?: (message: string, key: string) => void;
  /** called when the writer goes from idle to busy and back */
  onPendingChange?: (pending: boolean) => void;
  describeError?: (err: unknown) => string;
}

export interface KeyedWriter<V> {
  /** write `value` for `key` once nothing new has arrived for `delayMs` */
  schedule(key: string, value: V): void;
  /** write what is waiting for `key`, or for every key, and wait for it */
  flush(key?: string): Promise<void>;
  /** something is waiting or being written, for `key` or for any key */
  pending(key?: string): boolean;
}

interface Slot<V> {
  value: V | undefined;
  hasValue: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
}

export function createKeyedWriter<V>(options: KeyedWriterOptions<V>): KeyedWriter<V> {
  const slots = new Map<string, Slot<V>>();
  const describe =
    options.describeError ?? ((err: unknown) => (err instanceof Error ? err.message : String(err)));
  let lastError: string | null = null;
  let wasPending = false;

  const busy = (slot: Slot<V>): boolean => slot.hasValue || slot.inFlight !== null;

  function reportPending(): void {
    const now = [...slots.values()].some(busy);
    if (now === wasPending) return;
    wasPending = now;
    options.onPendingChange?.(now);
  }

  function start(key: string): Promise<void> {
    const slot = slots.get(key);
    if (!slot) return Promise.resolve();
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    // The write in flight picks up the newest value when it ends.
    if (slot.inFlight) return slot.inFlight;
    if (!slot.hasValue) return Promise.resolve();

    const run = async (): Promise<void> => {
      while (slot.hasValue) {
        const value = slot.value as V;
        slot.value = undefined;
        slot.hasValue = false;
        try {
          await options.write(key, value);
          lastError = null;
        } catch (err) {
          const message = describe(err);
          if (message !== lastError) {
            lastError = message;
            options.onError?.(message, key);
          }
        }
        // A value that arrived meanwhile and is still debouncing waits for its timer.
        if (slot.timer) break;
      }
    };
    slot.inFlight = run().finally(() => {
      slot.inFlight = null;
      if (!busy(slot) && !slot.timer) slots.delete(key);
      reportPending();
    });
    reportPending();
    return slot.inFlight;
  }

  return {
    schedule(key, value) {
      let slot = slots.get(key);
      if (!slot) {
        slot = { value: undefined, hasValue: false, timer: null, inFlight: null };
        slots.set(key, slot);
      }
      slot.value = value;
      slot.hasValue = true;
      if (slot.timer) clearTimeout(slot.timer);
      const waiting = slot;
      slot.timer = setTimeout(() => {
        waiting.timer = null;
        void start(key);
      }, options.delayMs);
      reportPending();
    },

    async flush(key) {
      const keys = key === undefined ? [...slots.keys()] : [key];
      await Promise.all(keys.map((k) => start(k)));
    },

    pending(key) {
      if (key === undefined) return [...slots.values()].some(busy);
      const slot = slots.get(key);
      return slot !== undefined && busy(slot);
    }
  };
}
