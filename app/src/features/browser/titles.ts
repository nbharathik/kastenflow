// The titles of the pages browser tabs show, by address, so a tab's face
// names its page as the page itself said (the tab's place holds only the
// address). Kept while the window lasts.

import { create } from "zustand";

import { siteOf } from "./address";

/** Titles kept; the oldest go first. */
const MOST = 200;

interface Titles {
  titles: Readonly<Record<string, string>>;
  keep(url: string, title: string): void;
}

export const useWebTitles = create<Titles>()((set) => ({
  titles: {},
  keep(url, title) {
    const text = title.replace(/\s+/g, " ").trim();
    if (!url || !text) return;
    set((s) => {
      if (s.titles[url] === text) return s;
      const { [url]: _old, ...rest } = s.titles;
      const next = { ...rest, [url]: text };
      const keys = Object.keys(next);
      for (const key of keys.slice(0, Math.max(0, keys.length - MOST))) delete next[key];
      return { titles: next };
    });
  },
}));

/** What a browser tab is called: its page's title, else its site, else "Browser". */
export function webTitle(url: string | undefined, titles: Readonly<Record<string, string>> = useWebTitles.getState().titles): string {
  if (!url) return "Browser";
  return titles[url] || siteOf(url) || "Browser";
}
