// What a page's editor knows about diagrams, for `![[Flow.drawio]]` embeds
// and /diagram: the diagrams to pick from, making one in the page's project
// (its editor opens at once), drawing one's picture inside the page, and
// opening one. The picture is an ordinary image: nothing here needs the
// editor to be installed to show a diagram.

import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { ViewBoundary } from "../../../ui/ViewBoundary";
import { projectTitle } from "../../boards/store";
import { newDiagram } from "../../diagrams/actions";
import { useDiagrams } from "../../diagrams/store";
import { UpdatedBadge } from "../../health/UpdatedBadge";
import type { LinkProvider } from "../../pages/editor/links";
import { useWorkspace } from "../store";

type DiagramLinks = Required<Pick<LinkProvider, "diagrams" | "createDiagram" | "mountDiagram" | "openDiagram">>;

/** The picture's view loads when the first diagram is shown. */
const LazyDiagramEmbed = lazy(() => import("../../diagrams/DiagramEmbedView").then((m) => ({ default: m.DiagramEmbedView })));

export function diagramLinks(_client: VaultClient, page: () => NoteMeta | undefined): DiagramLinks {
  return {
    diagrams: () => {
      const notes = useWorkspace.getState().notes;
      return [...useDiagrams.getState().list]
        .filter((d) => !d.problem)
        .sort((a, b) => b.modified - a.modified)
        .map((d) => ({ path: d.path, title: d.title, hint: d.project ? projectTitle(notes, d.project) : undefined }));
    },
    createDiagram: async (title) => {
      const path = await newDiagram({ title, project: page()?.project ?? null, how: "tab" });
      // The embed is drawn from the list: it must hold the new diagram before the embed is placed.
      if (path) await useDiagrams.getState().load();
      return path;
    },
    mountDiagram: (host, path) => {
      const root = createRoot(host);
      root.render(
        <ViewBoundary place={path}>
          <Suspense fallback={<p className="px-3 py-6 text-center text-13 text-muted">Opening the diagram…</p>}>
            <LazyDiagramEmbed path={path} />
          </Suspense>
          <UpdatedBadge kind="diagram" path={path} />
        </ViewBoundary>,
      );
      return () => root.unmount();
    },
    openDiagram: (path, how) => useWorkspace.getState().openPath(path, how),
  };
}
