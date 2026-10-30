// A pane's view fades in when the pane moves to another place, never on
// the first view, and not at all while motion is off.

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useViewEnter, VIEW_FADE_MS } from "./view-enter";

function View({ place }: { place: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewEnter(ref, place);
  return <div ref={ref}>{place}</div>;
}

const animate = vi.fn(() => ({ cancel() {} }));

beforeEach(() => {
  animate.mockClear();
  (HTMLElement.prototype as unknown as { animate: typeof animate }).animate = animate;
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as { animate?: typeof animate }).animate;
  delete document.documentElement.dataset.motion;
});

describe("view fade", () => {
  it("runs when the place changes, not on the first view", () => {
    const { rerender } = render(<View place="home" />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<View place="home" />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<View place="inbox" />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]).toEqual([[{ opacity: 0 }, { opacity: 1 }], expect.objectContaining({ duration: VIEW_FADE_MS })]);
  });

  it("fades a newly mounted view when asked, but not one shown again", () => {
    function Shown({ visible, place }: { visible: boolean; place: string }) {
      const ref = useRef<HTMLDivElement>(null);
      useViewEnter(ref, place, true);
      return <div ref={ref} hidden={!visible} />;
    }
    const { rerender } = render(<Shown visible place="a" />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Shown visible={false} place="a" />);
    rerender(<Shown visible place="a" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does not fade a newly mounted view while motion is off", () => {
    document.documentElement.dataset.motion = "off";
    function Shown() {
      const ref = useRef<HTMLDivElement>(null);
      useViewEnter(ref, "a", true);
      return <div ref={ref} />;
    }
    render(<Shown />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does nothing while motion is off", () => {
    document.documentElement.dataset.motion = "off";
    const { rerender } = render(<View place="home" />);
    rerender(<View place="inbox" />);
    expect(animate).not.toHaveBeenCalled();
  });
});
