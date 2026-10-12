// Small parts of the Graph view: the key to the colours, and the card for the
// node that is selected.

import type { GraphNode } from "../../lib/vault/types";
import { Button, IconButton } from "../../ui/Button";
import { colourOf, kindLabel, type ColourBy, type Model } from "./graph-model";

/** A swatch of the colour a node is drawn in: the highlight deepened toward the ink, as the canvas does it. */
const swatch = (name: string) => `color-mix(in srgb, var(--color-highlight-${name}) 72%, var(--color-ink))`;

/** What the colours mean: the kinds in the graph, or the projects. */
export function Legend({ model, by, titles }: { model: Model; by: ColourBy; titles: ReadonlyMap<string, string> }) {
  const seen = new Map<string, { label: string; colour: string }>();
  for (const node of model.nodes) {
    const key = by === "kind" ? node.kind : (node.project ?? "");
    if (seen.has(key)) continue;
    const label = by === "kind" ? kindLabel(node.kind) : key ? (titles.get(key) ?? key) : "No project";
    seen.set(key, { label, colour: colourOf(node, by) });
  }
  if (seen.size === 0) return null;
  const entries = [...seen.values()].slice(0, 10);
  return (
    <ul aria-label={by === "kind" ? "Kinds" : "Projects"} className="pointer-events-none flex max-w-[22rem] flex-wrap justify-end gap-x-3 gap-y-1 text-12 text-muted">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full border border-line-strong" style={{ background: swatch(entry.colour) }} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

interface CardProps {
  node: GraphNode;
  /** Where its project is called, for the card's second line. */
  projectTitle: string | undefined;
  onOpen(): void;
  /** Shows the graph around it; left out where that makes no sense (a graph already around a page). */
  onAround?(): void;
  onClose(): void;
}

/** The node selected: what it is, how many links it has, and what can be done with it. */
export function NodeCard({ node, projectTitle, onOpen, onAround, onClose }: CardProps) {
  const ghost = node.kind === "ghost";
  return (
    <aside aria-label="Selected node" className="absolute right-3 top-3 z-20 flex w-64 flex-col gap-2 rounded-xl border border-line bg-raised p-3 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-14 font-medium" title={node.title}>
            {node.title}
          </p>
          <p className="truncate text-12 text-muted">
            {kindLabel(node.kind)}
            {node.project ? ` · ${projectTitle ?? node.project}` : ""} · {node.links === 1 ? "1 link" : `${node.links} links`}
          </p>
        </div>
        <IconButton icon="close" label="Clear the selection" size="sm" onClick={onClose} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" tone="primary" icon={ghost ? "page-plus" : "open"} onClick={onOpen}>
          {ghost ? "Make the page" : "Open"}
        </Button>
        {onAround && !ghost && (
          <Button size="sm" icon="graph" onClick={onAround}>
            Graph around it
          </Button>
        )}
      </div>
    </aside>
  );
}
