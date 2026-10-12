import { memo, useMemo, useState, type DragEvent, type KeyboardEvent, type LiHTMLAttributes, type ReactNode } from "react";

import { startNewBoard, useBoards } from "../features/boards/store";
import { openOverview } from "../features/projects/overview/open";
import { startNewDeck, useDecks } from "../features/slides/store";
import { dragNotes } from "../features/workspace/drag";
import { HOLDS_PAGES } from "../features/workspace/page/new-page-home";
import { iconOf, titleOf } from "../features/workspace/names";
import { howFromPage } from "../features/workspace/open-how";
import { usePrefs } from "../features/workspace/prefs";
import { sidebarRows } from "../features/workspace/sidebar-rows";
import { useWorkspace, type WorkspaceState } from "../features/workspace/store";
import { nestNote } from "../features/workspace/placing";
import { holders, movable, treeOf } from "../features/workspace/tree";
import { useShell } from "../lib/store";
import type { NoteMeta } from "../lib/vault/types";
import { ProjectBoards } from "./BoardRows";
import { ProjectDecks } from "./DeckRows";
import { DROP_INTO, useNestDrop } from "./drop-into";
import { Icon } from "../ui/Icon";
import { IconOrEmoji } from "../ui/IconOrEmoji";
import { Menu, openRowMenu, type MenuItem } from "./Menu";
import { openItems, openMenuHandlers } from "./open-menu";
import { PinMark } from "./PinMark";
import { ShowMoreRow, useRowLimit } from "./row-limit";
import { keeps, useTreeFilter } from "./tree-filter";
import { treeKey } from "./tree-keys";
import { rowOrder, useSidebarSelection } from "./selection";

const EXPANDED_KEY = "kasten.expanded";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Which rows are open, shared by every tree and kept across restarts. */
const expanded = loadExpanded();

export function useExpanded(path: string, auto: boolean): [boolean, () => void] {
  const [, redraw] = useState(0);
  const open = expanded.has(path) || auto;
  const toggle = () => {
    if (open) expanded.delete(path);
    else expanded.add(path);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // Only a convenience.
    }
    redraw((n) => n + 1);
  };
  return [open, toggle];
}

const currentPage = (s: WorkspaceState) => (s.place.view === "page" ? s.place.path : undefined);

/** What a row in the Projects list adds to a plain row (shell/projects). */
export interface RowExtras {
  /** More menu items, above "Move to Trash". */
  menu?: (MenuItem | "divider")[];
  /** Shown at the end of the row, such as a pin. */
  badge?: ReactNode;
  /** Props for the row's list item, such as drop handling. */
  item?: LiHTMLAttributes<HTMLLIElement> & { [data: `data-${string}`]: string | undefined };
  /** Runs as the row starts being dragged, after it carries its note. */
  onDragStart?: (event: DragEvent) => void;
  /** Keys pressed while the row has focus. */
  onKeyDown?: (event: KeyboardEvent) => void;
}

/** Rows of notes, the first few with "Show more" for the rest, how far
 * kept for the session under `listKey`. The open page and its parents
 * always show, even past the cut. With a filter typed, every match shows. */
export function RowList({ notes, depth = 0, listKey }: { notes: NoteMeta[]; depth?: number; listKey: string }) {
  const filter = useTreeFilter();
  const [limit, more] = useRowLimit(listKey);
  const visible = useMemo(() => (filter ? notes.filter((n) => filter.show.has(n.path)) : notes), [notes, filter]);
  const cut = !filter && visible.length > limit;
  const held = useWorkspace((s) => (cut ? rowsPast(visible, limit, s) : ""));
  const shown = cut ? visible.slice(0, limit) : visible;
  const extra = cut && held ? visible.slice(limit).filter((n) => held.split("\n").includes(n.path)) : [];
  return (
    <>
      {[...shown, ...extra].map((note) => (
        <TreeRow key={note.path} note={note} depth={depth} />
      ))}
      {cut && <ShowMoreRow shown={limit} total={visible.length} depth={depth} onMore={more} />}
    </>
  );
}

/** Paths past the cut that hold or are the open page, as one string so the
 * store selector stays cheap to compare. */
function rowsPast(notes: NoteMeta[], limit: number, s: WorkspaceState): string {
  const current = currentPage(s);
  if (!current) return "";
  const hold = holders(s.notes, current);
  const out: string[] = [];
  for (let i = limit; i < notes.length; i++) {
    const path = notes[i]!.path;
    if (path === current || hold.has(path)) out.push(path);
  }
  return out.join("\n");
}

