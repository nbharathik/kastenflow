// "Send to LaTeX": the open page, or the words selected in it, converted from
// Markdown by the app (kasten-core) and either made into a new document or
// added at the end of one the person picks. Both end in the document, open.

import { projectFolderOf } from "../../features/tags/model";
import { titleOf } from "../../features/workspace/names";
import { flushOpenPage } from "../../features/workspace/page/open-page";
import { useWorkspace } from "../../features/workspace/store";
import { noteAt } from "../../features/workspace/tree";
import { latexBackend, sentence } from "./backend";
import { refreshDocs } from "./docs-cache";
import { LATEX_VIEW } from "./manifest";
import { openPicker, type PickerItem } from "./picker";
import type { LatexTemplate, SendRequest, Sent } from "./types";

/** What was done, in a sentence; says so when parts were left as plain text. */
export function sentMessage(sent: Sent): string {
  const done = sent.appended ? `Added to “${sent.doc.title}”.` : `Made “${sent.doc.title}” from it.`;
  if (sent.todos === 0) return done;
  const left = sent.todos === 1 ? "One part was" : `${sent.todos} parts were`;
  return `${done} ${left} left as plain text: search the source for TODO.`;
}

/** The page open in the focused pane: its path and its title. */
export function openPage(): { path: string; title: string } | null {
  const { place, notes } = useWorkspace.getState();
  if (place.view !== "page" || !place.path) return null;
  const note = noteAt(notes, place.path);
  return note ? { path: place.path, title: titleOf(note) } : null;
}

/** Sends, then opens the document. A project that is not one is not a reason to fail: the library takes it. */
async function send(request: SendRequest): Promise<void> {
  const ws = useWorkspace.getState();
  const backend = latexBackend();
  if (!backend) {
    ws.toast("Sending to LaTeX needs the desktop app.");
    return;
  }
  try {
    if (request.page) await flushOpenPage();
    const sent = await backend.send(request).catch((err: unknown) => {
      if (!request.project) throw err;
      return backend.send({ ...request, project: undefined });
    });
    await refreshDocs();
    useWorkspace.getState().go({ view: LATEX_VIEW, path: sent.path });
    useWorkspace.getState().toast(sentMessage(sent));
  } catch (err) {
    ws.toast(`Could not send it to LaTeX: ${sentence(err)}`);
  }
}

/** The page as a new document (an article unless told otherwise). */
export async function sendPage(template: LatexTemplate = "article"): Promise<void> {
  const page = openPage();
  if (!page) return useWorkspace.getState().toast("Open a page first, then send it to LaTeX.");
  await send({ page: page.path, title: page.title, template, project: projectFolderOf(page.path) ?? undefined });
}

const documents = async (): Promise<PickerItem[]> => {
  const backend = latexBackend();
  const docs = backend ? await backend.docs() : [];
  return docs.map((d) => ({ id: d.mainPath, label: d.title, detail: d.folder }));
};

/** Asks which document the page goes to, and adds it there. */
export function addPageToDocument(): void {
  const page = openPage();
  if (!page) return useWorkspace.getState().toast("Open a page first, then add it to a LaTeX document.");
  openPicker({
    title: "Add this page to a LaTeX document",
    placeholder: "Find a document",
    load: documents,
    empty: { text: "There are no LaTeX documents yet.", action: { label: "Make one from this page", run: () => void sendPage() } },
    onPick: (item) => void send({ page: page.path, appendTo: item.id }),
  });
}

/** The selected Markdown, to a new document or to one picked from the list. */
export function sendSelection(markdown: string): void {
  const page = openPage();
  if (markdown.trim() === "") return useWorkspace.getState().toast("Select some text first, then send it to LaTeX.");
  const NEW = "";
  openPicker({
    title: "Send the selection to LaTeX",
    placeholder: "A new document, or find one",
    load: async () => [{ id: NEW, label: "A new document", detail: "article" }, ...(await documents())],
    empty: { text: "There are no LaTeX documents yet." },
    onPick: (item) =>
      void send(
        item.id === NEW
          ? { text: markdown, title: page?.title ?? "Selection", project: page ? (projectFolderOf(page.path) ?? undefined) : undefined }
          : { text: markdown, appendTo: item.id },
      ),
  });
}
