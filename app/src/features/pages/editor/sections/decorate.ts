// Drawing folded sections: each block of one is hidden by a class (as a
// closed toggle hides its body), its divider is marked, and a row where it
// began says what is folded away.

import type { Node } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

import type { HiddenRange } from "./key";
import { keyOf, sectionTitle, sectionsOf } from "./model";
import { summaryRow } from "./summary";

/** What folding `folded` does to `doc`; `kept` are the folded sections that still exist. */
export interface Folded {
  kept: Set<number>;
  hidden: HiddenRange[];
  decorations: DecorationSet;
}

export const NONE: Folded = { kept: new Set(), hidden: [], decorations: DecorationSet.empty };

export function foldDecorations(doc: Node, folded: ReadonlySet<number>): Folded {
  if (folded.size === 0) return NONE;
  const sections = sectionsOf(doc);
  // A page with no divider has nothing to fold.
  if (sections.length < 2) return NONE;
  const kept = new Set<number>();
  const hidden: HiddenRange[] = [];
  const decorations: Decoration[] = [];
  for (const section of sections) {
    const key = keyOf(section);
    if (!folded.has(key)) continue;
    kept.add(key);
    if (section.divider !== null) decorations.push(Decoration.node(section.divider, section.divider + 1, { class: "is-folded" }, { folded: true }));
    if (section.blocks === 0) continue;
    hidden.push({ key, from: section.from, to: section.to });
    for (let at = section.from, i = doc.childAfter(section.from).index; at < section.to; i++) {
      const size = doc.child(i).nodeSize;
      decorations.push(Decoration.node(at, at + size, { class: "kasten-section-hidden" }));
      at += size;
    }
    const title = sectionTitle(doc, section);
    const { blocks } = section;
    const first = section.divider === null;
    // The row asks where it is when clicked, so it stays right as the page grows above it.
    decorations.push(Decoration.widget(section.from, (view, getPos) => summaryRow(view, getPos, first, title, blocks), { side: -1, key: `fold:${first ? "start" : "divider"}:${blocks}:${title}`, stopEvent: () => true, ignoreSelection: true }));
  }
  return { kept, hidden, decorations: DecorationSet.create(doc, decorations) };
}
