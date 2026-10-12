import type { JSX } from "react";

import { selectedDiagram } from "../diagrams.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { Group } from "./Group.tsx";
import { CommandButton } from "./ToolButton.tsx";

/** Whether the selection is one picture of a diagram that the host can edit. */
export const hasDiagramTools = (session: EditorSession): boolean => session.host.editDiagram !== undefined && selectedDiagram(session.state) !== undefined;

/** Edit diagram: for a selected picture that came from a diagram, and only where the host has diagrams. */
export function DiagramTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  useEditorValue(session, (state) => state.selection);
  useEditorValue(session, () => session.slide);
  if (!hasDiagramTools(session)) return null;
  return (
    <Group id="diagram">
      <CommandButton id="edit.diagram" ctx={{ session, ui }} text="Edit diagram" />
    </Group>
  );
}
