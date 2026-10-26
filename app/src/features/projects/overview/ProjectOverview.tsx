// A project's overview, big: opened with the Expand button on the project
// home, from the project menu or from the palette, in the pane or the whole
// window. Tabs: All (pages, cards, whiteboards and decks, as a table or a
// gallery), Captures, Tasks, Graph, and the project's saved tables, each a
// name, a filter, columns and a sort kept in the project page's `overview`
// property.

import "../../dashboard/dashboard.css";
import "./overview.css";

import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { GraphScope, TagView } from "../../../lib/vault/types";
import type { MenuEntry, MenuItem } from "../../../shell/Menu";
import { STARTERS } from "../../smart/author/starter-list";
import { PointMenu } from "../../../shell/PointMenu";
import { Button, IconButton } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { startNewBoard, useBoards } from "../../boards/store";
import { PinnedSlot } from "../../collections/PinnedSlot";
import { useFullScreen } from "../../graph/use-full-screen";
import { startNewDeck, useDecks } from "../../slides/store";
import { iconOf, titleOf } from "../../workspace/names";
import { ResumeWorkspace } from "../../workspace/ResumeWorkspace";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { ProjectReviewMenu } from "../../review-screens/project/ProjectReviewMenu";
import { ProjectStateMenu } from "../state/StateChips";
import { AllTab } from "./AllTab";
import { CapturesTab } from "./CapturesTab";
import { capturesOf, itemsOf } from "./items";
import { addTable, MAX_TABLES, newTable, removeTable, replaceTable, type Overview } from "./overview";
import { useSavedOverview } from "./overview-actions";
import { useOverviewPrefs } from "./overview-prefs";
import { TableTab } from "./TableTab";

const ProjectKanban = lazy(() => import("../ProjectKanban").then((m) => ({ default: m.ProjectKanban })));
const GraphView = lazy(() => import("../../graph/GraphView").then((m) => ({ default: m.GraphView })));

const TABLE = "table:";

/** What "+ New table" offers to start from. */
const PRESETS: { label: string; name: string; filter: TagView["filter"] }[] = [
  { label: "Blank table", name: "Table", filter: [] },
  { label: "Pages only", name: "Pages", filter: [{ key: "type", op: "is", value: "page" }] },
  { label: "Cards only", name: "Cards", filter: [{ key: "type", op: "is", value: "card" }] },
  { label: "Captures (tagged #capture)", name: "Captures", filter: [{ key: "tags", op: "contains", value: "capture" }] },
];

export function ProjectOverview({ path }: { path: string }) {
  const project = useWorkspace((s) => noteAt(s.notes, path));
  if (!project || project.kind !== "project" || !project.project) {
    return (
      <div className="kasten-overview">
        <p className="kasten-overview-empty">This project could not be found. It may have been moved or put in the trash.</p>
        <div className="mt-3 flex justify-center">
          <Button onClick={() => useWorkspace.getState().go({ view: "home" })}>Go home</Button>
        </div>
      </div>
    );
  }
  return <Loaded path={path} />;
}

