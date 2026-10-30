// The highlight colours and Comment are items of the editor's one selection
// toolbar: a click highlights the words selected in the page that holds it.

import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildToolbar } from "../pages/editor/menus/toolbar";
import { findText, useTestEditor } from "../../test/editor";
import type { Words } from "./anchor";
import { registerHighlighter } from "./highlight-registry";
import { HIGHLIGHT_COLORS } from "../sources/colors";

const editor = useTestEditor();

interface Item {
  key: string;
  label: string;
  onRun(ctx: unknown): void;
}

/** Runs the toolbar's builder against a stand-in and returns every item it added. */
function items(): Item[] {
  const made: Item[] = [];
  const chain = {
    addItem(key: string, item: Omit<Item, "key">) {
      made.push({ key, ...item });
      return chain;
    },
  };
  const builder = {
    getGroup: (key: string) => ({ group: { items: key === "formatting" ? [{ key: "italic" }] : [] }, addItem: chain.addItem }),
    addGroup: () => chain,
    build: () => [],
  };
  buildToolbar(builder as never);
  return made;
}

let forget = () => {};
afterEach(() => forget());

describe("the selection toolbar's highlight items", () => {
  it("has the five colours and Comment, in one bar with the formatting", () => {
    const keys = items().map((item) => item.key);
    expect(keys.filter((key) => key.startsWith("kasten-hl-"))).toEqual([...HIGHLIGHT_COLORS.map((color) => `kasten-hl-${color}`), "kasten-hl-comment"]);
    expect(keys).toContain("kasten-color");
  });

  it("highlights the selected words in the colour clicked and collapses the selection", () => {
    editor.open("Pack the tent. Check the poles.\n");
    const from = findText(editor.doc, "Check the poles.");
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, from, from + 16)));
    const words: Words = { from, to: from + 16, quote: "Check the poles.", prefix: "", suffix: "" } as Words;
    const added: [string, string, string | null | undefined][] = [];
    forget = registerHighlighter({
      dom: document.body,
      highlight: async () => true,
      words: () => words,
      add: async (w, color, comment) => {
        added.push([w.quote, color, comment]);
        return true;
      },
    });
    items().find((item) => item.key === "kasten-hl-pink")!.onRun(editor.ctx);
    expect(added).toEqual([["Check the poles.", "pink", undefined]]);
    expect(editor.view.state.selection.empty).toBe(true);
    // Only a page kept from the web registers; anywhere else the items do nothing.
    forget();
    items().find((item) => item.key === "kasten-hl-blue")!.onRun(editor.ctx);
    expect(added).toHaveLength(1);
  });
});
