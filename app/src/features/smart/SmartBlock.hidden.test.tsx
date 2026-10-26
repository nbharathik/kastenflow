// Smart blocks in a tab kept ready out of sight (React's Activity): hidden, they
// give their frames and their places back; shown again, the ones that were running
// take their places again, so a page still never runs more than four at once.

import { Activity } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { running } from "./live-frames";
import { forgetRunSwitch } from "./run-switch";
import { SmartBlock } from "./SmartBlock";
import { FakeBackend } from "./test-support/fake-frame";
import { FakeObserver } from "./test-support/observer";

const SCOPE = "library/host.md";

beforeEach(() => {
  FakeObserver.reset();
  forgetRunSwitch();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tab = (backend: FakeBackend, mode: "visible" | "hidden") => (
  <Activity mode={mode}>
    <div>
      {Array.from({ length: 6 }, (_, n) => (
        <SmartBlock key={n} pagePath={`library/block-${n}.md`} pageId={`0${n}`} title={`Block ${n}`} scope={SCOPE} backend={backend} />
      ))}
    </div>
  </Activity>
);

describe("smart blocks in a hidden tab", () => {
  it("run nothing while hidden, and take their four places again when shown", async () => {
    const backend = new FakeBackend();
    const view = render(tab(backend, "visible"));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(view.container.querySelectorAll("iframe")).toHaveLength(4);
    });
    expect(running(SCOPE)).toBe(4);

    view.rerender(tab(backend, "hidden"));
    await waitFor(() => expect(backend.live.size).toBe(0));
    expect(running(SCOPE)).toBe(0);

    view.rerender(tab(backend, "visible"));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(view.container.querySelectorAll("iframe")).toHaveLength(4);
    });
    // Counted again: four places taken, so the two that wait still wait and a click is refused.
    expect(running(SCOPE)).toBe(4);
    expect(screen.getAllByRole("button", { name: "Click to run" })).toHaveLength(2);
    await waitFor(() => expect(backend.live.size).toBe(4));
  });
});
