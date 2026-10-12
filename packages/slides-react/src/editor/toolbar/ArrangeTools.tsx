import type { JSX } from "react";

import { useUiValue } from "../chrome/useUiValue.ts";
import { groups } from "../menus/build.ts";
import { alignHorizontalItems, alignVerticalItems, orderItems } from "../menus/items-arrange.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Group } from "./Group.tsx";
import { CommandButton, MenuButton } from "./ToolButton.tsx";

/** What can be done with whatever is selected, whatever it is: its place among the others, how it lines up, and how it comes in. */
export function ArrangeTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const ctx = { session, ui };
  const animating = useUiValue(ui, (state) => state.panel === "steps");
  return (
    <Group id="arrange">
      <MenuButton ui={ui} label="Order" icon="bring-to-front" items={() => orderItems(ctx)} />
      <MenuButton ui={ui} label="Align objects" icon="align-center-vertical" items={() => groups(alignHorizontalItems(ctx), alignVerticalItems(ctx))} />
      <CommandButton id="view.steps-panel" ctx={ctx} label="Animate" icon="film" text="Animate" on={animating} />
    </Group>
  );
}
