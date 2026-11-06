// The theme's named text styles as something to pick: the order they are listed in, what they are called, how the words in hand are
// set now, and a command for each (so the palette finds "Title" and a key can be given to one later).

import type { Theme } from "@kasten-slides/wasm";

import type { Command, CommandContext } from "./types.ts";

/** The styles every theme has, in the order they are offered; a style a theme adds comes after them, by name. */
export const STYLE_ORDER = ["title", "subtitle", "display", "body", "caption", "quote", "big-number", "code", "citation"] as const;

/** The names of the theme's text styles, in the order they are offered. */
export function styleNames(theme: Pick<Theme, "textStyles">): string[] {
  const own = Object.keys(theme.textStyles);
  const known = STYLE_ORDER.filter((name) => own.includes(name));
  return [...known, ...own.filter((name) => !(STYLE_ORDER as readonly string[]).includes(name)).sort()];
}

/** A style as a person calls it: "big-number" is "Big number". */
export const styleLabel = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1).replaceAll("-", " ")}`;

/** The text style the words in hand are set in: its name, "mixed" where the paragraphs differ, null where there are no words to set. */
export function paragraphStyleOf({ session, ui }: CommandContext): string | null {
  return ui.state.text ? ui.state.text.paragraphStyle() : session.text.paragraphStyle();
}

/** Sets the words in hand (the open box's paragraphs, else every paragraph of the selected boxes) in a text style: one step of undo. */
export function setParagraphStyle({ session, ui }: CommandContext, style: string | null): void {
  if (ui.state.text) ui.state.text.setParagraphStyle(style);
  else session.text.setParagraphStyle(style);
}

export const styleCommands: Command[] = STYLE_ORDER.map(
  (name): Command => ({
    id: `text.style-${name}`,
    label: `Text style: ${styleLabel(name)}`,
    icon: "type",
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => setParagraphStyle(context, name),
  }),
);
