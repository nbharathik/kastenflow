import { describe, expect, it } from "vitest";

import { wayToOpen, type Situation } from "./go-how";
import { howFrom, howFromName, howFromView } from "./store-layout";
import { initialLayout, navigate, openTab, type Place } from "./tabs";

const page = (path: string): Place => ({ view: "page", path });
const deck: Place = { view: "slides", path: "talks/a.deck" };

function situation(patch: Partial<Situation> = {}): Situation {
  const layout = navigate(initialLayout(), page("a.md"));
  return { current: page("a.md"), layout, newTabs: false, peekMode: "center", peekOpen: null, ...patch };
}

describe("the way a click asks to open", () => {
  it("reads the modifier keys", () => {
    expect(howFrom({})).toBe("here");
    expect(howFrom({ ctrlKey: true })).toBe("tab");
    expect(howFrom({ metaKey: true })).toBe("tab");
    expect(howFrom({ shiftKey: true })).toBe("stack");
    expect(howFrom({ altKey: true })).toBe("split");
    // The middle button stays a tab.
    expect(howFrom({ button: 1 })).toBe("tab");
    expect(howFrom({ button: 1, ctrlKey: true, altKey: true })).toBe("tab");
  });

  it("takes Ctrl or Cmd with Alt as the pane to the right, before Ctrl alone", () => {
    expect(howFrom({ ctrlKey: true, altKey: true })).toBe("right");
    expect(howFrom({ metaKey: true, altKey: true })).toBe("right");
    expect(howFrom({ ctrlKey: true, altKey: true, shiftKey: true })).toBe("right");
  });

  it("makes a plain click in a view of many a peek, and leaves the other clicks", () => {
    expect(howFromView({})).toBe("peek");
    expect(howFromView({ ctrlKey: true })).toBe("tab");
    expect(howFromView({ ctrlKey: true, altKey: true })).toBe("right");
  });

  it("knows the names the editor and a page's `opens` key use", () => {
    for (const name of ["here", "tab", "right", "peek-side", "peek-center", "stack", "split", "peek"]) expect(howFromName(name)).toBe(name);
    expect(howFromName("sideways")).toBe("here");
    expect(howFromName(undefined)).toBe("here");
    expect(howFromName(null)).toBe("here");
  });
});

describe("what going somewhere does once settings apply", () => {
  it("keeps the layout's own ways as they are", () => {
    for (const how of ["here", "tab", "split", "right", "stack"] as const) expect(wayToOpen(how, page("b.md"), situation())).toEqual({ how });
  });

  it("peeks as Settings chooses", () => {
    expect(wayToOpen("peek", page("b.md"), situation({ peekMode: "center" }))).toEqual({ peek: "center" });
    expect(wayToOpen("peek", page("b.md"), situation({ peekMode: "side" }))).toEqual({ peek: "side" });
  });

  it("peeks where it is asked to, whatever Settings choose", () => {
    expect(wayToOpen("peek-side", page("b.md"), situation({ peekMode: "full" }))).toEqual({ peek: "side" });
    expect(wayToOpen("peek-center", page("b.md"), situation({ peekMode: "side" }))).toEqual({ peek: "center" });
  });

  it("keeps the mode of the peek that is open when a link in it peeks", () => {
    expect(wayToOpen("peek", page("b.md"), situation({ peekMode: "center", peekOpen: "side" }))).toEqual({ peek: null });
  });

  it("opens a view with a full page chosen as a plain click does, in its own tab when pages open in new tabs", () => {
    // The old order put the new-tabs rule before the peek, so this opened in the tab you were on.
    expect(wayToOpen("peek", page("b.md"), situation({ peekMode: "full", newTabs: true }))).toEqual({ how: "tab" });
    expect(wayToOpen("peek", page("b.md"), situation({ peekMode: "full", newTabs: false }))).toEqual({ how: "here" });
  });

  it("has a plain click go to the tab that already shows the place", () => {
    const layout = openTab(navigate(initialLayout(), page("a.md")), page("b.md"));
    expect(wayToOpen("peek", page("a.md"), situation({ layout, current: page("b.md"), peekMode: "full", newTabs: true }))).toEqual({ how: "tab" });
  });

  it("does not peek at a place without a page: a view opens where it is", () => {
    expect(wayToOpen("peek", { view: "inbox" }, situation({ peekMode: "side" }))).toEqual({ how: "here" });
    expect(wayToOpen("peek-side", { view: "inbox" }, situation())).toEqual({ how: "here" });
    expect(wayToOpen("peek", { view: "tags", path: "#task" }, situation())).toEqual({ how: "here" });
  });

  it("opens a deck as a full tab instead of in a peek", () => {
    expect(wayToOpen("peek", deck, situation({ peekMode: "center" }))).toEqual({ how: "tab" });
    expect(wayToOpen("peek", deck, situation({ peekMode: "side" }))).toEqual({ how: "tab" });
    expect(wayToOpen("peek-side", deck, situation())).toEqual({ how: "tab" });
    expect(wayToOpen("peek-center", deck, situation())).toEqual({ how: "tab" });
    // Settings' full page is the same page, in this tab.
    expect(wayToOpen("peek", deck, situation({ peekMode: "full" }))).toEqual({ how: "here" });
  });

  it("opens a whiteboard in a peek", () => {
    expect(wayToOpen("peek-side", { view: "boards", path: "x.canvas" }, situation())).toEqual({ peek: "side" });
  });
});
