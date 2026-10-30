// What the LaTeX plugin adds to the window: off adds nothing, on adds the
// view, file kinds, palette commands, "New" entry, sidebar row and settings;
// and none of the editor's code is loaded until a document is opened.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newActions } from "../../features/home/actions";
import { openKind } from "../../features/workspace/open-kind";
import { allCommands } from "../../features/workspace/overlays/commands";
import { availableNav } from "../../shell/nav";
import { tabFace } from "../../shell/TabStrip";
import { setLatexBackend } from "./backend";
import { activeActions, registerActions } from "./actions";
import { fileHandlerFor, pageMenuItems, selectionTools, settingsSections, sidebarRows, views } from "../contributions";
import { useWorkspace } from "../../features/workspace/store";
import { CATALOG } from "../catalog";
import { usePlugins } from "../registry";
import { rememberDocs } from "./docs-cache";
import { LATEX_MANIFEST, LATEX_VIEW } from "./manifest";
import { fakeBackend } from "./test-support";

const loaded = vi.hoisted(() => ({ editor: false, pdf: false }));
vi.mock("@codemirror/view", async (original) => {
  loaded.editor = true;
  return original();
});
// pdf.js itself (big) is fetched by the PDF loader on the first PDF opened, not with the view.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  loaded.pdf = true;
  return { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error("no")), destroy: () => {} }) };
});

const ALWAYS = ["latex", "new-latex", "new-latex-report", "new-latex-slides"];
// Apply only while a document is on screen.
const WITH_DOCUMENT = ["latex-build", "latex-stop", "latex-export", "latex-sync", "latex-auto", "latex-files", "latex-cite", "latex-fix-ai", "latex-inline-ai", "latex-ai-refs", "latex-ai-citations", "latex-ai-boxes", "latex-ai-draft", "latex-ai-table"];
// Apply only while a page is open.
const ON_A_PAGE = ["latex-send-page", "latex-add-page"];
const IDS = [...ALWAYS, ...WITH_DOCUMENT, ...ON_A_PAGE];
const mine = () => allCommands().filter((c) => IDS.includes(c.id) && (c.when?.() ?? true));
const on = () => usePlugins.getState().enable("latex", CATALOG);

beforeEach(() => {
  usePlugins.setState({ enabled: [], loaded: {} });
  rememberDocs([]);
});
afterEach(() => {
  cleanup();
  setLatexBackend(null);
  usePlugins.setState({ enabled: [], loaded: {} });
});

describe("the catalogue entry", () => {
  it("is LaTeX, off until turned on, for the vault", () => {
    const entry = CATALOG.find((e) => e.manifest.id === "latex");
    expect(entry?.manifest).toBe(LATEX_MANIFEST);
    expect(LATEX_MANIFEST).toMatchObject({ id: "latex", name: "LaTeX", defaultOn: false, scope: "vault", icon: "sigma" });
    expect(LATEX_MANIFEST.summary.length).toBeGreaterThan(0);
  });

  it("starts nothing of the editor at start-up, or when the plugin is turned on", async () => {
    expect(loaded).toEqual({ editor: false, pdf: false });
    expect(await on()).toBe(true);
    // Contributions are in; the view (editor, PDF library) is still not fetched.
    expect(loaded).toEqual({ editor: false, pdf: false });
    expect(views().map((v) => v.id)).toEqual([LATEX_VIEW]);
  });

  it("fetches the editor only when a view is first drawn, and pdf.js only when a PDF is first opened", async () => {
    await on();
    const fake = fakeBackend();
    setLatexBackend(fake.backend);
    const View = views()[0]!.lazy;
    render(
      <Suspense fallback={<p>loading</p>}>
        <View place={{ view: LATEX_VIEW, path: "projects/p/latex/paper/main.tex" }} />
      </Suspense>,
    );
    // The first import transforms the editor's modules: slow on a loaded machine.
    await waitFor(() => expect(loaded.editor).toBe(true), { timeout: 25000 });
    await screen.findByRole("navigation", { name: "Files in this document" }, { timeout: 25000 });
    // No PDF was built or opened yet: the big library is still not fetched.
    expect(loaded.pdf).toBe(false);
    fake.send({ doc: "projects/p/latex/paper", seq: 1, state: "done", ms: 5, diagnostics: [], pdf: true });
    await waitFor(() => expect(loaded.pdf).toBe(true), { timeout: 25000 });
  }, 60000);
});

