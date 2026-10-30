// The highlight colours and a comment, as items of the editor's selection
// toolbar, so selected words on a page kept from the web get one bar, not two.
// The items are in every editor's toolbar but show only on a page kept from the
// web (annotations.css); a click goes to the page that holds the toolbar.

import "../sources/colors.css";
import "../sources/reader/reader-marks.css";
import "./annotations.css";

import type { ToolbarFeatureConfig } from "@milkdown/crepe/feature/toolbar";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { TextSelection } from "@milkdown/kit/prose/state";

import { HIGHLIGHT_COLORS, COLOR_NAMES } from "../sources/colors";
import { keepColor, lastColor } from "../sources/reader/SelectionBar";
import type { Words } from "./anchor";
import { openCommentPop } from "./comment-pop";
import { highlighterAt, type Highlighter } from "./highlight-registry";

type Group = ReturnType<Parameters<NonNullable<ToolbarFeatureConfig["buildToolbar"]>>[0]["addGroup"]>;

const COMMENT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 9.5h8M8 12.5h5"/></svg>';

const swatch = (color: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" style="fill:var(--swatch-${color});stroke:none"/></svg>`;

/** Collapses the selection to its end: the words are kept, and the bar goes. */
function dismiss(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { doc, selection, tr } = view.state;
  view.dispatch(tr.setSelection(TextSelection.create(doc, selection.to)));
}

function run(ctx: Ctx, pick: (page: Highlighter, words: Words) => void): void {
  const view = ctx.get(editorViewCtx);
  const page = highlighterAt(view.dom);
  const words = page?.words();
  if (page && words) pick(page, words);
}

/** Adds the five colours and Comment to a toolbar group. */
export function addHighlightItems(group: Group): Group {
  HIGHLIGHT_COLORS.forEach((color, i) => {
    group.addItem(`kasten-hl-${color}`, {
      icon: swatch(color),
      label: `Highlight ${COLOR_NAMES[color].toLowerCase()}`,
      shortcut: String(i + 1),
      active: () => false,
      onRun: (ctx: Ctx) =>
        run(ctx, (page, words) => {
          keepColor(color);
          void page.add(words, color);
          dismiss(ctx);
        }),
    });
  });
  return group.addItem("kasten-hl-comment", {
    icon: COMMENT_ICON,
    label: "Highlight with a comment",
    active: () => false,
    onRun: (ctx: Ctx) =>
      run(ctx, (page, words) => {
        const view = ctx.get(editorViewCtx);
        const button = view.dom.parentElement?.querySelector<HTMLElement>('[data-toolbar-item="kasten-hl-comment"]');
        openCommentPop((button ?? view.dom).getBoundingClientRect(), (comment) => {
          void page.add(words, lastColor(), comment);
          dismiss(ctx);
        });
      }),
  });
}
