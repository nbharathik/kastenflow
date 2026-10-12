// What kind of embed an element is.

import type { Element } from "@kasten-slides/wasm";

type Embed = Extract<Element, { type: "embed" }>;

/** Whether an embed shows a page of the host: it has no web address of its own, and says which page. */
export const isPageEmbedElement = (element: Embed): boolean => element.url.trim() === "" && Boolean(element.source);
