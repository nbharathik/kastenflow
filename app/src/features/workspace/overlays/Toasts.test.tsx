import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOcclusion } from "../../browser/occlusion";
import { SHOW_HOLD, holdForShow, useShowing } from "../../browser/show";
import { useWorkspace } from "../store";
import { TOAST_MS, Toasts } from "./Toasts";

const texts = () => useWorkspace.getState().toasts.map((t) => t.text);

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspace.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toasts", () => {
  it("lets a toast go after a while, but not while the pointer is on it", () => {
    render(<Toasts />);
    act(() => useWorkspace.getState().toast("Saved a copy"));
    const card = screen.getByText("Saved a copy").closest(".kasten-toast")!;
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(TOAST_MS.plain * 3));
    expect(texts()).toEqual(["Saved a copy"]);
    fireEvent.pointerLeave(card);
    act(() => vi.advanceTimersByTime(TOAST_MS.plain));
    expect(card.classList.contains("is-leaving")).toBe(true);
    act(() => vi.advanceTimersByTime(TOAST_MS.leave));
    expect(texts()).toEqual([]);
  });

  it("stays longer when it offers an action, and runs it once", () => {
    const run = vi.fn();
    render(<Toasts />);
    act(() => useWorkspace.getState().toast("Moved “Plan” to the trash", { label: "Undo", run }));
    act(() => vi.advanceTimersByTime(TOAST_MS.plain + TOAST_MS.leave));
    expect(texts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledOnce();
    expect(texts()).toEqual([]);
  });

  it("shows nothing over a slide show, takes no part of the window from a native view, and shows what waited once it ends", () => {
    useOcclusion.setState({ holds: {}, areas: {} });
    useShowing.setState({ count: 0 });
    render(<Toasts />);
    let done = () => {};
    act(() => void (done = holdForShow()));
    act(() => useWorkspace.getState().toast("Saved a copy"));
    expect(screen.queryByText("Saved a copy")).toBeNull();
    // Only the show's own hold is on the window: the toasts add none.
    expect(Object.keys(useOcclusion.getState().holds)).toEqual([SHOW_HOLD]);
    act(() => done());
    expect(screen.getByText("Saved a copy")).toBeTruthy();
  });

  it("closes with its button, and the store keeps at most three", () => {
    render(<Toasts />);
    act(() => {
      for (const n of [1, 2, 3, 4]) useWorkspace.getState().toast(`Note ${n}`);
    });
    expect(texts()).toEqual(["Note 2", "Note 3", "Note 4"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    act(() => vi.advanceTimersByTime(TOAST_MS.leave));
    expect(texts()).toEqual(["Note 3", "Note 4"]);
  });
});
