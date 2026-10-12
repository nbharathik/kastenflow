// What the text controls of the toolbar need to know: how the words in hand
// look now (the open text box's selection, else the selected boxes), whether
// there are any, and what the text style gives words that set nothing of their own.

import { useEffect, useMemo, useState } from "react";

import { type CommandContext, textFormat } from "../commands/index.ts";
import { type BaseLook, baseLookOf, shownFormat } from "../menus/format-view.ts";
import type { EditorSession } from "../session/session.ts";
import type { FormatState } from "../session/text-commands.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";

export interface TextView {
  ctx: CommandContext;
  format: FormatState;
  /** Whether there is any text to format. */
  can: boolean;
  base: BaseLook;
}

/**
 * Subscribes to the session and the window state, and, while a text box is
 * open, to the caret: moving it or typing changes what the controls show, and
 * the text editor does not announce that to anyone but its own host.
 */
export function useTextView(session: EditorSession, ui: EditorUi): TextView {
  // What the controls show comes from the selection, the box being edited, the slide's elements and the theme's styles; a save, the
  // history or the slide list changing is no reason to draw them again.
  useEditorValue(session, (state) => state.selection);
  useEditorValue(session, (state) => state.editing);
  useEditorValue(session, () => session.slide);
  useEditorValue(session, (state) => state.deck.theme);
  const open = useUiState(ui).text !== null;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => tick((n) => n + 1));
    };
    document.addEventListener("selectionchange", later);
    document.addEventListener("keyup", later, true);
    document.addEventListener("pointerup", later, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", later);
      document.removeEventListener("keyup", later, true);
      document.removeEventListener("pointerup", later, true);
    };
  }, [open]);

  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const base = baseLookOf(session);
  return { ctx, format: shownFormat(ctx, base), can: textFormat.canFormat(ctx), base };
}
