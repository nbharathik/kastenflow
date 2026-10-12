// Pictures go into a section like any block, in the sections layout too: a
// dropped or pasted file lands under the line it was put on, inside that
// section's card, and the Markdown is the page's own.

import { describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { FileProvider } from "../files";
import { insertFiles } from "../paste-files";
import { setSmart } from "./api";
import { sectionsOf } from "./model";

const files: FileProvider = {
  save: vi.fn(async () => "../assets/pasted.png"),
  url: (src) => (src.startsWith("../assets/") ? `asset://vault/${src.slice(3)}` : src),
};
const editor = useTestEditor({ foldKey: "note-1", files });

const PAGE = "One.\n\n---\n\nTwo first.\n\nTwo second.\n\n---\n\nThree.\n";
const png = () => new File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });

describe("a picture put in a section", () => {
  it("lands in that section's card, after the line it was put on", async () => {
    editor.open(PAGE);
    setSmart(editor.view, true);
    // Under "Two first." in the second section.
    const first = sectionsOf(editor.doc)[1]!.from;
    await insertFiles(editor.view, files, [png()], first + 2);
    expect(editor.save()).toBe("One.\n\n---\n\nTwo first.\n\n![](../assets/pasted.png)\n\nTwo second.\n\n---\n\nThree.\n");
    const sections = sectionsOf(editor.doc);
    expect(sections.map((s) => s.blocks)).toEqual([1, 3, 1]);
    // The picture is one of the second section's blocks, between its first and last, so it is the inside of that card.
    const blocks: string[] = [];
    editor.doc.forEach((node) => void blocks.push(node.type.name));
    expect(blocks.slice(0, 7)).toEqual(["paragraph", "hr", "paragraph", "image-block", "paragraph", "hr", "paragraph"]);
    expect(editor.view.dom.querySelectorAll(".kasten-sec-head")).toHaveLength(3);
    expect(editor.view.dom.querySelectorAll(".is-sec-start")).toHaveLength(3);
    setSmart(editor.view, false);
  });
});
