import { rpcState, RpcUnavailableError } from '../rpc.svelte';
import { register } from './registry';

export interface PollerOptions<T> {
  /** Delay between successful polls. */
  interval: number;
  onData?: (next: T, prev: T | null) => void;
}

/**
 * Polls `fetcher` on an interval, paused while the tab is hidden (refreshes the moment it is
 * visible again). Keeps the last good data on failure and retries with 2s, 4s, 8s ... max 30s backoff.
 */
export class Poller<T> {
  data = $state.raw<T | null>(null);
  error = $state<Error | null>(null);
  loaded = $state(false);
  updatedAt = $state<number | null>(null);
  failures = $state(0);
  fetching = $state(false);

  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #unregister: (() => void) | null = null;
  #gen = 0;
  #fetcher: () => Promise<T>;
  #opts: PollerOptions<T>;

  constructor(fetcher: () => Promise<T>, opts: PollerOptions<T>) {
    this.#fetcher = fetcher;
    this.#opts = opts;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#unregister = register(this);
    document.addEventListener('visibilitychange', this.#onVisibility);
    void this.refresh();
  }

  stop() {
    this.#running = false;
    this.#unregister?.();
    this.#gen++;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  #onVisibility = () => {
    if (!document.hidden && this.#running) void this.refresh();
  };

  async refresh(): Promise<void> {
    if (!this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const gen = ++this.#gen;
    this.fetching = true;
    try {
      const next = await this.#fetcher();
      if (gen !== this.#gen) return;
      const prev = this.data;
      this.data = next;
      this.error = null;
      this.failures = 0;
      this.loaded = true;
      this.updatedAt = Date.now();
      this.#opts.onData?.(next, prev);
      this.#schedule(this.#opts.interval);
    } catch (e) {
      if (gen !== this.#gen) return;
      this.error = e instanceof Error ? e : new Error(String(e));
      this.failures += 1;
      this.loaded = true;
      const backoff = Math.min(2000 * 2 ** (this.failures - 1), 30000);
      if (e instanceof RpcUnavailableError) rpcState.retryAt = Date.now() + backoff;
      this.#schedule(backoff);
    } finally {
      if (gen === this.#gen) this.fetching = false;
    }
  }

  #schedule(ms: number) {
    if (!this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (document.hidden) return; // resumes on visibilitychange
      void this.refresh();
    }, ms);
  }
}
