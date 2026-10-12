import type { JSX } from "react";

import { MenuButton } from "../toolbar/ToolButton.tsx";
import type { TextView } from "../toolbar/useTextView.ts";
import type { EditorUi } from "../ui-state.ts";
import { bulletRows, caseRows, fitRows, lineAndParagraphRows, scriptRows } from "./items.ts";

interface Props {
  view: TextView;
  ui: EditorUi;
}

/** "Do not autofit", "Shrink text on overflow", "Resize shape to fit text", and whether lines wrap: how a box fits its words. */
export function FitButton({ view, ui }: Props): JSX.Element {
  return <MenuButton ui={ui} label="Text fitting" icon="type" disabled={!view.can} items={() => fitRows(view.ctx)} />;
}

/** lowercase, UPPERCASE, Title Case and Sentence case, for the selected words or the word at the caret. */
export function CaseButton({ view, ui }: Props): JSX.Element {
  return <MenuButton ui={ui} label="Change case" text="Aa" disabled={!view.can} items={() => caseRows(view.ctx)} />;
}

/** Superscript, subscript, small capitals and capitals. */
export function ScriptButton({ view, ui }: Props): JSX.Element {
  return <MenuButton ui={ui} label="More text formatting" icon="baseline" disabled={!view.can} items={() => scriptRows(view.ctx)} />;
}

/** The same rows as a menu, for a host that prefers a list to the card of `BulletsButton` and `SpacingButton`. */
export function BulletsMenuButton({ view, ui }: Props): JSX.Element {
  return <MenuButton ui={ui} label="Bullets and numbering styles" icon="list" disabled={!view.can} items={() => bulletRows(view.ctx)} />;
}

export function SpacingMenuButton({ view, ui }: Props): JSX.Element {
  return <MenuButton ui={ui} label="Line and paragraph spacing" icon="list-chevrons-up-down" disabled={!view.can} items={() => lineAndParagraphRows(view.ctx)} />;
}
