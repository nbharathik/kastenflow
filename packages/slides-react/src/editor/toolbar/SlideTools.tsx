import type { JSX } from "react";

import { useUiValue } from "../chrome/useUiValue.ts";
import { SEPARATOR, commandItem } from "../menus/build.ts";
import { layoutItems } from "../menus/items-layout.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { Group } from "./Group.tsx";
import { CommandButton, MenuButton } from "./ToolButton.tsx";

/**
 * The slide's own settings, in the row when nothing is selected: its background, its layout (a list of them), the theme and the
 * transition, which each open the panel for them beside the slide.
 */
export function SlideTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  // The layout of the slide shown is all the list follows (it is built when it opens).
  useEditorValue(session, (state) => state.deck.slides.find((slide) => slide.id === state.slideId)?.layout ?? "");
  useEditorValue(session, (state) => state.deck.theme);
  const themes = useUiValue(ui, (state) => state.panel === "themes");
  const motion = useUiValue(ui, (state) => state.panel === "transitions");
  const ctx = { session, ui };
  // The layout designer draws a layout, not a slide of the deck: it has its background and nothing else of the slide's own.
  if (ui.designing) {
    return (
      <Group id="slide">
        <CommandButton id="slide.background" ctx={ctx} label="Background" icon="image" text="Background" />
      </Group>
    );
  }
  return (
    <Group id="slide">
      <CommandButton id="slide.background" ctx={ctx} label="Background" icon="image" text="Background" />
      {/* The deck's own layouts: the list has them first, with their thumbnails; saving one, changing the one in use and managing them are at its end. */}
      <MenuButton
        ui={ui}
        label="Layout"
        icon="layout-template"
        text="Layout"
        items={() => [
          ...layoutItems(ctx),
          SEPARATOR,
          commandItem("slide.layout", ctx),
          commandItem("slide.save-as-layout", ctx),
          commandItem("layout.edit", ctx),
          commandItem("slide.reset-layout", ctx),
          commandItem("layout.manage", ctx),
        ]}
      />
      <CommandButton id="view.themes-panel" ctx={ctx} label="Theme" icon="palette" text="Theme" on={themes} />
      <CommandButton id="view.motion-panel" ctx={ctx} label="Transition" icon="film" text="Transition" on={motion} />
    </Group>
  );
}
