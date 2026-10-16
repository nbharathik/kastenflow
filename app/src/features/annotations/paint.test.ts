// Highlights are painted over a page's words, found again after each change by
// the exact rules, and never written into the page.

import { describe, expect, it } from "vitest";

import { findText, useTestEditor } from "../../test/editor";
import { setPainted, type Painted } from "./paint";

const editor = useTestEditor();

const PAGE = "Press Ctrl+N anywhere to jot something down.\n\nIt lands in the inbox. Press it again.\n";
const marked = () => [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-text-hl")].map((el) => [el.dataset.highlight, el.textContent, [...el.classList].filter((c) => c.startsWith("is-"))] as const);

const jot: Painted = { id: "h1", color: "pink", anchor: { quote: "jot something down" } };

describe("painted highlights", () => {
  it("cover their words in their colour, and leave the page's text alone", () => {
    editor.open(PAGE);
    const before = editor.save();
    setPainted(editor.view, [jot]);
    expect(marked()).toEqual([["h1", "jot something down", ["is-pink"]]]);
    expect(editor.save()).toBe(before);
    setPainted(editor.view, []);
    expect(marked()).toEqual([]);
  });

  it("draw the current one stronger, and an unknown colour as yellow", () => {
    editor.open(PAGE);
    setPainted(editor.view, [{ ...jot, color: "teal", current: true }]);
    expect(marked()).toEqual([["h1", "jot something down", ["is-yellow", "is-current"]]]);
  });

  it("follow the words as the page changes", () => {
    editor.open(PAGE);
    setPainted(editor.view, [jot]);
    const at = findText(editor.doc, "Press");
    editor.view.dispatch(editor.view.state.tr.insertText("Really: ", at));
    expect(marked()).toEqual([["h1", "jot something down", ["is-pink"]]]);
  });

  it("disappear when their words are edited away, and come back with them", () => {
    editor.open(PAGE);
    setPainted(editor.view, [jot]);
    const at = findText(editor.doc, "something");
    const { tr } = editor.view.state;
    editor.view.dispatch(tr.insertText("anything", at, at + "something".length));
    expect(marked()).toEqual([]);
    const back = findText(editor.doc, "anything");
    editor.view.dispatch(editor.view.state.tr.insertText("something", back, back + "anything".length));
    expect(marked()).toEqual([["h1", "jot something down", ["is-pink"]]]);
  });

  it("paint a quote that occurs more than once only where its context says", () => {
    editor.open(PAGE);
    setPainted(editor.view, [
      { id: "plain", color: "green", anchor: { quote: "Press" } },
      { id: "told", color: "blue", anchor: { quote: "Press", prefix: "inbox. ", suffix: " it again." } },
    ]);
    expect(marked()).toEqual([["told", "Press", ["is-blue"]]]);
  });

  it("paint several at once", () => {
    editor.open(PAGE);
    setPainted(editor.view, [jot, { id: "h2", color: "yellow", anchor: { quote: "the inbox" } }]);
    expect(marked().map(([id]) => id)).toEqual(["h1", "h2"]);
  });
});
