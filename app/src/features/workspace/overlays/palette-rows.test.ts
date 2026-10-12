// The palette finds PDFs and Settings groups, and offers the searches run
// lately again.

import { beforeEach, describe, expect, it } from "vitest";

import type { SourceInfo } from "../../../lib/vault/types";
import { useWorkspace } from "../store";
import { takeSettingsJump } from "../views/settings/jump";
import { keepSearch, pdfRows, recentSearches, settingsRows } from "./palette-rows";

const PDFS = [
  { path: "sources/primer.pdf", title: "A primer on sleep", highlights: 2, bytes: 10, modified: 1 },
  { path: "sources/notes.pdf", title: "Lecture notes", highlights: 0, bytes: 10, modified: 2 },
] as SourceInfo[];

beforeEach(() => localStorage.clear());

describe("more palette rows", () => {
  it("finds PDFs by title and opens them in the reader", () => {
    expect(pdfRows(PDFS, "sleep").map((r) => [r.label, r.detail])).toEqual([["A primer on sleep", "PDF"]]);
    expect(pdfRows(null, "sleep")).toEqual([]);
    pdfRows(PDFS, "lecture")[0]!.run("here");
    expect(useWorkspace.getState().place).toEqual({ view: "highlights", path: "sources/notes.pdf" });
  });

  it("finds Settings groups, and opens Settings at one", () => {
    expect(settingsRows("ai prov").map((r) => r.label)).toEqual(["Settings: AI providers"]);
    expect(settingsRows("settings short").map((r) => r.label)).toEqual(["Settings: Keyboard shortcuts"]);
    expect(settingsRows("x")).toEqual([]);
    // As the row is written: "Settings: Appearance".
    expect(settingsRows("Settings: appear").map((r) => r.label)).toEqual(["Settings: Appearance"]);
    settingsRows("backup")[0]!.run("here");
    expect(useWorkspace.getState().place.view).toBe("settings");
    expect(takeSettingsJump()).toEqual({ group: "history" });
    expect(takeSettingsJump()).toBeNull();
  });

  it("finds a single setting by its name, and opens Settings at its row", () => {
    const rows = settingsRows("settings interface size");
    expect(rows.map((r) => [r.label, r.detail])).toEqual([["Interface size", "Settings · Appearance"]]);
    rows[0]!.run("here");
    expect(takeSettingsJump()).toEqual({ group: "appearance", row: "appearance.zoom" });
    // A group that is named does not bring its own settings along.
    expect(settingsRows("settings appearance").map((r) => r.label)).toEqual(["Settings: Appearance"]);
    // Without the word "settings", only groups: a setting must not beat a command such as Go to Trash.
    expect(settingsRows("trash")).toEqual([]);
    expect(settingsRows("settings trash").map((r) => r.label)).toEqual(["Notes trashed per session"]);
    expect(settingsRows("appearance").map((r) => r.label)).toEqual(["Settings: Appearance"]);
    expect(settingsRows("interface size")).toEqual([]);
    // What this app does not draw is not offered.
    expect(settingsRows("embedding model")).toEqual([]);
  });

  it("keeps the last five searches, newest first, once each", () => {
    for (const q of ["one", "two", "three", "two", "four", "five", "six", "  "]) keepSearch(q);
    expect(recentSearches()).toEqual(["six", "five", "four", "two", "three"]);
    localStorage.setItem("kasten.palette.searches", "{broken");
    expect(recentSearches()).toEqual([]);
  });
});
