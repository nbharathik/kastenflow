// The Library's date filters, groups and themed drop-downs, in the view itself.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOpenMenu } from "../../shell/open-menu/store";
import { usePrefs } from "../workspace/prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { LibraryView } from "./LibraryView";

const SEED = {
  "library/old.md": "---\ntitle: Old note\ncreated: 2026-08-15\nupdated: 2026-08-16\ntags: [alpha]\n---\nFrom August.\n",
  "library/sun.md": "---\ntitle: Sunday note\ncreated: 2026-09-20\nupdated: 2026-09-20\n---\nFrom Sunday.\n",
  "library/wed.md": "---\ntitle: Wednesday note\ncreated: 2026-09-23\nupdated: 2026-09-23\ntags: [beta]\n---\nFrom today.\n",
  "projects/demo/_project.md": "---\ntitle: Demo project\ntype: project\ncreated: 2026-09-01\nupdated: 2026-09-02\n---\nThe project.\n",
};

// Wednesday 23 September 2026. Only the clock is faked: the view needs its timers.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 23, 12, 0) });
  localStorage.clear();
  usePrefs.setState({ weekStart: 1 });
  await useWorkspace.getState().connect({ client: new MemoryVault(SEED) });
  await act(async () => {
    render(<LibraryView />);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Plain DOM queries, as the view's other tests do.
const titles = () => [...document.querySelectorAll('[role="option"][aria-labelledby]')].map((o) => document.getElementById(o.getAttribute("aria-labelledby")!)?.textContent);
const choose = (control: string, option: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${control}:`) }));
  fireEvent.click(within(screen.getByRole("listbox", { name: control })).getByRole("option", { name: option }));
};
const stored = () => JSON.parse(localStorage.getItem("kasten.library")!);

describe("themed drop-downs", () => {
  it("replace the browser's selects", () => {
    expect(document.querySelectorAll("select")).toHaveLength(0);
    for (const name of ["Project", "Tag", "Updated", "Created", "Sort", "Group by"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}:`) })).toBeTruthy();
  });

  it("filter by project and tag, and remember them", () => {
    choose("Project", "Pages (no project)");
    expect(titles().sort()).toEqual(["Old note", "Sunday note", "Wednesday note"]);
    // Each tag shows how many notes carry it, after its name.
    choose("Tag", /^#beta/);
    expect(titles()).toEqual(["Wednesday note"]);
    expect(stored().filters).toMatchObject({ place: ":pages", tag: "beta" });
  });
});

describe("date filters", () => {
  it("show who was made or changed last month", () => {
    choose("Created", "Last month");
    expect(titles()).toEqual(["Old note"]);
    expect(screen.getByRole("button", { name: "Created: Created last month" })).toBeTruthy();
    expect(stored().filters.created).toBe("last-month");
    choose("Created", "Any time");
    expect(titles()).toHaveLength(4);
    choose("Updated", "Last month");
    expect(titles()).toEqual(["Old note"]);
  });

  it("start this week on the day Settings says", () => {
    choose("Updated", "This week");
    expect(titles().sort()).toEqual(["Wednesday note"]);
    cleanup();
    usePrefs.setState({ weekStart: 0 });
    render(<LibraryView />);
    // The saved choice is still there; on a Sunday-first week the Sunday card is in it.
    expect(titles().sort()).toEqual(["Sunday note", "Wednesday note"]);
  });

  it("take a month from the month field", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Created:/ }));
    fireEvent.change(screen.getByLabelText("Created: a month"), { target: { value: "2026-08" } });
    expect(titles()).toEqual(["Old note"]);
    expect(stored().filters.created).toBe("month:2026-08");
    expect(screen.getByRole("button", { name: /^Created: Created: / }).textContent).toMatch(/2026/);
  });

  it("take a custom range, waiting while it is backwards", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Updated:/ }));
    const group = screen.getByRole("group", { name: "Updated: a range" });
    fireEvent.change(within(group).getByLabelText("From"), { target: { value: "2026-09-21" } });
    expect(titles()).toEqual(["Wednesday note"]);
    expect(stored().filters.updated).toBe("range:2026-09-21..");
    fireEvent.change(within(group).getByLabelText("To"), { target: { value: "2026-09-22" } });
    expect(titles()).toEqual([]);
    // An end before the start changes nothing yet.
    fireEvent.change(within(group).getByLabelText("To"), { target: { value: "2026-09-01" } });
    expect(stored().filters.updated).toBe("range:2026-09-21..2026-09-22");
    fireEvent.change(within(group).getByLabelText("To"), { target: { value: "2026-09-23" } });
    expect(titles()).toEqual(["Wednesday note"]);
  });

  it("clear with the Clear button", () => {
    choose("Created", "Today");
    expect(titles()).toEqual(["Wednesday note"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(titles()).toHaveLength(4);
    expect(stored().filters.created).toBe("any");
  });

  it("are read from the search box: on:, created: and updated:", async () => {
    const search = screen.getByRole("searchbox", { name: "Find a card" });
    fireEvent.change(search, { target: { value: "on:2026-09-20" } });
    await vi.waitFor(() => expect(titles()).toEqual(["Sunday note"]));
    fireEvent.change(search, { target: { value: "created:2026-09 updated:2026-09-21.." } });
    await vi.waitFor(() => expect(titles()).toEqual(["Wednesday note"]));
  });
});

