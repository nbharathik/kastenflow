// The Graph view: every note, whiteboard and deck as a dot, every link as a
// line, and the pages that links name but nobody has made as hollow ghosts. It
// can show the whole vault, one project, or the pages around one page, found,
// filtered and coloured; a click opens a node (to the right by default), a
// ghost is made when clicked, and a page can be made by double-clicking empty
// space or dragging out of a node.

import "./graph.css";

import { useCallback, useMemo, useRef, useState } from "react";

import type { GraphScope } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { IconButton } from "../../ui/Button";
import { showOpenMenu } from "../../shell/open-menu";
import { titleOf } from "../workspace/names";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { noteAt, projects } from "../workspace/tree";
import { FilterMenu, LookControls, ScopeBar, SearchBox } from "./GraphBar";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { Legend, NodeCard } from "./GraphParts";
import type { Handlers } from "./controller";
import { howToOpen, makeLinkedPage, makePage, openNode, projectForGhost } from "./graph-actions";
import { modelOf, scopeKey, type Model } from "./graph-model";
import { useGraphPrefs, type ScopeChoice } from "./graph-prefs";
import { useFullScreen } from "./use-full-screen";
import { useLayout } from "./use-layout";
import { useVaultGraph } from "./use-graph";

export interface GraphViewProps {
  /** A page to show the graph around, or a project page to show its project. */
  path?: string;
  /** A graph that is always this scope (the project overview's): no scope controls. */
  scope?: GraphScope;
  /** Inside another view: no full-screen button. */
  embedded?: boolean;
}

const EMPTY: Model = { nodes: [], edges: [], origin: [], neighbours: [] };
const isProjectPage = (path: string) => /^projects\/[^/]+\/_project\.md$/.test(path);
const projectFolder = (path: string) => path.split("/")[1] ?? null;

