// Projects: every project at a glance, as a gallery of cards or a compact
// list. Each shows its status and health, how its to-dos are going, what to do
// next and when it last changed; a few counts above the list say what needs a
// look. Search, filter, sort, pin, re-status and archive from here, and start a
// new project from a setup. The data is one read of the project summaries,
// read again when the vault's notes, boards or decks change.

import "../state/state.css";
import "./hub.css";
import "./cards.css";

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import { PointMenu } from "../../../shell/PointMenu";
import { usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { NextActionDialog } from "../../review-screens/project/NextActionDialog";
import { refOfSummary, type ProjectRef } from "../../review-screens/project/refs";
import { cardMenu } from "./card-menu";
import type { CardActions } from "./CardParts";
import { Collection, Skeleton } from "./Collection";
import { HubBar } from "./HubBar";
import { HubEmpty, type EmptyKind } from "./HubEmpty";
import { canShift, openOverviewOf, openPageOf, shiftProject, togglePin } from "./hub-actions";
import { filterProjects, hubStats, sortProjects, statusCounts, type Focus } from "./hub-model";
import { useHubPrefs } from "./hub-prefs";
import { NewProject } from "./NewProject";
import { StatStrip } from "./StatStrip";
import type { NavActions } from "./use-card-nav";
import { useSummaries } from "./use-summaries";

/** Whether keys typed at `target` belong to a field or an editor. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
}

interface MenuAt {
  s: ProjectSummary;
  x: number;
  y: number;
}

export function ProjectsHub() {
  const vault = useWorkspace((s) => s.client?.label ?? "");
  const { list, now, error, reload } = useSummaries();
  const prefs = useHubPrefs((s) => s.prefs);
  const projectOrder = usePrefs((s) => s.projectOrder);
  const pinnedProjects = usePrefs((s) => s.pinnedProjects);
  const [text, setText] = useState("");
  const [archived, setArchived] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [naming, setNaming] = useState(false);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  /** The project whose next action is being picked. */
  const [pinning, setPinning] = useState<ProjectRef | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const searched = useDeferredValue(text);

  // The choices made for this vault, read before the first paint.
  useLayoutEffect(() => {
    useHubPrefs.getState().open(vault);
  }, [vault]);
  const choose = useHubPrefs.getState().set;

  const all = useMemo(() => list ?? [], [list]);
  const shown = useMemo(
    () => sortProjects(filterProjects(all, { status: prefs.status, archived, focus, text: searched }, now), prefs.sort, { projectOrder, pinnedProjects }),
    [all, now, prefs.status, archived, focus, searched, prefs.sort, projectOrder, pinnedProjects],
  );
  const stats = useMemo(() => hubStats(all, now), [all, now]);
  const counts = useMemo(() => statusCounts(all, archived), [all, archived]);
  const archivedCount = useMemo(() => all.filter((s) => s.archived).length, [all]);
  const pinned = useMemo(() => new Set(pinnedProjects), [pinnedProjects]);
  const folders = useMemo(() => shown.map((s) => s.folder), [shown]);
  /** The order can be changed by hand when the list is whole and in that order. */
  const reorderable = prefs.sort === "manual" && prefs.status === "all" && !archived && focus === null && searched.trim() === "";

  // "/" goes to the search field from anywhere in the window that is not a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      // With several panes, only the one that has the focus answers.
      const pane = root.current?.closest(".kasten-pane");
      if (!root.current?.isConnected || (pane && document.querySelectorAll(".kasten-pane").length > 1 && !pane.classList.contains("is-focused"))) return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cardActions = useMemo<CardActions>(
    () => ({
      menu(s, at, from) {
        anchor.current = from;
        // The "…" button of a card whose menu is open closes it, as a menu button does.
        setMenu((was) => (from !== null && was?.s.folder === s.folder ? null : { s, x: at.x, y: at.y }));
      },
    }),
    [],
  );
  const byFolder = (folder: string) => shown.find((s) => s.folder === folder);
  const navActions: NavActions = {
    open: (folder, how) => {
      const s = byFolder(folder);
      if (s) openOverviewOf(s, how);
    },
    page: (folder, how) => {
      const s = byFolder(folder);
      if (s) openPageOf(s, how);
    },
    pin: togglePin,
    menu: (folder, at) => {
      const s = byFolder(folder);
      if (s) cardActions.menu(s, at, null);
    },
    shift: (folder, step) => reorderable && shiftProject(folders, folders.indexOf(folder), step),
  };

  const filtered = prefs.status !== "all" || focus !== null || text.trim() !== "";
  const clear = () => {
    setText("");
    setFocus(null);
    choose({ status: "all" });
  };
  const kind: EmptyKind | null = error !== null && list === null ? "error" : list === null ? null : all.length === 0 ? "none" : shown.length > 0 ? null : archived && archivedCount === 0 ? "archived" : "matches";

  return (
    <div className="kasten-hub" ref={root}>
      <div className="kasten-hub-page">
        {kind === "none" || kind === "error" || list === null ? (
          <header className="kasten-hub-bar">
            <h1>Projects</h1>
          </header>
        ) : (
          <>
            <HubBar
              ref={field}
              total={counts.all}
              status={prefs.status}
              onStatus={(status) => choose({ status })}
              counts={counts}
              archived={archived}
              archivedCount={archivedCount}
              onArchived={setArchived}
              focus={focus}
              onFocus={setFocus}
              text={text}
              onText={setText}
              sort={prefs.sort}
              onSort={(sort) => choose({ sort })}
              layout={prefs.layout}
              onLayout={(layout) => choose({ layout })}
              onNew={() => setNaming(true)}
              onDown={() => root.current?.querySelector<HTMLElement>("[data-card]")?.focus()}
            />
            {!archived && <StatStrip stats={stats} status={prefs.status} focus={focus} onStatus={(status) => choose({ status })} onFocus={setFocus} />}
          </>
        )}
        {list === null && error === null && <Skeleton />}
        {kind && (
          <HubEmpty
            kind={kind}
            error={error}
            onNew={() => setNaming(true)}
            onClear={kind === "archived" ? () => setArchived(false) : clear}
            onRetry={reload}
          />
        )}
        {kind === null && list !== null && <Collection shown={shown} layout={prefs.layout} now={now} pinned={pinned} cardActions={cardActions} navActions={navActions} />}
        {filtered && kind === null && shown.length > 0 && (
          <p className="kasten-hub-foot-note">
            {shown.length} of {counts.all}
            <button type="button" className="kasten-hub-link" onClick={clear}>
              Clear filters
            </button>
          </p>
        )}
      </div>

      {naming && <NewProject onClose={() => setNaming(false)} />}
      {pinning && <NextActionDialog project={pinning} onClose={() => setPinning(null)} />}
      {menu && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          label={`${menu.s.title} options`}
          anchor={anchor}
          onClose={() => setMenu(null)}
          items={cardMenu({
            s: menu.s,
            pinned: pinned.has(menu.s.folder),
            earlier: reorderable && canShift(folders, folders.indexOf(menu.s.folder), -1),
            later: reorderable && canShift(folders, folders.indexOf(menu.s.folder), 1),
            onShift: (step) => shiftProject(folders, folders.indexOf(menu.s.folder), step),
            onNextAction: (s) => setPinning(refOfSummary(s)),
          })}
        />
      )}
    </div>
  );
}
