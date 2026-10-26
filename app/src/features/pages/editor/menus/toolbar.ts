// Notion's selection toolbar on top of Crepe's: "Ask AI" first, then bold,
// italic, underline and strikethrough, code and link, then colour ("A")
// and Turn into. Crepe's
// inline-math button is dropped: Kasten's own maths replaces it.

import type { ToolbarFeatureConfig } from "@milkdown/crepe/feature/toolbar";
import { editorViewCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

import { selectionTools } from "../../../../plugins/contributions";
import { openAi } from "../ai/ai";
import { applyColor } from "../blocks/color";
import { closesWith } from "../ui/close-with-editor";
import { Popover } from "../ui/popover";
import { colorSections, openBlockMenu } from "./block-menu";
import { currentBlock } from "./block-nav";
import { blocksOfSelection } from "./block-range";
import { selectionMarkdown } from "./selection-markdown";

const COLOR_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 16 12 5l4.5 11M9.2 12h5.6"/><path d="M5.5 20h13" stroke-width="2.4"/></svg>';

const UNDERLINE_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7.5 5v6.5a4.5 4.5 0 0 0 9 0V5"/><path d="M6 20h12"/></svg>';

const TURN_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h10M5 12h7M5 17h10"/><path d="m16.5 11 2 2 2-2"/></svg>';

const AI_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4M22 4h-4"/></svg>';

// A line icon (a lightbulb), drawn with its own fill so the toolbar's filled-icon style leaves it open.
const EXPLAIN_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/></svg>';

const CHAT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>';

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = (keys: string) => (mac ? keys.replace("Ctrl+", "⌘").replace("Shift+", "⇧") : keys);

let menu: Popover | null = null;

function hasColor(ctx: Ctx): boolean {
  const { state } = ctx.get(editorViewCtx);
  const { marks } = ctx.get(schemaCtx);
  const { from, to } = state.selection;
  return [marks.text_color, marks.bg_color].some((type) => type !== undefined && state.doc.rangeHasMark(from, to, type));
}

function openColorMenu(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const button = view.dom.parentElement?.querySelector<HTMLElement>('[data-toolbar-item="kasten-color"]');
  menu?.close();
  menu = closesWith(
    view,
    new Popover(
      colorSections((mark, color) => {
        const type = ctx.get(schemaCtx).marks[mark];
        if (type) view.dispatch(applyColor(view.state, type, color));
      }),
      { anchor: () => (button ?? view.dom).getBoundingClientRect(), ownKeys: true, label: "Colour" },
    ),
  );
}

function markActive(ctx: Ctx, name: string): boolean {
  const { state } = ctx.get(editorViewCtx);
  const type = ctx.get(schemaCtx).marks[name];
  const { from, to, empty } = state.selection;
  return !!type && !empty && state.doc.rangeHasMark(from, to, type);
}

/** Turn into for the selection: every block it runs over, not just the first. */
function openTurnInto(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const block = currentBlock(view.state);
  const spanned = blocksOfSelection(view.state);
  const button = view.dom.parentElement?.querySelector<HTMLElement>('[data-toolbar-item="kasten-turn"]');
  if (!block) return;
  menu?.close();
  menu = openBlockMenu(view, spanned?.from ?? block.pos, () => (button ?? view.dom).getBoundingClientRect(), spanned && spanned.count > 1 ? spanned : undefined);
}

/** Reshapes Crepe's toolbar into Notion's. */
export const buildToolbar: NonNullable<ToolbarFeatureConfig["buildToolbar"]> = (builder) => {
  const formatting = builder.getGroup("formatting").group.items;
  const italic = formatting.findIndex((item) => item.key === "italic");
  formatting.splice(italic + 1, 0, {
    key: "underline",
    icon: UNDERLINE_ICON,
    label: "Underline",
    shortcut: shortcut("Ctrl+U"),
    active: (ctx) => markActive(ctx, "underline"),
    onRun: (ctx) => {
      const view = ctx.get(editorViewCtx);
      const type = ctx.get(schemaCtx).marks.underline;
      if (!type) return;
      const { from, to } = view.state.selection;
      const tr = view.state.doc.rangeHasMark(from, to, type) ? view.state.tr.removeMark(from, to, type) : view.state.tr.addMark(from, to, type.create());
      view.dispatch(tr);
    },
  });
  const functions = builder.getGroup("function").group.items;
  const latex = functions.findIndex((item) => item.key === "latex");
  if (latex >= 0) functions.splice(latex, 1);

  builder
    .addGroup("kasten-ai", "AI")
    .addItem("kasten-ai", { icon: AI_ICON, label: "Ask AI", active: () => false, onRun: (ctx) => void openAi(ctx.get(editorViewCtx), "ask") })
    .addItem("kasten-explain", { icon: EXPLAIN_ICON, label: "Explain", active: () => false, onRun: (ctx: Ctx) => void openAi(ctx.get(editorViewCtx), "explain") });
  // "Ask AI" leads, as in Notion; build() hands back the builder's own list.
  const groups = builder.build();
  groups.unshift(groups.pop()!);

  builder
    .addGroup("kasten", "Colour")
    .addItem("kasten-color", { icon: COLOR_ICON, label: "Colour", shortcut: shortcut("Ctrl+Shift+H"), active: hasColor, onRun: openColorMenu })
    .addItem("kasten-turn", { icon: TURN_ICON, label: "Turn into", shortcut: shortcut("Ctrl+/"), active: () => false, onRun: openTurnInto })
    // Keeps the selection with the chat (loaded on demand: the chat is not part of the editor).
    .addItem("kasten-to-chat", { icon: CHAT_ICON, label: "Add to chat", shortcut: shortcut("Ctrl+Alt+L"), active: () => false, onRun: () => void import("../../../chat/selection/add").then((m) => m.addSelectionToChat()) });
  // What plugins that are on add over a selection (Send to LaTeX).
  const kasten = builder.getGroup("kasten");
  for (const tool of selectionTools()) {
    kasten.addItem(`kasten-plugin-${tool.id}`, { icon: tool.icon, label: tool.label, active: () => false, onRun: (ctx: Ctx) => tool.run(selectionMarkdown(ctx)) });
  }
};
