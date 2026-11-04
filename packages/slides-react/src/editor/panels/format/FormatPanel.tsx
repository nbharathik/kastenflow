import type { Element } from "@kasten-slides/wasm";
import { useRef } from "react";

import { useEditorValue } from "../../useEditor.ts";
import { ElementOptions } from "./ElementOptions.tsx";
import { SlideOptions } from "./SlideOptions.tsx";
import type { PanelProps } from "./types.ts";

/** Format options: for the slide when nothing is selected, else for what is. */
export function FormatPanel({ session, ui }: PanelProps) {
  // Only the selected elements and the theme are followed, so a change to a slide that is not shown, or to the notes, does not draw the panel.
  const last = useRef<Element[]>([]);
  const elements = useEditorValue(session, (state) => {
    const next = session.elements.find(state.selection);
    const same = next.length === last.current.length && next.every((element, i) => element === last.current[i]);
    if (same) return last.current;
    last.current = next;
    return next;
  });
  // The cells picked in a table: the table section and the fill section show them.
  useEditorValue(session, (state) => state.cells);
  const theme = useEditorValue(session, (state) => state.deck.theme);
  if (elements.length === 0) return <SlideOptions session={session} ui={ui} />;
  return <ElementOptions session={session} ui={ui} elements={elements} theme={theme} />;
}
