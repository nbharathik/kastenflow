import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startInterval, useInterval } from "./use-interval";

function hide(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  hide(false);
  vi.useRealTimers();
});

describe("startInterval", () => {
  it("runs on the beat while visible, not at the start", () => {
    const run = vi.fn();
    const stop = startInterval(run, 1000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("rests while hidden and runs at once on becoming visible", () => {
    const run = vi.fn();
    const stop = startInterval(run, 1000);
    hide(true);
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    hide(false);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops for good when stopped", () => {
    const run = vi.fn();
    const stop = startInterval(run, 1000);
    stop();
    vi.advanceTimersByTime(5000);
    hide(true);
    hide(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("useInterval", () => {
  function Probe({ run, active }: { run: () => void; active: boolean }) {
    useInterval(run, 500, active);
    return null;
  }

  it("runs only while active and while mounted", () => {
    const run = vi.fn();
    const view = render(<Probe run={run} active={false} />);
    vi.advanceTimersByTime(2000);
    expect(run).not.toHaveBeenCalled();
    view.rerender(<Probe run={run} active />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(run).toHaveBeenCalledTimes(2);
    view.unmount();
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("is paused while hidden and resumes with an immediate run", () => {
    const run = vi.fn();
    render(<Probe run={run} active />);
    act(() => hide(true));
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    act(() => hide(false));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
