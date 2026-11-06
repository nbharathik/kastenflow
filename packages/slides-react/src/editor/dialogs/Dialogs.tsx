import type { JSX } from "react";

import { lazyPart } from "../lazy.tsx";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useUiState } from "../useUi.ts";
import type { DialogSwitchProps } from "./DialogSwitch.tsx";

/** Every dialog is in one file that is loaded when the first is opened, or when the editor is idle after opening. */
const Switch = lazyPart<DialogSwitchProps>(() => import("./DialogSwitch.tsx").then((module) => module.DialogSwitch));

/** Loads the dialogs now, so that none of them waits on the network or the disk when it is asked for. */
export const preloadDialogs = Switch.preload;

/** The dialog that is open, if any. */
export function Dialogs({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  const { dialog } = useUiState(ui);
  if (!dialog) return null;
  return <Switch.Part session={session} ui={ui} dialog={dialog} />;
}
