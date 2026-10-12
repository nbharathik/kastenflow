import type { JSX } from "react";

import { NewSlideMenu } from "../layouts/NewSlideMenu.tsx";
import { useDropdown } from "../menus/useDropdown.ts";
import { addSlide } from "../new-slide.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * "New slide" under the slides, with a small arrow beside it that picks the layout of the slide to add. The button makes what the
 * person asked New slide to make (a blank slide unless they chose otherwise); the arrow opens every layout of the deck as a live
 * thumbnail, the ones the person made beside the built-in ones, and that choice (see `layouts/NewSlideMenu`).
 */
export function NewSlideButton({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const dd = useDropdown("dialog");
  return (
    <div className="ks-fs-adder">
      <button type="button" className="ks-btn ks-fs-add" aria-label="New slide" onMouseDown={(event) => event.preventDefault()} onClick={() => void addSlide(session, ui)}>
        <Icon name="plus" size={16} />
        <span>New slide</span>
      </button>
      <button type="button" className="ks-btn ks-fs-add-more" aria-label="Choose a layout for the new slide" onMouseDown={(event) => event.preventDefault()} {...dd.trigger}>
        <Icon name="chevron-down" size={14} />
      </button>
      {dd.anchor ? <NewSlideMenu session={session} ui={ui} anchor={dd.anchor} keyboard={dd.keyboard} onClose={dd.close} /> : null}
    </div>
  );
}
