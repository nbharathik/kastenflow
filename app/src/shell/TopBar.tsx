import { useRef, useState, type MouseEvent } from "react";

import { mapKey } from "../features/boards/map-sync";
import { findOrMakeMap } from "../features/boards/page-map";
import { useBoards } from "../features/boards/store";
import { askAboutPage } from "../features/chat/actions";
import { useSourceTitle } from "../features/sources/store";
import { reloadLists } from "../features/workspace/reload";
import { linkFor } from "../features/workspace/links";
import { isDraft } from "../features/workspace/drafts";
import { iconOf, titleOf } from "../features/workspace/names";
import { usePrefs } from "../features/workspace/prefs";
import { howFrom, useWorkspace } from "../features/workspace/store";
import { activeTab, type Pane, type ViewId } from "../features/workspace/tabs";
import { ancestors, movable, noteAt, projects } from "../features/workspace/tree";
import { useShell } from "../lib/store";
import type { NoteMeta } from "../lib/vault/types";
import { keyHint, keyTitle } from "../features/shortcuts/store";
import { JournalActions, JournalCrumbs } from "../features/journal/JournalBar";
import { journalPath } from "../features/journal/feed";
import { isoDay } from "../lib/dates";
import { BoardActions, BoardCrumbs } from "./BoardBar";
import { PageStyle } from "./PageStyle";
import { setLocked } from "../features/workspace/page/page-lock";
import { saveAsTemplate } from "../features/templates/kits";
import { copyAsMarkdown, showInFolder } from "../features/workspace/page/page-file";
import { foldAllSections } from "../features/pages/editor/sections/registry";
import { presentThisPage, sectionsToDeck, toggleSmartLayout, useSmartLayout } from "../features/pages/present/actions";
import { inTauri } from "../lib/api";
import { Icon } from "../ui/Icon";
import { IconOrEmoji } from "../ui/IconOrEmoji";
import { lineIcon } from "../ui/glyph";
import { homeItem, templateItems } from "../features/projects/home-menu";
import { Menu } from "./Menu";
import { findNav } from "./nav";
import { openMenuHandlers } from "./open-menu";
import { PageOpensMenu } from "./PageOpens";

const iconButton = "ui-icon-btn";

const STATUS = { saved: "Saved", edited: "Edited", saving: "Saving…", failed: "Not saved" } as const;

/** Above each pane's view: back and forward, where you are, and the page's actions. */
export function TopBar({ pane, first }: { pane: Pane; first: boolean }) {
  const tab = activeTab(pane);
  const place = tab.place;
  const notes = useWorkspace((s) => s.notes);
  const panes = useWorkspace((s) => s.layout.panes.length);
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const note = place.view === "page" && place.path ? noteAt(notes, place.path) : undefined;
  // The journal's day: its page's actions once it has one.
  const day = place.view === "journal" ? noteAt(notes, place.path ?? journalPath(isoDay(new Date()))) : undefined;
  const board = place.view === "boards" && place.path ? place.path : null;
  // The buttons act on this pane: focus it first.
  const inPane = (run: () => void) => () => {
    useWorkspace.getState().focusPane(pane.id);
    run();
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 px-3">
      {!sidebarOpen && first && (
        <button type="button" aria-label="Show sidebar" title={keyTitle("Show sidebar", "sidebar")} onClick={useShell.getState().toggleSidebar} className={iconButton}>
          <Icon name="sidebar" />
        </button>
      )}
      <button type="button" aria-label="Back" title={keyTitle("Back", "back")} disabled={tab.back.length === 0} onClick={inPane(() => useWorkspace.getState().goBack())} className={iconButton}>
        <Icon name="back" />
      </button>
      <button type="button" aria-label="Forward" title={keyTitle("Forward", "forward")} disabled={tab.forward.length === 0} onClick={inPane(() => useWorkspace.getState().goForward())} className={iconButton}>
        <Icon name="forward" />
      </button>
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-1 text-13">
        {note ? (
          <Breadcrumb note={note} notes={notes} />
        ) : board ? (
          <BoardCrumbs path={board} />
        ) : place.view === "tags" && place.path ? (
          <ViewCrumbs view="tags" current={place.path} />
        ) : place.view === "highlights" && place.path ? (
          <SourceCrumbs path={place.path} />
        ) : place.view === "journal" ? (
          <JournalCrumbs path={place.path} />
        ) : place.view === "page" && isDraft(place.path) ? (
          <span className="truncate font-medium">New page</span>
        ) : (
          <span className="truncate font-medium">{viewTitle(place.view)}</span>
        )}
      </div>
      {place.view === "journal" && <JournalActions />}
      {(note ?? day) && <PageActions note={(note ?? day)!} paneId={pane.id} />}
      {board && <BoardActions path={board} />}
      {panes > 1 && (
        <button type="button" aria-label="Close pane" title="Close pane" onClick={() => useWorkspace.getState().closePane(pane.id)} className={iconButton}>
          <Icon name="close" />
        </button>
      )}
    </header>
  );
}

