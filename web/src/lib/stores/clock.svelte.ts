// One app-wide clock. Components read clock.now; nothing else owns a setInterval for ticking.
class Clock {
  now = $state(Date.now());
  #timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.#timer || typeof window === 'undefined') return;
    this.#timer = setInterval(() => (this.now = Date.now()), 1000);
  }
}

export const clock = new Clock();
