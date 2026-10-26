// A smart page in a tab that is kept ready out of sight (React's Activity,
// hidden) is unloaded: its frame is taken out of the page, the app stops
// serving its secret, and it loads again, under a new one, when the tab
// is shown.

import { Activity } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SmartFrame } from "./SmartFrame";
import { FakeBackend } from "./test-support/fake-frame";
import { FakeObserver } from "./test-support/observer";

beforeEach(() => {
  FakeObserver.reset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tab = (backend: FakeBackend, mode: "visible" | "hidden") => (
  <Activity mode={mode}>
    <SmartFrame pagePath="library/tracker.md" pageId="01PAGE" title="Tracker" backend={backend} />
  </Activity>
);

describe("a smart page in a hidden tab", () => {
  it("is unloaded while hidden and loads again, under a new secret, when shown", async () => {
    const backend = new FakeBackend();
    const view = render(tab(backend, "visible"));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(view.container.querySelector("iframe")).not.toBeNull();
    });
    expect([...backend.live]).toEqual([backend.made[0]]);

    view.rerender(tab(backend, "hidden"));
    await waitFor(() => expect(backend.live.size).toBe(0));
    await waitFor(() => expect(view.container.querySelector("iframe")).toBeNull());

    view.rerender(tab(backend, "visible"));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(view.container.querySelector("iframe")).not.toBeNull();
    });
    expect(backend.made).toHaveLength(2);
    expect([...backend.live]).toEqual([backend.made[1]]);
    act(() => {});
  });
});
