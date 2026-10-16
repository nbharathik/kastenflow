// Citation chips in the real page editor: the chips replace the words of a
// citation on screen only, the Markdown opens and saves byte for byte, an edit
// of a paragraph keeps its citations as typed, and the citation menu writes
// plain `[@key]` text.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, waitFor } from "@testing-library/react";

import { MANAGED_BIB } from "../../../../lib/vault/reference-types";
import { markdownFixtures } from "../../../../test/fixtures";
import { usePaperDialog } from "../../../references/add-state";
import { useReferenceRequests } from "../../../references/requests";
import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { useWorkspace } from "../../../workspace/store";
import { splitFrontmatter } from "../../markdown/frontmatter";
import { createKastenCrepe } from "../crepe";
import { openNote } from "../session";
import { bookReady, resetBook } from "./book";
import { startCitePick } from "./cite-pick";
import { insertCitation } from "./registry";

const BIB = `@inproceedings{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  title = {Attention is all you need},
  booktitle = {NeurIPS},
  year = {2017},
}

@inproceedings{devlin2019bert,
  author = {Devlin, Jacob and Chang, Ming-Wei},
  title = {BERT},
  booktitle = {NAACL},
  year = {2019},
}
`;

let crepe: Crepe;
let root: HTMLElement;
const go = vi.fn();
const toast = vi.fn();

beforeAll(async () => {
  root = document.createElement("div");
  document.body.append(root);
  crepe = await createKastenCrepe(root);
});

afterAll(async () => {
  await crepe.destroy();
  root.remove();
});

beforeEach(async () => {
  go.mockClear();
  toast.mockClear();
  usePaperDialog.getState().close();
  useReferenceRequests.getState().clear();
  resetBook();
  const vault = new MemoryVault({ [MANAGED_BIB]: BIB });
  useWorkspace.setState({ client: vault, notes: await vault.list(), go, toast });
});

const view = (): EditorView => crepe.editor.ctx.get(editorViewCtx);
const chips = () => [...root.querySelectorAll<HTMLElement>(".kasten-cite")].map((c) => c.textContent);
const body = (text: string) => splitFrontmatter(text).body;

/** The document position of the first occurrence of `text` in a text node. */
function where(text: string): number {
  let found = -1;
  view().state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const at = node.text!.indexOf(text);
    if (at >= 0) found = pos + at;
  });
  if (found < 0) throw new Error(`"${text}" is not in the page`);
  return found;
}

function caretAt(pos: number): void {
  view().dispatch(view().state.tr.setSelection(TextSelection.create(view().state.doc, pos)));
}