function Loaded({ path }: { path: string }) {
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  const project = noteAt(notes, path)!;
  const folder = project.project!;
  const title = titleOf(project);
  const [overview, save] = useSavedOverview(project);
  const [prefs, patch] = useOverviewPrefs(folder);
  const full = useFullScreen();
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "new" | "table" } | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const tableButton = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const captures = capturesOf(notes, folder);
    return { all: itemsOf(notes, boards, decks, folder).length, captures: captures.filed.length + captures.unfiled.length };
  }, [notes, boards, decks, folder]);
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "captures", label: "Captures", count: counts.captures },
    { id: "tasks", label: "Tasks" },
    { id: "graph", label: "Graph" },
    ...overview.tables.map((t) => ({ id: `${TABLE}${t.name}`, label: t.name })),
  ];
  // A saved tab that is gone (a table deleted elsewhere) falls back to All.
  const current = tabs.some((t) => t.id === prefs.tab) ? prefs.tab : "all";
  const table = current.startsWith(TABLE) ? overview.tables.find((t) => t.name === current.slice(TABLE.length)) : undefined;

  const select = (id: string) => patch({ tab: id });
  const onTabKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = (tabs.findIndex((t) => t.id === current) + step + tabs.length) % tabs.length;
    select(tabs[at]!.id);
    requestAnimationFrame(() => document.getElementById(`overview-tab-${at}`)?.focus());
  };

  /** Saves the tables, and goes to the one called `then`. */
  const changeTables = (next: Overview, then?: string) => {
    void save(next);
    if (then) select(`${TABLE}${then}`);
  };
  const startTable = (preset: (typeof PRESETS)[number]) => {
    const next = addTable(overview, newTable(overview, preset.name, { filter: preset.filter }));
    if (next === overview) return useWorkspace.getState().toast(`A project keeps up to ${MAX_TABLES} saved tables. Delete one first.`);
    changeTables(next, next.tables.at(-1)!.name);
  };
  const changeTable = (current: TagView, next: TagView) => {
    const after = replaceTable(overview, current.name, next);
    const at = overview.tables.findIndex((t) => t.name === current.name);
    // A rename keeps the name unique, so the tab to show is what the table ended up called.
    const name = after.tables[at]?.name;
    changeTables(after, name !== undefined && name !== current.name ? name : undefined);
  };
  const duplicate = (of: TagView) => {
    const next = addTable(overview, { ...of, name: `${of.name} copy` });
    if (next === overview) return useWorkspace.getState().toast(`A project keeps up to ${MAX_TABLES} saved tables. Delete one first.`);
    changeTables(next, next.tables.at(-1)!.name);
  };
  const deleteTable = (name: string) => {
    const before = overview;
    changeTables(removeTable(overview, name));
    select("all");
    useWorkspace.getState().toast(`Deleted the table “${name}”`, { label: "Undo", run: () => void save(before) });
  };

  const newItems: MenuEntry[] = [
    { label: "New page", icon: <Icon name="compose" className="size-4" />, onSelect: () => useWorkspace.getState().newPage({ project: folder }, "tab") },
    { label: "New card", icon: <Icon name="card" className="size-4" />, onSelect: () => useWorkspace.getState().newPage({ kind: "card", project: folder }, "tab") },
    { label: "New whiteboard", icon: <Icon name="board" className="size-4" />, onSelect: () => startNewBoard(folder, "tab") },
    { label: "New deck", icon: <Icon name="present" className="size-4" />, onSelect: () => startNewDeck(folder, "tab") },
    {
      label: "New smart page",
      icon: <Icon name="code" className="size-4" />,
      submenu: STARTERS.map((starter) => ({ label: starter.name, icon: <Icon name="code" className="size-4" />, onSelect: () => void import("../../smart/author/flows").then((m) => m.newSmartPage(starter.id, undefined, folder)) })),
    },
  ];
  const tableItems: (MenuItem | "divider")[] = PRESETS.map((preset) => ({ label: preset.label, icon: <Icon name="table" className="size-4" />, onSelect: () => startTable(preset) }));
  const scope: GraphScope = { kind: "project", path: folder };
  const toggleMenu = (button: HTMLElement | null, kind: "new" | "table") => {
    const box = button?.getBoundingClientRect();
    setMenu(menu?.kind === kind ? null : { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4, kind });
  };

  return (
    <div className="kasten-overview" aria-label={`${title}: overview`}>
      <header className="kasten-overview-head">
        <h1 className="flex min-w-0 items-center gap-2 text-24 font-bold tracking-tight">
          <span className="shrink-0" aria-hidden="true">
            <IconOrEmoji icon={iconOf(project)} />
          </span>
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-16 font-normal text-muted">overview</span>
        </h1>
        <ProjectStateMenu project={project} />
        <ProjectReviewMenu project={project} />
        <span className="flex-1" />
        {/* Icons with tooltips: the words are their names. */}
        <IconButton ref={newButton} icon="plus" label="New in this project" title="New page, card, whiteboard or deck" aria-haspopup="menu" aria-expanded={menu?.kind === "new"} onClick={() => toggleMenu(newButton.current, "new")} />
        <ResumeWorkspace folder={folder} />
        <IconButton icon="page" label="Project page" title="Open the project page" onClick={() => useWorkspace.getState().openPath(project.path)} />
        <IconButton icon={full.on ? "shrink" : "expand"} label={full.on ? "Leave full window" : "Full window"} active={full.on} onClick={full.toggle} />
      </header>

      <div role="tablist" aria-label="Overview" className="kasten-overview-tabs" onKeyDown={onTabKey}>
        {tabs.map((tab, i) => (
          <button key={tab.id} id={`overview-tab-${i}`} type="button" role="tab" aria-selected={tab.id === current} aria-controls="overview-panel" tabIndex={tab.id === current ? 0 : -1} onClick={() => select(tab.id)} className="kasten-overview-tab">
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <span className="kasten-overview-tab-count">{tab.count}</span>}
          </button>
        ))}
        <button ref={tableButton} type="button" aria-label="New table" title="New table: a saved view of this project's notes" aria-haspopup="menu" aria-expanded={menu?.kind === "table"} className="kasten-overview-tab is-add" onClick={() => toggleMenu(tableButton.current, "table")}>
          <Icon name="plus" className="size-3.5" />
        </button>
      </div>

      <section id="overview-panel" role="tabpanel" aria-labelledby={`overview-tab-${tabs.findIndex((t) => t.id === current)}`} className="kasten-overview-body">
        {current === "all" && <PinnedSlot scope={{ kind: "project", folder }} />}
        {current === "all" && <AllTab folder={folder} notes={notes} boards={boards} decks={decks} />}
        {current === "captures" && <CapturesTab folder={folder} projectTitle={title} notes={notes} />}
        {current === "tasks" && (
          <Suspense fallback={<p className="kasten-overview-empty">Opening the task board…</p>}>
            <ProjectKanban folder={folder} />
          </Suspense>
        )}
        {current === "graph" && (
          <div className="kasten-overview-graph">
            <Suspense fallback={<p className="kasten-overview-empty">Opening the graph…</p>}>
              <GraphView scope={scope} embedded />
            </Suspense>
          </div>
        )}
        {table && <TableTab key={table.name} table={table} folder={folder} projectTitle={title} notes={notes} onChange={(next) => changeTable(table, next)} onDuplicate={() => duplicate(table)} onDelete={() => deleteTable(table.name)} />}
      </section>

      {menu && <PointMenu x={menu.x} y={menu.y} label={menu.kind === "new" ? "New in this project" : "New table"} items={menu.kind === "new" ? newItems : tableItems} anchor={menu.kind === "new" ? newButton : tableButton} onClose={() => setMenu(null)} />}
    </div>
  );
}
