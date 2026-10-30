import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../features/workspace/store";
import { setPluginsBackend, type PluginsBackend } from "../api";
import { usePlugins } from "../registry";
import { setLatexBackend } from "./backend";
import { rememberDocs } from "./docs-cache";
import { useDiagnostics } from "./diagnostics";
import { useLatexPrefs } from "./prefs";
import { DOC, event, fakeBackend, FOLDER, INTRO, MAIN } from "./test-support";
import LatexView from "./view";
import { Workspace } from "./Workspace";

const pdf = vi.hoisted(() => ({ opened: 0, failOpen: false, destroyed: 0 }));
vi.mock("./preview/pdf-deps", () => ({
  pdfDeps: {
    open: async () => {
      if (pdf.failOpen) throw new Error("not a PDF");
      pdf.opened++;
      return {
        numPages: 2,
        getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }) }),
        destroy: () => void pdf.destroyed++,
      };
    },
    paint: async () => {},
  },
}));

const toast = vi.fn();
let fake: ReturnType<typeof fakeBackend>;

/** The toolbar's own buttons (the empty preview offers a Build button of its own too). */
const toolbar = () => within(screen.getByRole("toolbar", { name: "LaTeX document" }));

function open(file = MAIN) {
  return render(<Workspace backend={fake.backend} doc={DOC} file={file} />);
}

const cm = (container: HTMLElement): EditorView => EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;

beforeEach(() => {
  fake = fakeBackend();
  setLatexBackend(fake.backend);
  useLatexPrefs.getState().set({ autoBuild: false, treeOpen: true, delayMs: 500 });
  useWorkspace.setState({ toast });
  toast.mockClear();
  pdf.opened = 0;
  pdf.failOpen = false;
  pdf.destroyed = 0;
  useDiagnostics.setState({ byDoc: {} });
});

afterEach(() => {
  cleanup();
  setLatexBackend(null);
  setPluginsBackend(null);
  usePlugins.setState({ info: [], payload: {}, enabled: [], loaded: {}, on: {} });
});