/** "Tag Database › #task": the first part leads back to the whole view. */
function ViewCrumbs({ view, current, icon }: { view: ViewId; current: string; icon?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <button type="button" className="rounded px-1 text-muted hover:bg-hover hover:text-ink" onClick={(e) => useWorkspace.getState().go({ view }, howFrom(e))}>
        {viewTitle(view)}
      </button>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
      {icon && <IconOrEmoji icon={icon} />}
      <span className="truncate font-medium">{current}</span>
    </span>
  );
}

/** "Highlights › A primer", for a PDF open in the reader. */
function SourceCrumbs({ path }: { path: string }) {
  return <ViewCrumbs view="highlights" current={useSourceTitle(path)} icon={lineIcon("book")} />;
}

function viewTitle(view: string): string {
  if (view === "home") return "Home";
  if (view === "tasks") return "Tasks";
  if (view === "overview") return "Project overview";
  if (view === "web") return "Browser";
  return findNav(view as never)?.label ?? "";
}

/** A parent in the breadcrumb: a plain click goes there, Ctrl, Shift, Alt
 * and the middle button open it as they do anywhere, right-click shows the
 * Open menu. */
function Crumb({ note, current }: { note: NoteMeta; current?: boolean }) {
  const openPath = useWorkspace((s) => s.openPath);
  const Tag = current ? "span" : "button";
  return (
    <Tag
      {...(current ? {} : { type: "button" as const, onClick: (e: MouseEvent) => openPath(note.path, howFrom(e)), ...openMenuHandlers(note.path) })}
      className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 ${current ? "font-medium" : "text-muted hover:bg-hover hover:text-ink"}`}
    >
      <IconOrEmoji icon={iconOf(note)} />
      <span className="truncate">{titleOf(note)}</span>
    </Tag>
  );
}

/** Parents left out of a long breadcrumb, as a menu of them. */
function HiddenCrumbs({ notes }: { notes: NoteMeta[] }) {
  const { openPath } = useWorkspace.getState();
  return (
    <Menu
      label="Show the parents left out"
      align="left"
      float
      buttonClass="rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-ink"
      items={notes.map((note) => ({ label: titleOf(note), icon: <IconOrEmoji icon={iconOf(note)} />, onSelect: () => openPath(note.path) }))}
    >
      …
    </Menu>
  );
}

function Breadcrumb({ note, notes }: { note: NoteMeta; notes: NoteMeta[] }) {
  const project = note.kind !== "project" && note.project ? projects(notes).find((p) => p.project === note.project) : undefined;
  const chain = [...(project ? [project] : []), ...ancestors(notes, note).filter((a) => a.path !== project?.path)];
  const shown = chain.length > 3 ? [chain[0]!, ...chain.slice(-2)] : chain;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5">
      {shown.map((crumb, i) => (
        <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
          {i === 1 && chain.length > 3 && <HiddenCrumbs notes={chain.slice(1, -2)} />}
          <Crumb note={crumb} />
          <span className="text-muted/70">/</span>
        </span>
      ))}
      <Crumb note={note} current />
    </nav>
  );
}

function PageActions({ note, paneId }: { note: NoteMeta; paneId: string }) {
  const saveState = useShell((s) => s.saveStates[note.path] ?? "saved");
  const panelOpen = useShell((s) => s.panels.includes(paneId));
  const sourceOpen = useShell((s) => s.sourceOpen);
  const prefs = usePrefs();
  const favourite = prefs.favourites.includes(note.path);
  const shell = useShell.getState();
  const [choosing, setChoosing] = useState(false);
  const smart = useSmartLayout(note.path);
  // A page has one mind map: the menu opens it once it exists.
  const hasMap = useBoards((s) => s.list.some((b) => b.source !== undefined && (b.source === mapKey(note) || b.source === note.path)));
  const actions = useRef<HTMLDivElement>(null);

  return (
    <div ref={actions} className="flex shrink-0 items-center gap-0.5">
      <span role="status" title={STATUS[saveState]} className={`mr-1.5 flex items-center gap-1.5 rounded px-2 py-0.5 text-12 ${saveState === "failed" ? "bg-danger/10 text-danger" : "text-muted"}`}>
        <span className={`size-1.5 rounded-full ${saveState === "saved" ? "bg-success" : saveState === "failed" ? "bg-danger" : "animate-pulse bg-warning"}`} aria-hidden="true" />
        <span className="kasten-topbar-word">{STATUS[saveState]}</span>
      </span>
      {movable(note) && !note.project && !note.parent && (
        <button type="button" onClick={() => shell.setMoving(note.path)} title="Put this page in a project" className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-13 text-muted transition-colors hover:bg-hover hover:text-ink">
          <Icon name="move-to" className="size-4" />
          <span className="kasten-topbar-word">Add to project</span>
        </button>
      )}
      <button
        type="button"
        aria-label={favourite ? "Remove from Favourites" : "Add to Favourites"}
        title={favourite ? "Remove from Favourites" : "Add to Favourites"}
        aria-pressed={favourite}
        onClick={() => prefs.toggleFavourite(note.path)}
        className={`${iconButton} ${favourite ? "text-favourite" : ""}`}
      >
        <Icon name="star" className={favourite ? "fill-current" : ""} />
      </button>
      <button type="button" aria-label="Outline and details" title={keyTitle("Outline and details", "panel")} aria-pressed={panelOpen} onClick={() => shell.togglePanel(paneId)} className={`${iconButton} ${panelOpen ? "bg-line/60 text-ink" : ""}`}>
        <Icon name="panel" />
      </button>
      <Menu
        label="Page options"
        buttonClass={iconButton}
        header={<PageStyle path={note.path} />}
        items={[
          { label: "Copy link", icon: <Icon name="link" className="size-4" />, hint: "[[ ]]", onSelect: () => void navigator.clipboard?.writeText(linkFor(note, useWorkspace.getState().notes)) },
          { label: "Open in new tab", icon: <Icon name="external" className="size-4" />, hint: "Ctrl+click", onSelect: () => useWorkspace.getState().openPath(note.path, "tab") },
          { label: "Open in split view", icon: <Icon name="split" className="size-4" />, hint: keyHint("split"), onSelect: () => useWorkspace.getState().splitRight() },
          { label: "Open in side peek", icon: <Icon name="peek-side" className="size-4" />, onSelect: () => useWorkspace.getState().openPath(note.path, "peek-side") },
          { label: "Open links from this page in…", icon: <Icon name="open" className="size-4" />, onSelect: () => setChoosing(true) },
          "divider",
          ...(movable(note)
            ? [
                { label: "Duplicate", icon: <Icon name="copy" className="size-4" />, onSelect: () => void useWorkspace.getState().duplicate(note.path) },
                { label: "Move to…", icon: <Icon name="move-to" className="size-4" />, onSelect: () => shell.setMoving(note.path) },
              ]
            : []),
          ...(note.kind === "project" ? [homeItem(note), ...templateItems(note)] : []),
          { label: "Ask AI about this page", icon: <Icon name="sparkle" className="size-4" />, hint: keyHint("chat-dock"), onSelect: () => askAboutPage(note) },
          { label: note.locked ? "Unlock for agents" : "Lock for agents", icon: <Icon name="agent" className="size-4" />, onSelect: () => void setLocked(note, !note.locked) },
          { label: hasMap ? "Open mind map" : "Mind map from this page", icon: <Icon name="board" className="size-4" />, onSelect: () => void mapPage(note) },
          ...(movable(note) ? [{ label: "Save as template", icon: <Icon name="template" className="size-4" />, onSelect: () => void saveAsTemplate(note.path, titleOf(note)).then((name) => name && shell.openGallery({ select: name })) }] : []),
          { label: sourceOpen ? "Hide Markdown file" : "Show Markdown file", icon: <Icon name="code" className="size-4" />, onSelect: shell.toggleSource },
          { label: "Copy as Markdown", icon: <Icon name="copy" className="size-4" />, onSelect: () => void copyAsMarkdown(note) },
          { label: "Present this page", icon: <Icon name="present" className="size-4" />, onSelect: () => presentThisPage(note) },
          { label: "Smart layout", checked: smart, onSelect: () => toggleSmartLayout(note) },
          { label: "Turn sections into a deck", icon: <Icon name="template" className="size-4" />, onSelect: () => sectionsToDeck(note) },
          { label: "Fold all sections", icon: <Icon name="fold" className="size-4" />, onSelect: () => foldSections(true, note) },
          { label: "Unfold all sections", icon: <Icon name="chevrons-up-down" className="size-4" />, onSelect: () => foldSections(false, note) },
          ...(inTauri() ? [{ label: "Show in folder", icon: <Icon name="folder" className="size-4" />, onSelect: () => void showInFolder(note.path) }] : []),
          { label: "Focus mode", icon: <Icon name="expand" className="size-4" />, hint: keyHint("focus"), onSelect: shell.toggleFocus },
          { label: "Print or save as PDF", icon: <Icon name="print" className="size-4" />, onSelect: () => window.print() },
          "divider",
          { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void useWorkspace.getState().trash(note.path) },
        ]}
      >
        <Icon name="more" />
      </Menu>
      {choosing && <PageOpensMenu path={note.path} anchor={actions} onClose={() => setChoosing(false)} />}
    </div>
  );
}

/** Folds or unfolds every section of `note`, the page cut at its `---` lines, saying how to make some when it has none. */
function foldSections(folded: boolean, note: NoteMeta): void {
  if (foldAllSections(folded, note.id || note.path) === 0) useWorkspace.getState().toast("This page has no sections yet: a line of --- starts one.");
}

/** Opens the page's mind map, making it only when it has none. */
async function mapPage(note: NoteMeta): Promise<void> {
  const { client, openPath, toast } = useWorkspace.getState();
  if (!client) return;
  try {
    const { path, created } = await findOrMakeMap(client, note);
    await reloadLists();
    openPath(path);
    if (created) toast(`Made “${note.title} map”: Tab on a branch grows it`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}
