import type { TextStyle, Theme } from "@kasten-slides/wasm";
import type { CSSProperties, JSX } from "react";

import { fontStack } from "../../theme/index.ts";
import { paragraphStyleOf, setParagraphStyle, styleLabel, styleNames } from "../commands/text-style.ts";
import { plainItem } from "../menus/build.ts";
import type { EditorUi } from "../ui-state.ts";
import { MenuButton } from "./ToolButton.tsx";
import type { TextView } from "./useTextView.ts";
import "./style-menu.css";

/** The words a style is shown in, short enough to sit in a menu row. */
const SAMPLE = "Aa Text";

/** A style's look in miniature: its face, weight and slant, at a size that keeps the order of the sizes but fits a row. */
export function previewCss(theme: Theme, style: TextStyle): CSSProperties {
  return {
    fontFamily: fontStack(theme, style.font),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    fontSize: `${Math.min(20, Math.max(11, Math.round(style.size * 0.55)))}px`,
  };
}

/**
 * The text style of the words in hand (Title, Subtitle, Body, Caption, Quote and the rest the theme has): a button with its name, or
 * "Mixed" where the paragraphs differ, that opens a list with each style shown in its own look. Choosing one sets every paragraph in hand
 * in it, as one step of undo. Nothing is picked up from the words, so a style is always the theme's, and follows the theme when it changes.
 */
export function StyleMenu({ view, ui }: { view: TextView; ui: EditorUi }): JSX.Element {
  const { ctx, can } = view;
  const { theme } = ctx.session.deck;
  const current = can ? paragraphStyleOf(ctx) : null;
  const shown = current === null ? "Style" : current === "mixed" ? "Mixed" : styleLabel(current);
  return (
    <MenuButton
      ui={ui}
      label="Text style"
      className="ks-tb-style"
      text={shown}
      disabled={!can}
      items={() => {
        const now = paragraphStyleOf(ctx);
        return styleNames(theme).map((name) =>
          plainItem(`style-${name}`, styleLabel(name), () => setParagraphStyle(ctx, name), {
            checked: now === name,
            trailing: (
              <span className="ks-style-sample" style={previewCss(theme, theme.textStyles[name] as TextStyle)} aria-hidden="true">
                {SAMPLE}
              </span>
            ),
          }),
        );
      }}
    />
  );
}
