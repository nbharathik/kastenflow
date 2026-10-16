// The annotation calls reach the commands the app's backend registers, with
// the arguments it reads.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { tauriAnnotations } from "./annotations-tauri";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
});

describe("the comment calls", () => {
  it("list, add, resolve and move a comment", async () => {
    await tauriAnnotations.comments("library/a.md");
    expect(invoke).toHaveBeenLastCalledWith("comments", { page: "library/a.md" });
    await tauriAnnotations.addComment("library/a.md", { anchor: { section: "Method", nth: 1, quote: "words" }, text: "Check" });
    expect(invoke).toHaveBeenLastCalledWith("add_comment", { page: "library/a.md", comment: { anchor: { section: "Method", nth: 1, quote: "words" }, text: "Check" } });
    await tauriAnnotations.resolveComment("library/a.md", "c-1", true);
    expect(invoke).toHaveBeenLastCalledWith("resolve_comment", { page: "library/a.md", id: "c-1", resolved: true });
    await tauriAnnotations.reanchorComment("library/a.md", "c-1", { section: "Results", nth: 2 });
    expect(invoke).toHaveBeenLastCalledWith("reanchor_comment", { page: "library/a.md", id: "c-1", anchor: { section: "Results", nth: 2 } });
  });
});

describe("the highlight calls", () => {
  it("list, add, change, move and remove a highlight", async () => {
    await tauriAnnotations.textHighlights("inbox/a.md");
    expect(invoke).toHaveBeenLastCalledWith("text_highlights", { note: "inbox/a.md" });
    await tauriAnnotations.addTextHighlight("inbox/a.md", { anchor: { quote: "words" }, color: "pink" });
    expect(invoke).toHaveBeenLastCalledWith("add_text_highlight", { note: "inbox/a.md", highlight: { anchor: { quote: "words" }, color: "pink" } });
    await tauriAnnotations.editTextHighlight("inbox/a.md", "h-1", { color: "blue", comment: "" });
    expect(invoke).toHaveBeenLastCalledWith("edit_text_highlight", { note: "inbox/a.md", id: "h-1", edit: { color: "blue", comment: "" } });
    await tauriAnnotations.moveTextHighlight("inbox/a.md", "h-1", { quote: "other" });
    expect(invoke).toHaveBeenLastCalledWith("move_text_highlight", { note: "inbox/a.md", id: "h-1", anchor: { quote: "other" } });
    await tauriAnnotations.removeTextHighlight("inbox/a.md", "h-1");
    expect(invoke).toHaveBeenLastCalledWith("remove_text_highlight", { note: "inbox/a.md", id: "h-1" });
  });
});
