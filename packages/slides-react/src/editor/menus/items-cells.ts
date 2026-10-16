// The context menus that are not about a block or a slide: the cells of a table, the empty room of the filmstrip, and a side panel.

import { copyHere, pasteSlidesHere } from "../clipboard/commands.ts";
import type { CommandContext } from "../commands/index.ts";
import { colsIn, rowsIn } from "../table/cells.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { commandItem, groups, plainItem } from "./build.ts";

const many = (count: number, one: string, other: (count: number) => string): string => (count === 1 ? one : other(count));

/** What a right click on the cells of a table offers: the clipboard, rows and columns for as many as are picked, merging, the table. */
export function cellsItems(ctx: CommandContext): MenuItem[] {
  const picked = ctx.session.tables.picked();
  const rows = picked ? rowsIn(picked.range) : 1;
  const columns = picked ? colsIn(picked.range) : 1;
  return groups(
    [
      commandItem("edit.cut", ctx, { run: () => void copyHere(ctx, true, "cells") }),
      commandItem("edit.copy", ctx, { run: () => void copyHere(ctx, false, "cells") }),
      commandItem("edit.paste", ctx),
      commandItem("table.clear-cells", ctx, { label: "Clear" }),
    ],
    [
      commandItem("table.insert-row-above", ctx, { label: many(rows, "Insert row above", (n) => `Insert ${n} rows above`) }),
      commandItem("table.insert-row-below", ctx, { label: many(rows, "Insert row below", (n) => `Insert ${n} rows below`) }),
      commandItem("table.insert-column-left", ctx, { label: many(columns, "Insert column left", (n) => `Insert ${n} columns left`) }),
      commandItem("table.insert-column-right", ctx, { label: many(columns, "Insert column right", (n) => `Insert ${n} columns right`) }),
    ],
    [
      commandItem("table.delete-rows", ctx, { label: many(rows, "Delete row", (n) => `Delete ${n} rows`) }),
      commandItem("table.delete-columns", ctx, { label: many(columns, "Delete column", (n) => `Delete ${n} columns`) }),
    ],
    [commandItem("table.merge-cells", ctx), commandItem("table.unmerge-cells", ctx)],
    [commandItem("view.format-panel", ctx, { label: "Format options", checked: null, run: () => ctx.ui.openPanel("format") })],
    [commandItem("table.select", ctx), commandItem("table.delete", ctx)],
  );
}

/** The Table menu of the Format menu: the same things for the cells picked, without the counts, in groups. */
export function tableItems(ctx: CommandContext): MenuItem[] {
  return groups(
    ["table.insert-row-above", "table.insert-row-below", "table.insert-column-left", "table.insert-column-right"].map((id) => commandItem(id, ctx)),
    ["table.delete-rows", "table.delete-columns"].map((id) => commandItem(id, ctx)),
    [commandItem("table.merge-cells", ctx), commandItem("table.unmerge-cells", ctx)],
    [commandItem("table.clear-cells", ctx), commandItem("table.select-cells", ctx), commandItem("table.select", ctx), commandItem("table.delete", ctx)],
  );
}

/** What a right click on the empty room of the filmstrip offers: a new slide, the slides copied, a new section. */
export function filmstripItems(ctx: CommandContext): MenuItem[] {
  return groups([
    commandItem("slide.new", ctx),
    // The menu is about the slides: it pastes slides, wherever the focus was.
    commandItem("edit.paste", ctx, { run: () => void pasteSlidesHere(ctx) }),
    commandItem("slide.add-section", ctx),
  ]);
}

/** What a right click on a side panel's tab offers: close it, or open another in its place. */
export function panelItems(ctx: CommandContext): MenuItem[] {
  return groups(
    [plainItem("close-panel", "Close panel", () => ctx.ui.openPanel(null), { icon: "x" })],
    ["view.format-panel", "view.themes-panel", "view.motion-panel", "view.steps-panel", "view.ai-panel"].map((id) => commandItem(id, ctx)),
  );
}
