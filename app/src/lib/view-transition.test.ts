// A view change cross-fades where the API exists and motion is on; otherwise
// it happens at once, in the same call.

import { afterEach, describe, expect, it, vi } from "vitest";

import { viewTransition } from "./view-transition";

const doc = document as unknown as { startViewTransition?: unknown };

afterEach(() => {
  delete doc.startViewTransition;
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.motionReduced;
  delete document.documentElement.dataset.viewTransition;
});

describe("viewTransition", () => {
  it("runs the change at once without the API", () => {
    document.documentElement.dataset.motion = "on";
    const update = vi.fn();
    viewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs the change at once when motion is off, API or not", () => {
    const start = vi.fn();
    doc.startViewTransition = start;
    document.documentElement.dataset.motion = "off";
    const update = vi.fn();
    viewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("hands the change to the API when motion is on, and marks the page while it runs", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });
    doc.startViewTransition = start;
    document.documentElement.dataset.motion = "on";
    const update = vi.fn();
    viewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-view-transition")).toBe(true);
    finish();
    await finished;
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.hasAttribute("data-view-transition")).toBe(false);
  });

  it("still fades when only the computer asks for less motion", () => {
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = start;
    document.documentElement.dataset.motion = "off";
    document.documentElement.dataset.motionReduced = "";
    viewTransition(vi.fn());
    expect(start).toHaveBeenCalledTimes(1);
  });
});
