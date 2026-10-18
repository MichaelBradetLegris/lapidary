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
 *
 * A value whose write failed is kept until a later write for its key succeeds
 * (apply.9): `failures` says why, and `retry` queues it again, so closing the
 * window can try once more before anything is lost. Until then the writer
 * counts as busy for `onPendingChange`, since what it was given is not on disk.
 */

export interface KeyedWriterOptions<V> {
  delayMs: number;
  write: (key: string, value: V) => Promise<void>;
  onError?: (message: string, key: string) => void;
  /**
   * called when the writer goes from having nothing to write to having
   * something waiting, being written, or failed and not written since, and back
   */
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
  /**
   * Why the last write failed, for `key` or for every key, where nothing has
   * been written for that key since: one message per key, distinct messages
   * only. Empty when everything given to the writer is on disk or on its way.
   */
  failures(key?: string): string[];
  /**
   * Queue again each value whose write failed, for `key` or for every key,
   * unless a newer value for that key is waiting or being written. A `flush`
   * then writes them at once.
   */
  retry(key?: string): void;
}

interface Slot<V> {
  value: V | undefined;
  hasValue: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
}

export function createKeyedWriter<V>(options: KeyedWriterOptions<V>): KeyedWriter<V> {
  const slots = new Map<string, Slot<V>>();
  /** the value whose write failed, and why, by key; gone once a write for the key succeeds */
  const failed = new Map<string, { value: V; message: string }>();
  const describe =
    options.describeError ?? ((err: unknown) => (err instanceof Error ? err.message : String(err)));
  let lastError: string | null = null;
  let wasPending = false;

  const busy = (slot: Slot<V>): boolean => slot.hasValue || slot.inFlight !== null;

  function reportPending(): void {
    const now = [...slots.values()].some(busy) || failed.size > 0;
    if (now === wasPending) return;
    wasPending = now;
    options.onPendingChange?.(now);
  }

  function schedule(key: string, value: V): void {
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
          failed.delete(key);
        } catch (err) {
          const message = describe(err);
          failed.set(key, { value, message });
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

  function pending(key?: string): boolean {
    if (key === undefined) return [...slots.values()].some(busy);
    const slot = slots.get(key);
    return slot !== undefined && busy(slot);
  }

  return {
    schedule,

    async flush(key) {
      const keys = key === undefined ? [...slots.keys()] : [key];
      await Promise.all(keys.map((k) => start(k)));
    },

    pending,

    failures(key) {
      const messages = [...failed.entries()]
        .filter(([k]) => key === undefined || k === key)
        .map(([, f]) => f.message);
      return [...new Set(messages)];
    },

    retry(key) {
      for (const [k, f] of failed) {
        if (key !== undefined && k !== key) continue;
        // A newer value for the key replaces the one that failed.
        if (!pending(k)) schedule(k, f.value);
      }
    }
  };
}
