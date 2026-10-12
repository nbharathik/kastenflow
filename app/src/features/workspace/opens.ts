// Where a link or a sub-page opens when it is clicked plainly: the values of
// the `opens` key a page can carry in its frontmatter and of the default in
// Settings → Pages. Plain data, so preferences and pages can both use it.

export const OPENS = ["here", "tab", "right", "peek-side", "peek-center", "stack"] as const;

export type Opens = (typeof OPENS)[number];

export const isOpens = (value: unknown): value is Opens => typeof value === "string" && (OPENS as readonly string[]).includes(value);

/** What each value is called in menus and Settings. */
export const OPENS_LABEL: Record<Opens, string> = {
  here: "The same tab",
  tab: "A new tab",
  right: "To the right",
  "peek-side": "A side peek",
  "peek-center": "A center peek",
  stack: "The side stack",
};
