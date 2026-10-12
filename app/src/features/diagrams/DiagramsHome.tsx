import "./diagrams.css";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import type { DiagramInfo } from "../../lib/vault/types";
import { Menu } from "../../shell/Menu";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { projectTitle } from "../boards/store";
import { renameDiagram, importDiagrams, newDiagram, IMPORT_ACCEPT } from "./actions";
import { DiagramTile, type Place } from "./DiagramTile";
import { InstallNotice } from "./InstallNotice";
import { RenameDialog } from "./RenameDialog";
import { useDiagramEditor } from "./editor";
import { useDiagramHost } from "./host-store";
import { useDiagrams } from "./store";
import { useWorkspace } from "../workspace/store";

type Sort = "title" | "newest";
type Layout = "grid" | "list";

const LAYOUT_KEY = "kasten.diagrams.layout";
const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

const ALL = "\u0000all";
const NONE = "\u0000none";

/** The Diagrams view: every diagram as a card with its picture (or a row), searched, filtered by project and sorted; a way to
 * make one, import files made elsewhere and the offer to install the editor while it is missing. */
export function DiagramsHome() {
  const list = useDiagrams((s) => s.list);
  const loaded = useDiagrams((s) => s.loaded);
  const notes = useWorkspace((s) => s.notes);
  const installed = useDiagramEditor((s) => s.info?.installed ?? false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(ALL);
  const [sort, setSort] = useState<Sort>("title");
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [renaming, setRenaming] = useState<DiagramInfo | null>(null);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useDiagrams.getState().load();
    void useDiagramEditor.getState().refresh();
  }, []);

  // A picture that is missing or out of date is drawn again, quietly, while the editor is installed.
  useEffect(() => {
    if (!installed) return;
    for (const d of list) if (d.preview !== "fresh" && !d.problem) useDiagramHost.getState().redraw(d.path);
  }, [list, installed]);

  const projects = useMemo(() => [...new Set(list.map((d) => d.project).filter((p): p is string => p !== null))].sort((a, b) => projectTitle(notes, a).localeCompare(projectTitle(notes, b))), [list, notes]);
  const places = useMemo<Place[]>(
    () => [
      { folder: null, title: "the library" },
      ...notes.filter((n) => n.kind === "project" && n.project).map((n): Place => ({ folder: n.project, title: n.title })),
    ],
    [notes],
  );

  const words = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const kept = list.filter((d) => (project === ALL || (project === NONE ? d.project === null : d.project === project)) && (!words || d.title.toLowerCase().includes(words)));
    return sort === "newest" ? [...kept].sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title)) : kept;
  }, [list, project, words, sort]);

  const target = project === ALL || project === NONE ? null : project;
  const choose = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // The choice holds for this window.
    }
  };
  const drop = (event: DragEvent) => {
    setOver(false);
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void importDiagrams([...event.dataTransfer.files], target);
  };

  return (
    <div
      className={`mx-auto min-h-full max-w-[1120px] px-6 pb-24 pt-10 ${over ? "bg-soft" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-28 font-bold tracking-tight">
            <Icon name="diagram" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
            Diagrams
          </h1>
          <p className="mt-1 text-14 text-muted">Flowcharts, architecture and sketches. Each is a plain file in your vault with a picture beside it, so pages, slides and boards show it without any editor, and history and agents work on it like on any note.</p>
        </div>
        <input
          ref={file}
          type="file"
          multiple
          hidden
          accept={IMPORT_ACCEPT}
          aria-label="Import diagrams"
          onChange={(event) => {
            void importDiagrams([...(event.target.files ?? [])], target);
            event.target.value = "";
          }}
        />
        <Button icon="upload" onClick={() => file.current?.click()}>
          Import…
        </Button>
        <Menu
          label="New diagram"
          buttonClass="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-13 font-medium text-on-accent shadow-card transition hover:brightness-110"
          items={[
            { label: "Blank diagram", icon: <Icon name="diagram" className="size-4" />, onSelect: () => void newDiagram({ project: target }) },
            { label: "From a draw.io template…", icon: <Icon name="template" className="size-4" />, hint: installed ? undefined : "needs the editor", onSelect: () => void newDiagram({ project: target, template: true }) },
          ]}
        >
          <Icon name="plus" className="size-4" />
          New diagram
        </Menu>
      </header>

      <InstallNotice className="mt-6" />

      {list.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="flex h-9 w-60 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted transition focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15">
            <Icon name="search" />
            <input type="search" aria-label="Find a diagram" placeholder="Find a diagram" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none" />
          </label>
          <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-13 text-ink">
            <option value={ALL}>All projects</option>
            <option value={NONE}>Not in a project</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {projectTitle(notes, p)}
              </option>
            ))}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-13 text-ink">
            <option value="title">By title</option>
            <option value="newest">Newest first</option>
          </select>
          <Segmented
            label="Layout"
            value={layout}
            iconsOnly
            choices={[
              { value: "grid", label: "Cards", icon: "gallery" },
              { value: "list", label: "List", icon: "list" },
            ]}
            onChange={choose}
            className="ml-auto"
          />
        </div>
      )}

      {loaded && list.length === 0 && (
        <div className="mt-16 grid place-items-center text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-panel text-muted" aria-hidden="true">
            <Icon name="diagram" className="size-7" />
          </div>
          <h2 className="mt-3 text-20 font-semibold">No diagrams yet</h2>
          <p className="mt-1 max-w-[420px] text-14 text-muted">Draw a flowchart or a sketch, then show it in a page, a slide or on a whiteboard. Drop a .drawio file here to bring one in.</p>
          <Button tone="primary" className="mt-5" onClick={() => void newDiagram({ project: target })}>
            Draw your first diagram
          </Button>
        </div>
      )}

      {list.length > 0 && shown.length === 0 && <p className="mt-10 text-center text-14 text-muted">No diagram matches.</p>}

      {shown.length > 0 && (
        <section aria-label="Diagrams" className={layout === "grid" ? "mt-6 grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-4" : "mt-6 flex flex-col"}>
          {shown.map((info) => (
            <DiagramTile key={info.path} info={info} layout={layout} places={places} onRename={setRenaming} />
          ))}
        </section>
      )}

      {renaming && <RenameDialog title={renaming.title} onClose={() => setRenaming(null)} onRename={(title) => void renameDiagram(renaming.path, title)} />}
    </div>
  );
}
