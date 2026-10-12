// Settings → Pages (where links open) and Settings → Sidebar (quick notes, pinned views).

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../prefs";
import { PageSettings } from "./PageSettings";
import { SidebarSettings } from "./SidebarSettings";

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ pageLinksOpen: "here", rightReplaces: true, sidebarShowCards: false, navPinned: null });
});
afterEach(cleanup);

describe("where links open", () => {
  const select = () => screen.getByRole("combobox", { name: "Open links and sub-pages in" }) as HTMLSelectElement;

  it("offers the six places, the same tab to begin with, and keeps the choice", () => {
    render(<PageSettings />);
    expect([...select().options].map((o) => o.textContent)).toEqual(["The same tab", "A new tab", "To the right", "A side peek", "A center peek", "The side stack"]);
    expect(select().value).toBe("here");
    fireEvent.change(select(), { target: { value: "right" } });
    expect(usePrefs.getState().pageLinksOpen).toBe("right");
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).pageLinksOpen).toBe("right");
  });

  it("says whether opening to the right replaces the tab or adds one", () => {
    render(<PageSettings />);
    const group = screen.getByRole("radiogroup", { name: "Open to the right" });
    expect(within(group).getByRole("radio", { name: "Replaces the tab" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Adds a tab" }));
    expect(usePrefs.getState().rightReplaces).toBe(false);
    fireEvent.click(within(group).getByRole("radio", { name: "Replaces the tab" }));
    expect(usePrefs.getState().rightReplaces).toBe(true);
  });

  it("ignores a value it does not know when the select is changed to one", () => {
    render(<PageSettings />);
    fireEvent.change(select(), { target: { value: "sideways" } });
    expect(usePrefs.getState().pageLinksOpen).toBe("here");
  });
});

describe("the sidebar's settings", () => {
  it("keeps quick notes out of the sidebar until asked, and remembers the switch", () => {
    render(<SidebarSettings />);
    const quick = screen.getByRole("switch", { name: "Show quick notes under projects" }) as HTMLInputElement;
    expect(quick.checked).toBe(false);
    fireEvent.click(quick);
    expect(usePrefs.getState().sidebarShowCards).toBe(true);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).sidebarShowCards).toBe(true);
  });

  it("shows the same list of views as the sidebar, to pin, unpin and move", () => {
    render(<SidebarSettings />);
    const list = screen.getByRole("group", { name: "All views" });
    expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Capture", "Think", "Organise", "Tools"]);
    // Pinned views move; the first cannot go up and the last cannot go down.
    expect((within(list).getByRole("button", { name: "Move Inbox up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(list).getByRole("button", { name: "Move Calendar down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(list).getByRole("button", { name: "Move Inbox down" }));
    expect(usePrefs.getState().navPinned).toEqual(["journal", "inbox", "tasks", "calendar"]);
    fireEvent.click(within(list).getByRole("button", { name: "Pin Trash to the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["journal", "inbox", "tasks", "calendar", "trash"]);
    fireEvent.click(within(list).getByRole("button", { name: "Unpin Tasks from the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["journal", "inbox", "calendar", "trash"]);
  });

  it("goes back to the usual views", () => {
    usePrefs.setState({ navPinned: ["trash"] });
    render(<SidebarSettings />);
    const reset = screen.getByRole("button", { name: "Reset to the usual" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    act(() => reset.click());
    expect(usePrefs.getState().navPinned).toBeNull();
    expect((screen.getByRole("button", { name: "Reset to the usual" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("filters the list there too, by what is typed", () => {
    render(<SidebarSettings />);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter views" }), { target: { value: "cal" } });
    const list = screen.getByRole("group", { name: "All views" });
    expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Organise"]);
    expect(within(list).getByRole("button", { name: "Unpin Calendar from the sidebar" })).toBeTruthy();
  });
});
