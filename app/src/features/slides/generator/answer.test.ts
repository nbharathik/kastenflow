// An agent's request to run code, answered by the window: the SVG (and a look at it), or the PNG, or the error with its line. The
// frame is a stand-in that answers the run it is given; the drawing and the app's ear are stand-ins too.

import { describe, expect, it, vi } from "vitest";

import { base64Of } from "../../diagrams/draw-png";
import { type AnswerDeps, type RunJob, answerRunJob, errorWords } from "./answer";
import type { FrameHost } from "./sandbox";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const job = (extra: Partial<RunJob> = {}): RunJob => ({
  id: "job-1",
  deck: "library/talk.deck",
  agent: "claude-code",
  output: "svg",
  timeoutMs: 10_000,
  code: "return kit.svg(10, 10, '');",
  inputs: [{ name: "sales", text: "a,b\n1,2\n" }],
  theme: { accent1: "#2563eb" },
  maxSvg: 1024 * 1024,
  maxPng: 2 * 1024 * 1024,
  maxSide: 4000,
  ...extra,
});

interface Run {
  id: string;
  code: string;
  inputs: Record<string, string>;
  theme: Record<string, string>;
}

/** A frame that answers the run it is given with whatever a test says. */
function framed(say: (run: Run) => unknown): { host: FrameHost; ran: Run[] } {
  const ran: Run[] = [];
  const host: FrameHost = {
    async open(onMessage) {
      queueMicrotask(() => onMessage({ type: "ready" }));
      return {
        post(message) {
          const run = message as Run;
          ran.push(run);
          queueMicrotask(() => onMessage(say(run)));
        },
        close() {},
      };
    },
  };
  return { host, ran };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>';
const drew = (run: Run) => ({ type: "result", id: run.id, svg: SVG, logs: ["rows: 2"], warnings: ["a font"] });

function deps(host: FrameHost, over: Partial<AnswerDeps> = {}) {
  const draw = vi.fn(async (_svg: string, _scale: number, _side: number, _background: string) => PNG);
  const answer = vi.fn(async (_id: string, _answer: { text: string } | { error: string }): Promise<unknown> => undefined);
  const all: AnswerDeps = { host, draw, answer, ...over };
  return { all, draw, answer };
}

const told = (answer: ReturnType<typeof deps>["answer"]) => {
  const [id, body] = answer.mock.calls[0]!;
  if (!("text" in body)) throw new Error(`answered with an error: ${body.error}`);
  return { id, body: JSON.parse(body.text) as Record<string, unknown> };
};

describe("answering a request to run code", () => {
  it("hands the code and what it may read to the sandbox and answers with the SVG and a look at it", async () => {
    const { host, ran } = framed(drew);
    const { all, draw, answer } = deps(host);
    await answerRunJob(job(), all);
    expect(ran[0]).toMatchObject({ code: "return kit.svg(10, 10, '');", inputs: { sales: "a,b\n1,2\n" }, theme: { accent1: "#2563eb" } });
    const { id, body } = told(answer);
    expect(id).toBe("job-1");
    expect(body).toEqual({ output: "svg", svg: SVG, preview_png_base64: base64Of(PNG), warnings: ["a font"], logs: ["rows: 2"] });
    expect(draw).toHaveBeenCalledWith(SVG, 1, 800, "transparent");
  });

  it("draws a PNG when a PNG was asked for, at twice the size and within the sides it was told", async () => {
    const { host } = framed(drew);
    const { all, draw, answer } = deps(host);
    await answerRunJob(job({ output: "png", maxSide: 3000 }), all);
    expect(told(answer).body).toEqual({ output: "png", png_base64: base64Of(PNG), warnings: ["a font"], logs: ["rows: 2"] });
    expect(draw).toHaveBeenCalledWith(SVG, 2, 3000, "transparent");
  });

  it("answers with the error and its line when the code fails, and draws nothing", async () => {
    const { host } = framed((run) => ({ type: "error", id: run.id, message: "ReferenceError: sales is not defined", line: 3, column: 9 }));
    const { all, draw, answer } = deps(host);
    await answerRunJob(job(), all);
    expect(answer).toHaveBeenCalledWith("job-1", { error: "Line 3: ReferenceError: sales is not defined" });
    expect(draw).not.toHaveBeenCalled();
    expect(errorWords({ message: "boom" })).toBe("boom");
    expect(errorWords({ message: "boom", line: 1 })).toBe("Line 1: boom");
  });

  it("still answers with the SVG when only the look at it could not be drawn, and says so when the PNG cannot", async () => {
    const svgOnly = deps(framed(drew).host, { draw: async () => Promise.reject(new Error("tainted canvas")) });
    await answerRunJob(job(), svgOnly.all);
    const body = told(svgOnly.answer).body;
    expect(body["svg"]).toBe(SVG);
    expect(body).not.toHaveProperty("preview_png_base64");

    const png = deps(framed(drew).host, { draw: async () => Promise.reject(new Error("tainted canvas")) });
    await answerRunJob(job({ output: "png" }), png.all);
    expect(png.answer).toHaveBeenCalledWith("job-1", { error: "tainted canvas" });

    const heavy = deps(framed(drew).host, { draw: async () => new Uint8Array(3 * 1024 * 1024) });
    await answerRunJob(job({ output: "png" }), heavy.all);
    expect(heavy.answer).toHaveBeenCalledWith("job-1", { error: "The picture is too big to send, even drawn smaller" });
  });

  it("never throws: a window that cannot even answer leaves the request to time out", async () => {
    const { host } = framed(drew);
    const { all } = deps(host, { answer: async () => Promise.reject(new Error("no way to the app")) });
    await expect(answerRunJob(job(), all)).resolves.toBeUndefined();
  });
});
