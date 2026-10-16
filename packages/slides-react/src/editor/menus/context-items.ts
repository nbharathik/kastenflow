// What a right click offers: on an element, on the empty slide, on a slide in the filmstrip, on the cells of a table, on the empty room of the
// filmstrip and on a side panel.

import { copyHere } from "../clipboard/commands.ts";
import { ungroupable } from "../commands/composites.ts";
import { type CommandContext, commandOf } from "../commands/index.ts";
import { selectedDiagram } from "../diagrams.ts";
import { updatable } from "../../pages/insert.ts";
import { pageOfElement } from "../../pages/open.ts";
import type { ContextMenuState } from "../ui-state.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { SEPARATOR, commandItem, groups, plainItem, submenu } from "./build.ts";
import { alignHorizontalItems, alignVerticalItems, distributeItems, orderItems, rotateItems } from "./items-arrange.ts";
import { cellsItems, filmstripItems, panelItems } from "./items-cells.ts";
import { moveSlideItems } from "./items-slide.ts";

/** What the menu offers for an assistant's work: accept the selected elements that are marked, and all of it when any of the deck is. */
function acceptItems(ctx: CommandContext): MenuItem[] {
  const { session } = ctx;
  const selected = session.marks.selected.length;
  return [
    ...(selected > 0 ? [commandItem("agent.accept", ctx, { label: selected === 1 ? "Accept" : `Accept ${selected} elements` })] : []),
    ...(session.marks.pending > selected ? [commandItem("agent.accept-all", ctx)] : []),
  ];
}

function elementItems(ctx: CommandContext): MenuItem[] {
  const { session, ui } = ctx;
  const picked = session.elements.find();
  const only = picked.length === 1 ? picked[0] : undefined;
  const hasGroup = picked.some((element) => element.type === "group");
  const locked = commandOf("arrange.lock").checked?.(session.state, ui.state) === true;
  const group = only?.type === "group" ? only : undefined;
  return groups(
    acceptItems(ctx),
    // A menu on an element is about the elements, wherever the focus was before it opened.
    [
      commandItem("edit.cut", ctx, { run: () => void copyHere(ctx, true, "elements") }),
      commandItem("edit.copy", ctx, { run: () => void copyHere(ctx, false, "elements") }),
      commandItem("edit.paste", ctx),
      commandItem("edit.paste-in-place", ctx),
      commandItem("edit.duplicate", ctx, { run: () => session.elements.duplicate() }),
      commandItem("edit.delete", ctx, { run: () => session.elements.remove() }),
    ],
    [
      submenu("order", "Order", orderItems(ctx), "bring-to-front"),
      // Several things align to each other; one aligns to the slide.
      submenu(
        "align",
        picked.length > 1 ? "Align" : "Align to slide",
        [...alignHorizontalItems(ctx), SEPARATOR, ...alignVerticalItems(ctx), ...(picked.length > 1 ? [SEPARATOR, ...distributeItems(ctx, false)] : [])],
        "align-center-vertical",
      ),
      submenu("rotate", "Rotate & flip", rotateItems(ctx), "rotate-cw"),
      ...(picked.length > 1 || !hasGroup ? [commandItem("arrange.group", ctx)] : []),
      ...(hasGroup ? [commandItem("arrange.ungroup", ctx)] : []),
      // A group is gone into to work on what it holds, as a double click does; Exit group comes back out.
      ...(group ? [plainItem("enter-group", "Edit group", () => session.enterGroup(group.id, group.children[0]?.id), { icon: "group" })] : []),
      ...(session.state.inside.length > 0 ? [plainItem("exit-group", "Exit group", () => session.leaveGroup(), { icon: "ungroup" })] : []),
      ...(picked.some(ungroupable) ? [commandItem("arrange.ungroup-composite", ctx)] : []),
      commandItem("arrange.lock", ctx, { label: locked ? "Unlock" : "Lock", icon: locked ? "lock-open" : "lock", checked: null }),
    ],
    [
      // A picture that came from a diagram is edited in the host's diagram editor.
      ...(session.host.editDiagram && selectedDiagram(session.state) ? [commandItem("edit.diagram", ctx)] : []),
      // Something made from a page of the host: open the page, make it again from the page as it is now, or cut the tie.
      ...(picked.some((element) => pageOfElement(element) !== null) ? [commandItem("page.open", ctx)] : []),
      ...(picked.some(updatable) ? [commandItem("page.update", ctx)] : []),
      ...(picked.some((element) => element.source != null) ? [commandItem("page.break-link", ctx)] : []),
      // A web page: show it live beside the slide.
      ...(commandOf("embed.preview-live").enabled?.(session.state, ui.state, session.host, ctx) ? [commandItem("embed.preview-live", ctx)] : []),
      commandItem("view.format-panel", ctx, { label: "Format options", checked: null, run: () => ui.openPanel("format") }),
      ...(only && (only.type === "text" || only.type === "shape") ? [plainItem("edit-text", "Edit text", () => session.startEditing(only.id), { icon: "text-cursor-input" })] : []),
      commandItem("text.link", ctx, { label: "Link…" }),
    ],
  );
}

const canvasItems = (ctx: CommandContext): MenuItem[] =>
  groups(
    acceptItems(ctx),
    [commandItem("edit.paste", ctx), commandItem("edit.paste-in-place", ctx), commandItem("edit.select-all", ctx)],
    ctx.session.state.inside.length > 0 ? [plainItem("exit-group", "Exit group", () => ctx.session.leaveGroup(), { icon: "ungroup" })] : [],
    [commandItem("slide.layout", ctx), commandItem("slide.background", ctx)],
    [commandItem("slide.save-as-layout", ctx), commandItem("slide.reset-layout", ctx)],
    [commandItem("view.notes", ctx), commandItem("view.snap", ctx)],
  );

const slideItems = (ctx: CommandContext): MenuItem[] =>
  groups(
    ctx.session.marks.pending > 0 ? [commandItem("agent.accept-all", ctx)] : [],
    // A menu on a slide is about the slides: cut, copy and paste put them after the ones picked, in this deck or another.
    [
      commandItem("edit.cut", ctx, { run: () => void copyHere(ctx, true, "slides") }),
      commandItem("edit.copy", ctx, { run: () => void copyHere(ctx, false, "slides") }),
      commandItem("edit.paste", ctx),
    ],
    [commandItem("slide.new", ctx), commandItem("slide.duplicate", ctx), commandItem("slide.delete", ctx)],
    [commandItem("edit.select-all", ctx, { label: "Select all slides" })],
    [commandItem("slide.skip", ctx), commandItem("slide.backup", ctx)],
    [submenu("move", "Move slide", moveSlideItems(ctx), "arrow-up"), commandItem("slide.layout", ctx), commandItem("slide.background", ctx)],
    [commandItem("slide.save-as-layout", ctx), commandItem("slide.reset-layout", ctx)],
    [commandItem("slide.add-section", ctx), commandItem("slide.rename-section", ctx), commandItem("slide.remove-section", ctx)],
  );

/** The rows of the context menu for `kind`. */
export function contextItems(kind: ContextMenuState["kind"], ctx: CommandContext): MenuItem[] {
  switch (kind) {
    case "element":
      return elementItems(ctx);
    case "canvas":
      return canvasItems(ctx);
    case "cells":
      return cellsItems(ctx);
    case "filmstrip":
      return filmstripItems(ctx);
    case "panel":
      return panelItems(ctx);
    default:
      return slideItems(ctx);
  }
}
