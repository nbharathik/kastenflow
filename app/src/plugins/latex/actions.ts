// What the palette can do to the LaTeX document on screen: the open view
// registers its actions while it is shown, and the commands ask for them. When
// no LaTeX view is open the commands do not apply.

import { projectFolderOf } from "../../features/tags/model";
import { useWorkspace } from "../../features/workspace/store";
import { latexBackend, sentence } from "./backend";
import { refreshDocs } from "./docs-cache";
import { LATEX_VIEW } from "./manifest";
import type { LatexTemplate } from "./types";

export interface ViewActions {
  build(): void;
  stop(): void;
  exportPdf(): void;
  syncToPdf(): void;
  toggleAuto(): void;
  toggleFiles(): void;
  /** Puts the keyboard on the outline's first heading (or its "Add a section" button). */
  focusOutline?(): void;
  /** Puts the keyboard on the build's first problem. */
  focusProblems?(): void;
  /** Opens the list of references and writes the chosen one's `\cite` at the caret. */
  insertCitation?(): void;
  /** Starts a chat that fixes the errors of the last build in the open file. */
  fixWithAi?(): void;
}

let active: ViewActions | null = null;

/** Makes `actions` the ones the palette runs; answers how to withdraw them. */
export function registerActions(actions: ViewActions): () => void {
  active = actions;
  return () => {
    if (active === actions) active = null;
  };
}

export const activeActions = (): ViewActions | null => active;

const UNTITLED: Record<LatexTemplate, string> = { article: "Untitled document", report: "Untitled report", beamer: "Untitled slides" };

/** Starts a document from a template (an article unless told otherwise) and opens it: in the project the person is in, else in the library. */
export async function newDocument(template: LatexTemplate = "article"): Promise<void> {
  const say = useWorkspace.getState().toast;
  const backend = latexBackend();
  if (!backend) {
    say("LaTeX documents need the desktop app.");
    return;
  }
  try {
    const project = projectFolderOf(useWorkspace.getState().place.path) ?? undefined;
    // A folder under projects/ that is not a project (no project page) is not a place for it: the library is.
    const doc = await backend.create(UNTITLED[template], project, template).catch((err: unknown) => {
      if (project === undefined) throw err;
      return backend.create(UNTITLED[template], undefined, template);
    });
    await refreshDocs();
    useWorkspace.getState().go({ view: LATEX_VIEW, path: doc.mainPath });
  } catch (err) {
    say(`The document could not be made: ${sentence(err)}`);
  }
}
