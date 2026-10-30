// The LaTeX plugin: a source editor with a live PDF preview, given to the
// registry as contributions. Its code is a separate chunk, loaded when the
// plugin is turned on; the view, with the editor and the PDF library, is a
// further chunk loaded when a document is first opened. The files and the
// builds are the app's (src-tauri/src/plugins/latex); this is the window.
//
// Left for the parts that follow: `editor/extensions.ts` takes completion,
// lint and the outline, `diagnostics.ts` holds what the build said, and
// `PreviewHandle.controller()` gives clicks in the PDF.

import { createElement, lazy } from "react";

import { useWorkspace } from "../../features/workspace/store";
import type { Command } from "../../features/workspace/overlays/commands";
import { Icon } from "../../ui/Icon";
import type { PluginContributions } from "../types";
import { activeActions, newDocument, type ViewActions } from "./actions";
import { inLatexFolder, refreshDocs } from "./docs-cache";
import { LATEX_VIEW } from "./manifest";
import { LatexSection } from "./settings";

const WORDS = "tex latex paper pdf typeset math thesis";

/** A palette command that acts on the document on screen, and applies only while one is. */
function onDocument(id: string, label: string, words: string, act: (actions: ViewActions) => void): Command {
  return {
    id,
    label,
    words: `${WORDS} ${words}`,
    when: () => activeActions() !== null,
    run: () => {
      const actions = activeActions();
      if (actions) act(actions);
    },
  };
}

// Sending a page or a selection draws a list over the window: that code is loaded when first used.
const sending = () => import("./send");
const onPage = (): boolean => {
  const { place } = useWorkspace.getState();
  return place.view === "page" && !!place.path;
};
const SIGMA =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/></svg>';

/** The folder's name, for a tab: the document is its folder. */
const titleOf = (path: string): string => {
  const parts = path.split("/");
  return parts.length > 1 ? parts[parts.length - 2]! : (parts[0] ?? "LaTeX");
};

void refreshDocs();

export const latexContributions: PluginContributions = {
  views: [
    {
      id: LATEX_VIEW,
      title: "LaTeX",
      icon: "sigma",
      lazy: lazy(() => import("./view")),
      face: (place) => (place.path ? { icon: "sigma", title: titleOf(place.path) } : null),
    },
  ],
  // The LaTeX file kinds always open here; a .bib only inside a LaTeX folder (the vault's own reference list is not one).
  fileHandlers: [
    { ext: [".tex", ".sty", ".cls", ".bst"], view: LATEX_VIEW },
    { ext: [".bib"], view: LATEX_VIEW, when: inLatexFolder },
  ],
  commands: [
    { id: "latex", label: "Go to LaTeX documents", words: WORDS, run: () => useWorkspace.getState().go({ view: LATEX_VIEW }) },
    { id: "new-latex", label: "New LaTeX document", words: `${WORDS} create article`, run: () => void newDocument() },
    { id: "new-latex-report", label: "New LaTeX report", words: `${WORDS} create chapters thesis`, run: () => void newDocument("report") },
    { id: "new-latex-slides", label: "New LaTeX slides", words: `${WORDS} create beamer presentation talk`, run: () => void newDocument("beamer") },
    { id: "latex-send-page", label: "Send this page to LaTeX", words: `${WORDS} convert export markdown`, when: onPage, run: () => void sending().then((m) => m.sendPage()) },
    { id: "latex-add-page", label: "Add this page to a LaTeX document", words: `${WORDS} convert append markdown`, when: onPage, run: () => void sending().then((m) => m.addPageToDocument()) },
    onDocument("latex-cite", "LaTeX: insert a citation", "reference references bibliography bibtex cite", (a) => a.insertCitation?.()),
    onDocument("latex-build", "LaTeX: build", "compile run", (a) => a.build()),
    onDocument("latex-stop", "LaTeX: stop the build", "cancel", (a) => a.stop()),
    onDocument("latex-export", "LaTeX: export the PDF", "save keep", (a) => a.exportPdf()),
    onDocument("latex-sync", "LaTeX: show this line in the PDF", "sync synctex jump", (a) => a.syncToPdf()),
    onDocument("latex-auto", "LaTeX: turn auto-build on or off", "live automatic", (a) => a.toggleAuto()),
    onDocument("latex-files", "LaTeX: show or hide the files", "tree sidebar", (a) => a.toggleFiles()),
    onDocument("latex-outline", "LaTeX: go to the outline", "headings sections contents", (a) => a.focusOutline?.()),
    onDocument("latex-problems", "LaTeX: go to the build's problems", "errors warnings log", (a) => a.focusProblems?.()),
    onDocument("latex-fix-ai", "LaTeX: fix the problems with AI", "assistant chat repair mistakes compile errors warnings", (a) => a.fixWithAi?.()),
    onDocument("latex-inline-ai", "LaTeX: ask AI at the cursor", "assistant inline write rewrite equation table cmd k", (a) => a.inlineAi?.()),
    onDocument("latex-ai-refs", "LaTeX: check references and labels with AI", "assistant ref label cite undefined", (a) => a.runAction?.("check-latex-refs")),
    onDocument("latex-ai-citations", "LaTeX: find missing citations with AI", "assistant cite references bibliography", (a) => a.runAction?.("find-missing-citations")),
    onDocument("latex-ai-boxes", "LaTeX: fix overfull boxes with AI", "assistant margin overflow hbox", (a) => a.runAction?.("fix-overfull-boxes")),
    onDocument("latex-ai-draft", "LaTeX: draft a section from a page with AI", "assistant write section page notes", (a) => a.runAction?.("draft-latex-section")),
    onDocument("latex-ai-table", "LaTeX: turn a page table into booktabs with AI", "assistant tabular table markdown", (a) => a.runAction?.("table-to-booktabs")),
  ],
  newItems: [
    { id: "latex", label: "New LaTeX document", icon: "sigma", words: "tex paper pdf typeset article", run: () => void newDocument() },
    { id: "latex-report", label: "New LaTeX report", icon: "sigma", words: "tex thesis chapters pdf typeset", run: () => void newDocument("report") },
    { id: "latex-slides", label: "New LaTeX slides", icon: "sigma", words: "tex beamer presentation talk pdf", run: () => void newDocument("beamer") },
  ],
  // They land in "Present & export" of the page's menu.
  pageMenu: [
    { label: "Send to LaTeX", icon: createElement(Icon, { name: "sigma", className: "size-4" }), onSelect: () => void sending().then((m) => m.sendPage()) },
    { label: "Add to a LaTeX document…", icon: createElement(Icon, { name: "sigma", className: "size-4" }), onSelect: () => void sending().then((m) => m.addPageToDocument()) },
  ],
  selectionTools: [{ id: "latex", label: "Send to LaTeX", icon: SIGMA, run: (markdown) => void sending().then((m) => m.sendSelection(markdown)) }],
  sidebar: [{ id: LATEX_VIEW, label: "LaTeX", icon: "sigma", group: "think", after: "plugin:diagrams" }],
  settingsSection: { title: "LaTeX", render: LatexSection },
};
