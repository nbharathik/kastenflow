// A page's own layout: its font, width and text size, as `font: serif`,
// `width: full` and `text: large` in its frontmatter, over the defaults in
// Settings → Pages. A page carries only what differs from the defaults:
// picking the default clears its key. A value set by hand that Kasten does
// not know stays in the file as it is, and the default shows. The same
// header also holds where its links open (`opens`) and how it is drawn
// (`layout`), which have no default to differ from.

import { create } from "zustand";

import { readKeys } from "../../pages/page/page-meta";
import { OPENS } from "../opens";
import type { PageFont, TextSize } from "../prefs";
import type { PageSession } from "./page-session";

export type LayoutKey = "font" | "width" | "text" | "opens" | "layout";

/** The keys of a page's style, which "Use the default style" clears: the
 * others say how it behaves, not how it looks. */
export const STYLE_KEYS = ["font", "width", "text"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

/** The values each key takes, as the core checks them. */
export const LAYOUT_VALUES = {
  font: ["sans", "serif", "mono"],
  width: ["normal", "full"],
  text: ["small", "normal", "large", "xl"],
  opens: OPENS,
  layout: ["sections"],
} as const satisfies Record<LayoutKey, readonly string[]>;

export type PageLayout = { [K in LayoutKey]?: (typeof LAYOUT_VALUES)[K][number] };

export const isLayoutKey = (key: string): key is LayoutKey => Object.hasOwn(LAYOUT_VALUES, key);

/** The layout keys a page's frontmatter sets to a value Kasten knows. */
export function readLayout(prefix: string): PageLayout {
  const { values } = readKeys(prefix);
  const layout: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(LAYOUT_VALUES) as [LayoutKey, readonly string[]][]) {
    const value = values[key];
    if (value !== undefined && allowed.includes(value)) layout[key] = value;
  }
  return layout as PageLayout;
}

export interface LayoutDefaults {
  font: PageFont;
  textSize: TextSize;
  fullWidth: boolean;
}

export interface ShownLayout {
  font: PageFont;
  text: TextSize;
  full: boolean;
}

/** What a page shows: its own layout, else the defaults. */
export function shownLayout(own: PageLayout, defaults: LayoutDefaults): ShownLayout {
  return {
    font: own.font === undefined ? defaults.font : own.font === "sans" ? "default" : own.font,
    text: own.text ?? defaults.textSize,
    full: own.width === undefined ? defaults.fullWidth : own.width === "full",
  };
}

/** The style key's value for showing `shown`, or null when that is the default. */
export function layoutValue(key: StyleKey, shown: ShownLayout, defaults: LayoutDefaults): string | null {
  if (key === "font") return shown.font === defaults.font ? null : shown.font === "default" ? "sans" : shown.font;
  if (key === "text") return shown.text === defaults.textSize ? null : shown.text;
  return shown.full === defaults.fullWidth ? null : shown.full ? "full" : "normal";
}

/** Each open page's own layout, by its session (which follows renames),
 * so the page menu and the page show the same. */
export const usePageLayouts = create<{ of: ReadonlyMap<PageSession, PageLayout> }>()(() => ({ of: new Map() }));

const put = (session: PageSession, layout: PageLayout | null) =>
  usePageLayouts.setState(({ of }) => {
    const next = new Map(of);
    if (layout) next.set(session, layout);
    else next.delete(session);
    return { of: next };
  });

/** Keeps the layout a page opened with, or forgets it with null. */
export const keepLayout = put;

/** Sets or clears one key of a page's own layout, and writes it. */
export function setLayout(session: PageSession, key: LayoutKey, value: string | null): void {
  const own: Record<string, string> = { ...usePageLayouts.getState().of.get(session) };
  if (value === null) delete own[key];
  else own[key] = value;
  put(session, own as PageLayout);
  session.editHeader(key, value);
  void session.flush();
}
