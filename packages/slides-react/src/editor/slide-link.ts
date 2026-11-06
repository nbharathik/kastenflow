// The web address a slide already points at: what a new QR code holds, so a slide that links to a page can hand the page out.

import type { Element, Slide } from "@kasten-slides/wasm";

const isWeb = (link: string | null | undefined): link is string => typeof link === "string" && /^https?:\/\//i.test(link.trim());

/** The first `http` or `https` address linked from the boxes of an element (or from its words), looking into groups; undefined for none. */
function linkOf(element: Element): string | undefined {
  if (isWeb(element.link)) return element.link.trim();
  if (element.type === "group") {
    for (const child of element.children) {
      const found = linkOf(child);
      if (found) return found;
    }
    return undefined;
  }
  const text = element.type === "text" || element.type === "shape" ? element.text : undefined;
  for (const paragraph of text?.paragraphs ?? []) {
    for (const run of paragraph.runs) if (isWeb(run.link)) return run.link.trim();
  }
  return undefined;
}

/** The first web address the shown slide links to, in the order of its elements; undefined when it links to none. */
export function slideLink(slide: Pick<Slide, "elements">): string | undefined {
  for (const element of slide.elements) {
    const found = linkOf(element);
    if (found) return found;
  }
  return undefined;
}
