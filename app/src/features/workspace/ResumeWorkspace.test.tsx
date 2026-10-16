// "Resume workspace" on a project: nothing for a project with no linked set,
// a button for one, a menu for several; each brings the set back and says
// what it could not find.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrefs } from "./prefs";
import { ResumeWorkspace } from "./ResumeWorkspace";
import { useWorkspace } from "./store";
import { derive } from "./store-layout";
import type { TabSet } from "./tab-sets";
import { focusedPane, initialLayout } from "./tabs";

const page = (path: string) => ({ view: "page" as const, path });
const toast = vi.fn();
const set = (name: string, paths: string[], project?: string): TabSet => ({ name, tabs: paths.map((path) => ({ place: page(path), pinned: false })), ...(project ? { project } : {}) });
const open = () => focusedPane(useWorkspace.getState().layout).tabs.map((t) => t.place.path ?? t.place.view);

beforeEach(() => {
  localStorage.clear();
  toast.mockClear();
  usePrefs.setState({ tabSets: [] });
  useWorkspace.setState({ ...derive(initialLayout()), recent: [], notes: [], toast });
});
afterEach(cleanup);

describe("resume workspace", () => {
  it("shows nothing for a project that has no set, or only another project's", () => {
    usePrefs.setState({ tabSets: [set("Elsewhere", ["a.md"], "other"), set("Loose", ["b.md"])] });
    const { container } = render(<ResumeWorkspace folder="trip" />);
    expect(container.textContent).toBe("");
  });

  it("is one button for one set, which opens it and says what was not found", () => {
    usePrefs.setState({ tabSets: [set("Trip reading", ["library/gone.md", "library/other.md"], "trip")] });
    render(<ResumeWorkspace folder="trip" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume workspace" }));
    expect(open()).toEqual(expect.arrayContaining(["library/gone.md", "library/other.md"]));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toMatch(/Opened “Trip reading”\. Not found, so shown empty: gone, other/);
  });

  it("is a menu of the sets when there are several, by name", () => {
    usePrefs.setState({ tabSets: [set("Writing", ["library/w.md"], "trip"), set("Reading", ["library/r.md"], "trip"), set("Other", ["library/o.md"], "other")] });
    render(<ResumeWorkspace folder="trip" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume workspace" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Reading", "Writing"]);
    act(() => fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Writing" })));
    expect(open()).toContain("library/w.md");
    expect(open()).not.toContain("library/r.md");
  });
});
