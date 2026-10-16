// The settings search also finds shortcut commands by name: "present" finds
// "Present this page" in the Keyboard shortcuts group, and a click on it goes to
// that command's row in the key editor.

import { describe, expect, it } from "vitest";

import { KEY_SECTIONS, commandLabel } from "../../../shortcuts/catalog";
import { commandHits, commandRowId, commandOfRow, withCommands } from "./command-search";
import { searchSettings } from "./index";
import { wordsOf } from "./search";

describe("finding a shortcut command by name", () => {
  it("takes every word, in any order, from the names the key editor lists", () => {
    expect(commandHits(wordsOf("present page"))).toContain("present-page");
    expect(commandHits(wordsOf("page present"))).toContain("present-page");
    expect(commandHits(wordsOf("PRESENT"))).toContain("present-page");
    expect(commandHits(wordsOf("nonsense words here"))).toEqual([]);
    expect(commandHits([])).toEqual([]);
  });

  it("lists each command once, in the editor's order, and only ones the editor lists", () => {
    const hits = commandHits(wordsOf("a"));
    expect(new Set(hits).size).toBe(hits.length);
    const order = KEY_SECTIONS.flatMap((s) => s.ids);
    expect(hits.map((id) => order.indexOf(id))).toEqual([...hits.map((id) => order.indexOf(id))].sort((a, b) => a - b));
    for (const id of hits) expect(order).toContain(id);
    for (const id of hits) expect(commandLabel(id).toLowerCase()).toContain("a");
  });

  it("names a command's row so a click can go to it, and reads the name back", () => {
    expect(commandRowId("new-page")).toBe("shortcuts.key.new-page");
    expect(commandOfRow("shortcuts.key.new-page")).toBe("new-page");
    expect(commandOfRow("shortcuts.editor")).toBeNull();
    expect(commandOfRow("appearance.zoom")).toBeNull();
  });
});

describe("the search with commands", () => {
  it("adds the commands to the Keyboard shortcuts group's count, leaves the settings it found alone", () => {
    const words = wordsOf("present");
    const plain = searchSettings("present", false);
    const found = withCommands(plain, words);
    const commands = commandHits(words);
    expect(commands.length).toBeGreaterThan(0);
    expect(found.commands).toEqual(commands);
    expect([...found.ids]).toEqual([...plain.ids]);
    expect(found.byGroup.get("shortcuts")).toBe((plain.byGroup.get("shortcuts") ?? 0) + commands.length);
    expect(found.total).toBe(plain.total + commands.length);
    expect([...found.byGroup.values()].reduce((a, b) => a + b, 0)).toBe(found.total);
  });

  it("finds the zoom commands beside the zoom setting", () => {
    const found = withCommands(searchSettings("zoom", false), wordsOf("zoom"));
    expect(found.ids.has("appearance.zoom")).toBe(true);
    // By name: "Zoom in" and "Zoom out"; "Actual size" does not say zoom.
    expect(found.commands).toEqual(["zoom-in", "zoom-out"]);
    expect(found.byGroup.get("appearance")).toBe(1);
    expect(found.byGroup.get("shortcuts")).toBe(found.commands!.length);
  });

  it("is the search as it was when no command matches", () => {
    const none = searchSettings("interface size", false);
    expect(withCommands(none, wordsOf("interface size"))).toBe(none);
  });
});
