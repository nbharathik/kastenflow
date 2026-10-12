// The page's own corner of the graph, at the top of the right panel's Links
// tab: the page and the pages it links or is linked from (one link away), small
// and laid out at once. A click opens a node; the heading's button opens the
// whole graph around the page beside it.

import "./graph.css";

import { useEffect, useMemo, useRef, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { showOpenMenu } from "../../shell/open-menu";
import { howFrom, useWorkspace } from "../workspace/store";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import type { Handlers } from "./controller";
import { openNode } from "./graph-actions";
import { SHOW_ALL, modelOf, type Model } from "./graph-model";
import { settle } from "./layout";
import { useVaultGraph } from "./use-graph";

/** More nodes than this is no glance: the button opens the whole graph instead. */
const MOST = 120;
const EMPTY: Model = { nodes: [], edges: [], origin: [], neighbours: [] };

export function LocalGraph({ note }: { note: Pick<NoteMeta, "path" | "title"> }) {
  const scope = useMemo(() => ({ kind: "around" as const, path: note.path, depth: 1 }), [note.path]);
  const { graph } = useVaultGraph(scope);
  const model = useMemo(() => (graph ? modelOf(graph, SHOW_ALL) : EMPTY), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvas = useRef<GraphCanvasHandle>(null);

  const big = model.nodes.length > MOST;
  // Small enough to settle on the spot, so it is there as the tab opens.
  const places = useMemo<{ current: Float32Array | null }>(() => {
    if (big || model.nodes.length === 0) return { current: null };
    const edges = new Uint32Array(model.edges.length * 2);
    model.edges.forEach((e, i) => {
      edges[2 * i] = e.from;
      edges[2 * i + 1] = e.to;
    });
    return { current: settle(model.nodes.length, edges, { seed: 7, ticks: 160 }) };
  }, [model, big]);
  useEffect(() => {
    canvas.current?.frame();
  }, [places]);

  const here = model.nodes.findIndex((n) => n.id === note.path);
  const selected = selectedId === null ? here : model.nodes.findIndex((n) => n.id === selectedId);
  const openOne = (index: number, how: ReturnType<typeof howFrom>) => {
    const target = model.nodes[index];
    // The page itself is already open; a plain click goes to what it links, in place like a link in the panel.
    if (target && index !== here) void openNode(target, how);
  };
  const handlers: Handlers = {
    select: (i) => setSelectedId(model.nodes[i]?.id ?? null),
    open: (i, keys) => openOne(i, howFrom(keys)),
    openHere: (i) => openOne(i, "here"),
    context: (i, at) => {
      const target = model.nodes[i];
      if (target?.path) showOpenMenu({ clientX: at.x, clientY: at.y, preventDefault() {} }, target.path);
    },
    createAt: () => {},
    linkTo: () => {},
  };

  const others = Math.max(0, model.nodes.length - 1);
  return (
    <section className="kasten-panel-section" aria-label="Local graph">
      <h3 className="kasten-panel-label">
        <span>
          Graph <span className="kasten-panel-count">{others}</span>
        </span>
        <button type="button" className="kasten-panel-button" onClick={() => useWorkspace.getState().openRight({ view: "graph", path: note.path })}>
          Open graph
        </button>
      </h3>
      {!graph ? (
        <p className="kasten-panel-empty">Finding links…</p>
      ) : others === 0 ? (
        <p className="kasten-panel-empty">Nothing links to or from this page yet.</p>
      ) : big ? (
        <p className="kasten-panel-empty">{others.toLocaleString()} pages link here or are linked from here: too many for a glance. Open the graph to see them.</p>
      ) : (
        <div className="kasten-local-graph">
          <GraphCanvas
            ref={canvas}
            key={note.path}
            model={model}
            places={places}
            handlers={handlers}
            label={`Graph of the pages linked with ${note.title}. Arrow keys move along links, Enter opens.`}
            colourBy="kind"
            selected={selected}
            nameAll
            editable={false}
          />
        </div>
      )}
    </section>
  );
}
