import { openElementPage, pageOfElement } from "../../pages/open.ts";
import { breakLink, updatable, updateFromPages } from "../../pages/insert.ts";
import { selectedElements } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import type { Command } from "./types.ts";

const said = (session: EditorSession, message: string): void => session.host.notify?.(message);

/** What "Update from page" told the person. */
export function reportUpdate(session: EditorSession, done: { updated: number; missing: number; same: number }): void {
  const parts: string[] = [];
  if (done.updated > 0) parts.push(done.updated === 1 ? "Updated from the page." : `Updated ${done.updated} from their pages.`);
  if (done.missing > 0) parts.push(done.missing === 1 ? "A page could not be found." : `${done.missing} pages could not be found.`);
  if (parts.length === 0) parts.push(done.same > 0 ? "Already up to date." : "Nothing here came from a page.");
  said(session, parts.join(" "));
}

/** Pages of the host: Insert → Page…, bringing what was made from one up to date, and cutting the tie. Each needs a host that has pages. */
export const pageCommands: Command[] = [
  {
    id: "insert.page",
    label: "Page…",
    icon: "file-text",
    enabled: (_state, _ui, host) => host.pickPage !== undefined && host.readPage !== undefined,
    run: ({ ui }) => ui.openDialog("insert-page"),
  },
  {
    id: "page.update",
    label: "Update from page",
    icon: "refresh-cw",
    enabled: (state, _ui, host) => host.readPage !== undefined && selectedElements(state).some(updatable),
    run: async ({ session }) => reportUpdate(session, await updateFromPages(session, session.state.selection)),
  },
  {
    id: "page.update-all",
    label: "Update all from their pages",
    icon: "refresh-cw",
    enabled: (_state, _ui, host) => host.readPage !== undefined,
    run: async ({ session }) => reportUpdate(session, await updateFromPages(session)),
  },
  {
    id: "page.break-link",
    label: "Break link to page",
    icon: "unlink",
    enabled: (state) => selectedElements(state).some((element) => element.source != null),
    run: async ({ session }) => {
      for (const id of session.state.selection) {
        const [element] = session.elements.find([id]);
        if (element?.source) await breakLink(session, id);
      }
    },
  },
  {
    id: "page.open",
    label: "Open the page",
    icon: "external-link",
    enabled: (state, _ui, host) => host.openPage !== undefined && selectedElements(state).some((element) => pageOfElement(element) !== null),
    run: ({ session }) => {
      const element = selectedElements(session.state).find((e) => pageOfElement(e) !== null);
      if (element) openElementPage(session.host, element);
    },
  },
];
