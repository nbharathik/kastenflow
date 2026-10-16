import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../workspace/store";
import { usePaperDialog } from "./add-state";
import { paperFromExtension } from "./from-extension";

const toast = vi.fn();
beforeEach(() => {
  toast.mockClear();
  usePaperDialog.getState().close();
  useWorkspace.setState({ toast });
});

describe("a paper the browser extension found", () => {
  it("opens the form with the page's tags read as data", () => {
    const meta = JSON.stringify({ meta: [["citation_title", "<b>Attention</b> is all you need"], ["citation_author", "Vaswani, Ashish"], ["citation_doi", "10.1000/xyz"]], ld: [] });
    expect(paperFromExtension({ url: "https://journal.example/a", title: "Page", meta })).toBe(true);
    const draft = usePaperDialog.getState().request!.draft!;
    expect(draft.origin).toBe("page");
    expect(draft.fields).toMatchObject({ title: "Attention is all you need", author: "Vaswani, Ashish", doi: "10.1000/xyz", url: "https://journal.example/a" });
  });

  it("says so, and opens nothing, for a message that is not what KastenFlow sends", () => {
    for (const payload of [null, "text", {}, { url: "https://a.example/", title: 5, meta: "{}" }, { url: "https://a.example/", title: "T" }]) {
      expect(paperFromExtension(payload)).toBe(false);
    }
    expect(toast).toHaveBeenCalledTimes(5);
    expect(usePaperDialog.getState().request).toBeNull();
  });

  it("opens a form with just the title and address for a page whose tags are not JSON", () => {
    paperFromExtension({ url: "https://a.example/x", title: "A page", meta: "not json" });
    expect(usePaperDialog.getState().request!.draft!.fields).toEqual({ title: "A page", url: "https://a.example/x" });
  });
});
