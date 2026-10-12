import type { JSX } from "react";

import { useUiValue } from "../chrome/useUiValue.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { CommandButton } from "./ToolButton.tsx";

/** At the right edge of the row, whatever its width: the button that opens the format options beside the slide. */
export function PanelTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const open = useUiValue(ui, (state) => state.panel === "format");
  return <CommandButton id="view.format-panel" ctx={{ session, ui }} on={open} />;
}
