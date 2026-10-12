import type { Rect } from "@kasten-slides/canvas";
import type { JSX } from "react";

import { alignHorizontalItems, alignVerticalItems, distributeItems, orderItems } from "../menus/items-arrange.ts";
import { SEPARATOR } from "../menus/build.ts";
import type { EditorSession } from "../session/session.ts";
import { selectedElements } from "../session/scope.ts";
import type { EditorUi } from "../ui-state.ts";
import { CommandButton, MenuButton } from "../toolbar/ToolButton.tsx";
import { useEditorValue } from "../useEditor.ts";

/** The room the bar takes above the selection, in pixels: its height and a gap. */
const ABOVE = 44;
/** How wide the bar is at most, for keeping it on the page. */
const REACH = 150;

interface SelectionBarProps {
  session: EditorSession;
  ui: EditorUi;
  /** The box round the selection, in slide units. */
  bounds: Rect;
  /** Pixels on screen per slide unit. */
  zoom: number;
  /** The width of the page in pixels. */
  width: number;
}

/**
 * What can be done to several things at once, where the eye is: a small bar over the selection with Group (and Ungroup when the
 * selection holds a group), Align and Order. It is the same commands as the Arrange menu and the right-click menu, so each
 * is one step of undo and has its keys. It is drawn over the page, never in the slide, so it is in no thumbnail and no export.
 */
export function SelectionBar({ session, ui, bounds, zoom, width }: SelectionBarProps): JSX.Element {
  const ctx = { session, ui };
  // Whether a group is among the selected is the one thing the bar reads of the deck.
  const hasGroup = useEditorValue(session, (state) => selectedElements(state).some((element) => element.type === "group"));
  const centre = (bounds.x + bounds.w / 2) * zoom;
  const left = Math.min(Math.max(centre, REACH), Math.max(width - REACH, REACH));
  const above = bounds.y * zoom - ABOVE;
  // At the top of the page the bar goes under the selection instead.
  const top = above >= 4 ? above : (bounds.y + bounds.h) * zoom + 8;
  return (
    <div className="ks-selbar" role="toolbar" aria-label="Arrange the selection" style={{ left, top }} data-selbar="">
      <CommandButton id="arrange.group" ctx={ctx} text="Group" />
      {hasGroup ? <CommandButton id="arrange.ungroup" ctx={ctx} text="Ungroup" /> : null}
      <MenuButton ui={ui} label="Align" icon="align-center-vertical" items={() => [...alignHorizontalItems(ctx), SEPARATOR, ...alignVerticalItems(ctx), SEPARATOR, ...distributeItems(ctx)]} />
      <MenuButton ui={ui} label="Order" icon="bring-to-front" items={() => orderItems(ctx)} />
    </div>
  );
}
