// Lint while editing. A change to the deck marks the slides that changed;
// when the person stops for a moment the page checks them, one slide at a time
// in the browser's idle time, and the filmstrip and the Lint dialog read what
// was found. Nothing here runs in the change itself: the cost of a change is
// comparing the slides with the ones seen last and setting one timer.

import { type Deck, type Issue, type SkippedRule, type Slide, subscribeReferences } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";
import { loadMeasurer, measureProbes, measurerReady } from "./measure.ts";

/** What the service asks of the page's clock: a delay, and idle time. Tests give their own. */
export interface Scheduler {
  /** Calls `run` after `ms` milliseconds. The result cancels it. */
  after(ms: number, run: () => void): () => void;
  /** Calls `run` when the page is idle, with how many milliseconds it may still use. The result cancels it. */
  idle(run: (left: () => number) => void): () => void;
}

/** How long a page without idle callbacks may work in one go. */
const SLICE_MS = 8;

export const pageScheduler: Scheduler = {
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  idle(run) {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback((deadline) => run(() => deadline.timeRemaining()), { timeout: 2000 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(() => {
      const end = performance.now() + SLICE_MS;
      run(() => end - performance.now());
    }, 1);
    return () => clearTimeout(timer);
  },
};

export interface LintOptions {
  scheduler?: Scheduler;
  /** Milliseconds of quiet after a change before the slides it touched are checked. */
  delay?: number;
  /**
   * Whether the service checks slides by itself as the deck changes (the default). Off, it does no work of its own, not even
   * loading what measures text, and checks only when asked (`checkAll`); `setBackground` changes it later.
   */
  background?: boolean;
}

/** What the views read. A new object whenever any slide's problems change. */
export interface LintSnapshot {
  /** The problems of each slide that has some, worst first. */
  readonly issues: ReadonlyMap<string, readonly Issue[]>;
  /** Rules that could not be checked here, and why. */
  readonly skipped: readonly SkippedRule[];
  /** Whether a check of every slide, asked for by the person, is running. */
  readonly checking: boolean;
  /** Counts the checks of the whole deck that finished. */
  readonly checks: number;
  /** Whether how much room the text takes is the engine's estimate, because this page could not load what measures it. */
  readonly estimated: boolean;
}

/** Numbers about the work done, for tests and for tuning. Milliseconds are the page's own clock. */
export interface LintStats {
  /** Changes followed, and the time they took on the page's thread in all and at worst. */
  follows: number;
  followMs: number;
  worstFollowMs: number;
  slidesChecked: number;
  /** The longest time spent on one slide's check. */
  worstSlideMs: number;
  /** Checks that could not be done, and the last reason. */
  failures: number;
  lastFailure: string;
  /** Why the page could not load what measures text; empty when it could. */
  measureFailure: string;
}

const NONE: readonly Issue[] = Object.freeze([]);
/** Stop working when less than this many milliseconds of idle time remain. */
const LEAST_LEFT_MS = 3;

const clock = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());
const same = (a: readonly Issue[], b: readonly Issue[]): boolean => a.length === b.length && a.every((issue, i) => issue.rule === b[i]?.rule && issue.element === b[i]?.element && issue.severity === b[i]?.severity && issue.message === b[i]?.message);

export class LintService {
  readonly stats: LintStats = { follows: 0, followMs: 0, worstFollowMs: 0, slidesChecked: 0, worstSlideMs: 0, failures: 0, lastFailure: "", measureFailure: "" };
  private readonly session: EditorSession;
  private readonly scheduler: Scheduler;
  private readonly delay: number;
  private readonly listeners = new Set<() => void>();
  private readonly results = new Map<string, readonly Issue[]>();
  private readonly skips = new Map<string, readonly SkippedRule[]>();
  private readonly known = new Map<string, Slide>();
  private readonly dirty = new Set<string>();
  private readonly waiting: (() => void)[] = [];
  private deck: Deck;
  private snapshot: LintSnapshot;
  private checking = false;
  private checks = 0;
  private loading = false;
  /** Set when the text measure could not be loaded: the engine's estimate stands in for it until it can be. */
  private estimating = false;
  private stopListening: () => void;
  private stopReferences: () => void;
  private cancelTimer: (() => void) | null = null;
  private cancelIdle: (() => void) | null = null;
  private disposed = false;
  private following: boolean;
  /** How many views have asked for the background checking (`retain`). */
  private holders = 0;

  constructor(session: EditorSession, options: LintOptions = {}) {
    this.session = session;
    this.scheduler = options.scheduler ?? pageScheduler;
    this.delay = options.delay ?? 400;
    this.following = options.background ?? true;
    this.deck = session.state.deck;
    this.snapshot = this.build();
    for (const slide of this.deck.slides) {
      this.known.set(slide.id, slide);
      this.dirty.add(slide.id);
    }
    this.stopListening = session.subscribe(this.follow);
    // A new bibliography changes what the citation keys of every slide mean.
    this.stopReferences = subscribeReferences(this.everythingChanged);
    if (typeof document !== "undefined") document.fonts?.addEventListener?.("loadingdone", this.everythingChanged);
    if (this.following) this.prepare();
  }

  // ---- reading

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LintSnapshot => this.snapshot;

  /** The problems of a slide; the same array until they change. */
  issuesOf(slideId: string): readonly Issue[] {
    return this.results.get(slideId) ?? NONE;
  }

  // ---- following the deck

  /** The deck changed, perhaps: mark the slides that are not the ones seen last, and start the wait. */
  private follow = (): void => {
    const started = clock();
    const deck = this.session.state.deck;
    if (deck === this.deck) return;
    const everything = deck.theme !== this.deck.theme || deck.size !== this.deck.size;
    const alive = new Set<string>();
    for (const slide of deck.slides) {
      alive.add(slide.id);
      if (everything || this.known.get(slide.id) !== slide) this.dirty.add(slide.id);
      this.known.set(slide.id, slide);
    }
    let gone = false;
    for (const id of this.known.keys()) {
      if (alive.has(id)) continue;
      this.known.delete(id);
      this.dirty.delete(id);
      this.skips.delete(id);
      gone = this.results.delete(id) || gone;
    }
    this.deck = deck;
    if (gone) this.publish();
    this.wait();
    const took = clock() - started;
    this.stats.follows += 1;
    this.stats.followMs += took;
    this.stats.worstFollowMs = Math.max(this.stats.worstFollowMs, took);
  };

  /** Something every slide's check depends on changed (the fonts, the bibliography): look at all of them again. */
  private everythingChanged = (): void => {
    for (const id of this.known.keys()) this.dirty.add(id);
    this.wait();
  };

  // ---- checking

  /** Whether the service checks slides by itself as the deck changes. */
  get background(): boolean {
    return this.following;
  }

  /**
   * Turns the checking on the service does by itself on or off. While it is off, the service still notes which slides changed (it
   * costs a comparison) but sets no timer, asks for no idle time and loads nothing; a check that was asked for (`checkAll`) is not
   * stopped. Turned on, it checks what changed meanwhile.
   */
  setBackground(on: boolean): void {
    if (this.disposed || on === this.following) return;
    this.following = on;
    if (on) {
      this.prepare();
    } else if (!this.checking) {
      this.cancelTimer?.();
      this.cancelTimer = null;
      this.cancelIdle?.();
      this.cancelIdle = null;
    }
  }

  /**
   * Asks for the checking in the background for as long as the answer is wanted. Several views can ask (the filmstrip's marks, the count
   * in the title bar); it is on while any of them does, and off when the last lets go. The result lets go, once.
   */
  retain(): () => void {
    this.holders += 1;
    this.setBackground(true);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.holders -= 1;
      if (this.holders === 0) this.setBackground(false);
    };
  }

  /** Starts (or restarts) the quiet period after which the marked slides are checked. */
  private wait(): void {
    if (this.disposed || !this.following || this.dirty.size === 0) return;
    this.cancelTimer?.();
    this.cancelTimer = this.scheduler.after(this.delay, () => {
      this.cancelTimer = null;
      this.startIdle();
    });
  }

  private startIdle(): void {
    // Work goes on only in the background, or for a check that was asked for.
    if (this.disposed || this.cancelIdle || this.dirty.size === 0 || !(this.following || this.checking)) return;
    this.cancelIdle = this.scheduler.idle((left) => {
      this.cancelIdle = null;
      this.work(left);
    });
  }

  /** The slide shown first, then the rest in the order of the deck. */
  private next(): string | undefined {
    const shown = this.session.state.slideId;
    if (this.dirty.has(shown)) return shown;
    return this.deck.slides.find((slide) => this.dirty.has(slide.id))?.id ?? this.dirty.values().next().value;
  }

  /**
   * Loads what measures text, and starts the checks when it is there. A page that
   * cannot (the chunk that holds it did not arrive) checks with the engine's
   * estimate instead, and says so in the snapshot; it does not try again, since
   * the browser keeps the failure it saw.
   */
  private prepare(): void {
    if (measurerReady() || this.estimating) {
      this.startIdle();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    const settled = (): void => {
      this.loading = false;
      this.startIdle();
    };
    void loadMeasurer().then(settled, (thrown: unknown) => {
      this.estimating = true;
      this.stats.measureFailure = thrown instanceof Error ? thrown.message : String(thrown);
      this.publish();
      settled();
    });
  }

  private work(left: () => number): void {
    if (this.disposed) return;
    if (!measurerReady() && !this.estimating) {
      this.prepare();
      return;
    }
    let changed = false;
    for (let id = this.next(); id !== undefined; id = this.next()) {
      this.dirty.delete(id);
      changed = this.check(id) || changed;
      if (left() < LEAST_LEFT_MS) break;
    }
    if (this.dirty.size > 0) {
      if (changed) this.publish();
      this.startIdle();
      return;
    }
    const finished = this.checking;
    if (finished) {
      this.checking = false;
      this.checks += 1;
    }
    this.publish(changed || finished);
    for (const done of this.waiting.splice(0)) done();
  }

  /** Checks one slide. True when its problems are different from before. */
  private check(id: string): boolean {
    const slide = this.known.get(id);
    if (!slide) return false;
    const started = clock();
    try {
      const engine = this.session.core;
      const measures = measurerReady() ? { slides: { [id]: measureProbes(this.deck.theme, engine.lintProbes(id)) } } : engine.lintEstimate(id);
      const report = engine.lintSlide(id, { measures });
      const now = report.issues.length === 0 ? NONE : report.issues;
      const before = this.results.get(id) ?? NONE;
      const skipsBefore = this.skips.get(id);
      this.skips.set(id, report.skipped);
      this.stats.slidesChecked += 1;
      const skipsChanged = JSON.stringify(skipsBefore) !== JSON.stringify(report.skipped);
      if (same(before, now)) return skipsChanged;
      if (now === NONE) this.results.delete(id);
      else this.results.set(id, now);
      return true;
    } catch (thrown) {
      // A slide that could not be checked (the deck is going away, or the slide just did) is left as it was.
      this.stats.failures += 1;
      this.stats.lastFailure = thrown instanceof Error ? thrown.message : String(thrown);
      return false;
    } finally {
      this.stats.worstSlideMs = Math.max(this.stats.worstSlideMs, clock() - started);
    }
  }

  /** Checks every slide again, now rather than after the quiet period. Resolves when all are checked. */
  checkAll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    for (const id of this.known.keys()) this.dirty.add(id);
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.dirty.size === 0) {
      // A deck with no slide has nothing to look at: it is checked as soon as it is asked.
      this.checks += 1;
      this.publish();
      return Promise.resolve();
    }
    this.checking = true;
    this.publish();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.startIdle();
    });
  }

  // ---- telling the views

  private build(): LintSnapshot {
    const skipped = new Map<string, SkippedRule>();
    for (const rules of this.skips.values()) for (const rule of rules) if (!skipped.has(rule.rule)) skipped.set(rule.rule, rule);
    return { issues: new Map(this.results), skipped: [...skipped.values()], checking: this.checking, checks: this.checks, estimated: this.estimating && !measurerReady() };
  }

  private publish(changed = true): void {
    if (!changed) return;
    this.snapshot = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  /** Stops following the deck. */
  dispose(): void {
    this.disposed = true;
    this.stopListening();
    this.stopReferences();
    this.cancelTimer?.();
    this.cancelIdle?.();
    if (typeof document !== "undefined") document.fonts?.removeEventListener?.("loadingdone", this.everythingChanged);
    this.listeners.clear();
    for (const done of this.waiting.splice(0)) done();
  }
}

const services = new WeakMap<EditorSession, LintService>();

/**
 * The lint service of an editing session, made the first time it is asked for. It starts with the background off: it does nothing of
 * its own until a view that shows what it finds (the filmstrip's badges) turns it on with `setBackground`. The Lint dialog asks for its own check.
 */
export function lintOf(session: EditorSession): LintService {
  let service = services.get(session);
  if (!service) {
    service = new LintService(session, { background: false });
    services.set(session, service);
  }
  return service;
}
