import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePaperDialog } from "../references/add-state";
import { useWorkspace } from "../workspace/store";
import { setBrowserBackend } from "./backend";
import type { BrowserBackend } from "./types";
import { useSavePaper } from "./use-save-paper";

const toast = vi.fn();

function Button({ id }: { id: string }) {
  const { busy, start } = useSavePaper(id);
  return (
    <button type="button" disabled={busy} onClick={() => void start()}>
      Save
    </button>
  );
}

/** A backend that answers only what "Save as paper" asks. */
const backend = (pageMeta?: BrowserBackend["pageMeta"]): BrowserBackend => ({ pageMeta }) as unknown as BrowserBackend;

beforeEach(() => {
  toast.mockClear();
  usePaperDialog.getState().close();
  useWorkspace.setState({ toast });
});
afterEach(() => {
  cleanup();
  setBrowserBackend(null);
});

describe("Save as paper in a browser tab", () => {
  it("reads the page's tags and opens the form with them, to check", async () => {
    const meta = JSON.stringify({ meta: [["citation_title", "Attention is all you need"], ["citation_author", "Vaswani, Ashish"], ["citation_publication_date", "2017/06/12"], ["citation_doi", "10.1000/xyz"]], ld: [] });
    const asked = vi.fn(async () => ({ url: "https://journal.example/a", title: "Attention | Journal", meta }));
    setBrowserBackend(backend(asked));
    render(<Button id="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(usePaperDialog.getState().request?.draft).toBeDefined());
    expect(asked).toHaveBeenCalledWith("t1");
    const draft = usePaperDialog.getState().request!.draft!;
    expect(draft.origin).toBe("page");
    expect(draft.fields).toMatchObject({ title: "Attention is all you need", author: "Vaswani, Ashish", year: "2017", doi: "10.1000/xyz", url: "https://journal.example/a" });
  });

  it("treats an answer that is not what was asked for as a page with nothing to read", async () => {
    setBrowserBackend(backend(async () => ({ url: "https://x.example/", title: "Just a page", meta: "<script>alert(1)</script>" })));
    render(<Button id="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(usePaperDialog.getState().request?.draft).toBeDefined());
    const draft = usePaperDialog.getState().request!.draft!;
    expect(draft.fields).toEqual({ title: "Just a page", url: "https://x.example/" });
    expect(draft.note).toMatch(/no scholarly tags/i);
  });

  it("says why when the page could not be read, and opens nothing", async () => {
    setBrowserBackend(backend(async () => Promise.reject(new Error("Open a web page first"))));
    render(<Button id="t1" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The page could not be read: Open a web page first"));
    expect(usePaperDialog.getState().request).toBeNull();
  });

  it("says the desktop app is needed where there is no page to read", async () => {
    setBrowserBackend(backend(undefined));
    render(<Button id="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The browser needs the desktop app"));
    expect(usePaperDialog.getState().request).toBeNull();
  });
});
