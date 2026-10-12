// The Insert sub-menus, shared by the menu bar and the toolbar's image, shape and line buttons.

import type { Route } from "@kasten-slides/wasm";

import type { CommandContext } from "../commands/index.ts";
import { INSERTABLE } from "../composite-kinds.ts";
import { INSERT_GROUPS, type InsertGroupId, insertItems } from "../insert/model.ts";
import { LINES, SHAPE_GROUPS } from "../shapes.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { type Row, commandItem, submenu } from "./build.ts";
import { LinePreview, ShapePreview } from "./previews.tsx";

/** From the computer, and from the gallery; and a diagram where the host has them (the standalone page has none). */
export const imageItems = (ctx: CommandContext): Row[] => [
  commandItem("insert.image", ctx),
  commandItem("insert.gallery", ctx),
  ...(ctx.session.host.pickDiagram ? [commandItem("insert.diagram", ctx)] : []),
];

/** The composites: code, a formula, a conversation, token probabilities, cards, a citation, a step label, a page, a video. */
export const compositeItems = (ctx: CommandContext): Row[] => INSERTABLE.map((spec) => commandItem(`insert.${spec.kind}`, ctx));

/** The id of the command that arms a shape tool. */
export const shapeCommand = (preset: string): string => `insert.shape.${preset}`;

/** The id of the command that arms a line tool: `line:elbow` is `insert.line.elbow`. */
export const lineCommand = (tool: string): string => `insert.${tool.replace(":", ".")}`;

/** One sub-menu per group of shapes (Shapes, Arrows, Callouts, Flowchart), each entry with its outline beside it. */
export function shapeGroupItems(ctx: CommandContext): Row[] {
  const tool = ctx.session.state.tool;
  return SHAPE_GROUPS.map((group) =>
    submenu(
      `shapes-${group.title}`,
      group.title,
      group.shapes.map((shape) => commandItem(shapeCommand(shape.preset), ctx, { checked: tool === `shape:${shape.preset}`, trailing: <ShapePreview preset={shape.preset} size={20} /> })),
    ),
  );
}

/** Lines, arrows and connectors, each drawn small beside its name. */
export function lineItems(ctx: CommandContext): Row[] {
  const tool = ctx.session.state.tool;
  return LINES.map((line) => {
    const [kind, route] = line.tool.split(":") as ["line" | "arrow", Route];
    return commandItem(lineCommand(line.tool), ctx, { checked: tool === line.tool, trailing: <LinePreview route={route} arrow={kind === "arrow"} /> });
  });
}

/** The second level of the Insert menu: what is in a group, each item with an icon, a line saying what it makes, and its keys. */
export function insertGroupRows(ctx: CommandContext, group: InsertGroupId): MenuItem[] {
  if (group === "shapes") {
    return [...shapeGroupItems(ctx), submenu("lines", "Lines & arrows", lineItems(ctx), "arrow-up-right")];
  }
  return insertItems(ctx, group).map((item) => {
    // The text box is armed by the menu (to be placed with a click) and added at once by its key.
    const checked = item.command === "insert.text-box" ? ctx.session.state.tool === "text" : undefined;
    return commandItem(item.command, ctx, { description: item.description, ...(checked === undefined ? {} : { checked }) });
  });
}

/** The first level of the Insert menu: the groups. */
export const insertGroupItems = (ctx: CommandContext): Row[] => INSERT_GROUPS.map((group) => submenu(`insert-${group.id}`, group.label, insertGroupRows(ctx, group.id), group.icon));
