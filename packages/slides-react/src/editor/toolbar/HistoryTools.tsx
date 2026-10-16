import type { JSX } from "react";

import { runCommand } from "../commands/index.ts";
import { historyLabel } from "../menus/history-label.ts";
import { zoomItems, zoomText } from "../menus/items-view.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { Group } from "./Group.tsx";
import { CommandButton, MenuButton, ToolButton } from "./ToolButton.tsx";

/** Undo and redo, which say what they would undo, and the paint format brush. */
export function HistoryTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  // Only what the buttons show: the two labels, whether each can be done, and whether anything is selected.
  const undoLabel = useEditorValue(session, (state) => state.undoLabel);
  const redoLabel = useEditorValue(session, (state) => state.redoLabel);
  useEditorValue(session, (state) => state.canUndo);
  useEditorValue(session, (state) => state.canRedo);
  const selected = useEditorValue(session, (state) => state.selection.length > 0);
  const { paint, text } = useUiState(ui);
  const ctx = { session, ui };
  // The brush copies the look of what is selected or being typed in; it can always be put down again.
  const canTake = paint !== null || text !== null || selected;
  return (
    <Group id="history">
      <CommandButton id="edit.undo" ctx={ctx} label={historyLabel("Undo", undoLabel)} />
      <CommandButton id="edit.redo" ctx={ctx} label={historyLabel("Redo", redoLabel)} />
      <ToolButton icon="paintbrush" label="Paint format" className="ks-tb-paint" on={paint !== null} disabled={!canTake} onClick={() => void runCommand("format.paint", ctx)} />
    </Group>
  );
}

/** The zoom of the slide: what it is now, and the levels to pick. */
export function ZoomTool({ ui, session }: { ui: EditorUi; session: EditorSession }): JSX.Element {
  const { zoom } = useUiState(ui);
  const ctx = { session, ui };
  return (
    <Group id="zoom">
      <MenuButton ui={ui} label="Zoom" className="ks-tb-zoom" text={zoomText(zoom)} items={() => zoomItems(ctx)} />
    </Group>
  );
}
