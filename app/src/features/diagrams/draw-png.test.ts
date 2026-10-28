// A diagram drawn as a PNG for an agent: the window draws the SVG the app hands
// it, drawn smaller when the file is too big, and answers with the PNG as text,
// or says plainly why it could not.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answerJob, base64Of, DRAW_EVENT, drawWithin, useDrawForAgents, type DrawJob } from "./draw-png";

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), inTauri: () => true }));

const JOB: DrawJob = { id: "job1", svg: "<svg xmlns='http://www.w3.org/2000/svg'/>", background: "#ffffff", scale: 2, maxSide: 4000, maxBytes: 100 };
const answers = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "diagram_png_answer").map(([, args]) => args as Record<string, unknown>);

beforeEach(() => vi.mocked(invoke).mockClear());

describe("a picture drawn for an agent", () => {
  it("is sent as base64 text, however big", () => {
    expect(base64Of(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(btoa("\x89PNG"));
    const big = new Uint8Array(200_000).fill(65);
    expect(atob(base64Of(big))).toHaveLength(200_000);
  });

  it("is drawn on the background and at the scale the app says, and smaller until it fits", async () => {
    const draw = vi.fn(async (_svg: string, scale: number) => new Uint8Array(scale > 1 ? 500 : 50));
    const bytes = await drawWithin(JOB, draw);
    expect(bytes).toHaveLength(50);
    expect(draw.mock.calls.map((c) => Math.round(c[1] * 100) / 100)).toEqual([2, 1.4, 0.98]);
    expect(draw).toHaveBeenCalledWith(JOB.svg, 2, 4000, "#ffffff");
    // One that never fits is said to be too big, after a few tries.
    const never = vi.fn(async () => new Uint8Array(500));
    await expect(drawWithin(JOB, never)).rejects.toThrow("too big to send");
    expect(never).toHaveBeenCalledTimes(5);
  });

  it("is answered to the app, and a window that cannot draw says why instead", async () => {
    await answerJob(JOB, async () => new Uint8Array([1, 2, 3]));
    expect(answers()).toEqual([{ id: "job1", png: btoa("\x01\x02\x03") }]);
    vi.mocked(invoke).mockClear();
    await answerJob(JOB, async () => {
      throw new Error("This window cannot draw a PNG");
    });
    expect(answers()).toEqual([{ id: "job1", error: "This window cannot draw a PNG" }]);
  });

  it("is asked for by the app's event, for as long as the window is there", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation((async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }) as never);
    const view = renderHook(() => useDrawForAgents());
    await waitFor(() => expect(handlers.has(DRAW_EVENT)).toBe(true));
    view.unmount();
    expect(handlers.has(DRAW_EVENT)).toBe(false);
  });
});
