import { describe, expect, it } from "vitest";

import { availableNav, defaultPinned, findNav, groupedNav, moveNav, NAV, NAV_GROUPS, pin, pinnedIds, placeOfNav, showsNav, sidebarNav, unpin, type NavItem } from "./nav";

const ids = (items: readonly NavItem[]) => items.map((i) => i.id as string);

describe("the registry of views", () => {
  it("lists each view once, in a group the list knows", () => {
    expect(new Set(ids(NAV)).size).toBe(NAV.length);
    const groups = new Set(NAV_GROUPS.map((g) => g.id));
    for (const item of NAV) expect(groups.has(item.group), item.id).toBe(true);
  });

  it("groups the views as the list shows them", () => {
    const all = groupedNav(NAV).map((g) => [g.label, ids(g.items)]);
    expect(all).toEqual([
      ["Capture", ["inbox", "captures", "journal"]],
      ["Think", ["boards", "diagrams", "slides", "graph"]],
      ["Organise", ["library", "tags", "tasks", "calendar", "highlights"]],
      ["Tools", ["chat", "browser", "import", "history", "trash", "review"]],
    ]);
  });

  it("pins the daily drivers until the person chooses", () => {
    expect(defaultPinned()).toEqual(["inbox", "journal", "tasks", "calendar"]);
  });

  it("lists Captures right after the Inbox, without a place in the pinned order", () => {
    const items = NAV.filter((n) => n.id !== "review" && n.id !== "browser");
    const pinned = ["inbox", "journal", "tasks", "calendar"];
    expect(ids(sidebarNav(pinned, {}, items))).toEqual(["inbox", "captures", "journal", "tasks", "calendar"]);
    // After the Inbox wherever the person put it, and first when it is not pinned.
    expect(ids(sidebarNav(["journal", "inbox", "tasks"], {}, items))).toEqual(["journal", "inbox", "captures", "tasks"]);
    expect(ids(sidebarNav(["journal", "tasks"], {}, items))).toEqual(["captures", "journal", "tasks"]);
    // Pinned, it is where it was pinned, once; open and not pinned, it stays beside the Inbox.
    expect(ids(sidebarNav(["journal", "captures", "inbox"], {}, items))).toEqual(["journal", "captures", "inbox"]);
    expect(ids(sidebarNav(pinned, { open: "captures" }, items))).toEqual(["inbox", "captures", "journal", "tasks", "calendar"]);
    // Not there (nothing captured, the browser and the extension off): not listed.
    expect(ids(sidebarNav(pinned, { open: "captures" }))).toEqual(pinned);
    expect(NAV.find((n) => n.id === "captures")?.follows).toBe("inbox");
  });

  it("opens the Captures row at the capture tag's database, which is that row's, not the Tag Database's, once listed", () => {
    expect(placeOfNav("captures")).toEqual({ view: "tags", path: "#capture" });
    expect(placeOfNav("tags")).toEqual({ view: "tags" });
    expect(showsNav({ view: "tags", path: "#capture" }, "captures")).toBe(true);
    expect(showsNav({ view: "tags", path: "#paper" }, "captures")).toBe(false);
    expect(showsNav({ view: "tags" }, "captures")).toBe(false);
    expect(showsNav({ view: "tags", path: "#paper" }, "tags")).toBe(true);
    // Not listed yet: the Tag Database's row is the one that shows it open.
    expect(showsNav({ view: "tags", path: "#capture" }, "tags")).toBe(true);
    expect(findNav("captures" as never)?.label).toBe("Captures");
  });

  it("holds the views that are not built yet back until they say they are there", () => {
    const here = ids(availableNav());
    for (const later of ["browser", "captures"]) expect(here).not.toContain(later);
    // They are named, so a later phase needs only to say `available: () => true`.
    for (const later of ["browser", "captures"]) expect(ids(NAV)).toContain(later);
    // The graph and the diagrams have arrived; diagrams is listed under Think, not pinned.
    expect(here).toContain("graph");
    expect(findNav("graph")?.label).toBe("Graph");
    expect(here).toContain("diagrams");
    expect(findNav("diagrams")).toMatchObject({ label: "Diagrams", group: "think" });
    expect(defaultPinned()).not.toContain("diagrams");
    // Review shows only while proposals wait, and none do here.
    expect(here).not.toContain("review");
    expect(here).toContain("trash");
  });

  it("names every view for a tab, there or not", () => {
    expect(findNav("trash")?.label).toBe("Trash");
    expect(findNav("review")?.label).toBe("Review");
    expect(findNav("settings")?.label).toBe("Settings");
    expect(findNav("home")).toBeUndefined();
  });
});

