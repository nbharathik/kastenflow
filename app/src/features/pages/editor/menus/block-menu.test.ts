import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { MenuItem } from "../ui/popover";
import { blockMenuSections } from "./block-menu";
import { setLocationCopier, type HeadingSpot } from "./location-link";

const editor = useTestEditor();

function items(pos: number): MenuItem[] {
  return blockMenuSections(editor.view, pos).flatMap((s) => s.items);
}
const item = (pos: number, key: string) => items(pos).find((i) => i.key === key)!;

describe("the block menu", () => {
  it("offers Notion's actions for a text block", () => {
    editor.open("Hello\n");
    expect(items(0).map((i) => i.label)).toEqual(["Turn into", "Colour", "Duplicate", "Delete"]);
  });

  it("marks the block's current kind under Turn into", () => {
    editor.open("## Two\n");
    const turn = item(0, "turn-into").submenu!().flatMap((s) => s.items);
    expect(turn.filter((i) => i.active).map((i) => i.key)).toEqual(["h2"]);
    turn.find((i) => i.key === "quote")!.onPick!();
    expect(editor.save()).toBe("> Two\n");
  });

  it("turns a block into an equation and back", () => {
    editor.open("x^2\n");
    item(0, "turn-into").submenu!().flatMap((s) => s.items).find((i) => i.key === "math")!.onPick!();
    expect(editor.save()).toBe("$$\nx^2\n$$\n");
    const turn = item(0, "turn-into").submenu!().flatMap((s) => s.items);
    expect(turn.filter((i) => i.active).map((i) => i.key)).toEqual(["math"]);
    turn.find((i) => i.key === "text")!.onPick!();
    expect(editor.save()).toBe("x^2\n");
  });

  it("colours, duplicates and deletes the block", () => {
    editor.open("One\n\nTwo\n");
    const colour = item(0, "color").submenu!().flatMap((s) => s.items);
    colour.find((i) => i.key === "bg_color-blue")!.onPick!();
    expect(editor.save()).toBe('<span style="background-color: blue">One</span>\n\nTwo\n');
    item(0, "duplicate").onPick!();
    item(0, "delete").onPick!();
    expect(editor.save()).toBe('<span style="background-color: blue">One</span>\n\nTwo\n');
  });

  it("copies a link to a heading's place, counting the headings that share a title, and only for a heading", () => {
    editor.open("## Plan\n\nText\n\n## Plan\n");
    const spots: HeadingSpot[] = [];
    setLocationCopier(editor.view, (spot) => spots.push(spot));
    const headings: number[] = [];
    let paragraph = -1;
    editor.view.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") headings.push(offset);
      else if (node.type.name === "paragraph") paragraph = offset;
    });
    expect(item(headings[0]!, "copy-location").label).toBe("Copy link to this location");
    item(headings[0]!, "copy-location").onPick!();
    item(headings[1]!, "copy-location").onPick!();
    expect(spots).toEqual([
      { text: "Plan", nth: 1 },
      { text: "Plan", nth: 2 },
    ]);
    expect(items(paragraph).map((i) => i.key)).not.toContain("copy-location");
    // A page that cannot make a link (no copier) offers none.
    setLocationCopier(editor.view, undefined);
    expect(items(headings[0]!).map((i) => i.key)).not.toContain("copy-location");
  });

  it("has no Turn into or Colour for a divider", () => {
    editor.open("---\n");
    expect(items(0).map((i) => i.key)).toEqual(["duplicate", "delete"]);
  });
});
