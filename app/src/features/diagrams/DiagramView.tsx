import { DIAGRAMS_VIEW } from "../../plugins/diagrams/manifest";
import { useWorkspace } from "../workspace/store";
import { DiagramEditor } from "./DiagramEditor";

/** A diagram in a tab: the editor fills the pane. After a conflict the editor goes on with a copy, and the tab follows it. */
export function DiagramView({ path }: { path: string }) {
  return <DiagramEditor path={path} onMoved={(copy) => useWorkspace.getState().go({ view: DIAGRAMS_VIEW, path: copy }, "here")} />;
}
