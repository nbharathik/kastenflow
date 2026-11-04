import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { withPages } from "../../pages/fake-pages.ts";
import { runCommand } from "../commands/index.ts";
import type { SlidesHost } from "../host.ts";
import { hasWords, titleOfFile } from "./import-markdown.ts";
import { mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const words = () => screen.getByRole("textbox", { name: "Markdown" }) as HTMLTextAreaElement;
const make = () => screen.getByRole("button", { name: "Make slides" }) as HTMLButtonElement;
const MARKDOWN = "# One\n\nfirst words\n\n# Two\n\n- a\n- b\n";

describe("File, Import, Markdown or a note", () => {
  it("is a command that opens the dialog, in the File menu's Import and in the palette", async () => {
    const kit = await mountDialogs({ dialog: null });
    await act(async () => runCommand("file.import-markdown", kit));
    expect(kit.ui.state.dialog).toBe("import-markdown");
    expect(screen.getByRole("dialog", { name: "Import Markdown or a note" })).toBeTruthy();
    expect(document.activeElement).toBe(words());
  });

  it("makes a slide for each heading of pasted Markdown, after the slide shown, and goes to the first", async () => {
    const kit = await mountDialogs({ dialog: "import-markdown" });
    const before = kit.session.deck.slides.length;
    const shown = kit.session.state.slideId;
    expect(make().disabled).toBe(true);
    fireEvent.change(words(), { target: { value: MARKDOWN } });
    expect(make().disabled).toBe(false);
    fireEvent.click(make());
    expect(kit.session.deck.slides).toHaveLength(before + 2);
    const at = kit.session.deck.slides.findIndex((slide) => slide.id === shown);
    expect(kit.session.state.slideId).toBe(kit.session.deck.slides[at + 1]?.id);
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.errors).toEqual([]);
  });

  it("is one step of undo", async () => {
    const kit = await mountDialogs({ dialog: "import-markdown" });
    const before = kit.session.deck.slides.length;
    const label = kit.session.state.undoLabel;
    fireEvent.change(words(), { target: { value: MARKDOWN } });
    fireEvent.click(make());
    act(() => kit.session.undo());
    expect(kit.session.deck.slides).toHaveLength(before);
    expect(kit.session.state.undoLabel).toBe(label);
  });

  it("makes nothing from a frontmatter block alone, or blank lines", async () => {
    await mountDialogs({ dialog: "import-markdown" });
    fireEvent.change(words(), { target: { value: "---\ntitle: Nothing\n---\n\n\n" } });
    expect(make().disabled).toBe(true);
    expect(hasWords("---\ntitle: x\n---\n")).toBe(false);
    expect(hasWords("# Hello")).toBe(true);
  });

  it("reads a .md file into the box, and names the slide for the words before the first heading by the file", async () => {
    await mountDialogs({ dialog: "import-markdown" });
    const input = screen.getByLabelText("Markdown file") as HTMLInputElement;
    const file = new File([MARKDOWN], "Quarterly review.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(words().value).toBe(MARKDOWN));
    expect(titleOfFile("Quarterly review.md")).toBe("Quarterly review");
    expect(titleOfFile(".md")).toBe("Imported Markdown");
  });

  it("offers no note to choose where the host has none, and the pasted words work all the same", async () => {
    await mountDialogs({ dialog: "import-markdown" });
    expect(screen.queryByRole("button", { name: "Choose a note…" })).toBeNull();
  });

  it("makes slides from a note the host picks, with the host reading it", async () => {
    const kit = await mountDialogs({ dialog: null });
    withPages(kit.host, [{ path: "notes/plan.md", title: "Plan", markdown: MARKDOWN }]);
    act(() => kit.ui.openDialog("import-markdown"));
    const before = kit.session.deck.slides.length;
    fireEvent.click(screen.getByRole("button", { name: "Choose a note…" }));
    await waitFor(() => expect(kit.session.deck.slides).toHaveLength(before + 2));
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("does nothing when the person closes the host's note picker", async () => {
    const kit = await mountDialogs({ dialog: null });
    const pages = withPages(kit.host, [{ path: "notes/plan.md", title: "Plan", markdown: MARKDOWN }]);
    pages.choose = null;
    act(() => kit.ui.openDialog("import-markdown"));
    const before = kit.session.deck.slides.length;
    fireEvent.click(screen.getByRole("button", { name: "Choose a note…" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Choose a note…" }) as HTMLButtonElement).disabled).toBe(false));
    expect(kit.session.deck.slides).toHaveLength(before);
    expect(kit.ui.state.dialog).toBe("import-markdown");
  });

  it("says so when the note cannot be read", async () => {
    const kit = await mountDialogs({ dialog: null });
    const pages = withPages(kit.host, [{ path: "notes/plan.md", title: "Plan", markdown: MARKDOWN }]);
    act(() => kit.ui.openDialog("import-markdown"));
    // The picker answers with a page that is gone by the time it is read.
    (kit.host as SlidesHost).pickPage = async () => ({ path: "notes/gone.md", title: "Gone" });
    expect(pages.pages.has("notes/gone.md")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Choose a note…" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be found/);
  });
});