const press = (key: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
const typeWords = (words: string) => [...words].forEach((c) => press(c));

describe("citation chips", () => {
  const fixture = markdownFixtures().find((f) => f.name === "roundtrip/36-citations.md")!;

  it("replace the words of every citation on screen, and the page still opens and saves byte for byte", async () => {
    const text = body(fixture.text);
    const note = openNote(crepe, text);
    await waitFor(() => expect(bookReady()).toBe(true));
    await waitFor(() => expect(chips()).toContain("(Vaswani et al., 2017)"));
    expect(chips()).toEqual([
      "(Vaswani et al., 2017)",
      "(Devlin and Chang, 2019, p. 4)",
      "(see Vaswani et al., 2017; Devlin and Chang, 2019, ch. 2)",
      "(2017)",
      // No reference has these keys: they are drawn as they are written.
      "(doe_2020:part-1.v2)",
      "(müller2020)",
      "(Vaswani et al., 2017)",
      "(Devlin and Chang, 2019, pp. 1-5)",
      "(Vaswani et al., 2017)",
      "(Vaswani et al., 2017)",
      "(Devlin and Chang, 2019, p. 7)",
      "(Vaswani et al., 2017)",
    ]);
    expect(note.save()).toBe(text);
    // The words are still in the document, hidden by a class.
    expect(root.querySelector(".kasten-cite-src")?.textContent).toBe("[@vaswani2017attention]");
    expect(root.textContent).toContain("[@in-fence]");
  });

  it("are not made of code, links, wiki links, addresses or a bare @", async () => {
    openNote(crepe, "A link [@not a cite](https://example.org), a wiki link [[Page @x]], code `[@in-code]`, me@example.com and @mention.\n");
    await waitFor(() => expect(bookReady()).toBe(true));
    expect(chips()).toEqual([]);
  });

  it("mark a key the bibliography lacks, once the bibliography has been read", async () => {
    openNote(crepe, "A missing one [@nobody2000] and a known one [@devlin2019bert].\n");
    await waitFor(() => expect(chips()).toEqual(["(nobody2000)", "(Devlin and Chang, 2019)"]));
    const [missing, known] = [...root.querySelectorAll<HTMLElement>(".kasten-cite")];
    expect(missing!.classList.contains("is-missing")).toBe(true);
    expect(known!.classList.contains("is-missing")).toBe(false);
    expect(missing!.dataset.citeKeys).toBe("nobody2000");
  });

  it("give the words back while the caret is in or beside the citation", async () => {
    openNote(crepe, "Before [@devlin2019bert, p. 4] after.\n");
    await waitFor(() => expect(chips()).toEqual(["(Devlin and Chang, 2019, p. 4)"]));
    caretAt(where("[@devlin2019bert") + 5);
    expect(chips()).toEqual([]);
    expect(root.querySelector(".kasten-cite-src.is-editing")?.textContent).toBe("[@devlin2019bert, p. 4]");
    // Right after the closing bracket is still beside it; one space on is not.
    caretAt(where("[@devlin2019bert") + "[@devlin2019bert, p. 4]".length);
    expect(chips()).toEqual([]);
    caretAt(where("[@devlin2019bert") + "[@devlin2019bert, p. 4] ".length);
    expect(chips()).toEqual(["(Devlin and Chang, 2019, p. 4)"]);
  });

  it("open the reference with Ctrl+Enter from inside the citation, and not elsewhere", async () => {
    openNote(crepe, "Before [@devlin2019bert, p. 4] after.\n");
    await waitFor(() => expect(chips()).toHaveLength(1));
    const enter = () => new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    caretAt(1);
    expect(view().someProp("handleKeyDown", (f) => f(view(), enter()))).toBeFalsy();
    expect(go).not.toHaveBeenCalled();
    caretAt(where("[@devlin2019bert") + 6);
    expect(view().someProp("handleKeyDown", (f) => f(view(), enter()))).toBe(true);
    expect(go).toHaveBeenCalledWith({ view: "references" });
    expect(useReferenceRequests.getState().key).toBe("devlin2019bert");
  });
});

describe("a chip", () => {
  const chip = () => root.querySelector<HTMLElement>(".kasten-cite")!;
  const card = () => document.querySelector<HTMLElement>(".kasten-cite-card");
  const inCard = (label: string) => [...card()!.querySelectorAll("button")].find((b) => b.textContent === label)!;
  const hover = async () => {
    chip().dispatchEvent(new MouseEvent("mouseenter"));
    await waitFor(() => expect(card()).not.toBeNull());
  };

  it("shows a card on hover with the reference's title, who and where, and goes when the pointer leaves", async () => {
    openNote(crepe, "Before [@devlin2019bert, p. 4] after.\n");
    await waitFor(() => expect(chips()).toEqual(["(Devlin and Chang, 2019, p. 4)"]));
    await hover();
    expect(card()!.textContent).toContain("BERT");
    expect(card()!.textContent).toContain("Devlin and Chang · 2019 · NAACL");
    expect([...card()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Copy citation", "Open reference"]);
    chip().dispatchEvent(new MouseEvent("mouseleave"));
    await waitFor(() => expect(card()).toBeNull());
  });

  it("copies the citation, or opens the reference, from its card", async () => {
    const write = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    openNote(crepe, "Before [@devlin2019bert] after.\n");
    await waitFor(() => expect(chips()).toHaveLength(1));
    await hover();
    fireEvent.click(inCard("Copy citation"));
    await waitFor(() => expect(write).toHaveBeenCalledWith("Devlin, Jacob; Chang, Ming-Wei (2019). BERT. NAACL."));
    expect(card()).toBeNull();
    await hover();
    fireEvent.click(inCard("Open reference"));
    expect(go).toHaveBeenCalledWith({ view: "references" });
    expect(useReferenceRequests.getState().key).toBe("devlin2019bert");
    expect(card()).toBeNull();
  });

  it("says a key has no reference, and offers to add a paper", async () => {
    openNote(crepe, "A missing one [@nobody2000].\n");
    await waitFor(() => expect(chip().classList.contains("is-missing")).toBe(true));
    await hover();
    expect(card()!.textContent).toContain("No reference has the key “nobody2000”");
    fireEvent.click(inCard("Add a paper…"));
    expect(usePaperDialog.getState().request).not.toBeNull();
    expect(card()).toBeNull();
  });

  it("opens its words for editing when clicked, with the caret at their end", async () => {
    openNote(crepe, "Before [@devlin2019bert, p. 4] after.\n");
    await waitFor(() => expect(chips()).toHaveLength(1));
    chip().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(chips()).toEqual([]);
    expect(root.querySelector(".kasten-cite-src.is-editing")?.textContent).toBe("[@devlin2019bert, p. 4]");
    expect(view().state.selection.from).toBe(where("[@devlin2019bert") + "[@devlin2019bert, p. 4]".length - 1);
  });

  it("follows the citation to its reference when clicked with Ctrl, and leaves the page as it was", async () => {
    openNote(crepe, "Before [@devlin2019bert, p. 4] after.\n");
    await waitFor(() => expect(chips()).toHaveLength(1));
    chip().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(go).toHaveBeenCalledWith({ view: "references" });
    expect(useReferenceRequests.getState().key).toBe("devlin2019bert");
    expect(chips()).toHaveLength(1);
  });

  it("is named for screen readers by what it says", async () => {
    openNote(crepe, "Before [@devlin2019bert] after.\n");
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chip().getAttribute("aria-label")).toBe("Citation: (Devlin and Chang, 2019)");
  });
});

describe("editing a paragraph with citations in it", () => {
  it("writes the citations as they were, with no escaping of their brackets or underscores", async () => {
    const note = openNote(crepe, "See [@vaswani2017attention; @doe_2020:part-1.v2, p. 4] and -[@x_y] now.\n");
    await waitFor(() => expect(chips().length).toBeGreaterThan(0));
    view().dispatch(view().state.tr.insertText("Edited ", 1));
    const saved = note.save();
    expect(saved).toBe("Edited See [@vaswani2017attention; @doe_2020:part-1.v2, p. 4] and -[@x_y] now.\n");
    // The first block was re-written; what it wrote reads back as the same citations.
    const again = openNote(crepe, saved);
    expect(again.save()).toBe(saved);
  });

  it("still escapes the characters around a citation that would change the page's meaning", async () => {
    const note = openNote(crepe, "Plain text.\n");
    view().dispatch(view().state.tr.insertText("*stars* _under_ [@a_b] `tick` <b>", 1));
    expect(note.save()).toBe("\\*stars\\* \\_under\\_ [@a_b] \\`tick\\` \\<b>Plain text.\n");
  });
});

describe("the citation menu", () => {
  const menu = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu-item")].map((row) => row.querySelector(".kasten-menu-label")?.textContent);

  async function open(text: string, at: (v: EditorView) => number) {
    const note = openNote(crepe, text);
    await waitFor(() => expect(bookReady()).toBe(true));
    caretAt(at(view()));
    startCitePick(view());
    await waitFor(() => expect(menu()).toContain("Add a paper…"));
    return note;
  }
  const end = (v: EditorView) => v.state.doc.content.size - 1;

  it("lists the papers, narrows them as you type, and writes [@key] for the pick", async () => {
    const note = await open("As shown\n", end);
    expect(menu()).toEqual(["Attention is all you need", "BERT", "Add a paper…"]);
    typeWords("dev");
    expect(menu()).toEqual(["BERT", "Add a paper…"]);
    press("Enter");
    expect(note.save()).toBe("As shown[@devlin2019bert]\n");
    expect(menu()).toEqual([]);
  });

  it("adds a locator after a comma", async () => {
    const note = await open("As shown\n", end);
    typeWords("attention, p. 4");
    press("Enter");
    expect(note.save()).toBe("As shown[@vaswani2017attention, p. 4]\n");
  });

  it("adds another work to a citation the caret is in", async () => {
    const note = await open("As [@vaswani2017attention] says.\n", () => where("[@vaswani2017attention]") + 4);
    typeWords("bert");
    press("Enter");
    expect(note.save()).toBe("As [@vaswani2017attention; @devlin2019bert] says.\n");
  });

  it("offers to add a paper, and puts the citation where it was asked for once it is saved", async () => {
    const note = await open("As shown\n", end);
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    const request = usePaperDialog.getState().request;
    expect(request).not.toBeNull();
    request!.then!("fresh2024paper");
    expect(note.save()).toBe("As shown[@fresh2024paper]\n");
  });

  it("closes with Escape and writes nothing", async () => {
    const note = await open("As shown\n", end);
    press("Escape");
    expect(menu()).toEqual([]);
    expect(note.save()).toBe("As shown\n");
  });

  it("is reached from the palette's Insert citation, which opens it in the page in front", async () => {
    openNote(crepe, "As shown\n");
    caretAt(end(view()));
    expect(insertCitation()).toBe(true);
    await waitFor(() => expect(menu()).toContain("Add a paper…"));
    press("Escape");
    expect(menu()).toEqual([]);
  });
});
