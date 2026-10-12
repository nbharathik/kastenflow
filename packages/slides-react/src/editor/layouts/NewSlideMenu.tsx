import type { JSX } from "react";

import { keepsEditorFocus } from "../menus/useDropdown.ts";
import { addSlide } from "../new-slide.ts";
import type { EditorSession } from "../session/session.ts";
import { useImageUrl } from "../filmstrip/SlideThumb.tsx";
import type { EditorUi, NewSlides } from "../ui-state.ts";
import { Popover, type Anchor } from "../ui/Popover.tsx";
import { useEditor } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { markedDefault } from "./default-layout.ts";
import { LayoutPicker } from "./LayoutPicker.tsx";
import "./layouts.css";

interface NewSlideMenuProps {
  session: EditorSession;
  ui: EditorUi;
  anchor: Anchor;
  /** The keyboard opened it (so the editor's text box is not holding the focus). */
  keyboard: boolean;
  onClose(): void;
}

/** What New slide can start from, and what each choice says. */
const STARTS: { value: NewSlides; label: string; title: string }[] = [
  { value: "blank", label: "Blank", title: "A new slide starts blank" },
  { value: "same", label: "Same as current", title: "A new slide starts on the layout of the slide shown" },
  { value: "mine", label: "My default", title: "A new slide starts on the layout you made the default" },
];

/**
 * What the arrow beside New slide opens: every layout of the deck as a live thumbnail (the ones you made beside the built-in ones),
 * what the New slide button itself makes, and the ways to make a layout of your own.
 */
export function NewSlideMenu({ session, ui, anchor, keyboard, onClose }: NewSlideMenuProps): JSX.Element {
  const { deck } = useEditor(session);
  const { newSlides } = useUiState(ui);
  const imageUrl = useImageUrl(session);
  const marked = markedDefault(deck);
  const open = (dialog: "layout-save" | "layouts-manage") => {
    onClose();
    ui.openDialog(dialog);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="ks-lp-pop" label="New slide layouts" keepFocus={keepsEditorFocus(ui, keyboard)}>
      <h3 className="ks-lp-heading">New slide with layout</h3>
      <LayoutPicker
        deck={deck}
        imageUrl={imageUrl}
        columns={3}
        onPick={(name) => {
          onClose();
          addSlide(session, ui, { layout: name });
        }}
      />
      <div className="ks-lp-foot">
        <div className="ks-lp-starts" role="radiogroup" aria-label="New slides start">
          <span className="ks-lp-starts-label">New slides start</span>
          {STARTS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={newSlides === choice.value}
              title={choice.title}
              className={`ks-btn ks-lp-start${newSlides === choice.value ? " is-on" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => ui.setNewSlides(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {newSlides === "mine" ? <p className="ks-lp-note">{marked ? `My default is “${deck.theme.layouts.find((layout) => layout.name === marked)?.label ?? marked}”.` : "No layout is marked as the default yet, so new slides start blank. Mark one in Manage layouts."}</p> : null}
        <div className="ks-lp-links">
          <button type="button" className="ks-btn ks-lp-link" onMouseDown={(event) => event.preventDefault()} onClick={() => open("layout-save")}>
            Save slide as layout…
          </button>
          <button type="button" className="ks-btn ks-lp-link" onMouseDown={(event) => event.preventDefault()} onClick={() => open("layouts-manage")}>
            Manage layouts…
          </button>
        </div>
      </div>
    </Popover>
  );
}