describe("pinned views", () => {
  it("falls back to the usual set, and reads what was saved without views that are gone or repeated", () => {
    expect(pinnedIds(null)).toEqual(defaultPinned());
    expect(pinnedIds(["trash", "gone", "inbox", "trash"])).toEqual(["trash", "inbox"]);
    expect(pinnedIds([])).toEqual([]);
  });

  it("pins at the end, unpins, and moves a place at a time", () => {
    expect(pin(["inbox"], "slides")).toEqual(["inbox", "slides"]);
    expect(pin(["inbox", "slides"], "inbox")).toEqual(["inbox", "slides"]);
    expect(unpin(["inbox", "slides"], "inbox")).toEqual(["slides"]);
    expect(unpin(["inbox"], "slides")).toEqual(["inbox"]);
    expect(moveNav(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveNav(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    // At an end, or not pinned: unchanged.
    expect(moveNav(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveNav(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveNav(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("what the sidebar shows", () => {
  const pinned = ["inbox", "journal", "tasks", "calendar"];

  it("shows the pinned views, in the order pinned", () => {
    expect(ids(sidebarNav(["tasks", "inbox"], {}))).toEqual(["tasks", "inbox"]);
    expect(ids(sidebarNav(pinned, {}))).toEqual(pinned);
  });

  it("keeps an unpinned view in sight while it is open", () => {
    expect(ids(sidebarNav(pinned, { open: "slides" }))).toEqual([...pinned, "slides"]);
    // A pinned one open is not shown twice.
    expect(ids(sidebarNav(pinned, { open: "tasks" }))).toEqual(pinned);
    // A view with no row (Home, a page) adds nothing.
    expect(ids(sidebarNav(pinned, { open: "home" }))).toEqual(pinned);
  });

  it("keeps an unpinned view with a count in sight", () => {
    expect(ids(sidebarNav(["journal"], { counted: new Set(["inbox"]) }))).toEqual(["journal", "inbox"]);
    expect(ids(sidebarNav(["journal"], { open: "trash", counted: new Set(["inbox", "history"]) }))).toEqual(["journal", "inbox", "history", "trash"]);
  });

  it("never shows a view that is not there", () => {
    expect(ids(sidebarNav(["browser", "inbox"], { open: "browser", counted: new Set(["browser"]) }))).toEqual(["inbox"]);
  });

  it("shows Review when proposals wait, where it keeps its rule", () => {
    const waiting: NavItem[] = NAV.map((item) => (item.id === "review" ? { ...item, available: () => true } : item)).filter((i) => i.available?.() ?? true);
    // Counted, not pinned: it shows.
    expect(ids(sidebarNav(pinned, { counted: new Set(["review"]) }, waiting))).toEqual([...pinned, "review"]);
    // Without a count it does not.
    expect(ids(sidebarNav(pinned, {}, waiting))).toEqual(pinned);
  });

  it("narrows the list by label, any case, dropping groups left empty", () => {
    const items = availableNav();
    expect(groupedNav(items, "TA").map((g) => [g.label, ids(g.items)])).toEqual([["Organise", ["tags", "tasks"]]]);
    expect(groupedNav(items, "  ")).toEqual(groupedNav(items));
    expect(groupedNav(items, "zzz")).toEqual([]);
  });
});