export function GraphView({ path, scope: fixed, embedded = false }: GraphViewProps) {
  const notes = useWorkspace((s) => s.notes);
  const recent = useWorkspace((s) => s.recent);
  const pageLinksOpen = usePrefs((s) => s.pageLinksOpen);
  const [prefs, patch] = useGraphPrefs();

  const [choice, setChoice] = useState<ScopeChoice>(() => (path ? (isProjectPage(path) ? "project" : "page") : prefs.scope));
  const [anchor, setAnchor] = useState<string | null>(() => (path && !isProjectPage(path) ? path : (recent.find((p) => p.endsWith(".md") && noteAt(notes, p)) ?? null)));
  const [pickedProject, setPickedProject] = useState<string | null>(() => (path && isProjectPage(path) ? projectFolder(path) : null));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const places = useMemo(() => projects(notes).map((p) => ({ folder: p.project!, title: titleOf(p) })), [notes]);
  const titles = useMemo(() => new Map(places.map((p) => [p.folder, p.title])), [places]);
  const folder = pickedProject ?? (anchor ? (noteAt(notes, anchor)?.project ?? null) : null);

  const scope = useMemo<GraphScope | null>(() => {
    if (fixed) return fixed;
    if (choice === "vault") return { kind: "vault" };
    if (choice === "project") return folder ? { kind: "project", path: folder } : null;
    return anchor ? { kind: "around", path: anchor, depth: prefs.depth } : null;
  }, [fixed, choice, folder, anchor, prefs.depth]);
  const key = scope ? scopeKey(scope) : "none";
  const { graph, error, reload } = useVaultGraph(scope);

  const tagged = prefs.filters.tags.length > 0 ? notes : null;
  const model = useMemo(() => {
    if (!graph) return EMPTY;
    const tags = new Map((tagged ?? []).map((n) => [n.path, n.tags]));
    return modelOf(graph, prefs.filters, (p) => tags.get(p) ?? []);
  }, [graph, prefs.filters, tagged]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) if (n.kind !== "template") for (const t of n.tags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [notes]);

  const canvas = useRef<GraphCanvasHandle>(null);
  const layout = useLayout(model, key, () => canvas.current?.frame(), round);
  const selected = selectedId === null ? -1 : model.nodes.findIndex((n) => n.id === selectedId);
  const node = selected >= 0 ? model.nodes[selected] : undefined;

  // Where new pages go: the project the graph is of, else the one of the page it is around.
  const home = useMemo(() => {
    if (scope?.kind === "project") return scope.path.replace(/^projects\//, "").split("/")[0] ?? null;
    if (scope?.kind === "around") return noteAt(notes, scope.path)?.project ?? null;
    return null;
  }, [scope, notes]);
  const opens = useCallback((event: Parameters<typeof howToOpen>[0]) => howToOpen(event, prefs.opens, pageLinksOpen), [prefs.opens, pageLinksOpen]);
  const plainClick = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };

  const handlers: Handlers = {
    select: (i) => setSelectedId(model.nodes[i]?.id ?? null),
    open: (i, keys) => {
      const target = model.nodes[i];
      if (!target) return;
      const linking = target.kind === "ghost" ? model.neighbours[i]!.map((n) => model.nodes[n]) : [];
      void openNode(target, opens(keys), projectForGhost(linking, home));
    },
    openHere: (i) => {
      const target = model.nodes[i];
      if (target) void openNode(target, "here", home);
    },
    context: (i, at) => {
      const target = model.nodes[i];
      if (target?.path) showOpenMenu({ clientX: at.x, clientY: at.y, preventDefault() {} }, target.path);
    },
    createAt: async (x, y) => {
      const made = await makePage(home);
      if (!made) return;
      layout.place(made.meta.path, x, y);
      reload();
      useWorkspace.getState().openPath(made.meta.path, opens(plainClick));
    },
    linkTo: async (from, x, y) => {
      const source = model.nodes[from];
      if (!source) return;
      const made = await makeLinkedPage(source, home);
      if (!made) return;
      layout.place(made.meta.path, x, y);
      reload();
      useWorkspace.getState().openPath(made.meta.path, opens(plainClick));
    },
  };

  const around = (path: string) => {
    setAnchor(path);
    setChoice("page");
    patch({ scope: "page" });
  };
  const pick = (index: number) => {
    setSelectedId(model.nodes[index]?.id ?? null);
    canvas.current?.focusNode(index);
  };

  const full = useFullScreen();
  const counts = useMemo(() => {
    const ghosts = model.nodes.filter((n) => n.kind === "ghost").length;
    return { things: model.nodes.length - ghosts, ghosts, links: model.edges.length };
  }, [model]);
  const waiting = scope !== null && !graph && !error;

  return (
    <div className={`kasten-graph${embedded ? " is-embedded" : ""}`}>
      <div className="kasten-graph-bar" role="toolbar" aria-label="Graph controls">
        {!embedded && (
          <h1 className="mr-1 flex items-center gap-2 text-16 font-semibold">
            <Icon name="graph" className="size-[18px] text-muted" />
            Graph
          </h1>
        )}
        {!fixed && (
          <ScopeBar
            choice={choice}
            onChoice={(next) => {
              setChoice(next);
              patch({ scope: next });
            }}
            depth={prefs.depth}
            onDepth={(depth) => patch({ depth })}
            project={folder}
            projects={places}
            onProject={setPickedProject}
            anchor={anchor}
          />
        )}
        <SearchBox model={model} onPick={pick} />
        {graph && <FilterMenu graph={graph} filters={prefs.filters} onFilters={(filters) => patch({ filters })} tags={tags} />}
        <LookControls colourBy={prefs.colourBy} onColourBy={(colourBy) => patch({ colourBy })} opens={prefs.opens} onOpens={(next) => patch({ opens: next })} />
        <span className="flex-1" />
        <IconButton icon="page-plus" label="New page" onClick={() => useWorkspace.getState().newPage({ project: home }, "right")} />
        <IconButton icon="refresh" label="Lay the graph out again" onClick={() => setRound((n) => n + 1)} />
        <IconButton icon="zoom-in" label="Zoom in" onClick={() => canvas.current?.zoomBy(1.4)} />
        <IconButton icon="zoom-out" label="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.4)} />
        <IconButton icon="fit" label="Fit the graph in the window" onClick={() => canvas.current?.fit()} />
        {!embedded && <IconButton icon={full.on ? "shrink" : "expand"} label={full.on ? "Leave full screen" : "Full screen"} active={full.on} onClick={full.toggle} />}
      </div>

      <div className="kasten-graph-stage">
        <GraphCanvas
          ref={canvas}
          key={key}
          model={model}
          places={layout.places}
          handlers={handlers}
          label="Graph of your pages and the links between them. Arrow keys move along links, Enter opens, plus and minus zoom."
          colourBy={prefs.colourBy}
          selected={selected}
          nameAll={model.nodes.length <= 40}
          editable
        />
        {waiting && <p className="kasten-graph-note">Reading the links…</p>}
        {error && <p className="kasten-graph-note is-error">The graph could not be read: {error}</p>}
        {!scope && !error && <p className="kasten-graph-note">{choice === "project" ? "Choose a project to see its graph." : "Open a page, then show the graph around it."}</p>}
        {graph && model.nodes.length === 0 && <p className="kasten-graph-note">Nothing to show{graph.nodes.length > 0 ? " with these filters" : " yet: links between pages appear here"}.</p>}
        {node && (
          <NodeCard
            node={node}
            projectTitle={node.project ? titles.get(node.project) : undefined}
            onOpen={() => void openNode(node, opens(plainClick), projectForGhost(node.kind === "ghost" ? model.neighbours[selected]!.map((n) => model.nodes[n]) : [], home))}
            onAround={!fixed && node.path ? () => around(node.path!) : undefined}
            onClose={() => setSelectedId(null)}
          />
        )}
        <div className="kasten-graph-foot">
          <p className="text-12 text-muted" aria-live="polite">
            {counts.things.toLocaleString()} {counts.things === 1 ? "thing" : "things"} · {counts.links.toLocaleString()} {counts.links === 1 ? "link" : "links"}
            {counts.ghosts > 0 ? ` · ${counts.ghosts.toLocaleString()} missing` : ""}
            {graph && !layout.settled ? " · laying out…" : ""}
          </p>
          <Legend model={model} by={prefs.colourBy} titles={titles} />
        </div>
        <p className="sr-only" aria-live="polite">
          {node ? `Selected ${node.title}, ${node.kind}, ${node.links} links` : ""}
        </p>
      </div>
    </div>
  );
}
