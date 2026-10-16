// A highlight's popup copies a link that opens the PDF at that page and highlight.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseKastenLink } from "../../../lib/kasten-links";
import type { Highlight } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { HighlightPop } from "./HighlightPop";

const HIGHLIGHT: Highlight = { id: "h-3", page: 12, rects: [], text: "One idea per note.", color: "yellow", comment: null, cardId: null, created: null, card: null };
const toast = vi.fn();
const write = vi.fn(async (_text: string) => {});

beforeEach(() => {
  toast.mockClear();
  write.mockClear();
  useWorkspace.setState({ toast });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
});
afterEach(cleanup);

describe("a highlight's popup", () => {
  it("copies a link to the PDF at the highlight's page, which the link reader gives back", async () => {
    render(<HighlightPop source="sources/Zettelkasten primer.pdf" highlight={HIGHLIGHT} at={{ left: 0, top: 0 }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this location" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const link = write.mock.calls[0]![0];
    expect(link).toBe("kasten:pdf/sources/Zettelkasten%20primer.pdf?page=12&highlight=h-3");
    expect(parseKastenLink(link)).toEqual({ kind: "pdf", path: "sources/Zettelkasten primer.pdf", page: 12, highlight: "h-3" });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Copied the link to this highlight"));
  });

  it("keeps the other buttons it had", () => {
    render(<HighlightPop source="sources/a.pdf" highlight={HIGHLIGHT} at={{ left: 0, top: 0 }} onClose={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Make card", "Copy", "Copy link to this location", "Explain", "Remove"]));
  });
});
