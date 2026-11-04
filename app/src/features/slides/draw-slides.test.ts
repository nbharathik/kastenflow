// Slides drawn for an agent: the window draws the deck the app hands it, smaller when the
// file is too big, and answers with the PNG as text, or the sizes of the words as JSON, or
// says plainly why it could not.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answerSlidesJob, drawWithin, SLIDES_EVENT, useDrawSlidesForAgents, type Shots, type SlidesJob } from "./draw-slides";

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), inTauri: () => true }));

const JOB: SlidesJob = { id: "job1", kind: "slide", after: "{after}", before: null, slide: 2, step: 1, scale: 2, maxSide: 4000, maxBytes: 100 };
const answers = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "diagram_png_answer").map(([, args]) => args as Record<string, unknown>);

function shots(over: Partial<Shots> = {}): Shots {
  const bytes = async () => new Uint8Array([1, 2, 3]);
  return { slide: vi.fn(bytes), grid: vi.fn(bytes), diff: vi.fn(bytes), measure: vi.fn(async () => ({ slides: {} })), ...over };
}

beforeEach(() => vi.mocked(invoke).mockClear());

describe("a slide drawn for an agent", () => {
  it("is drawn at the scale the app says, and smaller until it fits", async () => {
    const draw = vi.fn(async (scale: number) => new Uint8Array(scale > 1 ? 500 : 50));
    expect(await drawWithin(JOB, draw)).toHaveLength(50);
    expect(draw.mock.calls.map((c) => Math.round(c[0] * 100) / 100)).toEqual([2, 1.4, 0.98]);
    const never = vi.fn(async () => new Uint8Array(500));
    await expect(drawWithin(JOB, never)).rejects.toThrow("too big to send");
    expect(never).toHaveBeenCalledTimes(5);
  });

  it("is the deck's slide at its click, answered as base64 text", async () => {
    const tools = shots();
    await answerSlidesJob(JOB, tools);
    expect(tools.slide).toHaveBeenCalledWith("{after}", 2, 1, 2, 4000);
    expect(answers()).toEqual([{ id: "job1", png: btoa("\x01\x02\x03") }]);
  });

  it("leaves the click out for the slide as it ends", async () => {
    const tools = shots();
    await answerSlidesJob({ ...JOB, step: undefined }, tools);
    expect(tools.slide).toHaveBeenCalledWith("{after}", 2, null, 2, 4000);
  });

  it("is shrunk when the file comes out too big, drawing the slide again", async () => {
    const tools = shots({ slide: vi.fn(async (_deck: string, _index: number, _step: number | null, scale: number) => new Uint8Array(scale > 1 ? 500 : 50)) });
    await answerSlidesJob(JOB, tools);
    expect(tools.slide).toHaveBeenCalledTimes(3);
    expect(answers()[0]).toEqual({ id: "job1", png: btoa(String.fromCharCode(...new Uint8Array(50))) });
  });

  it("is the whole deck as a grid", async () => {
    const tools = shots();
    await answerSlidesJob({ ...JOB, kind: "grid", scale: 1 }, tools);
    expect(tools.grid).toHaveBeenCalledWith("{after}", 4000);
    expect(answers()).toHaveLength(1);
  });

  it("is one slide before and after, with the older deck and the boxes that changed", async () => {
    const tools = shots();
    const job: SlidesJob = { ...JOB, kind: "diff", before: "{before}", beforeSlide: 1, beforeMarks: [[1, 2, 3, 4]], afterMarks: [] };
    await answerSlidesJob(job, tools);
    expect(tools.diff).toHaveBeenCalledWith({ ...job, before: "{before}" }, 2);
    expect(answers()).toEqual([{ id: "job1", png: btoa("\x01\x02\x03") }]);
  });

  it("is refused in words when the older deck did not come", async () => {
    await answerSlidesJob({ ...JOB, kind: "diff", before: null }, shots());
    expect(answers()).toEqual([{ id: "job1", error: "The older deck did not come with the request" }]);
  });

  it("is the sizes of the words, as JSON text", async () => {
    const tools = shots({ measure: vi.fn(async () => ({ slides: { "s-1": { "e-1": { textWidth: 10 } } } })) });
    await answerSlidesJob({ ...JOB, kind: "measure" }, tools);
    expect(tools.measure).toHaveBeenCalledWith("{after}");
    expect(JSON.parse(String(answers()[0]?.png))).toEqual({ slides: { "s-1": { "e-1": { textWidth: 10 } } } });
  });

  it("says why when a window cannot draw it, and nothing else", async () => {
    const tools = shots({
      slide: vi.fn(async () => {
        throw new Error("There is no slide 9: the deck has 3.");
      }),
    });
    await answerSlidesJob(JOB, tools);
    expect(answers()).toEqual([{ id: "job1", error: "There is no slide 9: the deck has 3." }]);
    vi.mocked(invoke).mockClear();
    await answerSlidesJob({ ...JOB, kind: "nonsense" as SlidesJob["kind"] }, shots());
    expect(String(answers()[0]?.error)).toContain("does not draw");
  });

  it("is asked for by the app's event, for as long as the window is there", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation((async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }) as never);
    const view = renderHook(() => useDrawSlidesForAgents());
    await waitFor(() => expect(handlers.has(SLIDES_EVENT)).toBe(true));
    view.unmount();
    expect(handlers.has(SLIDES_EVENT)).toBe(false);
  });
});
