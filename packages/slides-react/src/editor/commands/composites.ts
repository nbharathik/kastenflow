// Commands for composites: inserting each kind, the insert palette that finds
// anything to insert or run, and "Ungroup to shapes".

import type { Element, ExpandComposite, ExpandedComposite } from "@kasten-slides/wasm";

import { INSERTABLE, isCompositeType } from "../composite-kinds.ts";
import { insertComposite } from "../insert-composite.ts";
import { selectedElements } from "../session/scope.ts";
import type { Command } from "./types.ts";

/**
 * Whether "Ungroup to shapes" can do something to an element: it is a composite
 * that is drawn with shapes. A formula is drawn with a picture of the formula,
 * which a deck does not keep, so there is nothing to ungroup it to.
 */
export const ungroupable = (element: Element): boolean => isCompositeType(element.type) && element.type !== "math";

const insertCommands: Command[] = INSERTABLE.map(
  (spec): Command => ({
    id: `insert.${spec.kind}`,
    label: spec.label,
    icon: spec.icon,
    run: ({ session, ui }) => {
      // A page or a video is made from an address, and a citation from the works chosen: a dialog asks for them.
      if (spec.asks) ui.openDialog(spec.asks);
      else insertComposite(session, spec.kind);
    },
  }),
);

export const compositesCommands: Command[] = [
  ...insertCommands,
  {
    id: "insert.palette",
    label: "Insert gallery…",
    icon: "search",
    // The slash is for when the slide has the keys: in a text box, or any field, it is a letter to type.
    keys: ["Mod+/", "Mod+Shift+P", "/"],
    scope: "global",
    run: ({ ui }) => ui.openDialog("insert"),
  },
  {
    id: "arrange.ungroup-composite",
    label: "Ungroup to shapes",
    icon: "ungroup",
    enabled: (state) => selectedElements(state).some(ungroupable),
    run: ({ session }) => {
      const slide = session.state.slideId;
      const ids = selectedElements(session.state).filter(ungroupable).map((element) => element.id);
      if (ids.length === 0) return;
      // One batch for all of them, so it is one step of undo.
      const operations = ids.map((id): ["expand_composite", ExpandComposite] => ["expand_composite", { slide, id }]);
      const done = session.run(() => session.core.applyBatch(operations));
      if (done) session.select(done.map((applied) => (applied.output as ExpandedComposite).group));
    },
  },
];
