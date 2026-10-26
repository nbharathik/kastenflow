// Where smart pages are started and changed from: the "+ New" menu, the
// capture field's /smart, the tab "+" menu, the palette and the page menu.
// Each entry exists, says plain words, and is reachable from the keyboard.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { matchingActions, newActions, slashActions } from "../../home/actions";
import { NewMenu } from "../../home/NewMenu";
import { KEY_SECTIONS } from "../../shortcuts/catalog";
import { allCommands } from "../../workspace/overlays/commands";
import type { NoteMeta } from "../../../lib/vault/types";
import type { MenuEntry } from "../../../shell/menu-types";
import { newTabItems } from "../../../shell/NewTab";
import { PALETTE_IDS, pageMenuEntries } from "../../../shell/page-menu";
import { STARTERS } from "./starter-list";

const flows = vi.hoisted(() => ({ newSmartPage: vi.fn(async () => null), saveSmartTemplate: vi.fn(async () => true), exportSmartHtml: vi.fn(async () => null) }));
vi.mock("./flows", () => flows);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const note = (extra: Partial<NoteMeta> = {}) => ({ path: "library/a.md", id: "a", title: "A", kind: "page", locked: false, tags: [], props: {}, ...extra }) as NoteMeta;
const labels = (list: MenuEntry[]): string[] => list.flatMap((e) => (e === "divider" || "heading" in e || "custom" in e ? [] : "submenu" in e ? [e.label, ...labels(e.submenu)] : [e.label]));

describe("the starters", () => {
  it("are the five the app ships, by the names the app has", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["dashboard", "tracker", "gallery", "map", "timeline"]);
    const rust = readFileSync("src-tauri/src/smart/starters.rs", "utf8");
    const named = [...rust.matchAll(/starter!\(\s*"(\w+)",\s*"(\w+)"/g)].map((m) => [m[1], m[2]]);
    expect(named).toEqual(STARTERS.map((s) => [s.id, s.name]));
  });
});

describe("+ New", () => {
  it("lists New smart page with a starter to choose from beside it", () => {
    const row = newActions().find((a) => a.id === "smart")!;
    expect(row.label).toBe("New smart page");
    expect(row.choices?.map((c) => c.label)).toEqual(["Smart page: Dashboard", "Smart page: Tracker", "Smart page: Gallery", "Smart page: Map", "Smart page: Timeline", "Smart page: more…"]);
  });

  it("makes a page from a starter in the menu, with the keyboard or the mouse", async () => {
    render(<NewMenu />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New" }), { detail: 0 }));
    const row = screen.getByRole("menuitem", { name: "New smart page" });
    await act(async () => fireEvent.click(row));
    const starter = screen.getByRole("menuitem", { name: "Smart page: Tracker" });
    await act(async () => fireEvent.click(starter));
    expect(flows.newSmartPage).toHaveBeenCalledWith("tracker");
  });

  it("is found by typing /smart in the capture field, each starter a row of its own", () => {
    const found = matchingActions(slashActions(), "smart").map((a) => a.label);
    expect(found).toEqual(["New smart page", "Smart page: Dashboard", "Smart page: Tracker", "Smart page: Gallery", "Smart page: Map", "Smart page: Timeline", "Smart page: more…"]);
    expect(matchingActions(slashActions(), "map").map((a) => a.label)).toContain("Smart page: Map");
  });

  it("is in the tab + menu too", () => {
    expect(labels(newTabItems())).toContain("New smart page");
    expect(labels(newTabItems())).toContain("Smart page: Gallery");
  });
});

describe("the palette", () => {
  const ids = ["smart-new", "smart-turn-into", "smart-back", "smart-edit-code", "smart-save-template", "smart-export-html", "smart-improve", "smart-fix-errors", "smart-present"];

  it("has a command for each, in the shortcut list too", () => {
    const palette = new Map(allCommands().map((c) => [c.id, c]));
    const catalog = new Set(KEY_SECTIONS.flatMap((s) => s.ids));
    for (const id of ids) {
      expect(palette.has(id), id).toBe(true);
      expect(catalog.has(id), id).toBe(true);
      expect(palette.get(id)!.label.length).toBeGreaterThan(8);
    }
  });

  it("offers the ones that change a page only where they apply", () => {
    const palette = new Map(allCommands().map((c) => [c.id, c]));
    // No page is open here: only starting a new one applies.
    expect(palette.get("smart-new")!.when?.() ?? true).toBe(true);
    for (const id of ["smart-turn-into", "smart-back", "smart-edit-code", "smart-save-template", "smart-export-html", "smart-improve", "smart-fix-errors", "smart-present"]) {
      expect(palette.get(id)!.when?.(), id).toBe(false);
    }
  });
});

describe("the page menu", () => {
  const entries = (smartPage: boolean) => pageMenuEntries({ note: note(), smart: false, smartPage, hasMap: false, sourceOpen: false, chooseOpens: () => {} });

  it("offers Turn into smart page on an ordinary page, and no smart rows", () => {
    const rows = labels(entries(false));
    expect(rows).toContain("Turn into smart page…");
    for (const row of ["Edit code", "Back to a normal page", "Save as smart template", "Export as HTML file"]) expect(rows).not.toContain(row);
  });

  it("offers Edit code, Back to a normal page, Save as smart template and Export on a smart page", () => {
    const rows = labels(entries(true));
    for (const row of ["Edit code", "Back to a normal page", "Save as smart template", "Export as HTML file", "Print or save as PDF", "Present this page"]) expect(rows, row).toContain(row);
    expect(rows).not.toContain("Turn into smart page…");
  });

  it("gives each a palette command that exists", () => {
    const ids = new Set(allCommands().map((c) => c.id));
    const doing = (list: MenuEntry[]): string[] => list.flatMap((e) => (e === "divider" || "heading" in e || "custom" in e ? [] : "submenu" in e ? doing(e.submenu) : [e.label]));
    for (const row of [...doing(entries(true)), ...doing(entries(false))]) {
      if (row === "Open links from this page in…") continue;
      expect(PALETTE_IDS[row], row).toBeTruthy();
      expect(ids.has(PALETTE_IDS[row]!), row).toBe(true);
    }
  });

  it("runs Save as smart template and Export from the menu rows", async () => {
    const rows = entries(true);
    const find = (list: MenuEntry[], label: string): MenuEntry | undefined => {
      for (const e of list) {
        if (e === "divider" || "heading" in e || "custom" in e) continue;
        if ("submenu" in e) {
          const hit = find(e.submenu, label);
          if (hit) return hit;
        } else if (e.label === label) return e;
      }
      return undefined;
    };
    await act(async () => (find(rows, "Save as smart template") as { onSelect(): void }).onSelect());
    await vi.waitFor(() => expect(flows.saveSmartTemplate).toHaveBeenCalledWith("library/a.md", "A"));
    await act(async () => (find(rows, "Export as HTML file") as { onSelect(): void }).onSelect());
    await vi.waitFor(() => expect(flows.exportSmartHtml).toHaveBeenCalledWith("library/a.md", "A"));
  });

  it("keeps the menu in a submenu where the rows are named plainly (no ops, commits or ids)", () => {
    for (const row of labels(entries(true))) expect(row).not.toMatch(/\b(op|commit|sidecar|session|id)\b/i);
  });
});