describe("an open LaTeX document", () => {
  it("shows the toolbar, the files, the source and the status line", async () => {
    const view = open();
    await screen.findByRole("navigation", { name: "Files in this document" });
    expect(screen.getByRole("toolbar", { name: "LaTeX document" })).toBeTruthy();
    for (const name of ["Build", "Export PDF", "Sync to PDF", "Hide the files"]) expect(toolbar().getByRole("button", { name })).toBeTruthy();
    // The empty preview says what to do next.
    expect(screen.getByText("Nothing to show yet.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-build" })).toBeTruthy();
    // Only text files open; the rest are listed.
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "main.tex" })).toBeTruthy();
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "intro.tex" })).toBeTruthy();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    expect(cm(view.container).state.doc.toString()).toContain("\\begin{document}");
    expect(screen.getByRole("status").textContent).toContain("Not built yet");
    expect(screen.getByRole("status").textContent).toContain("Saved");
    // Nothing to export or sync before a build.
    expect((screen.getByRole("button", { name: "Export PDF" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Sync to PDF" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Build asks for a build with the unsaved text, shows progress, then the PDF and the time", async () => {
    // Saving never finishes here, so the text is still unsaved when the build is asked for, however slow the machine is.
    fake.backend.saveSource.mockImplementation(() => new Promise(() => {}));
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    act(() => cm(view.container).dispatch({ changes: { from: 0, insert: "% hi\n" } }));
    fireEvent.click(toolbar().getByRole("button", { name: "Build" }));
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(1));
    expect(fake.backend.build.mock.calls[0]![0].buffers[0]!.text.startsWith("% hi\n")).toBe(true);
    // Feedback at once, before the app answers.
    expect(screen.getByRole("status").textContent).toContain("Building");
    act(() => fake.send(event({ state: "running", note: "Downloading TeX packages…" })));
    expect(screen.getByRole("status").textContent).toContain("Downloading TeX packages…");
    expect(screen.getByRole("progressbar", { name: "Downloading TeX packages…" })).toBeTruthy();
    act(() => fake.send(event({ state: "done", pdf: true, ms: 1234 })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Built in 1.2 s"));
    await waitFor(() => expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2));
    expect(fake.backend.readPdf).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Export PDF" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Ctrl+Enter builds and Ctrl+S saves and builds", async () => {
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    const content = view.container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true, keyCode: 13 });
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(1));
    act(() => cm(view.container).dispatch({ changes: { from: 0, insert: "x" } }));
    fireEvent.keyDown(content, { key: "s", ctrlKey: true, keyCode: 83 });
    await waitFor(() => expect(fake.backend.saveSource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(2));
  });

  it("keeps the last good PDF on screen, with a line saying why, when a build fails", async () => {
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    act(() => fake.send(event({ seq: 1, state: "done", pdf: true, ms: 300 })));
    await waitFor(() => expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2));
    act(() => fake.send(event({ seq: 2, state: "failed", diagnostics: [{ file: "main.tex", line: 7, severity: "error", message: "Undefined control sequence." }], error: { kind: "engine-failed", message: "TeX stopped." } })));
    await screen.findByText("Showing the last PDF that worked. Undefined control sequence. (line 7)");
    expect(screen.getAllByRole("status").some((s) => s.textContent?.includes("1 error"))).toBe(true);
    expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2);
    expect(useDiagnostics.getState().byDoc[FOLDER]).toHaveLength(1);
  });

  it("keeps the last good PDF, and says so, when the new one cannot be opened", async () => {
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    act(() => fake.send(event({ seq: 1, state: "done", pdf: true })));
    await waitFor(() => expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2));
    pdf.failOpen = true;
    act(() => fake.send(event({ seq: 2, state: "done", pdf: true })));
    await screen.findByText("The new PDF could not be opened: not a PDF");
    expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2);
  });

  it("Export PDF keeps the built PDF and says where; Sync to PDF jumps to the line", async () => {
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    act(() => fake.send(event({ state: "done", pdf: true })));
    await waitFor(() => expect(view.container.querySelectorAll(".latex-page")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(fake.backend.exportPdf).toHaveBeenCalledWith(FOLDER));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Kept main.pdf in the document's folder."));
    fireEvent.click(screen.getByRole("button", { name: "Sync to PDF" }));
    await waitFor(() => expect(fake.backend.syncForward).toHaveBeenCalledWith(FOLDER, MAIN, 1));
    await waitFor(() => expect(view.container.querySelector(".latex-sync-flash")).not.toBeNull());
  });

  it("the auto-build switch is the setting, and the other files open in the same editor", async () => {
    const view = open();
    await screen.findByRole("navigation");
    const auto = screen.getByRole("switch", { name: "Auto-build" }) as HTMLInputElement;
    expect(auto.checked).toBe(false);
    fireEvent.click(auto);
    expect(useLatexPrefs.getState().autoBuild).toBe(true);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "intro.tex" }));
    await waitFor(() => expect(cm(view.container).state.doc.toString()).toBe("Intro.\n"));
    expect(fake.backend.source).toHaveBeenCalledWith(INTRO);
    fireEvent.click(screen.getByRole("button", { name: "Hide the files" }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(useLatexPrefs.getState().treeOpen).toBe(false);
  });

  it("saves typed text 500 ms later, and a conflict asks which text to keep", async () => {
    const view = open();
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    fake.state.saveAnswer = (path) => ({ status: "conflict", copy: `${FOLDER}/main (conflict 1).tex`, file: { path, text: "disk\n", hash: "d1" } });
    act(() => cm(view.container).dispatch({ changes: { from: 0, insert: "mine " } }));
    expect(screen.getByRole("status").textContent).toContain("Saving");
    const banner = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(banner.textContent).toContain("was changed somewhere else on the same lines");
    expect(banner.textContent).toContain("main (conflict 1).tex");
    fireEvent.click(within(banner).getByRole("button", { name: "Use the file on disk" }));
    await waitFor(() => expect(cm(view.container).state.doc.toString()).toBe("disk\n"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with no engine, shows the card; Use my TeX saves the choice and builds", async () => {
    fake.state.engines = { engines: [], chosen: null, error: { kind: "no-engine", message: "There is no TeX engine on this computer.", next: "install-tectonic" } };
    open();
    const card = await screen.findByRole("group", { name: "No TeX engine" });
    expect(card.textContent).toContain("There is no TeX engine on this computer.");
    fireEvent.click(within(card).getByRole("button", { name: "Use my TeX" }));
    await waitFor(() => expect(fake.backend.setEngine).toHaveBeenCalledWith(FOLDER, "latexmk-pdf"));
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(1));
  });

  it("installs Tectonic from the card, shows the download, and builds when it is there", async () => {
    fake.state.engines = { engines: [], chosen: null, error: { kind: "no-engine", message: "There is no TeX engine on this computer.", next: "install-tectonic" } };
    let finish: (v: string) => void = () => {};
    const installing: PluginsBackend = {
      list: () => Promise.resolve([]),
      setEnabled: () => Promise.resolve(true),
      status: () => Promise.reject(new Error("unused")),
      install: () => new Promise<string>((resolve) => (finish = resolve)),
      cancel: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      onPayload: () => Promise.resolve(() => {}),
    };
    setPluginsBackend(installing);
    usePlugins.setState({ info: [{ id: "latex", name: "LaTeX", summary: "s", version: "1", defaultOn: false, scope: "vault", payload: { label: "LaTeX engine", version: "0.15", sizeBytes: 48_000_000 }, enabled: true }] });
    open();
    const card = await screen.findByRole("group", { name: "No TeX engine" });
    fireEvent.click(within(card).getByRole("button", { name: "Install Tectonic (48 MB)" }));
    await within(card).findByRole("progressbar", { name: "Downloading Tectonic" });
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(fake.backend.build).not.toHaveBeenCalled();
    await act(async () => finish("installed"));
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(1));
  });

  it("says plainly when the Tectonic download is not offered, and still offers the other way", async () => {
    fake.state.engines = { engines: [], chosen: null, error: { kind: "no-engine", message: "There is no TeX engine on this computer.", next: "install-tectonic" } };
    open();
    const card = await screen.findByRole("group", { name: "No TeX engine" });
    expect(card.textContent).toContain("The Tectonic download is not available in this version.");
    expect(within(card).getByRole("button", { name: "Use my TeX" })).toBeTruthy();
  });

  it("when no TeX installation is found either, the card offers to check again", async () => {
    fake.state.engines = { engines: [], chosen: null, error: { kind: "no-engine", message: "No TeX installation was found on this computer.", next: "install-tex" } };
    open();
    const card = await screen.findByRole("group", { name: "No TeX engine" });
    expect(within(card).queryByRole("button", { name: "Use my TeX" })).toBeNull();
    // It says where to get a TeX installation.
    expect(card.textContent).toContain("MiKTeX");
    expect(card.textContent).toContain("TeX Live");
    fireEvent.click(within(card).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(fake.backend.build).toHaveBeenCalledTimes(1));
  });

  it("a document that cannot be opened says why", async () => {
    fake.backend.files.mockRejectedValueOnce("That folder is not a LaTeX document");
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("That folder is not a LaTeX document");
  });
});

