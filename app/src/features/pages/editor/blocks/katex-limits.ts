// KaTeX's limits for TeX anyone may have written (a page, a chat answer): no
// links or pictures (`trust`), and sizes and macro expansion capped, so a
// formula can neither cover the page nor hang it. Kept apart from the
// editor's math view so the chat can load it without the editor.

export const KATEX = { trust: false, strict: "ignore", maxSize: 20, maxExpand: 500 } as const;
