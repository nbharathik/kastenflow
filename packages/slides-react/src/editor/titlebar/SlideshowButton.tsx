import { type JSX, useMemo } from "react";

import { MATTES, readMatte, writeMatte } from "../../present/matte.ts";
import { keysOf, runCommand } from "../commands/index.ts";
import { commandItem, groups, plainItem, submenu } from "../menus/build.ts";
import { DropMenu } from "../menus/DropMenu.tsx";
import { useDropdown } from "../menus/useDropdown.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * Slideshow: the button that presents from the slide shown, and a caret beside it with the other ways to start: from the beginning, in
 * the presenter's view, as a page to scroll. It is the one filled button of the bar.
 */
export function SlideshowButton({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const dd = useDropdown();
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const can = ui.actions.present !== undefined;
  return (
    <div className="ks-present">
      <button
        type="button"
        className="ks-btn ks-text-btn is-primary ks-present-main"
        aria-label="Slideshow"
        disabled={!can}
        data-tip={can ? `Slideshow from this slide (${keysOf("view.present") ?? "Ctrl+Enter"})` : "Presenting is not available here"}
        onClick={() => void runCommand("view.present", ctx)}
      >
        <Icon name="play" size={14} />
        Slideshow
      </button>
      <button type="button" className="ks-btn ks-text-btn is-primary ks-present-caret" aria-label="Slideshow options" data-tip="Slideshow options" disabled={!can} {...dd.trigger}>
        <Icon name="chevron-down" size={14} />
      </button>
      <DropMenu
        dd={dd}
        ui={ui}
        label="Slideshow options"
        items={() => {
          const matte = readMatte();
          return groups(
            [
              commandItem("view.present-start", ctx, { label: "Present from beginning" }),
              commandItem("view.present", ctx, { label: "Present from current slide" }),
              commandItem("view.presenter", ctx),
              commandItem("view.present-scroll", ctx),
            ],
            [
              // A slide is shown whole and centred at its own proportions, never cropped or scrolled; the matte is what shows round it on a screen of another shape.
              plainItem("fit", "Fit slide to window", () => {}, { checked: true, disabled: true }),
              submenu(
                "matte",
                "Colour round the slide",
                MATTES.map((choice) => plainItem(`matte-${choice.value}`, choice.label, () => writeMatte(choice.value), { checked: choice.value === matte })),
                "palette",
              ),
            ],
          );
        }}
      />
    </div>
  );
}
