// The selection toolbar's AI group: "Ask AI" first, then "Explain", which
// opens the AI panel in its read-only mode on the selection.

import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { findText, useTestEditor } from "../../../../test/editor";
import { onAiOpen, type AiOpen } from "../ai/ai";
import { buildToolbar } from "./toolbar";

const editor = useTestEditor();

interface Item {
  key: string;
  label: string;
  icon: string;
  onRun(ctx: unknown): void;
}

/** Runs the toolbar's builder against a stand-in and returns the groups it made. */
function groups(): { key: string; items: Item[] }[] {
  const made: { key: string; items: Item[] }[] = [];
  const builder = {
    getGroup: (key: string) => ({ group: { items: key === "formatting" ? [{ key: "italic" }] : [] } }),
    addGroup: (key: string) => {
      const group = { key, items: [] as Item[] };
      made.push(group);
      const chain = {
        addItem(itemKey: string, item: Omit<Item, "key">) {
          group.items.push({ key: itemKey, ...item });
          return chain;
        },
      };
      return chain;
    },
    build: () => made,
  };
  buildToolbar(builder as never);
  return made;
}

describe("the toolbar's AI group", () => {
  it("leads with Ask AI and Explain", () => {
    const [ai] = groups();
    expect(ai!.key).toBe("kasten-ai");
    expect(ai!.items.map((item) => [item.key, item.label])).toEqual([
      ["kasten-ai", "Ask AI"],
      ["kasten-explain", "Explain"],
    ]);
    // A line icon, open inside, whatever fill the toolbar gives the others.
    expect(ai!.items[1]!.icon).toContain('style="fill:none"');
  });

  it("opens the panel to explain the selection", () => {
    editor.open("Pack the tent. Check the poles.\n");
    const from = findText(editor.doc, "Check the poles.");
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, from, from + 16)));
    const seen: AiOpen[] = [];
    const stop = onAiOpen(editor.view, (open) => seen.push(open));
    groups()[0]!.items[1]!.onRun(editor.ctx);
    stop();
    expect(seen.map((open) => open.action)).toEqual(["explain"]);
    expect(editor.ctx.get(editorViewCtx)).toBe(editor.view);
  });
});
