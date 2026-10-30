import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../features/workspace/overlays/commands";
import type { NoteMeta } from "../lib/vault/types";
import { Menu } from "./Menu";
import type { MenuEntry } from "./menu-types";
import { PALETTE_IDS, pageMenuEntries } from "./page-menu";

const note = (extra: Partial<NoteMeta>) => ({ path: "library/a.md", id: "a", title: "A", kind: "page", locked: false, tags: [], props: {}, ...extra }) as NoteMeta;
const entries = (n: NoteMeta, smart = false) => pageMenuEntries({ note: n, smart, hasMap: false, sourceOpen: false, chooseOpens: () => {} });

/** The menu as plain text: "-" a divider, "# x" a heading, "> x" a submenu, "  y" its rows. */
function outline(list: MenuEntry[], depth = ""): string[] {
  return list.flatMap((e) => {
    if (e === "divider") return ["-"];
    if ("heading" in e) return [`${depth}# ${e.heading}`];
    if ("custom" in e) return [`${depth}[${e.id}]`];
    if ("submenu" in e) return [`${depth}> ${e.label}`, ...outline(e.submenu, `${depth}  `)];
    return [`${depth}${e.label}`];
  });
}

/** The labels of rows that do something (submenu parents and headings left out). */
const labels = (list: MenuEntry[]): string[] =>
  list.flatMap((e) => (e === "divider" || "heading" in e || "custom" in e ? [] : "submenu" in e ? labels(e.submenu) : [e.label]));

afterEach(cleanup);

describe("the page menu's structure", () => {
  // Smart pages are off until a person turns the plugin on, so the default menu has no smart rows.
  it("a note: icon rows, Page, View, Present & export, Ask AI, Trash; no Project, no smart rows", () => {
    expect(outline(entries(note({ path: "library/a.md" })))).toEqual([
      "Copy link",
      "Open in new tab",
      "Open in split view",
      "Open in side peek",
      "Open links from this page in…",
      "-",
      "[style]",
      "# Page",
      "Duplicate",
      "Move to…",
      "Save as template",
      "Lock for agents",
      "-",
      "> View",
      "  Show Markdown file",
      "  Sections layout",
      "  Focus mode",
      "  Fold all sections",
      "  Unfold all sections",
      "  Mind map from this page",
      "> Present & export",
      "  Present this page",
      "  Turn sections into a deck",
      "  Copy as Markdown",
      "  Print or save as PDF",
      "-",
      "Ask AI about this page",
      "-",
      "Move to Trash",
    ]);
  });

  it("a project page adds the Project submenu", () => {
    const list = outline(entries(note({ kind: "project", path: "projects/trip/trip.md" })));
    expect(list).toContain("> Project");
    expect(list).toContain("  Hide project home");
  });

  it("a locked page offers Unlock", () => {
    expect(labels(entries(note({ locked: true })))).toContain("Unlock for agents");
  });

  it("a journal day or other page the vault does not let move has no Duplicate, Move or template", () => {
    // movable() is false for the journal's day pages.
    const list = labels(entries(note({ kind: "journal", path: "journal/2026-10-22.md" })));
    expect(list).toContain("Lock for agents");
    expect(list).toContain("Move to Trash");
    expect(list).not.toContain("Duplicate");
    expect(list).not.toContain("Save as template");
  });

  it("offers Fold or Unfold properties only on a page that has some", () => {
    expect(labels(entries(note({})))).not.toContain("Fold properties");
    expect(labels(entries(note({ tags: ["paper"] })))).toContain("Fold properties");
    const many = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const folded = labels(entries(note({ id: "many", props: many })));
    expect(folded).toContain("Unfold properties");
    expect(folded).not.toContain("Fold properties");
  });
});

describe("palette parity", () => {
  it("every row has a palette command", () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    const all = [...labels(entries(note({}))), ...labels(entries(note({ kind: "project" }))), ...labels(entries(note({ locked: true }))), ...labels(entries(note({ tags: ["a"] }))), ...labels(entries(note({ props: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } })))];
    for (const label of all) {
      expect(PALETTE_IDS[label], label).toBeTruthy();
      expect(ids.has(PALETTE_IDS[label]!), `${label} -> ${PALETTE_IDS[label]}`).toBe(true);
    }
  });
});

describe("the page menu in use", () => {
  const open = async () => {
    render(<Menu label="Page options" items={entries(note({}))}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Page options" }), { detail: 0 }));
  };

  it("scrolls on a short window and focuses the first row", async () => {
    await open();
    const menu = screen.getByRole("menu", { name: "Page options" });
    expect(menu.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(menu.className).toContain("overflow-auto");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /^Copy link/ }));
  });

  it("custom content between rows: its buttons are reached by the arrows, then the next row", async () => {
    const items: MenuEntry[] = [
      { label: "First", onSelect: () => {} },
      { id: "style", custom: <div data-menu-focus=""><button type="button">Serif</button></div> },
      { label: "Last", onSelect: () => {} },
    ];
    render(<Menu label="Opts" items={items}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Opts" }), { detail: 0 }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First" }));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Serif" }));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Last" }));
  });

  it("opens View with → and closes it with ←; its rows are hidden until then", async () => {
    await open();
    expect(screen.queryByRole("menuitem", { name: "Focus mode" })).toBeNull();
    const row = screen.getByRole("menuitem", { name: "View" });
    row.focus();
    await act(async () => fireEvent.keyDown(row, { key: "ArrowRight" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Show Markdown file" }));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" }));
    expect(screen.queryByRole("menuitem", { name: /^Focus mode/ })).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});
