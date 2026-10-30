// The demo's only sense of time: the page's own clock, which a recorder
// installs and a test replaces. Nothing here reads anything else.

export interface DemoClock {
  now(): number;
  /** Runs `run` after `ms`; the answer cancels it. */
  after(ms: number, run: () => void): () => void;
}

export const pageClock: DemoClock = {
  now: () => Date.now(),
  after(ms, run) {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

/** A pretend download: this many steps, this far apart (about two seconds). */
export const DOWNLOAD_STEPS = 20;
export const STEP_MS = 100;

/** Resolves after `ms` of the page's clock. */
export const pause = (ms: number): Promise<void> => new Promise<void>((done) => setTimeout(done, ms));
