// Diagrams through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/diagrams.rs).

import { invoke } from "@tauri-apps/api/core";

import type { DiagramFile, DiagramInfo, DiagramMoved, DiagramOps, DiagramSaved } from "./diagram-types";

export const tauriDiagrams: DiagramOps = {
  diagrams: () => invoke<DiagramInfo[]>("list_diagrams"),
  diagram: (path) => invoke<DiagramFile>("read_diagram", { path }),
  diagramPreview: (path) => invoke<string | null>("read_diagram_preview", { path }),
  // The command says why it cannot draw; the window only needs to know it did not.
  diagramDraftSvg: (xml) => invoke<string>("diagram_draft_svg", { xml }).catch(() => null),
  createDiagram: (title, project, xml) => invoke<string>("create_diagram", { title, project, xml: xml ?? null }),
  // The bytes go as the request's body; header values are ASCII, hence the escaping.
  importDiagram: (name, bytes, project) =>
    invoke<string>("import_diagram", bytes, { headers: { "x-name": encodeURIComponent(name), ...(project ? { "x-project": encodeURIComponent(project) } : {}) } }),
  saveDiagram: (path, xml, svg, baseHash) => invoke<DiagramSaved>("save_diagram", { path, xml, svg, baseHash }),
  saveDiagramPreview: (path, svg, sourceHash) => invoke<DiagramFile>("save_diagram_preview", { path, svg, sourceHash }),
  renameDiagram: (path, title) => invoke<DiagramMoved>("rename_diagram", { path, title }),
  moveDiagram: (path, project) => invoke<DiagramMoved>("move_diagram", { path, project }),
  duplicateDiagram: (path) => invoke<string>("duplicate_diagram", { path }),
  restoreDiagram: (trashed) => invoke<string>("restore_diagram", { trashed }),
};
