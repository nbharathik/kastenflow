// The protocol between the window and the sandbox's frame, with a frame that is only an object: ready, one run, one answer, and the
// frame ended when it is over or the time is up. Anything the frame says that is not one of the three messages is ignored.

import { describe, expect, it, vi } from "vitest";

import { type FrameHost, type SandboxFrame, type Timers, parseFrameMessage, runCode } from "./sandbox";
import type { RunRequest } from "./types";

const request: RunRequest = { code: "return kit.svg(10, 10, '');", inputs: { sales: "a,b" }, theme: { accent1: "#2563eb" }, timeoutMs: 10_000 };

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** A frame that records what it is told, and a host that hands it out and remembers where its messages go. */
function fake() {
  const frame = {
    posted: [] as unknown[],
    closed: false,
    post(message: unknown) {
      this.posted.push(message);
    },
    close() {
      this.closed = true;
    },
  };
  const state: { onMessage: (data: unknown) => void; opened: number } = { onMessage: () => {}, opened: 0 };
  const host: FrameHost = {
    async open(onMessage) {
      state.opened += 1;
      state.onMessage = onMessage;
      return frame satisfies SandboxFrame;
    },
  };
  const fired: { run: () => void; ms: number }[] = [];
  const timers: Timers = {
    set: vi.fn((run: () => void, ms: number) => {
      fired.push({ run, ms });
      return fired.length;
    }),
    clear: vi.fn(),
  };
  const sentRun = () => frame.posted[0] as { type: string; id: string; code: string; inputs: unknown; theme: unknown };
  return { frame, state, host, timers, fired, sentRun };
}

