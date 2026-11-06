// Commands for composites: inserting each kind, the insert palette that finds
// anything to insert or run, and "Ungroup to shapes".

import type { Element, ExpandComposite, ExpandedComposite } from "@kasten-slides/wasm";

import { INSERTABLE, isCompositeType } from "../composite-kinds.ts";
import { insertComposite } from "../insert-composite.ts";
import { slideLink } from "../slide-link.ts";
import { selectedElements } from "../session/scope.ts";
import { openPalette } from "./chrome.ts";
import type { Command } from "./types.ts";

/**
 * Whether "Ungroup to shapes" can do something to an element: it is a composite
 * that is drawn with shapes. A formula is drawn with a picture of the formula,
 * which a deck does not keep, so there is nothing to ungroup it to.
 */
export const ungroupable = (element: Element): boolean => isCompositeType(element.type) && element.type !== "math";

/** What a new QR code holds when the slide links to nothing: an address to look at and then change. */
export const SAMPLE_QR_ADDRESS = "https://example.com";

const insertCommands: Command[] = INSERTABLE.map(
  (spec): Command => ({
    id: `insert.${spec.kind}`,
    label: spec.label,
    icon: spec.icon,
    run: ({ session, ui }) => {
      // A page or a video is made from an address, and a citation from the works chosen: a dialog asks for them.
      if (spec.asks) ui.openDialog(spec.asks);
      // A QR code starts as the address the slide links to, so that the slide can hand its page out.
      else if (spec.kind === "qr") insertComposite(session, "qr", { address: slideLink(session.slide) ?? SAMPLE_QR_ADDRESS });
      else insertComposite(session, spec.kind);
    },
  }),
);

/** The other charts the menu offers by name; "Chart" is the bar chart. The type can be switched in the format options afterwards. */
const chartCommands: Command[] = (["line", "pie"] as const).map(
  (chart): Command => ({
    id: `insert.chart.${chart}`,
    label: chart === "line" ? "Line chart" : "Pie chart",
    icon: chart === "line" ? "chart-line" : "chart-pie",
    run: ({ session }) => void insertComposite(session, "chart", { chart }),
  }),
);

export const compositesCommands: Command[] = [
  ...insertCommands,
  ...chartCommands,
  {
    id: "insert.emoji",
    label: "Emoji…",
    icon: "smile",
    run: ({ ui }) => ui.openDialog("emoji"),
  },
  {
    id: "insert.palette",
    label: "Insert gallery…",
    icon: "search",
    // The slash is for when the slide has the keys: in a text box, or any field, it is a letter to type. Ctrl+Shift+P is the whole palette's.
    keys: ["Mod+/", "/"],
    scope: "global",
    run: (context) => openPalette(context, "insert"),
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
