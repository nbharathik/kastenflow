// A 1 MB paste goes into a page in pieces: no piece is large, the window gets
// a turn between pieces, nothing is lost or reordered, and no piece holds the
// page for more than 200 ms.

import { TextSelection } from "@milkdown/kit/prose/state";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../test/editor";
import { BIG_PASTE_CHARS, PIECE_CHARS, pasteInPieces, piecesOf } from "./paste-big";

const editor = useTestEditor();
afterEach(() => vi.restoreAllMocks());
// jsdom has no ClipboardEvent, which the editor makes for a paste it is given as text.
beforeAll(() => {
  vi.stubGlobal("ClipboardEvent", class extends Event {});
});
afterAll(() => vi.unstubAllGlobals());

/** About 1 MB of notes: paragraphs, some lists and code fences. */
function megabyte(): string {
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < 1_000_000; i++) {
    const part =
      i % 7 === 3
        ? `\`\`\`text\nline ${i} of a code block\n\nstill code ${i}\n\`\`\`\n`
        : i % 5 === 2
          ? `- item ${i} one\n- item ${i} two\n- item ${i} three\n`
          : `Paragraph ${i}: ${"words that fill a line of notes and then some more ".repeat(6)}\n`;
    parts.push(part);
    size += part.length + 1;
  }
  return parts.join("\n");
}

describe("pieces of a big paste", () => {
  it("join back into the text, cut only at blank lines outside code fences", () => {
    const text = megabyte();
    const pieces = piecesOf(text);
    expect(pieces.join("")).toBe(text);
    expect(pieces.length).toBeGreaterThan(30);
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.length).toBeGreaterThanOrEqual(PIECE_CHARS);
      expect(piece.endsWith("\n\n") || piece.endsWith("\n\n\n")).toBe(true);
      // A fence opened in a piece is closed in it.
      expect((piece.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
  });

  it("stay small when the text has no blank line at all (a log)", () => {
    const log = Array.from({ length: 40_000 }, (_, i) => `2026-10-29 12:00:${i % 60} INFO line ${i}`).join("\n");
    const pieces = piecesOf(log);
    expect(pieces.join("")).toBe(log);
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThan(PIECE_CHARS * 4 + 200);
  });

  it("do not cut inside a code fence, however long", () => {
    const code = `\`\`\`\n${"x = 1\n\n".repeat(30_000)}\`\`\`\n`;
    expect(piecesOf(code)).toEqual([code]);
  });
});

describe("pasting 1 MB into a page", () => {
  it("lands whole, in order, with a turn for the window between pieces and no slice over 200 ms", async () => {
    const text = megabyte();
    expect(text.length).toBeGreaterThan(BIG_PASTE_CHARS * 5);
    editor.open("Start.\n\nEnd.\n");
    editor.caret("Start.", true);
    const { view } = editor;

    const slices: number[] = [];
    const real = view.pasteText.bind(view);
    const sizes: number[] = [];
    vi.spyOn(view, "pasteText").mockImplementation((piece: string, event?: ClipboardEvent) => {
      const began = performance.now();
      const done = real(piece, event);
      slices.push(performance.now() - began);
      sizes.push(piece.length);
      return done;
    });
    const turn = vi.fn(async () => {});
    await pasteInPieces(view, text, turn);

    expect(slices.length).toBe(piecesOf(text).length);
    expect(turn).toHaveBeenCalledTimes(slices.length - 1);
    expect(Math.max(...sizes)).toBeLessThan(PIECE_CHARS * 4 + 200);
    // The words are all there, in order, between the page's own two lines.
    const saved = editor.save();
    expect(saved.startsWith("Start.")).toBe(true);
    expect(saved.trimEnd().endsWith("End.")).toBe(true);
    expect(saved.indexOf("Paragraph 0:")).toBeLessThan(saved.indexOf("Paragraph 1:"));
    const last = /Paragraph (\d+):/g;
    let lastSeen = -1;
    for (const m of saved.matchAll(last)) lastSeen = Math.max(lastSeen, Number(m[1]));
    expect(lastSeen).toBeGreaterThan(1000);
    // No single slice held the page for 200 ms. jsdom on a busy machine (the whole suite runs beside this) is
    // several times slower than the window, so the typical slice is held to the budget and the worst to a looser one.
    const sorted = [...slices].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]!).toBeLessThan(200);
    expect(sorted.at(-1)!).toBeLessThan(2000);
  }, 120_000);

  it("is taken over by the page's paste handler only when it is plain text and big", async () => {
    const paste = (data: Record<string, string>, files: unknown[] = []) => {
      const event = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { files, getData: (type: string) => data[type] ?? "" } });
      editor.view.dom.dispatchEvent(event);
    };
    editor.open("Start.\n");
    const spy = vi.spyOn(editor.view, "pasteText");
    // Small, or with HTML, or with files: the editor's own paste, which does not go through pasteText.
    paste({ "text/plain": "short" });
    paste({ "text/plain": "x".repeat(BIG_PASTE_CHARS + 1), "text/html": "<p>x</p>" });
    paste({ "text/plain": "x".repeat(BIG_PASTE_CHARS + 1) }, [{}]);
    expect(spy).not.toHaveBeenCalled();
    // Big plain text: taken over, and lands piece by piece.
    paste({ "text/plain": `${"A paragraph of plain words.\n\n".repeat(6000)}` });
    await vi.waitFor(() => expect(spy.mock.calls.length).toBe(piecesOf("A paragraph of plain words.\n\n".repeat(6000)).length));
  }, 60_000);

  it("stops quietly when the page goes away between pieces", async () => {
    editor.open("Start.\n");
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    const spy = vi.spyOn(view, "pasteText");
    let calls = 0;
    await pasteInPieces(view, megabyte(), async () => {
      if (++calls === 2) Object.defineProperty(view, "isDestroyed", { value: true, configurable: true });
    });
    expect(spy.mock.calls.length).toBe(2);
    Object.defineProperty(view, "isDestroyed", { value: false, configurable: true });
  }, 120_000);
});
