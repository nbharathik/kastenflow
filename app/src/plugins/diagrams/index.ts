// The diagrams plugin (draw.io): everything the shell used to wire by hand
// for diagrams, given to the registry as contributions. The editor is a
// separate download the app manages; the files, their pictures and their
// embeds work without it, so Trash, Review, Health, Chat, Boards, Slides and
// the Graph read diagram data whether this plugin is on or not.

import { lazy } from "react";

import { newDiagram } from "../../features/diagrams/actions";
import { titleOfPath } from "../../features/diagrams/names";
import type { Choice } from "../../features/pages/editor/menus/catalog";
import { useWorkspace } from "../../features/workspace/store";
import { FavouriteDiagrams, ProjectDiagrams } from "../../shell/DiagramRows";
import type { PluginContributions } from "../types";
import { DIAGRAMS_VIEW } from "./manifest";
import { DiagramsSection } from "./settings";

const WORDS = "draw drawio flowchart architecture sketch uml";

/** "/diagram": the page's menu of diagrams to show, and a new one. Ahead of the whiteboard, which also answers to "diagram" and "draw". */
const slash: Choice = {
  key: "diagram",
  label: "Diagram",
  icon: "icon:diagram",
  description: "Show a diagram in the page, or draw a new one.",
  keywords: ["diagram", "drawio", "flowchart", "flow", "chart", "architecture", "uml", "sketch", "draw"],
  section: "Advanced",
  before: "board",
  // The picker is part of the page editor's code: fetched when the choice is picked.
  action: { type: "plugin", run: (on) => on && void import("../../features/pages/editor/menus/diagram-pick").then((m) => m.startDiagramPick(on.view, on.ctx, on.from)) },
};

export const diagramsContributions: PluginContributions = {
  views: [
    {
      id: DIAGRAMS_VIEW,
      title: "Diagrams",
      icon: "diagram",
      lazy: lazy(() => import("./view")),
      face: (place) => (place.path ? { icon: "diagram", title: titleOfPath(place.path) } : null),
    },
  ],
  fileHandlers: [{ ext: [".drawio"], view: DIAGRAMS_VIEW }],
  commands: [
    { id: "diagrams", label: "Go to Diagrams", words: WORDS, run: () => useWorkspace.getState().go({ view: DIAGRAMS_VIEW }) },
    { id: "new-diagram", label: "New diagram", words: `${WORDS} create`, run: () => void newDiagram() },
  ],
  slash: [slash],
  newItems: [{ id: "diagram", label: "New diagram", icon: "diagram", words: "draw flowchart drawio", run: () => void newDiagram() }],
  sidebar: [{ id: DIAGRAMS_VIEW, label: "Diagrams", icon: "diagram", group: "think", after: "boards" }],
  tree: { owns: (path) => path.endsWith(".drawio"), ProjectRows: ProjectDiagrams, FavouriteRows: FavouriteDiagrams },
  settingsSection: { title: "Diagrams", render: DiagramsSection },
};
