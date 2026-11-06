// Runs code in a sandboxed frame, one run at a time, and ends the frame when the answer is in or the time is up. The frame itself
// (a DOM element) is behind `FrameHost`, so this is the whole protocol and can be tested with a frame that is only an object.
//
// The protocol: the frame says `ready`; the window answers with one `run` message (the code, the inputs' text, the colours); the
// frame answers once with `result` or `error`. The window reads only messages of exactly those shapes, from the frame it made,
// whose `id` is the run's; everything else is ignored. A frame is used for one run and then ended: a program that never ends is
// cut off from outside when its time is up, and what one run left behind never reaches the next.

import { type FrameMessage, LINE_CHARS, MAX_SVG_CHARS, MOST_LINES, type RunOutcome, type RunRequest } from "./types";

/** A frame made for one run. */
export interface SandboxFrame {
  /** Posts a message to the code's frame. */
  post(message: unknown): void;
  /** Ends the frame: it is taken out of the page and its address stops being served. */
  close(): void;
}

/** Makes frames. `onMessage` is told what the frame posts (its own messages only). */
export interface FrameHost {
  open(onMessage: (data: unknown) => void): Promise<SandboxFrame>;
}

/** Time, so a test does not wait for it. */
export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const isText = (value: unknown, most: number): value is string => typeof value === "string" && value.length <= most;

function linesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string")
    .slice(0, MOST_LINES)
    .map((line) => line.slice(0, LINE_CHARS));
}

const place = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1_000_000 ? value : null);

/** A message of the frame, when it is one of the three this window knows; anything else is null. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m["type"] === "ready") return { type: "ready" };
  const id = m["id"];
  if (!isText(id, 200)) return null;
  const svg = m["svg"];
  if (m["type"] === "result" && isText(svg, MAX_SVG_CHARS)) return { type: "result", id, svg, logs: linesOf(m["logs"]), warnings: linesOf(m["warnings"]) };
  const message = m["message"];
  if (m["type"] === "error" && isText(message, 2000)) return { type: "error", id, message, line: place(m["line"]), column: place(m["column"]) };
  return null;
}

let counter = 0;
const newId = (): string => `run-${++counter}-${Math.random().toString(36).slice(2, 10)}`;

/** The run waiting its turn: runs go one after another in a window. */
let tail: Promise<unknown> = Promise.resolve();

function runOne(request: RunRequest, host: FrameHost, timers: Timers): Promise<RunOutcome> {
  const id = newId();
  return new Promise<RunOutcome>((resolve) => {
    let frame: SandboxFrame | null = null;
    let ready = false;
    let sent = false;
    let settled = false;

    const send = () => {
      if (!frame || !ready || sent || settled) return;
      sent = true;
      frame.post({ type: "run", id, code: request.code, inputs: request.inputs, theme: request.theme });
    };
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      frame?.close();
      resolve(outcome);
    };

    const seconds = Math.max(1, Math.round(request.timeoutMs / 1000));
    const timer = timers.set(() => finish({ ok: false, error: { message: `The code ran longer than ${seconds} seconds and was stopped.` } }), request.timeoutMs);

    host
      .open((data) => {
        const message = parseFrameMessage(data);
        if (!message || settled) return;
        if (message.type === "ready") {
          ready = true;
          send();
        } else if (message.id !== id) {
          // Not this run's: ignored.
        } else if (message.type === "result") {
          finish({ ok: true, svg: message.svg, logs: message.logs, warnings: message.warnings });
        } else {
          finish({ ok: false, error: { message: message.message, ...(message.line ? { line: message.line } : {}), ...(message.column ? { column: message.column } : {}) } });
        }
      })
      .then(
        (opened) => {
          if (settled) return opened.close();
          frame = opened;
          send();
        },
        (err: unknown) => finish({ ok: false, error: { message: err instanceof Error ? err.message : "The place the code runs in could not be started." } }),
      );
  });
}

/**
 * Runs the code and answers with what it drew, or why not. It never rejects. Runs are queued: one frame at a time, so a deck
 * of ten code pictures does not start ten programs at once.
 */
export function runCode(request: RunRequest, host: FrameHost, timers: Timers = realTimers): Promise<RunOutcome> {
  const next = tail.then(() => runOne(request, host, timers));
  tail = next.catch(() => undefined);
  return next;
}
