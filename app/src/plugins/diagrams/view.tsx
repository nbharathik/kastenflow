// The diagrams plugin's view: the Diagrams home, or the diagram open in a
// tab (the editor's frame loads with it). Loaded the first time one is opened.

import { DiagramsHome } from "../../features/diagrams/DiagramsHome";
import { DiagramView } from "../../features/diagrams/DiagramView";
import type { PluginViewProps } from "../types";

export default function DiagramsViewHost({ place }: PluginViewProps) {
  // Not keyed by path: after a conflict the editor goes on with a copy, and the tab follows it without reloading.
  return place.path ? <DiagramView path={place.path} /> : <DiagramsHome />;
}
