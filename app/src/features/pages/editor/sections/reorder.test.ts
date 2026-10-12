// Putting a section somewhere else: the dividers stay between the sections, the
// Markdown between them moves, exactly as written, as one step of history.

import { undo } from "@milkdown/kit/prose/history";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { listSections, setFolded } from "./api";
import { sectionsKey } from "./key";
import { sectionsOf, START } from "./model";
import { moveSection } from "./reorder";

const editor = useTestEditor({ foldKey: "note-1" });

// Four sections, each written in a way the editor would write differently:
// a setext heading and `*` bullets, a hard-wrapped paragraph, odd spacing.
const SETEXT = ["Setext heading", "==============", "", "* star item", "* another item"];
const WRAPPED = ["Hard wrapped", "paragraph here."];
const ODD = ["Last   words with  odd spacing."];
const INTRO = ["Intro words."];
const page = (dividers: readonly [string, string, string], sections: readonly (readonly string[])[]) => [...sections.flatMap((s, i) => (i === 0 ? s : ["", dividers[i - 1]!, "", ...s])), ""].join("\n");

const PAGE = page(["---", "---", "---"], [INTRO, SETEXT, WRAPPED, ODD]);
const MIXED = page(["---", "***", "___"], [INTRO, SETEXT, WRAPPED, ODD]);

const titles = () => listSections(editor.view.state).map((s) => s.title);
const OLD_TITLES = ["Intro words.", "Setext heading", "Hard wrapped paragraph here.", "Last words with odd spacing."];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("moving a section", () => {
  // First, while the editor's history holds nothing from other pages.
  it("is one step of history, whatever it moves", () => {
    editor.open(PAGE);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    expect(moveSection(editor.view, 0, 3)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    dispatch.mockRestore();
    expect(titles()[3]).toBe("Intro words.");
    expect(editor.run(undo)).toBe(true);
    expect(editor.save()).toBe(PAGE);
    expect(titles()).toEqual(OLD_TITLES);
  });

  it("moves the Markdown between the dividers, byte for byte", () => {
    editor.open(PAGE);
    expect(titles()).toEqual(OLD_TITLES);
    // The second section goes to the end.
    expect(moveSection(editor.view, 1, 3)).toBe(true);
    expect(titles()).toEqual(["Intro words.", "Hard wrapped paragraph here.", "Last words with odd spacing.", "Setext heading"]);
    expect(editor.save()).toBe(page(["---", "---", "---"], [INTRO, WRAPPED, ODD, SETEXT]));
  });

  it("moves a section up as well as down, and the first section like any other", () => {
    editor.open(PAGE);
    expect(moveSection(editor.view, 3, 1)).toBe(true);
    expect(titles()).toEqual(["Intro words.", "Last words with odd spacing.", "Setext heading", "Hard wrapped paragraph here."]);
    expect(editor.save()).toBe(page(["---", "---", "---"], [INTRO, ODD, SETEXT, WRAPPED]));
    editor.open(PAGE);
    // Section 0 has no divider of its own: it goes between the others like them.
    expect(moveSection(editor.view, 0, 2)).toBe(true);
    expect(titles()).toEqual(["Setext heading", "Hard wrapped paragraph here.", "Intro words.", "Last words with odd spacing."]);
    expect(editor.save()).toBe(page(["---", "---", "---"], [SETEXT, WRAPPED, INTRO, ODD]));
  });

  it("keeps every divider as it was written, and every section's own bytes, when the dividers differ", () => {
    editor.open(MIXED);
    expect(moveSection(editor.view, 1, 3)).toBe(true);
    const saved = editor.save();
    // Each block is there exactly as written, in its new order.
    const at = [INTRO, WRAPPED, ODD, SETEXT].map((section) => saved.indexOf(section.join("\n")));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // And each divider, once.
    for (const divider of ["---", "***", "___"]) expect(saved.split(`\n${divider}\n`)).toHaveLength(2);
    // Opened again, it is the page the editor holds.
    editor.open(saved);
    expect(titles()).toEqual(["Intro words.", "Hard wrapped paragraph here.", "Last words with odd spacing.", "Setext heading"]);
    expect(editor.save()).toBe(saved);
  });

  it("puts the caret where the section went, and does nothing for a move that is none", () => {
    editor.open(PAGE);
    expect(moveSection(editor.view, 2, 2)).toBe(false);
    expect(moveSection(editor.view, 2, 7)).toBe(false);
    expect(moveSection(editor.view, -1, 1)).toBe(false);
    expect(editor.save()).toBe(PAGE);
    moveSection(editor.view, 2, 0);
    const first = sectionsOf(editor.doc)[0]!;
    expect(editor.view.state.selection.from).toBeGreaterThanOrEqual(first.from);
    expect(editor.view.state.selection.to).toBeLessThanOrEqual(first.to);
  });

  it("moves sections that are empty or hold many blocks, and keeps the page's block count", () => {
    const body = "One.\n\n---\n\n---\n\nThree.\n\nThree again.\n\n- a\n- b\n\n---\n\nFour.\n";
    editor.open(body);
    const blocks = editor.doc.childCount;
    expect(moveSection(editor.view, 2, 1)).toBe(true);
    expect(editor.doc.childCount).toBe(blocks);
    expect(editor.save()).toBe("One.\n\n---\n\nThree.\n\nThree again.\n\n- a\n- b\n\n---\n\n---\n\nFour.\n");
    // The empty section and the long one trade places back.
    expect(moveSection(editor.view, 1, 2)).toBe(true);
    expect(editor.save()).toBe(body);
  });

  it("unfolds the folded sections it touches, and leaves the ones it does not", () => {
    editor.open(PAGE);
    const sections = sectionsOf(editor.doc);
    setFolded(editor.view, [START, sections[3]!.divider!], true);
    expect(sectionsKey.getState(editor.view.state)!.folded.size).toBe(2);
    moveSection(editor.view, 0, 1);
    // The first section held other words now, so it is open; the last one was not in the move.
    const state = sectionsKey.getState(editor.view.state)!;
    expect(state.folded.has(START)).toBe(false);
    expect(listSections(editor.view.state).map((s) => s.folded)).toEqual([false, false, false, true]);
  });
});
