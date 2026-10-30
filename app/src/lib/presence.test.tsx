// A surface stays for its exit, says so in `data-state`, and goes at once
// when motion is off.

import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exitMs, originFor, useLeaveGhost, usePresence } from "./presence";

function Panel({ open }: { open: boolean }) {
  const { present, state } = usePresence(open, 140);
  return present ? <div data-testid="panel" data-state={state} /> : null;
}

function Ghosting() {
  const ref = useRef<HTMLDivElement>(null);
  useLeaveGhost(ref, 100, true);
  return <div ref={ref} id="gone" role="menu" />;
}

function motion(value?: "on" | "off", reduced = false) {
  const root = document.documentElement.dataset;
  delete root.motion;
  delete root.motionReduced;
  if (value) root.motion = value;
  if (reduced) root.motionReduced = "";
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  motion();
});

describe("usePresence", () => {
  it("stays mounted, closing, for the exit time while motion is on", () => {
    motion("on");
    const view = render(<Panel open />);
    expect(view.getByTestId("panel").dataset.state).toBe("open");
    view.rerender(<Panel open={false} />);
    expect(view.getByTestId("panel").dataset.state).toBe("closing");
    act(() => {
      vi.advanceTimersByTime(139);
    });
    expect(view.queryByTestId("panel")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(view.queryByTestId("panel")).toBeNull();
  });

  it("unmounts at once when motion is off, and when it is not set", () => {
    for (const value of ["off", undefined] as const) {
      motion(value);
      const view = render(<Panel open />);
      view.rerender(<Panel open={false} />);
      expect(view.queryByTestId("panel")).toBeNull();
      view.unmount();
    }
  });

  it("opens again while it is closing", () => {
    motion("on");
    const view = render(<Panel open />);
    view.rerender(<Panel open={false} />);
    view.rerender(<Panel open />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(view.getByTestId("panel").dataset.state).toBe("open");
  });
});

describe("exitMs", () => {
  it("is the time given, a short fade for reduced motion, and nothing when off", () => {
    motion("on");
    expect(exitMs(200)).toBe(200);
    motion("off", true);
    expect(exitMs(200)).toBe(90);
    motion("off");
    expect(exitMs(200)).toBe(0);
  });
});

describe("useLeaveGhost", () => {
  it("leaves a hidden, inert copy that removes itself", async () => {
    motion("on");
    const view = render(<Ghosting />);
    view.unmount();
    await Promise.resolve();
    const ghost = document.body.querySelector<HTMLElement>("[data-ghost]");
    expect(ghost?.dataset.state).toBe("closing");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost?.hasAttribute("inert")).toBe(true);
    expect(ghost?.id).toBe("");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.body.querySelector("[data-ghost]")).toBeNull();
  });

  it("leaves nothing when motion is off", async () => {
    motion("off");
    render(<Ghosting />).unmount();
    await Promise.resolve();
    expect(document.body.querySelector("[data-ghost]")).toBeNull();
  });
});

describe("originFor", () => {
  it("grows from the anchor's centre, from the top when the menu is below it", () => {
    expect(originFor({ left: 100, width: 40, top: 10 }, { left: 80, width: 200, bottom: 300 })).toBe("40px top");
  });

  it("grows from the bottom when the menu opened upwards, and stays inside the box", () => {
    expect(originFor({ left: 600, width: 40, top: 400 }, { left: 80, width: 200, bottom: 390 })).toBe("200px bottom");
    expect(originFor({ left: 0, width: 10, top: 400 }, { left: 80, width: 200, bottom: 390 })).toBe("0px bottom");
  });
});
