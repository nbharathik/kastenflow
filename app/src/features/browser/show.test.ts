import { beforeEach, describe, expect, it } from "vitest";

import { covered, useOcclusion } from "./occlusion";
import { SHOW_HOLD, holdForShow, showing, useShowing } from "./show";

const box = { left: 10, top: 10, right: 100, bottom: 100 };

beforeEach(() => {
  useOcclusion.setState({ holds: {}, areas: {} });
  useShowing.setState({ count: 0 });
});

describe("holding the window for a show", () => {
  it("covers the whole window for as long as the show lasts, and no longer", () => {
    expect(showing()).toBe(false);
    const done = holdForShow();
    expect(showing()).toBe(true);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBe("all");
    expect(covered(useOcclusion.getState().holds, box)).toBe(true);
    done();
    expect(showing()).toBe(false);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBeUndefined();
    expect(covered(useOcclusion.getState().holds, box)).toBe(false);
  });

  it("is let go once, however often it is asked", () => {
    const first = holdForShow();
    const second = holdForShow();
    first();
    first();
    // The second show still holds the window; a late release of the first never frees it.
    expect(showing()).toBe(true);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBe("all");
    second();
    expect(showing()).toBe(false);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBeUndefined();
  });

  it("is not counted by the show's own view, which is the one thing above it", () => {
    holdForShow();
    expect(covered(useOcclusion.getState().holds, box, SHOW_HOLD)).toBe(false);
    useOcclusion.getState().hold("menu", box);
    expect(covered(useOcclusion.getState().holds, box, SHOW_HOLD)).toBe(true);
  });
});
