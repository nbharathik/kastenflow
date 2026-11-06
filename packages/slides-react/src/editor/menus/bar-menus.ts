// The nine menus of the menu bar, File to Help. Each is built when it is
// opened, from the command list and the sub-menus in the items-* modules.

import { chromeOf } from "../chrome/chrome.ts";
import { type CommandContext, textFormat } from "../commands/index.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { SEPARATOR, commandItem, groups, submenu } from "./build.ts";
import { historyLabel } from "./history-label.ts";
import { alignHorizontalItems, alignVerticalItems, distributeItems, orderItems, rotateItems } from "./items-arrange.ts";
import { tableItems } from "./items-cells.ts";
import { insertGroupItems } from "./items-insert.tsx";
import { layoutItems } from "./items-layout.ts";
import { moveSlideItems, newSlidesItems, stepItems } from "./items-slide.ts";
import { textFormatRows } from "../text-ui/items.ts";
import { alignItems, indentItems, markItems } from "./items-text.ts";
import { viewModeItems, zoomItems } from "./items-view.ts";

export interface BarMenu {
  id: string;
  label: string;
  /** The rows, built from the state as it is now. */
  items(): MenuItem[];
}

const EXPORTS = ["pptx", "pdf", "png", "markdown", "html"];

function fileItems(ctx: CommandContext): MenuItem[] {
  const { exportAs, print, home } = ctx.ui.actions;
  return groups(
    home ? [commandItem("view.home", ctx)] : [],
    [commandItem("slide.new", ctx), commandItem("slide.duplicate", ctx)],
    [submenu("import", "Import", [commandItem("file.import-pptx", ctx), commandItem("file.import-markdown", ctx)], "file-plus")],
    [commandItem("file.page-setup", ctx)],
    // The deck's look as a template of your own, and a template put on this deck (both need a host that keeps templates).
    [commandItem("deck.save-template", ctx), commandItem("deck.apply-template", ctx)],
    // The saved versions of the deck (needs a host that keeps them).
    [commandItem("deck.history", ctx)],
    [submenu("download", "Download", EXPORTS.map((format) => commandItem(`file.export-${format}`, ctx, { disabledIf: !exportAs })), "download")],
    [commandItem("file.print", ctx, { disabledIf: !print })],
  );
}

/** Copy, cut and paste act on the words when a text box is open, and otherwise on the slides of the filmstrip or the grid, or the elements of the slide. */
function clipboardItems(ctx: CommandContext): MenuItem[] {
  const text = ctx.ui.state.text;
  if (!text) return ["edit.cut", "edit.copy", "edit.paste", "edit.paste-in-place"].map((id) => commandItem(id, ctx));
  const word = (kind: "cut" | "copy") => () => void document.execCommand(kind);
  return [
    commandItem("edit.cut", ctx, { run: word("cut") }),
    commandItem("edit.copy", ctx, { run: word("copy") }),
    commandItem("edit.paste", ctx, { run: () => void navigator.clipboard?.readText().then((words) => words && text.insertText(words), () => {}) }),
  ];
}

function editItems(ctx: CommandContext): MenuItem[] {
  const { undoLabel, redoLabel } = ctx.session.state;
  const text = ctx.ui.state.text;
  return groups(
    [commandItem("edit.undo", ctx, { label: historyLabel("Undo", undoLabel) }), commandItem("edit.redo", ctx, { label: historyLabel("Redo", redoLabel) })],
    clipboardItems(ctx),
    [
      commandItem("edit.duplicate", ctx, { disabledIf: text !== null }),
      commandItem("edit.delete", ctx, { disabledIf: text !== null }),
      commandItem("edit.select-all", ctx),
    ],
    [commandItem("edit.find", ctx), commandItem("view.history-panel", ctx)],
  );
}

function viewItems(ctx: CommandContext): MenuItem[] {
  const { present } = ctx.ui.actions;
  return groups(
    [submenu("zoom", "Zoom", zoomItems(ctx), "zoom-in"), submenu("views", "Views", viewModeItems(ctx), "presentation"), submenu("new-slides", "New slides", newSlidesItems(ctx), "plus")],
    [
      ...["view.notes", "view.filmstrip", "view.snap", "lint.badges"].map((id) => commandItem(id, ctx)),
      ...["view.rulers", "view.grid-lines", "view.guides"].map((id) => commandItem(id, ctx)),
      commandItem("view.density", ctx, { checked: chromeOf(ctx.ui).state.density === "compact" }),
    ],
    ["view.format-panel", "view.themes-panel", "view.motion-panel", "view.steps-panel", "view.comments-panel", "view.access-panel", "view.ideas-panel", "view.history-panel", "view.ai-panel"].map((id) => commandItem(id, ctx)),
    [commandItem("view.full-screen", ctx)],
    [commandItem("view.present", ctx, { disabledIf: !present }), commandItem("view.present-start", ctx, { disabledIf: !present })],
    [commandItem("view.presenter", ctx, { disabledIf: !present }), commandItem("view.rehearse", ctx, { disabledIf: !present }), commandItem("view.present-scroll", ctx, { disabledIf: !present })],
  );
}

