// A tab kept ready: hidden, it stops its media; shown again it does not fade
// in again and focus returns to where it was.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Pane, Tab } from "../features/workspace/tabs";
import { KeepAlive } from "./KeepAlive";
import { PaneBody } from "./PaneBody";

vi.mock("./ViewOutlet", () => ({
  ViewOutlet: ({ place }: { place: { view: string } }) => (
    <div>
      <input aria-label={`field-${place.view}`} />
      <video data-testid={`video-${place.view}`} />
    </div>
  ),
}));

const tab = (id: string, view: string): Tab => ({ id, place: { view: view as Tab["place"]["view"] }, back: [], forward: [], pinned: false });
const pane: Pane = { id: "p", tabs: [], active: "a" };
const tabs = [tab("a", "tags"), tab("b", "tasks")];

function Harness({ active, fadeOnMount }: { active: string; fadeOnMount: boolean }) {
  return <KeepAlive items={tabs} active={active} keep={4} canKeep={() => true} render={(t) => <PaneBody pane={pane} tab={t} fadeOnMount={fadeOnMount} setDropping={() => {}} />} />;
}

const animate = vi.fn(() => ({ cancel() {} }));
const pause = vi.fn();

beforeEach(() => {
  animate.mockClear();
  pause.mockClear();
  (HTMLElement.prototype as unknown as { animate: typeof animate }).animate = animate;
  (HTMLMediaElement.prototype as unknown as { pause: typeof pause }).pause = pause;
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as { animate?: typeof animate }).animate;
  delete document.documentElement.dataset.motion;
});

describe("a tab kept ready", () => {
  it("fades in only when newly mounted, never when shown again", () => {
    const { rerender } = render(<Harness active="a" fadeOnMount />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Harness active="b" fadeOnMount />);
    expect(animate).toHaveBeenCalledTimes(2);
    rerender(<Harness active="a" fadeOnMount />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("does not fade while motion is off", () => {
    document.documentElement.dataset.motion = "off";
    const { rerender } = render(<Harness active="a" fadeOnMount />);
    rerender(<Harness active="b" fadeOnMount />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("pauses its media when hidden", () => {
    const { rerender } = render(<Harness active="a" fadeOnMount={false} />);
    expect(pause).not.toHaveBeenCalled();
    rerender(<Harness active="b" fadeOnMount={false} />);
    expect(pause).toHaveBeenCalled();
  });

  it("gives focus back to where it was when shown again", () => {
    const { rerender, getByLabelText } = render(<Harness active="a" fadeOnMount={false} />);
    const field = getByLabelText("field-tags");
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
    rerender(<Harness active="b" fadeOnMount={false} />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    rerender(<Harness active="a" fadeOnMount={false} />);
    expect(document.activeElement).toBe(field);
  });
});
