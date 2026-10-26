import "./tabs.css";

import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";

import { boardTitle, useBoards } from "../features/boards/store";
import { boxOf } from "../features/browser/bounds";
import { holdWhile, useOccludes } from "../features/browser/occlusion";
import { useWebTitles, webTitle } from "../features/browser/titles";
import { viewById } from "../plugins/contributions";
import { deckTitle, useDecks } from "../features/slides/store";
import { Popup } from "../features/pages/page/Popup";
import { draftSpec, isDraft } from "../features/workspace/drafts";
import { iconOf, titleOf } from "../features/workspace/names";
import { useWorkspace } from "../features/workspace/store";
import type { Pane, Place, Tab } from "../features/workspace/tabs";
import { noteAt } from "../features/workspace/tree";
import { whereIfShared } from "../features/workspace/where";
import type { BoardInfo, DeckInfo, NoteMeta, SourceInfo } from "../lib/vault/types";
import { sourceTitle, useSources } from "../features/sources/store";
import { IconOrEmoji } from "../ui/IconOrEmoji";
import { lineIcon } from "../ui/glyph";
import { Icon } from "../ui/Icon";
import { GlobalActions } from "./GlobalActions";
import { NewTabButton } from "./NewTab";
import { TabSets } from "./TabSets";
import { findNav } from "./nav";
import { useScrollEdges } from "./scroll-edges";

/** A tab's face: the note's icon and title, a board's or a PDF's title, or
 * the view's name, with the sidebar's line icon for it (ui/glyph.ts). */
export function tabFace(place: Place, notes: NoteMeta[], boards: readonly BoardInfo[] = [], sources: readonly SourceInfo[] = [], decks: readonly DeckInfo[] = []): { icon: string; title: string; where?: string } {
  // A browser tab is named by its page, as the page said, else its site.
  if (place.view === "web") return { icon: lineIcon("globe"), title: webTitle(place.url), ...(place.url ? { where: place.url } : {}) };
  if (place.view === "slides" && place.path) return { icon: lineIcon("present"), title: deckTitle(decks, place.path) };
  // A plugin's view may name a tab by the file it shows.
  const face = place.view.startsWith("plugin:") ? viewById(place.view)?.face?.(place) : null;
  if (face) return { icon: lineIcon(face.icon), title: face.title };
  if (place.view === "boards" && place.path) return { icon: lineIcon("board"), title: boardTitle(boards, place.path) };
  if (place.view === "highlights" && place.path) {
    return { icon: lineIcon("book"), title: sourceTitle(sources, place.path) };
  }
  if (place.view === "tags" && place.path) return { icon: lineIcon("tag"), title: place.path };
  if (place.view === "page") {
    if (isDraft(place.path)) return draftSpec(place.path)?.kind === "card" ? { icon: lineIcon("card"), title: "Quick note" } : { icon: lineIcon("page"), title: "New page" };
    const note = place.path ? noteAt(notes, place.path) : undefined;
    if (!note) return { icon: lineIcon("page"), title: place.path?.split("/").pop()?.replace(/\.md$/, "") ?? "Page" };
    // Pages that share a title say where they live, on hover.
    const where = whereIfShared(note, notes);
    return { icon: iconOf(note), title: titleOf(note), ...(where ? { where } : {}) };
  }
  if (place.view === "home") return { icon: lineIcon("home"), title: "Home" };
  if (place.view === "tasks") return { icon: lineIcon("tasks"), title: "Tasks" };
  // A project's overview and a graph around a page name what they are of.
  if (place.view === "overview") {
    const project = place.path ? noteAt(notes, place.path) : undefined;
    return { icon: lineIcon("dashboard"), title: project ? `${titleOf(project)} overview` : "Project overview" };
  }
  if (place.view === "graph" && place.path) {
    const page = noteAt(notes, place.path);
    return { icon: lineIcon("graph"), title: page ? `Graph · ${titleOf(page)}` : "Graph" };
  }
  const nav = findNav(place.view);
  return { icon: lineIcon(nav?.icon ?? "page"), title: nav?.label ?? place.view };
}

const NO_SOURCES: SourceInfo[] = [];

/** The data type tabs carry while dragged. */
export const TAB_DRAG = "application/x-kasten-tab";

interface MenuAt {
  tab: Tab;
  x: number;
  y: number;
}

/** A pane's tabs: click to switch, middle-click or × to close, drag to
 * reorder (or onto a pane's right edge to split), right-click for more.
 * The right-most pane's strip ends with the window's own actions. */
