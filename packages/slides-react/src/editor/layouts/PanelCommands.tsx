import type { JSX } from "react";

import { commandOf, isEnabled, runCommand } from "../commands/index.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { TextButton } from "../ui/Button.tsx";

interface PanelCommandsProps {
  session: EditorSession;
  ui: EditorUi;
  /** The commands, by id, one button each. */
  ids: readonly string[];
}

/** Buttons for commands in a side panel (a template saved or applied, a layout saved or managed): each runs its command and is off where the command cannot be done. */
export function PanelCommands({ session, ui, ids }: PanelCommandsProps): JSX.Element {
  const ctx = { session, ui };
  return (
    <div className="ks-sp-actions">
      {ids.map((id) => {
        const command = commandOf(id);
        return (
          <TextButton key={id} disabled={!isEnabled(command, ctx)} onClick={() => void runCommand(id, ctx)}>
            {command.label}
          </TextButton>
        );
      })}
    </div>
  );
}