describe("with the plugin off", () => {
  it("adds nothing to the window's lists", () => {
    expect(mine()).toEqual([]);
    expect(newActions().some((a) => a.id === "latex")).toBe(false);
    expect(availableNav().some((n) => n.id === LATEX_VIEW)).toBe(false);
    expect([views(), sidebarRows(), settingsSections()].map((l) => l.length)).toEqual([0, 0, 0]);
    expect(fileHandlerFor("a/b/main.tex")).toBeUndefined();
    expect(openKind("a/b/main.tex")).toBe("page");
  });
});

describe("with the plugin on", () => {
  beforeEach(async () => {
    await on();
  });

  it("opens LaTeX file kinds in the view, and a .bib only inside a LaTeX folder", () => {
    for (const path of ["x/main.tex", "x/a.sty", "x/a.cls", "x/a.bst", "X/MAIN.TEX"]) expect(openKind(path)).toBe(LATEX_VIEW);
    expect(openKind("sources/references.bib")).not.toBe(LATEX_VIEW);
    rememberDocs(["projects/p/latex/paper"]);
    expect(openKind("projects/p/latex/paper/refs.bib")).toBe(LATEX_VIEW);
    expect(openKind("projects/p/latex/paper-two/refs.bib")).not.toBe(LATEX_VIEW);
    expect(openKind("notes/page.md")).toBe("page");
  });

  it("adds the palette's commands: always the two, the rest only while a document is on screen", () => {
    expect(mine().map((c) => c.id).sort()).toEqual([...ALWAYS].sort());
    const calls: string[] = [];
    const stop = registerActions({
      build: () => calls.push("build"),
      stop: () => calls.push("stop"),
      exportPdf: () => calls.push("export"),
      syncToPdf: () => calls.push("sync"),
      toggleAuto: () => calls.push("auto"),
      toggleFiles: () => calls.push("files"),
      fixWithAi: () => calls.push("fix"),
      inlineAi: () => calls.push("inline"),
      runAction: (slug) => calls.push(slug),
    });
    expect(mine().map((c) => c.id).sort()).toEqual([...ALWAYS, ...WITH_DOCUMENT].sort());
    for (const id of ["latex-build", "latex-stop", "latex-export", "latex-sync", "latex-auto", "latex-files", "latex-fix-ai", "latex-inline-ai", "latex-ai-refs", "latex-ai-table"]) allCommands().find((c) => c.id === id)!.run();
    expect(calls).toEqual(["build", "stop", "export", "sync", "auto", "files", "fix", "inline", "check-latex-refs", "table-to-booktabs"]);
    stop();
    expect(activeActions()).toBeNull();
    expect(mine().map((c) => c.id).sort()).toEqual([...ALWAYS].sort());
  });

  it("offers sending a page only while a page is open, and citing only while a document is", () => {
    const place = useWorkspace.getState().place;
    useWorkspace.setState({ place: { view: "page", path: "notes/a.md" } });
    expect(mine().map((c) => c.id)).toEqual(expect.arrayContaining(ON_A_PAGE));
    useWorkspace.setState({ place: { view: "home" } });
    expect(mine().map((c) => c.id)).not.toContain("latex-send-page");
    useWorkspace.setState({ place });
  });

  it("starts documents from the three templates, in the New menu", () => {
    const labels = newActions().filter((a) => a.id.startsWith("latex")).map((a) => a.label);
    expect(labels).toEqual(["New LaTeX document", "New LaTeX report", "New LaTeX slides"]);
  });

  it("puts Send to LaTeX in the page menu and over a selection", () => {
    expect(pageMenuItems().map((m) => ("label" in m ? m.label : ""))).toEqual(["Send to LaTeX", "Add to a LaTeX document…"]);
    expect(selectionTools().map((t) => t.label)).toEqual(["Send to LaTeX"]);
    expect(selectionTools()[0]!.icon).toContain("<svg");
  });

  it("is in the New menu, the sidebar and Settings, and names a tab by its document", () => {
    expect(newActions().find((a) => a.id === "latex")).toMatchObject({ label: "New LaTeX document", icon: "sigma" });
    expect(availableNav().some((n) => n.id === LATEX_VIEW)).toBe(true);
    expect(settingsSections().map((s) => s.title)).toContain("LaTeX");
    expect(tabFace({ view: LATEX_VIEW, path: "projects/p/latex/paper/main.tex" }, [])).toMatchObject({ title: "paper" });
  });

  it("takes everything away again when turned off", () => {
    usePlugins.getState().disable("latex");
    expect(mine()).toEqual([]);
    expect(fileHandlerFor("x/main.tex")).toBeUndefined();
    expect(sidebarRows()).toEqual([]);
  });
});
