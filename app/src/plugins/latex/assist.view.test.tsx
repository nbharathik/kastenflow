import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../features/workspace/store";
import { setLatexBackend } from "./backend";
import { useDiagnostics } from "./diagnostics";
import { useLatexPrefs } from "./prefs";
import { DOC, event, fakeBackend, FOLDER, INTRO, MAIN } from "./test-support";
import { Workspace } from "./Workspace";

vi.mock("./preview/pdf-deps", () => ({
  pdfDeps: {
    open: async () => ({
      numPages: 2,
      getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }) }),
      destroy: () => {},
    }),
    paint: async () => {},
  },
}));

const TEXT = ["\\documentclass{article}", "\\begin{document}", "\\section{Intro}\\label{sec:intro}", "Hello.", "\\subsection{More}", "See \\ref{sec:intro}.", "\\end{document}", ""].join("\n");
const toast = vi.fn();
let fake: ReturnType<typeof fakeBackend>;

const cm = (container: HTMLElement): EditorView => EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
const caretLine = (container: HTMLElement): number => cm(container).state.doc.lineAt(cm(container).state.selection.main.head).number;

async function open(file = MAIN) {
  const view = render(<Workspace backend={fake.backend} doc={DOC} file={file} />);
  await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
  return view;
}

/** A finished build that made a PDF, drawn into the preview. */
async function withPdf(view: Awaited<ReturnType<typeof open>>, diagnostics = [] as ReturnType<typeof event>["diagnostics"]) {
  act(() => fake.send(event({ state: "done", pdf: true, diagnostics })));
  await waitFor(() => expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2));
}

beforeEach(() => {
  fake = fakeBackend({ [MAIN]: TEXT });
  setLatexBackend(fake.backend);
  useLatexPrefs.getState().set({ autoBuild: false, treeOpen: true, delayMs: 500 });
  useWorkspace.setState({ toast, client: null });
  toast.mockClear();
  useDiagnostics.setState({ byDoc: {} });
});

afterEach(() => {
  cleanup();
  setLatexBackend(null);
});

