// Menu rows for the text commands that `commands/text-format.ts` adds, built the way
// `menus/items-text.ts` builds the older ones, so the Format menu, a toolbar menu and a
// context menu can all take them. The check marks come from how the words in hand look now.

import { type CommandContext, textFormat } from "../commands/index.ts";
import { CASES, FITS, LINE_SPACINGS, LIST_STYLES } from "../commands/text-format.ts";
import { type Row, SEPARATOR, commandItem, groups, submenu } from "../menus/build.ts";
import type { MenuItem } from "../ui/Menu.tsx";

const live = (ctx: CommandContext): boolean => textFormat.canFormat(ctx);

/** The look of each kind of list, "No list", and the counting of a numbered one. */
export function bulletRows(ctx: CommandContext): MenuItem[] {
  const format = textFormat.currentFormat(ctx);
  const disabledIf = !live(ctx);
  const rows = (kind: "bullet" | "number"): Row[] =>
    LIST_STYLES.filter((entry) => entry.kind === kind).map(({ id, style }) => commandItem(`text.list-${id}`, ctx, { disabledIf, checked: format.listStyle === style }));
  return groups(
    [commandItem("text.bullets", ctx, { disabledIf, checked: format.list === "bullet" }), commandItem("text.numbers", ctx, { disabledIf, checked: format.list === "number" })],
    rows("bullet"),
    rows("number"),
    [commandItem("text.list-none", ctx, { disabledIf, checked: format.list === null })],
    [commandItem("text.list-restart", ctx, { disabledIf: disabledIf || format.list !== "number" }), commandItem("text.list-continue", ctx, { disabledIf: disabledIf || format.list !== "number" })],
  );
}

/** Line spacing, and the space before and after paragraphs. */
export function lineAndParagraphRows(ctx: CommandContext): MenuItem[] {
  const format = textFormat.currentFormat(ctx);
  const disabledIf = !live(ctx);
  const spacings = LINE_SPACINGS.map((multiple) =>
    commandItem(`text.line-spacing-${String(multiple).replace(".", "-")}`, ctx, { disabledIf, checked: format.lineSpacing === multiple, label: multiple === 1 ? "Single" : multiple === 2 ? "Double" : String(multiple) }),
  );
  return groups(
    [...spacings, commandItem("text.line-spacing-default", ctx, { disabledIf, checked: format.lineSpacing === null, label: "Default" })],
    [
      commandItem("text.space-before-add", ctx, { disabledIf }),
      commandItem("text.space-before-remove", ctx, { disabledIf }),
      commandItem("text.space-after-add", ctx, { disabledIf }),
      commandItem("text.space-after-remove", ctx, { disabledIf }),
    ],
  );
}

/** "Do not autofit", "Shrink text on overflow", "Resize shape to fit text", and wrapping. */
export function fitRows(ctx: CommandContext): MenuItem[] {
  const format = textFormat.currentFormat(ctx);
  const disabledIf = !live(ctx);
  return groups(
    FITS.map(({ fit, id }) => commandItem(`text.fit-${id}`, ctx, { disabledIf, checked: format.fit === fit })),
    [commandItem("text.wrap", ctx, { disabledIf, checked: format.wrap })],
  );
}

/** lowercase, UPPERCASE, Title Case and Sentence case. */
export function caseRows(ctx: CommandContext): MenuItem[] {
  const disabledIf = !live(ctx);
  return CASES.map(({ id }) => commandItem(`text.case-${id}`, ctx, { disabledIf }));
}

/** Raised and lowered words, small capitals and capitals. */
export function scriptRows(ctx: CommandContext): MenuItem[] {
  const format = textFormat.currentFormat(ctx);
  const disabledIf = !live(ctx);
  return [
    commandItem("text.superscript", ctx, { disabledIf, checked: format.script === "super" }),
    commandItem("text.subscript", ctx, { disabledIf, checked: format.script === "sub" }),
    commandItem("text.small-caps", ctx, { disabledIf, checked: format.smallCaps === true }),
    commandItem("text.all-caps", ctx, { disabledIf, checked: format.allCaps === true }),
  ];
}

/** What is corrected as words are typed: each a choice, kept in the browser. */
export function typingRows(ctx: CommandContext): MenuItem[] {
  return ["text.auto-lists", "text.auto-links", "text.autocorrect", "text.smart-quotes"].map((id) => commandItem(id, ctx));
}

/** Everything of the Format menu's text part in one list: alignment, spacing, lists, fit, words and case as sub-menus. */
export function textFormatRows(ctx: CommandContext): MenuItem[] {
  return [
    submenu("text-bullets", "Bullets & numbering", bulletRows(ctx), "list"),
    submenu("text-spacing", "Line & paragraph spacing", lineAndParagraphRows(ctx), "list"),
    submenu("text-fit", "Text fitting", fitRows(ctx)),
    submenu("text-words", "Words", [...scriptRows(ctx), SEPARATOR, ...caseRows(ctx)]),
    submenu("text-typing", "Typing", typingRows(ctx)),
  ];
}