/** One note in the sidebar, Notion style: chevron, icon, title, and on hover
 * "+" for a sub-page and "•••" for more. Children nest below. Rows redraw
 * only when their own note, children or state change. */
export const TreeRow = memo(function TreeRow({ note, depth = 0, extras }: { note: NoteMeta; depth?: number; extras?: RowExtras }) {
  const filter = useTreeFilter();
  const active = useWorkspace((s) => currentPage(s) === note.path);
  const holdsCurrent = useWorkspace((s) => holders(s.notes, currentPage(s)).has(note.path));
  const showCards = usePrefs((s) => s.sidebarShowCards);
  const pins = usePrefs((s) => s.pinnedPages);
  // Quick notes stay out of the tree unless asked for; a filter finds them.
  const children = useWorkspace((s) => sidebarRows(s.notes, note, showCards || filter !== null, pins));
  const favourite = usePrefs((s) => s.favourites.includes(note.path));
  const pinned = pins.includes(note.path);
  const [open, toggle] = useExpanded(note.path, holdsCurrent || Boolean(filter?.open.has(note.path)));
  const [renaming, setRenaming] = useState(false);
  const hasBoards = useBoards((s) => note.kind === "project" && s.list.some((b) => b.project === note.project));
  const hasDecks = useDecks((s) => note.kind === "project" && s.list.some((d) => d.project === note.project));
  // The page this one is inside, to take it out again.
  const holder = useWorkspace((s) => (note.parent ? treeOf(s.notes).byId.get(note.parent) : undefined));
  const nestDrop = useNestDrop(note);
  const { openPath, newPage, trash } = useWorkspace.getState();
  // While pages are picked (selection.ts), a click picks or unpicks.
  const picking = useSidebarSelection((s) => s.picked.length > 0);
  const picked = useSidebarSelection((s) => s.picked.includes(note.path));

  if (!keeps(filter, note.path)) return null;

  const startRename = () => {
    // The open page renames from its own title field, which owns its edits:
    // the one in the focused pane, where this page is open.
    const field = active ? document.querySelector<HTMLTextAreaElement>('.kasten-pane.is-focused textarea[aria-label="Page title"]') : null;
    if (field) {
      field.focus();
      field.select();
    } else setRenaming(true);
  };

  // Only pages and projects hold pages; under anything else a page would
  // show on its own.
  const holdsPages = HOLDS_PAGES.has(note.kind);
  const addChild = () => {
    if (!holdsPages) return;
    if (!open) toggle();
    if (note.kind === "project") newPage({ project: note.project });
    else newPage({ parent: note.path });
  };

  return (
    <li {...extras?.item}>
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          dragNotes(e, [note.path]);
          extras?.onDragStart?.(e);
        }}
        onKeyDown={(e) => {
          extras?.onKeyDown?.(e);
          if (!e.defaultPrevented) treeKey(e, { open, canOpen: children.length > 0, toggle });
        }}
        {...nestDrop.handlers}
        data-drop-into={nestDrop.over ? "" : undefined}
        data-row-path={note.path}
        onContextMenu={renaming ? undefined : openRowMenu}
        className={`group flex h-7 items-center gap-1 rounded-md pr-1 text-13 transition-colors ${picked ? "bg-soft" : active ? "bg-selected font-medium" : "hover:bg-hover"} ${nestDrop.over ? DROP_INTO : ""}`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        <button
          type="button"
          aria-label={open ? `Collapse ${titleOf(note)}` : `Expand ${titleOf(note)}`}
          className={`grid size-5 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink ${children.length ? "" : "invisible"}`}
          onClick={toggle}
        >
          <Icon name="chevron" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={note.title}
            aria-label={`New title for ${titleOf(note)}`}
            className="h-6 min-w-0 flex-1 rounded border border-accent/60 bg-canvas px-1.5 text-13 outline-none"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              const title = e.currentTarget.value.trim();
              if (e.key === "Escape") setRenaming(false);
              if (e.key !== "Enter") return;
              setRenaming(false);
              if (title && title !== note.title) void useWorkspace.getState().rename(note.path, title);
            }}
          />
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={(e) => {
              if (!picking) return openPath(note.path, howFromPage(e));
              const pick = useSidebarSelection.getState();
              if (e.shiftKey) pick.range(note.path, rowOrder());
              else pick.toggle(note.path);
            }}
            onAuxClick={openMenuHandlers(note.path).onAuxClick}
            onDoubleClick={() => !picking && note.kind !== "journal" && startRename()}
            aria-current={active ? "page" : undefined}
            aria-pressed={picking ? picked : undefined}
            aria-expanded={children.length > 0 ? open : undefined}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            data-row-title=""
          >
            <span className="grid w-5 shrink-0 place-items-center text-16 leading-none" aria-hidden="true">
              {picked ? <Icon name="circle-check" className="size-4 text-accent" /> : <IconOrEmoji icon={iconOf(note)} />}
            </span>
            <span className="truncate">{titleOf(note)}</span>
          </button>
        )}
        {extras?.badge ?? (pinned ? <PinMark /> : null)}
        <span className="hidden items-center group-focus-within:flex group-hover:flex">
          <Menu
            label={`More for ${titleOf(note)}`}
            float
            align="left"
            buttonClass="grid size-5 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
            items={[
              { label: picked ? "Unpick" : picking ? "Pick" : "Select", icon: <Icon name="circle-check" className="size-4" />, hint: picking ? "Click" : undefined, onSelect: () => useSidebarSelection.getState().toggle(note.path) },
              "divider",
              { label: favourite ? "Remove from Favourites" : "Add to Favourites", icon: <Icon name="star" className="size-4" />, onSelect: () => usePrefs.getState().toggleFavourite(note.path) },
              ...(note.kind === "page" ? [{ label: pinned ? "Unpin from the top" : "Pin to the top", icon: <Icon name="pin" className="size-4" />, onSelect: () => usePrefs.getState().togglePinnedPage(note.path) }] : []),
              "divider",
              ...openItems(note.path),
              "divider",
              ...(note.kind === "journal" ? [] : [{ label: "Rename", icon: <Icon name="edit" className="size-4" />, onSelect: startRename }]),
              ...(holdsPages ? [{ label: note.kind === "project" ? "Add a page" : "Add a sub-page", icon: <Icon name="page-plus" className="size-4" />, onSelect: addChild }] : []),
              ...(note.kind === "project" ? [{ label: "New whiteboard here", icon: <Icon name="board" className="size-4" />, onSelect: () => startNewBoard(note.project) }] : []),
              ...(note.kind === "project" ? [{ label: "New deck here", icon: <Icon name="present" className="size-4" />, onSelect: () => startNewDeck(note.project) }] : []),
              ...(note.kind === "project" ? [{ label: "Project overview", icon: <Icon name="expand" className="size-4" />, onSelect: () => openOverview(note) }] : []),
              ...(movable(note)
                ? [
                    { label: "Duplicate", icon: <Icon name="copy" className="size-4" />, onSelect: () => void useWorkspace.getState().duplicate(note.path) },
                    { label: "Move to…", icon: <Icon name="move-to" className="size-4" />, onSelect: () => useShell.getState().setMoving(note.path) },
                  ]
                : []),
              ...(holder?.kind === "page" && holder.path !== note.path
                ? [{ label: `Take out of “${titleOf(holder)}”`, icon: <Icon name="move-to" className="size-4" />, onSelect: () => void nestNote(note.path, null) }]
                : []),
              ...(extras?.menu ?? []),
              "divider",
              { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void trash(note.path) },
            ]}
          >
            <Icon name="more" className="size-4" />
          </Menu>
          {holdsPages && (
            <button
              type="button"
              aria-label={note.kind === "project" ? `Add a page to ${titleOf(note)}` : `Add a sub-page to ${titleOf(note)}`}
              title={note.kind === "project" ? "Add a page" : "Add a sub-page"}
              className="grid size-5 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
              onClick={addChild}
            >
              <Icon name="plus" className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      {open && (
        <ul>
          <RowList notes={children} depth={depth + 1} listKey={note.path} />
          {note.kind === "project" && note.project && <ProjectBoards project={note.project} depth={depth + 1} />}
          {note.kind === "project" && note.project && <ProjectDecks project={note.project} depth={depth + 1} />}
          {children.length === 0 && !(note.kind === "project" && (hasBoards || hasDecks)) && (
            <li className="py-1 text-13 text-muted" style={{ paddingLeft: `${30 + (depth + 1) * 14}px` }}>
              No pages inside
            </li>
          )}
        </ul>
      )}
    </li>
  );
});