describe("the LaTeX view", () => {
  it("lists the documents and starts a new one", async () => {
    rememberDocs([]);
    const go = vi.fn();
    useWorkspace.setState({ go });
    render(<LatexView place={{ view: "plugin:latex" }} />);
    expect(await screen.findByText("paper")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New document" })).toBeTruthy();
    fireEvent.click(screen.getByText("paper"));
    expect(go).toHaveBeenCalledWith({ view: "plugin:latex", path: MAIN });
  });

  it("says one sentence and offers the button when there are no documents", async () => {
    fake.backend.docs.mockResolvedValueOnce([]);
    render(<LatexView place={{ view: "plugin:latex" }} />);
    expect(await screen.findByText(/No LaTeX documents yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await waitFor(() => expect(fake.backend.create).toHaveBeenCalledWith("Untitled document", undefined, "article"));
  });

  it("a list that cannot be read says why and offers to try again", async () => {
    fake.backend.docs.mockRejectedValueOnce("The vault is still opening");
    render(<LatexView place={{ view: "plugin:latex" }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("The vault is still opening");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("paper")).toBeTruthy();
  });

  it("a file outside any document says so and leads back to the list", async () => {
    render(<LatexView place={{ view: "plugin:latex", path: "notes/stray.tex" }} />);
    expect(await screen.findByText(/not part of a LaTeX document/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "See the LaTeX documents" })).toBeTruthy();
  });

  it("opens the document a section file belongs to, on that file", async () => {
    const view = render(<LatexView place={{ view: "plugin:latex", path: INTRO }} />);
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    await waitFor(() => expect(cm(view.container).state.doc.toString()).toBe("Intro.\n"));
  });

  it("needs the desktop app outside it", () => {
    setLatexBackend(null);
    render(<LatexView place={{ view: "plugin:latex" }} />);
    expect(screen.getByText(/need the KastenFlow desktop app/)).toBeTruthy();
  });

  it("a build error from the app that is not about the engine is shown as a failed build", async () => {
    fake.backend.build.mockRejectedValueOnce({ kind: "bad-request", message: "The folder is not a plain folder." });
    open();
    await screen.findByRole("navigation");
    fireEvent.click(toolbar().getByRole("button", { name: "Build" }));
    await waitFor(() => expect(screen.getAllByRole("status").some((s) => s.textContent?.includes("The folder is not a plain folder."))).toBe(true));
  });
});