describe("a message from the frame", () => {
  it("is read only when it is exactly one of the three, with the sizes cut", () => {
    expect(parseFrameMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseFrameMessage({ type: "result", id: "r", svg: "<svg/>", logs: ["a", 4, "b"], warnings: [] })).toEqual({ type: "result", id: "r", svg: "<svg/>", logs: ["a", "b"], warnings: [] });
    expect(parseFrameMessage({ type: "error", id: "r", message: "boom", line: 3, column: 7 })).toEqual({ type: "error", id: "r", message: "boom", line: 3, column: 7 });
    expect(parseFrameMessage({ type: "error", id: "r", message: "boom", line: -1, column: "x" })).toEqual({ type: "error", id: "r", message: "boom", line: null, column: null });
    const wordy = parseFrameMessage({ type: "result", id: "r", svg: "<svg/>", logs: Array.from({ length: 80 }, () => "x".repeat(500)), warnings: [] });
    expect(wordy?.type === "result" && wordy.logs.length).toBe(50);
    expect(wordy?.type === "result" && wordy.logs[0]?.length).toBe(300);
    for (const bad of [null, undefined, "ready", 4, [], {}, { type: "result" }, { type: "result", id: 4, svg: "<svg/>" }, { type: "result", id: "r", svg: 4 }, { type: "result", id: "r", svg: "x".repeat(1024 * 1024 + 1) }, { type: "error", id: "r" }, { type: "run", id: "r", code: "x" }, { type: "result", id: "x".repeat(201), svg: "" }]) {
      expect(parseFrameMessage(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });
});

describe("running code in the sandbox", () => {
  it("sends the code once the frame is ready and answers with what it drew, then ends the frame", async () => {
    const { host, timers, state, frame, sentRun } = fake();
    const pending = runCode(request, host, timers);
    await tick();
    expect(frame.posted).toEqual([]);
    state.onMessage({ type: "ready" });
    expect(sentRun()).toMatchObject({ type: "run", code: request.code, inputs: { sales: "a,b" }, theme: { accent1: "#2563eb" } });
    state.onMessage({ type: "ready" });
    expect(frame.posted).toHaveLength(1);
    state.onMessage({ type: "result", id: sentRun().id, svg: "<svg/>", logs: ["rows: 2"], warnings: ["w"] });
    expect(await pending).toEqual({ ok: true, svg: "<svg/>", logs: ["rows: 2"], warnings: ["w"] });
    expect(frame.closed).toBe(true);
    expect(timers.clear).toHaveBeenCalled();
  });

  it("answers with the error and its line when the code fails", async () => {
    const { host, timers, state, sentRun } = fake();
    const pending = runCode(request, host, timers);
    await tick();
    state.onMessage({ type: "ready" });
    state.onMessage({ type: "error", id: sentRun().id, message: "ReferenceError: sales is not defined", line: 2, column: 5 });
    expect(await pending).toEqual({ ok: false, error: { message: "ReferenceError: sales is not defined", line: 2, column: 5 } });
    const bare = fake();
    const second = runCode(request, bare.host, bare.timers);
    await tick();
    bare.state.onMessage({ type: "ready" });
    bare.state.onMessage({ type: "error", id: bare.sentRun().id, message: "Syntax", line: null, column: null });
    expect(await second).toEqual({ ok: false, error: { message: "Syntax" } });
  });

  it("ignores another run's answer and anything that is not a message of the protocol", async () => {
    const { host, timers, state, sentRun, frame } = fake();
    const pending = runCode(request, host, timers);
    await tick();
    state.onMessage({ type: "ready" });
    state.onMessage({ type: "result", id: "not-this-run", svg: "<svg>wrong</svg>", logs: [], warnings: [] });
    state.onMessage("hello");
    state.onMessage({ type: "result", id: sentRun().id, svg: 4 });
    expect(frame.closed).toBe(false);
    state.onMessage({ type: "result", id: sentRun().id, svg: "<svg>right</svg>", logs: [], warnings: [] });
    expect(await pending).toMatchObject({ ok: true, svg: "<svg>right</svg>" });
    // Said after the run is over: nothing happens.
    state.onMessage({ type: "error", id: sentRun().id, message: "late", line: null, column: null });
  });

  it("ends the frame when the time is up, and says how long the code was given", async () => {
    const { host, timers, state, fired, frame, sentRun } = fake();
    const pending = runCode({ ...request, timeoutMs: 5_000 }, host, timers);
    await tick();
    state.onMessage({ type: "ready" });
    expect(fired[0]?.ms).toBe(5_000);
    fired[0]!.run();
    expect(await pending).toEqual({ ok: false, error: { message: "The code ran longer than 5 seconds and was stopped." } });
    expect(frame.closed).toBe(true);
    state.onMessage({ type: "result", id: sentRun().id, svg: "<svg/>", logs: [], warnings: [] });
  });

  it("ends a frame that opens after the time was up, and says so when none could be made", async () => {
    let open!: (frame: SandboxFrame) => void;
    const late = { closed: false, post() {}, close() { this.closed = true; } };
    const slow: FrameHost = { open: () => new Promise((resolve) => (open = resolve)) };
    const timers = fake().timers;
    const waiting = runCode(request, slow, timers);
    await tick();
    (timers.set as ReturnType<typeof vi.fn>).mock.calls[0]![0]();
    expect((await waiting).ok).toBe(false);
    open(late);
    await tick();
    expect(late.closed).toBe(true);

    const broken: FrameHost = { open: async () => Promise.reject(new Error("This computer would not give a secure number")) };
    expect(await runCode(request, broken, fake().timers)).toEqual({ ok: false, error: { message: "This computer would not give a secure number" } });
  });

  it("runs one at a time: the next frame is made only when the one before is over", async () => {
    const one = fake();
    const two = fake();
    const first = runCode(request, one.host, one.timers);
    const second = runCode({ ...request, code: "return 2;" }, two.host, two.timers);
    await tick();
    expect(one.state.opened).toBe(1);
    expect(two.state.opened).toBe(0);
    one.state.onMessage({ type: "ready" });
    one.state.onMessage({ type: "result", id: one.sentRun().id, svg: "<svg>1</svg>", logs: [], warnings: [] });
    expect(await first).toMatchObject({ ok: true });
    await tick();
    expect(two.state.opened).toBe(1);
    two.state.onMessage({ type: "ready" });
    expect(two.sentRun().code).toBe("return 2;");
    two.state.onMessage({ type: "result", id: two.sentRun().id, svg: "<svg>2</svg>", logs: [], warnings: [] });
    expect(await second).toMatchObject({ ok: true, svg: "<svg>2</svg>" });
  });
});
