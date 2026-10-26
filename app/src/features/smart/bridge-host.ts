// The window's side of a smart page's bridge. A page runs in a sandboxed frame
// and can only post messages to the window; this host listens for them, and
//
//  - ignores any message that does not come from that frame's own window,
//  - answers at most 50 calls a second, and keeps at most 32 waiting for the
//    app at once (`rate_limited` past either),
//  - checks each message against the contract before using it,
//  - sends reads and writes to the app (which runs them as the agent
//    `smart:<page path>` under the project's agent mode), and answers with the
//    result, or with an error when the answer is over 2 MB,
//  - keeps watches: a query re-run 300 ms after the vault changes, sent to the
//    page when the result is not what it last had, nothing while the frame is
//    paused (hidden), and all of it stopped when the host is disposed.
//
// What it answers the page with is data only; nothing the page sends is ever
// run, written into the window's DOM, or used as an address.

import {
  MAX_ANSWER_BYTES,
  MAX_BLOCK_HEIGHT_PX,
  MAX_CALLS_PER_SECOND,
  WATCH_DEBOUNCE_MS,
  bridgeError,
  isWriteCall,
  requestIdOf,
  type BridgeAnswer,
  type BridgeError,
  type BridgeEvent,
  type BridgeRequest,
  type QuerySpec,
  type SmartTheme,
} from "../../lib/vault/smart-types";
import { asBridgeError, type SmartBackend } from "./backend";
import { checkMessage, type VaultCall } from "./schema";

/** The most watches one page keeps at once. */
export const MAX_WATCHES = 20;
/** The smallest a frame may be made. */
export const MIN_HEIGHT_PX = 40;
/** The shortest wait between two notes a page opens. */
export const OPEN_GAP_MS = 1000;
/** The most calls one page may have waiting for the app's answer at once. */
export const MAX_IN_FLIGHT = 32;

export interface HostOptions {
  /** The smart page's path: what the app is told the calls are for. */
  pagePath: string;
  pageId: string;
  /**
   * The secret of the frame this host is for (`openFrame`). Every call to the
   * app carries it, and the app answers only for a frame that is still showing
   * this page: a host that outlives its frame, or is pointed at another page,
   * does nothing.
   */
  frameToken: string;
  /** The named view being shown (`![[Page#view]]`), if any. */
  view?: string;
  backend: SmartBackend;
  /** The frame's window, or null while there is none. A message from any other window is not heard. */
  frame(): Window | null;
  theme(): SmartTheme;
  /** Calls `listener` whenever a file of the vault changes; gives the way to stop. */
  onVaultChange(listener: () => void): () => void;
  /** The page asked to open a note or file (a vault path). */
  onOpen?(path: string): void;
  /** The page asked for a height (already kept within what it may have). */
  onResize?(px: number): void;
  onLog?(args: unknown[]): void;
  /** An error from the page was kept. */
  onReported?(): void;
  /** Called with each read the page was answered (kind, arguments, answer), for a copy of the page that carries its data. */
  record?(kind: string, args: unknown, value: unknown): void;
  /** The most height the page may have; the block limit when not given. */
  maxHeight?: number;
  now?(): number;
}

/** A message as the window hears it. */
export type Heard = Pick<MessageEvent, "source" | "data">;

interface Watch {
  query: QuerySpec;
  /** What the page was last sent, as text, so an unchanged result is not sent again. */
  last: string | null;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** The call as the app is told it: its kind and arguments, without the page's own request number. */
function vaultCall(request: BridgeRequest): VaultCall {
  const { id: _number, ...call } = request;
  return call as VaultCall;
}

export class BridgeHost {
  private readonly watches = new Map<string, Watch>();
  private readonly calls: number[] = [];
  private limitedAnswers: number[] = [];
  /** Calls handed to `run` that have not finished. */
  private inFlight = 0;
  private stopListening: (() => void) | null = null;
  private stopWatching: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastOpen = Number.NEGATIVE_INFINITY;
  private paused = false;
  private stale = false;
  private disposed = false;
  /** The next request is greeted with `init` first: a page's scripts may have started after the greeting at load. */
  private greeting = true;

  constructor(private readonly opts: HostOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Listens to `target`'s messages (the window's) until the returned function is called or the host is disposed. */
  attach(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
    const listener = (event: Event) => this.handle(event as MessageEvent);
    target.addEventListener("message", listener);
    const stop = () => target.removeEventListener("message", listener);
    this.stopListening = stop;
    return stop;
  }

