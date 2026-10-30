// The selection sources the app has itself, read from the document: the page
// editor, the PDF reader and a slide's open text box. Each answers only when
// the selection sits in its own editor in the focused pane; a tab kept ready
// out of sight (display none) is skipped (shell/visible-dom.ts).

import { inFocusedPane } from "../../../lib/keys";
import { isShown } from "../../../shell/visible-dom";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { activePath, activePlace } from "../open-pages";
import { registerSelectionSource, type SelectionSnapshot } from "./sources";

const elementOf = (node: Node | null): Element | null => (node instanceof Element ? node : (node?.parentElement ?? null));

/** The element matching `selector` that holds the start of the selection, when it is shown. */
function holder(selection: Selection, selector: string): HTMLElement | null {
  const found = elementOf(selection.anchorNode)?.closest<HTMLElement>(selector) ?? null;
  return found && isShown(found) ? found : null;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") || path;

/** The heading above the selection in a page: the nearest earlier block that is one. */
function headingAbove(from: Element, editor: Element): string | undefined {
  const root = editor.querySelector(".ProseMirror");
  let block: Element | null = from;
  while (block && block.parentElement !== root) block = block.parentElement;
  for (let b = block; b; b = b.previousElementSibling) {
    if (/^H[1-6]$/.test(b.tagName)) return b.textContent?.trim() || undefined;
  }
  return undefined;
}

function pageSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const editor = holder(selection, ".kasten-page-editor");
  // Only the page in the focused pane, or the only pane: the path is the active tab's.
  if (!editor || !editor.closest(".kasten-pane") || !inFocusedPane(editor)) return null;
  const path = activePath();
  if (!path) return null;
  const note = noteAt(useWorkspace.getState().notes, path);
  const heading = headingAbove(elementOf(selection.anchorNode) ?? editor, editor);
  return { source: { kind: "page", path }, text: selection.toString(), ...(heading ? { heading } : {}), title: note ? titleOf(note) : baseName(path) };
}

function pdfSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const page = holder(selection, ".kasten-reader .kasten-pdf-page");
  const place = activePlace();
  if (!page || place?.view !== "highlights" || !place.path) return null;
  return { source: { kind: "pdf", path: place.path, id: page.dataset.page }, text: selection.toString(), title: baseName(place.path) };
}

function slideSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const box = holder(selection, ".ks-text-layer[data-editing]");
  const place = activePlace();
  if (!box || place?.view !== "slides" || !place.path) return null;
  // The stage the box is on says which slide it is (the Slides editor sets `data-slide-number`, counting from 1).
  const number = Number(box.closest<HTMLElement>("[data-slide-number]")?.dataset.slideNumber);
  const where = Number.isInteger(number) && number > 0 ? number : null;
  const deck = baseName(place.path);
  return {
    source: { kind: "slide", path: place.path, id: box.dataset.editing },
    text: selection.toString(),
    ...(where ? { heading: `Slide ${where}` } : {}),
    title: where ? `${deck}, slide ${where}` : deck,
  };
}

let registered = false;

/** Registers the page, PDF and slide sources once. */
export function registerBuiltinSources(): void {
  if (registered) return;
  registered = true;
  registerSelectionSource("page", pageSelection);
  registerSelectionSource("pdf", pdfSelection);
  registerSelectionSource("slide", slideSelection);
}