describe("outline, problems and sync in an open document", () => {
  it("lists the headings and goes to one with a click", async () => {
    const view = await open();
    const outline = await screen.findByRole("region", { name: "Outline of this file" });
    expect(within(outline).getAllByRole("button").map((b) => b.textContent)).toEqual(["Intro3", "More5"]);
    fireEvent.click(within(outline).getByRole("button", { name: /More/ }));
    expect(caretLine(view.container)).toBe(5);
  });

  it("marks the build's errors in the text, lists them, and a click goes to the line", async () => {
    const view = await open();
    await withPdf(view, [
      { file: "main.tex", line: 6, severity: "error", message: "Undefined control sequence." },
      { file: "main.tex", line: 4, severity: "warning", message: "Overfull box." },
    ]);
    const list = await screen.findByRole("region", { name: "Problems from the last build" });
    expect(within(list).getByText("1 error, 1 warning")).toBeTruthy();
    await waitFor(() => expect(view.container.querySelectorAll(".cm-lintRange").length).toBeGreaterThan(0));
    fireEvent.click(within(list).getByRole("button", { name: /Undefined control sequence/ }));
    expect(caretLine(view.container)).toBe(6);
  });

  it("a problem in another file opens that file on its line", async () => {
    fake.disk[INTRO] = "first\nsecond\nthird\n";
    const view = await open();
    await withPdf(view, [{ file: "sections/intro.tex", line: 3, severity: "error", message: "Missing $ inserted." }]);
    fireEvent.click(await screen.findByRole("button", { name: /Missing \$ inserted/ }));
    await waitFor(() => expect(cm(view.container).state.doc.toString()).toBe("first\nsecond\nthird\n"));
    await waitFor(() => expect(caretLine(view.container)).toBe(3));
    // The marks follow the file that is open.
    await waitFor(() => expect(view.container.querySelectorAll(".cm-lintRange-error").length).toBeGreaterThan(0));
  });

  it("the Sync to PDF button and Ctrl+click both ask the app for the caret's line", async () => {
    const view = await open();
    await withPdf(view);
    cm(view.container).dispatch({ selection: { anchor: cm(view.container).state.doc.line(4).from } });
    fireEvent.click(screen.getByRole("button", { name: "Sync to PDF" }));
    await waitFor(() => expect(fake.backend.syncForward).toHaveBeenLastCalledWith(FOLDER, MAIN, 4));
    vi.spyOn(cm(view.container), "posAtCoords").mockReturnValue(cm(view.container).state.doc.line(6).from + 2);
    fireEvent.mouseDown(cm(view.container).contentDOM, { button: 0, ctrlKey: true });
    await waitFor(() => expect(fake.backend.syncForward).toHaveBeenLastCalledWith(FOLDER, MAIN, 6));
    // The place found is marked in the PDF.
    await waitFor(() => expect(view.container.querySelector(".latex-sync-flash")).not.toBeNull());
  });

  it("Ctrl+click says why when there is no PDF to show", async () => {
    fake.backend.syncForward.mockRejectedValueOnce("There is no PDF yet: build the document first");
    const view = await open();
    vi.spyOn(cm(view.container), "posAtCoords").mockReturnValue(3);
    fireEvent.mouseDown(cm(view.container).contentDOM, { button: 0, ctrlKey: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("There is no PDF yet: build the document first"));
  });

  it("a double-click in the PDF goes to the source line, in the same file or another", async () => {
    fake.disk[INTRO] = "alpha\nbeta\n";
    const view = await open();
    await withPdf(view);
    const pages = view.container.querySelector(".latex-preview-scroll") as HTMLElement;
    fake.backend.syncInverse.mockResolvedValueOnce({ file: "main.tex", line: 6 });
    fireEvent.doubleClick(pages, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(fake.backend.syncInverse).toHaveBeenLastCalledWith(FOLDER, 1, 10, 10));
    await waitFor(() => expect(caretLine(view.container)).toBe(6));
    fake.backend.syncInverse.mockResolvedValueOnce({ file: "sections/intro.tex", line: 2 });
    fireEvent.doubleClick(pages, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(cm(view.container).state.doc.toString()).toBe("alpha\nbeta\n"));
    await waitFor(() => expect(caretLine(view.container)).toBe(2));
  });

  it("Enter in the PDF column and the 'Find this place in the source' button do the same from the keyboard", async () => {
    const view = await open();
    await withPdf(view);
    fake.backend.syncInverse.mockResolvedValue({ file: "main.tex", line: 4 });
    const pages = view.container.querySelector(".latex-preview-scroll") as HTMLElement;
    fireEvent.keyDown(pages, { key: "Enter" });
    await waitFor(() => expect(caretLine(view.container)).toBe(4));
    cm(view.container).dispatch({ selection: { anchor: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Find this place in the source" }));
    await waitFor(() => expect(caretLine(view.container)).toBe(4));
  });

  it("says so when the PDF place has no source", async () => {
    const view = await open();
    await withPdf(view);
    fake.backend.syncInverse.mockRejectedValueOnce("There is no source for that place.");
    fireEvent.doubleClick(view.container.querySelector(".latex-preview-scroll") as HTMLElement, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("There is no source for that place."));
  });

  it("Add a section in an empty outline inserts a heading with its title selected", async () => {
    fake.disk[INTRO] = "just text\n";
    const view = await open(INTRO);
    const outline = await screen.findByRole("region", { name: "Outline of this file" });
    fireEvent.click(within(outline).getByRole("button", { name: "Add a section" }));
    const doc = cm(view.container).state;
    expect(doc.doc.toString()).toBe("just text\n\\section{Title}\n\n");
    expect(doc.sliceDoc(doc.selection.main.from, doc.selection.main.to)).toBe("Title");
  });
});