  /** The frame has loaded a document: greet it. The first request it makes after that is greeted again, in case the page's scripts were not running yet. */
  frameLoaded(): void {
    if (this.disposed) return;
    this.greeting = true;
    this.send(this.init());
  }

  /** Sends the page the app's theme (it changed). */
  sendTheme(theme: SmartTheme): void {
    this.send({ event: "theme", theme });
  }

  /** A paused host (the frame is hidden or off screen) sends nothing on its own; when it wakes it brings the watches up to date once. */
  setPaused(paused: boolean): void {
    if (this.disposed || paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.cancelTimer();
    } else if (this.stale) {
      this.stale = false;
      this.schedule();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.stopWatching?.();
    this.stopWatching = null;
    this.stopListening?.();
    this.stopListening = null;
    this.watches.clear();
  }

  // ---- hearing ----

  /** One message from the window's `message` event. */
  handle(event: Heard): void {
    if (this.disposed) return;
    const frame = this.opts.frame();
    // Only the frame's own window is listened to: not the window itself, not another frame, not nobody.
    if (!frame || event.source !== frame) return;
    // The rate is held before the message is even read, so a flood costs the window next to nothing.
    if (!this.allowed()) {
      const id = requestIdOf(event.data);
      if (id !== null) this.limited(id);
      return;
    }
    const checked = checkMessage(event.data);
    if (!checked.ok) {
      if (checked.id !== null) this.fail(checked.id, checked.error);
      return;
    }
    if (this.greeting) {
      this.greeting = false;
      this.send(this.init());
    }
    void this.run(checked.request);
  }

  /**
   * A call to the app. Fifty calls a second that each take a while would still keep the app's pool busy,
   * so only `MAX_IN_FLIGHT` wait for an answer at once; the rest are told to wait (`rate_limited`).
   */
  private async viaApp<T>(work: () => Promise<T>): Promise<T> {
    if (this.inFlight >= MAX_IN_FLIGHT) {
      throw bridgeError("rate_limited", `${MAX_IN_FLIGHT} calls are waiting for an answer already. Wait for some of them, or ask for more at once.`);
    }
    this.inFlight += 1;
    try {
      return await work();
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Whether another call fits in the second that has just gone by. */
  private allowed(): boolean {
    const now = this.now();
    while (this.calls.length > 0 && now - this.calls[0]! >= 1000) this.calls.shift();
    if (this.calls.length >= MAX_CALLS_PER_SECOND) return false;
    this.calls.push(now);
    return true;
  }

  /** Answers a call over the limit; past the limit's own number of refusals in a second it stays quiet. */
  private limited(id: number): void {
    const now = this.now();
    this.limitedAnswers = this.limitedAnswers.filter((at) => now - at < 1000);
    if (this.limitedAnswers.length >= MAX_CALLS_PER_SECOND) return;
    this.limitedAnswers.push(now);
    this.fail(id, bridgeError("rate_limited", "That is more than 50 calls in a second. Wait a moment, or ask for more at once."));
  }

  // ---- answering ----

  private init(): BridgeEvent {
    return { event: "init", pageId: this.opts.pageId, theme: this.opts.theme(), ...(this.opts.view ? { view: this.opts.view } : {}) };
  }

  private send(message: BridgeEvent | BridgeAnswer): void {
    if (this.disposed) return;
    try {
      // The frame's origin is opaque, so no address can name it; the window it is sent to is the check.
      this.opts.frame()?.postMessage(message, "*");
    } catch {
      // The frame went away between the call and its answer.
    }
  }

  /** Hands an answer to the recorder for a saved copy. Whatever goes wrong there never reaches the page. */
  private recorded(kind: string, args: unknown, value: unknown): void {
    try {
      this.opts.record?.(kind, args, value);
    } catch {
      // A copy of the page is a convenience; the page is answered all the same.
    }
  }

  private ok(id: number, value?: unknown): void {
    if (value === undefined || value === null) return this.send({ id, ok: true });
    const text = JSON.stringify(value);
    if (text !== undefined && text.length * 3 > MAX_ANSWER_BYTES && byteLength(text) > MAX_ANSWER_BYTES) {
      return this.fail(id, bridgeError("too_large", "That answer is more than 2 MB. Ask for fewer notes."));
    }
    this.send({ id, ok: true, value });
  }

  private fail(id: number, error: BridgeError): void {
    this.send({ id, ok: false, error });
  }

  // ---- doing ----

  private async run(call: BridgeRequest): Promise<void> {
    const id = call.id;
    try {
      switch (call.kind) {
        case "theme":
          return this.ok(id, this.opts.theme());
        case "resize": {
          const limit = Math.min(this.opts.maxHeight ?? MAX_BLOCK_HEIGHT_PX, MAX_BLOCK_HEIGHT_PX);
          this.opts.onResize?.(Math.max(MIN_HEIGHT_PX, Math.min(call.args.px, limit)));
          return this.ok(id);
        }
        case "log":
          this.opts.onLog?.(call.args.args);
          return this.ok(id);
        case "report":
          await this.viaApp(() => this.opts.backend.report(this.opts.pagePath, call.args, this.opts.frameToken));
          this.opts.onReported?.();
          return this.ok(id);
        case "unwatch":
          this.watches.delete(call.args.watchId);
          if (this.watches.size === 0) this.endWatching();
          return this.ok(id);
        case "watch":
          return await this.watch(id, call.args.watchId, call.args.query);
        case "open": {
          // A page cannot flip through the person's notes: one a second.
          if (this.now() - this.lastOpen < OPEN_GAP_MS) {
            return this.fail(id, bridgeError("rate_limited", "A page may open one note a second."));
          }
          this.lastOpen = this.now();
          const found = (await this.viaApp(() => this.opts.backend.call(this.opts.pagePath, vaultCall(call), this.opts.frameToken))) as { path?: unknown } | null;
          if (this.disposed) return;
          if (typeof found?.path === "string") this.opts.onOpen?.(found.path);
          return this.ok(id);
        }
        default: {
          const value = await this.viaApp(() => this.opts.backend.call(this.opts.pagePath, vaultCall(call), this.opts.frameToken));
          // A copy of the page for sharing carries what it read (reads only).
          if (!isWriteCall(call)) this.recorded(call.kind, (call as { args?: unknown }).args, value);
          return this.ok(id, value);
        }
      }
    } catch (err) {
      this.fail(id, asBridgeError(err, isWriteCall(call) ? "refused" : "bad_request"));
    }
  }

  // ---- watches ----

  private async watch(id: number, watchId: string, query: QuerySpec): Promise<void> {
    if (!this.watches.has(watchId) && this.watches.size >= MAX_WATCHES) {
      return this.fail(id, bridgeError("refused", `A page may watch ${MAX_WATCHES} queries at a time.`));
    }
    // The place is taken now, before the first answer: a page that asks for many at once, while the
    // app is still answering, cannot get past the limit.
    const watch: Watch = { query, last: null };
    this.watches.set(watchId, watch);
    let value: unknown;
    try {
      value = await this.query(query);
    } catch (err) {
      if (this.watches.get(watchId) === watch) this.watches.delete(watchId);
      throw err;
    }
    // The host may have been disposed while the first answer was on its way.
    if (this.disposed) return;
    // The page stopped this watch (or replaced it) meanwhile: it gets the answer and nothing more.
    if (this.watches.get(watchId) !== watch) return this.ok(id, value);
    watch.last = JSON.stringify(value) ?? null;
    this.recorded("query", query, value);
    this.startWatching();
    this.ok(id, value);
  }

  private query(query: QuerySpec): Promise<unknown> {
    return this.viaApp(() => this.opts.backend.call(this.opts.pagePath, { kind: "query", args: query }, this.opts.frameToken));
  }

  private startWatching(): void {
    if (this.stopWatching) return;
    this.stopWatching = this.opts.onVaultChange(() => this.vaultChanged());
  }

  private endWatching(): void {
    this.cancelTimer();
    this.stopWatching?.();
    this.stopWatching = null;
    this.stale = false;
  }

  private vaultChanged(): void {
    if (this.disposed || this.watches.size === 0) return;
    if (this.paused) {
      this.stale = true;
      return;
    }
    this.schedule();
  }

  /** Waits for the vault to be quiet for the debounce, then runs the watches once. */
  private schedule(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rerun();
    }, WATCH_DEBOUNCE_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async rerun(): Promise<void> {
    await Promise.all(
      [...this.watches.entries()].map(async ([watchId, watch]) => {
        try {
          const value = await this.query(watch.query);
          const text = JSON.stringify(value) ?? null;
          // Gone, stopped, or replaced while the query ran; or nothing new to say.
          if (this.disposed || this.watches.get(watchId) !== watch || text === watch.last) return;
          if (text !== null && text.length * 3 > MAX_ANSWER_BYTES && byteLength(text) > MAX_ANSWER_BYTES) return;
          watch.last = text;
          this.recorded("query", watch.query, value);
          this.send({ event: "watch", watchId, value });
        } catch {
          // The next change tries again.
        }
      }),
    );
  }
}