describe("the Open menu", () => {
  it("shows for a card and a table row on a right-click", () => {
    const card = within(screen.getByRole("listbox", { name: "Cards" })).getByRole("option", { name: "Wednesday note" });
    expect(fireEvent.contextMenu(card, { clientX: 40, clientY: 50 })).toBe(false);
    expect(useOpenMenu.getState().menu).toEqual({ x: 40, y: 50, target: "library/wed.md" });
    useOpenMenu.getState().close();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const row = within(screen.getByRole("table", { name: "Cards" })).getByRole("button", { name: /Sunday note/ }).closest("tr")!;
    expect(fireEvent.contextMenu(row, { clientX: 7, clientY: 9 })).toBe(false);
    expect(useOpenMenu.getState().menu).toEqual({ x: 7, y: 9, target: "library/sun.md" });
    useOpenMenu.getState().close();
  });
});

describe("groups", () => {
  it("head the cards by month, newest first, with counts", () => {
    choose("Group by", "Month");
    const headings = [...document.querySelectorAll("section[aria-label] button[aria-expanded]")].map((b) => b.textContent);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/2026.*3$/);
    expect(headings[1]).toMatch(/2026.*1$/);
    expect(stored().group).toBe("month");
    // Each group's cards sit in a list of their own.
    expect(screen.getAllByRole("listbox")).toHaveLength(2);
  });

  it("fold and unfold a group, keeping its heading and count", () => {
    choose("Group by", "Tag");
    const heading = screen.getByRole("button", { name: /#alpha/ });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    expect(titles()).toHaveLength(4);
    fireEvent.click(heading);
    expect(screen.getByRole("button", { name: /#alpha/ }).getAttribute("aria-expanded")).toBe("false");
    expect(titles()).not.toContain("Old note");
    expect(titles()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /#alpha/ }));
    expect(titles()).toContain("Old note");
  });

  it("group the table too, and select only what is on show", () => {
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    choose("Group by", "Type");
    const table = screen.getByRole("table", { name: "Cards" });
    expect(within(table).getByRole("button", { name: /^Projects/ })).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: /^Pages/ }));
    expect(within(table).queryByText("Old note")).toBeNull();
    fireEvent.click(within(table).getByRole("checkbox", { name: "Select all shown" }));
    expect(screen.getByRole("toolbar", { name: "Selected cards" }).textContent).toContain("1 selected");
  });

  it("go back to one list with no groups", () => {
    choose("Group by", "Month");
    choose("Group by", "No groups");
    expect(screen.getByRole("listbox", { name: "Cards" })).toBeTruthy();
    expect(document.querySelectorAll("section[aria-label] button[aria-expanded]")).toHaveLength(0);
  });
});