export function TabStrip({ pane, actions = false }: { pane: Pane; actions?: boolean }) {
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  const sources = useSources((s) => s.list) ?? NO_SOURCES;
  // Browser tabs are named by their pages' titles, which arrive as pages load.
  useWebTitles((s) => s.titles);
  const focused = useWorkspace((s) => s.layout.focus === pane.id);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ws = useWorkspace.getState();
  const list = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(list, pane.tabs.length);

  // The tab shown is kept in view as it changes, however many there are.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pane.active, pane.tabs.length]);

  const onDrop = (event: DragEvent, index: number) => {
    const data = event.dataTransfer.getData(TAB_DRAG);
    setOver(null);
    if (!data) return;
    const { paneId, tabId } = JSON.parse(data) as { paneId: string; tabId: string };
    event.preventDefault();
    if (paneId === pane.id) return ws.moveTab(pane.id, tabId, index);
    // From another pane: open here and close it there.
    const tab = useWorkspace
      .getState()
      .layout.panes.find((p) => p.id === paneId)
      ?.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    ws.focusPane(pane.id);
    ws.openTab(tab.place);
    ws.closeTab(paneId, tabId);
  };

  return (
    <div className="kasten-tabs flex h-9 shrink-0">
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        className={`kasten-tab-list flex min-w-0 items-end gap-0.5 overflow-x-auto pl-2 pt-1.5 ${focused ? "" : "opacity-90"}${edges.start ? " is-clipped-start" : ""}${edges.end ? " is-clipped-end" : ""}`}
        onDoubleClick={(e) => e.target === e.currentTarget && ws.openTab({ view: "home" })}
        onDragOver={(e) => e.dataTransfer.types.includes(TAB_DRAG) && e.preventDefault()}
        onDrop={(e) => onDrop(e, pane.tabs.length)}
      >
        {pane.tabs.map((tab, index) => {
          const face = tabFace(tab.place, notes, boards, sources, decks);
          const active = tab.id === pane.active;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              title={face.where ? `${face.title} · ${face.where}` : face.title}
              draggable
              tabIndex={active ? 0 : -1}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG, JSON.stringify({ paneId: pane.id, tabId: tab.id }));
                e.dataTransfer.effectAllowed = "move";
                // A browser tab's native view would take the drag from the panes under it.
                holdWhile("tab-drag");
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
                e.preventDefault();
                setOver(tab.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, index);
              }}
              onMouseDown={(e: MouseEvent) => {
                if (e.button === 1) {
                  e.preventDefault();
                  ws.closeTab(pane.id, tab.id);
                }
              }}
              onClick={() => ws.selectTab(pane.id, tab.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  ws.selectTab(pane.id, tab.id);
                  return;
                }
                // Arrows, Home and End go to another tab and show it.
                const count = pane.tabs.length;
                const to = e.key === "ArrowRight" ? (index + 1) % count : e.key === "ArrowLeft" ? (index + count - 1) % count : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : -1;
                if (to < 0) return;
                e.preventDefault();
                const list = e.currentTarget.parentElement;
                ws.selectTab(pane.id, pane.tabs[to]!.id);
                requestAnimationFrame(() => list?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus());
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ tab, x: e.clientX, y: e.clientY });
              }}
              className={`kasten-tab group ${active ? "is-active" : ""} ${tab.pinned ? "is-pinned" : ""} ${over === tab.id ? "is-over" : ""}`}
            >
              <span aria-hidden="true" className="kasten-tab-icon">
                <IconOrEmoji icon={face.icon} />
              </span>
              {!tab.pinned && <span className="kasten-tab-title">{face.title}</span>}
              {!tab.pinned && (
                <button
                  type="button"
                  aria-label={`Close ${face.title}`}
                  className="kasten-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    ws.closeTab(pane.id, tab.id);
                  }}
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {menu && <TabMenu pane={pane} at={menu} onClose={() => setMenu(null)} />}
      </div>
      {/* Outside the scrolling tabs, so it stays in reach however many there are. */}
      <div className="flex shrink-0 items-end pb-[3px] pl-0.5 pt-1.5">
        <NewTabButton />
      </div>
      <div
        aria-hidden="true"
        className="min-w-2 flex-1"
        onDoubleClick={() => ws.openTab({ view: "home" })}
        onDragOver={(e) => e.dataTransfer.types.includes(TAB_DRAG) && e.preventDefault()}
        onDrop={(e) => onDrop(e, pane.tabs.length)}
      />
      <div className="flex shrink-0 items-center pl-1 pr-1">
        <TabSets pane={pane} />
      </div>
      {actions && <GlobalActions />}
    </div>
  );
}

function TabMenu({ pane, at, onClose }: { pane: Pane; at: MenuAt; onClose: () => void }) {
  const ws = useWorkspace.getState();
  // Over a browser tab's page, the menu would be behind it.
  const box = useRef<HTMLDivElement>(null);
  useOccludes(true, () => (box.current ? boxOf(box.current.getBoundingClientRect()) : null));
  const items: [string, () => void][] = [
    [at.tab.pinned ? "Unpin tab" : "Pin tab", () => ws.togglePin(pane.id, at.tab.id)],
    ["Open in split view", () => ws.splitRight(at.tab.place)],
    ...(at.tab.place.view === "page" && at.tab.place.path ? [["Open in side stack", () => ws.openInStack(at.tab.place.path!)] as [string, () => void]] : []),
    ["Close tab", () => ws.closeTab(pane.id, at.tab.id)],
    ["Close other tabs", () => pane.tabs.filter((t) => t.id !== at.tab.id && !t.pinned).forEach((t) => ws.closeTab(pane.id, t.id))],
    ...(pane.tabs.findIndex((t) => t.id === at.tab.id) < pane.tabs.length - 1 ? [["Close tabs to the right", () => ws.closeRight(pane.id, at.tab.id)] as [string, () => void]] : []),
  ];
  return (
    <div ref={box} className="fixed z-50" style={{ left: at.x, top: at.y }}>
      <Popup label="Tab options" onClose={onClose} className="kasten-shell-menu min-w-48 p-1">
        {items.map(([label, run]) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-13 hover:bg-line/50"
            onClick={() => {
              onClose();
              run();
            }}
          >
            {label}
          </button>
        ))}
      </Popup>
    </div>
  );
}