/** Two levels: the groups of things to insert, each opening onto its items; then the gallery that finds any of them, and a new slide. */
function insertItems(ctx: CommandContext): MenuItem[] {
  return groups(insertGroupItems(ctx), [commandItem("insert.palette", ctx), commandItem("slide.new", ctx)]);
}

function formatItems(ctx: CommandContext): MenuItem[] {
  const disabledIf = !textFormat.canFormat(ctx);
  return groups(
    [submenu("text", "Text", markItems(ctx), "type"), submenu("align", "Align & indent", [...alignItems(ctx), SEPARATOR, ...indentItems(ctx)], "text-align-start")],
    // Bullets and numbering, line and paragraph spacing, text fitting, raised and lowered words, case and what is corrected as one types.
    textFormatRows(ctx),
    [commandItem("text.highlight", ctx, { disabledIf }), commandItem("text.highlight-none", ctx, { disabledIf })],
    // The looks of one thing laid on another: the brush that waits for the next click, or the two keys that hold a format and lay it.
    [commandItem("format.paint", ctx, { checked: null }), commandItem("text.paint-copy", ctx), commandItem("text.paint-paste", ctx)],
    // The cells picked in a table.
    [submenu("table", "Table", tableItems(ctx), "table")],
    [commandItem("text.clear", ctx, { disabledIf }), commandItem("text.link", ctx, { disabledIf })],
  );
}

function slideItems(ctx: CommandContext): MenuItem[] {
  return groups(
    [commandItem("slide.new", ctx), commandItem("slide.duplicate", ctx), commandItem("slide.delete", ctx)],
    [commandItem("slide.skip", ctx), commandItem("slide.backup", ctx), submenu("move", "Move slide", moveSlideItems(ctx), "arrow-up")],
    [submenu("steps", "Steps", stepItems(ctx), "list")],
    // The layouts: one picked from the list, or from the dialog; saving this slide as one, editing the one in use, putting the slide's
    // slots back and managing the deck's own.
    [
      submenu("apply-layout", "Apply layout", layoutItems(ctx), "layout-template"),
      commandItem("slide.layout", ctx),
      commandItem("slide.save-as-layout", ctx),
      commandItem("layout.edit", ctx),
      commandItem("slide.reset-layout", ctx),
      commandItem("layout.manage", ctx),
      commandItem("layout.import", ctx),
    ],
    ["slide.background", "slide.master", "slide.header-footer", "slide.transition", "view.themes-panel", "view.ideas-panel", "slide.theme"].map((id) => commandItem(id, ctx)),
  );
}

function arrangeItems(ctx: CommandContext): MenuItem[] {
  return groups(
    [
      submenu("order", "Order", orderItems(ctx), "bring-to-front"),
      submenu("align-h", "Align horizontally", alignHorizontalItems(ctx), "align-center-vertical"),
      submenu("align-v", "Align vertically", alignVerticalItems(ctx), "align-center-horizontal"),
      submenu("distribute", "Distribute", distributeItems(ctx), "align-horizontal-distribute-center"),
      submenu("rotate", "Rotate", rotateItems(ctx), "rotate-cw"),
    ],
    ["arrange.group", "arrange.ungroup", "arrange.ungroup-composite", "arrange.lock"].map((id) => commandItem(id, ctx)),
  );
}

/** Help from the assistant (where the host has one) and the brand kit (where the host keeps one): their own group at the end of Tools. */
function aiAndBrandItems(ctx: CommandContext): MenuItem[] {
  const { ai, brand } = ctx.session.host;
  const tasks = ["ai.rewrite", "ai.shorten", "ai.bullets", "ai.grammar", "ai.layout", "ai.notes", "ai.build", "ai.check"];
  return [...(ai ? [submenu("write-with-ai", "Write with AI", tasks.map((id) => commandItem(id, ctx)), "sparkles")] : []), ...(brand ? [commandItem("deck.brand-kit", ctx)] : [])];
}

/** The menus in the order of the bar. */
export function barMenus(ctx: CommandContext): BarMenu[] {
  return [
    { id: "file", label: "File", items: () => fileItems(ctx) },
    { id: "edit", label: "Edit", items: () => editItems(ctx) },
    { id: "view", label: "View", items: () => viewItems(ctx) },
    { id: "insert", label: "Insert", items: () => insertItems(ctx) },
    { id: "format", label: "Format", items: () => formatItems(ctx) },
    { id: "slide", label: "Slide", items: () => slideItems(ctx) },
    { id: "arrange", label: "Arrange", items: () => arrangeItems(ctx) },
    { id: "tools", label: "Tools", items: () => groups([commandItem("edit.find", ctx), commandItem("deck.spelling", ctx), commandItem("deck.fonts", ctx), commandItem("lint.open", ctx), commandItem("view.access-panel", ctx), commandItem("agent.accept-all", ctx)], ctx.session.host.readPage ? [commandItem("page.update-all", ctx), commandItem("page.review-sources", ctx)] : [], aiAndBrandItems(ctx)) },
    { id: "help", label: "Help", items: () => [commandItem("view.palette", ctx), commandItem("view.menu-search", ctx), commandItem("help.shortcuts", ctx)] },
  ];
}
