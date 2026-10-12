import { chooseDiagram, editDiagram, selectedDiagram } from "../diagrams.ts";
import type { Command } from "./types.ts";

/** Diagrams: put one on the slide, and edit the one a picture came from. Both need a host that has diagrams. */
export const diagramCommands: Command[] = [
  {
    id: "insert.diagram",
    label: "Diagram…",
    icon: "shapes",
    enabled: (_state, _ui, host) => host.pickDiagram !== undefined,
    run: ({ session }) => chooseDiagram(session),
  },
  {
    id: "edit.diagram",
    label: "Edit diagram",
    icon: "pen-line",
    enabled: (state, _ui, host) => host.editDiagram !== undefined && selectedDiagram(state) !== undefined,
    run: ({ session }) => editDiagram(session),
  },
];
