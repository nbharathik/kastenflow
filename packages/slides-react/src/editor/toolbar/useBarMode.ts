// What the toolbar shows follows what is selected: with nothing selected it offers what can be added to the slide and the slide's own
// settings; with something selected it swaps to the controls for that thing, and leaves out the ones that do not apply (hidden, not greyed).

import { useUiValue } from "../chrome/useUiValue.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { hasDiagramTools } from "./DiagramTools.tsx";
import { hasShapeTools } from "./ShapeTools.tsx";

export interface BarMode {
  /** Something is selected, or a text box is open. */
  selected: boolean;
  /** There are words to format: a text box is open, or a selected box holds text. */
  text: boolean;
  /** There is a shape, line, text box or picture to give a fill or a border. */
  shape: boolean;
  /** A picture of a diagram the host can edit is selected. */
  diagram: boolean;
}

/** Whether a selected element can hold words. */
const holdsText = (type: string): boolean => type === "text" || type === "shape";

export function useBarMode(session: EditorSession, ui: EditorUi): BarMode {
  const open = useUiValue(ui, (state) => state.text !== null);
  const picked = useEditorValue(session, (state) => state.selection.length > 0);
  const words = useEditorValue(session, () => session.elements.find().some((element) => holdsText(element.type)));
  const shape = useEditorValue(session, () => hasShapeTools(session));
  const diagram = useEditorValue(session, () => hasDiagramTools(session));
  return { selected: picked || open, text: open || words, shape, diagram };
}
