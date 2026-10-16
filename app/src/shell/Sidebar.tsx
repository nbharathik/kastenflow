import { useMemo, useState, type ReactNode } from "react";

import { useBoards } from "../features/boards/store";
import { useDiagrams } from "../features/diagrams/store";
import { useDecks } from "../features/slides/store";
import { SIDEBAR_WIDTH, usePrefs } from "../features/workspace/prefs";
import { matchTree, sidebarLoose, type Named } from "../features/workspace/sidebar-rows";
import { describeBackup, useVaultStatus } from "../features/workspace/status";
import { howFrom, useWorkspace } from "../features/workspace/store";
import { noteAt, noteFolders } from "../features/workspace/tree";
import { useShell } from "../lib/store";
import { BrandMark } from "../ui/BrandMark";
import { keyTitle, useKeyLabel } from "../features/shortcuts/store";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";
import { ResizeHandle } from "../ui/ResizeHandle";
import { SETTINGS_NAV } from "./nav";
import { FavouriteBoards } from "./BoardRows";
import { FavouriteDecks } from "./DeckRows";
import { FavouriteDiagrams } from "./DiagramRows";
import { FolderTree } from "./FolderTree";
import { Menu } from "./Menu";
import { ACTIVE_ROW, IDLE_ROW, openView, ROW, useActive } from "./NavRow";
import { RowList, TreeRow } from "./PageTree";
import { DROP_INTO, useDropInto } from "./drop-into";
import { ProjectsHubButton } from "./projects/HubButton";
import { ProjectList } from "./projects/ProjectList";
import { SelectionBar } from "./SelectionBar";
import { SidebarNav } from "./SidebarNav";
import { DOT } from "./StatusBar";
import { TreeFilterBox, TreeFilterProvider } from "./tree-filter";

export function Sidebar() {
  const toggleSidebar = useShell((s) => s.toggleSidebar);
  const setPalette = useShell((s) => s.setPalette);
  const paletteKey = useKeyLabel("palette");
  const notes = useWorkspace((s) => s.notes);
  const client = useWorkspace((s) => s.client);
  const create = useWorkspace((s) => s.create);
  const newPage = useWorkspace((s) => s.newPage);
  const favourites = usePrefs((s) => s.favourites);
  const pinnedPages = usePrefs((s) => s.pinnedPages);
  const savedWidth = usePrefs((s) => s.sidebarWidth);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  const diagrams = useDiagrams((s) => s.list);
  // The width while its edge is dragged; the preference once it is let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? savedWidth;
  const homeActive = useActive("home");
  const pagesDrop = useDropInto(null);
  const naming = useShell((s) => s.namingProject);
  const setNaming = useShell.getState().nameProject;
  const favouriteNotes = favourites.map((p) => noteAt(notes, p)).filter((n): n is NonNullable<typeof n> => Boolean(n));
  const favouriteBoards = favourites.filter((p) => p.endsWith(".canvas"));
  const favouriteDecks = favourites.filter((p) => p.endsWith(".deck"));
  const favouriteDiagrams = favourites.filter((p) => p.endsWith(".drawio"));

  // What is typed in the filter box narrows the tree to the titles that
  // match, whiteboards, decks and diagrams included, with what holds them opened out.
  const [query, setQuery] = useState("");
  const named = useMemo<Named[]>(() => [...boards, ...decks, ...diagrams].map(({ path, title, project }) => ({ path, title, project: project ?? null })), [boards, decks, diagrams]);
  const match = useMemo(() => matchTree(notes, query, named), [notes, query, named]);

  return (
    <nav aria-label="Sidebar" data-peek-closes className="relative flex shrink-0 flex-col border-r border-line bg-panel pb-2 pt-2.5" style={{ width }}>
      <div className="mb-2 flex items-center gap-2.5 px-3 py-1">
        <BrandMark tile className="size-7" />
        <span className="min-w-0 flex-1 leading-tight" title={client?.label}>
          <span className="block truncate text-14 font-semibold">KastenFlow</span>
          {client?.label && <span className="block truncate text-12 text-muted">{client.label}</span>}
        </span>
        <button
          type="button"
          aria-label="Hide sidebar"
          title={keyTitle("Hide sidebar", "sidebar")}
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink"
        >
          <Icon name="sidebar" className="size-[17px]" />
        </button>
      </div>

      <div className="space-y-px px-2">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className={`${ROW} ${IDLE_ROW}`}
        >
          <Icon name="search" className="size-[17px]" />
          <span className="flex-1">Search</span>
          {paletteKey && <Kbd keys={paletteKey} className="opacity-0 transition-opacity group-hover/row:opacity-100" />}
        </button>
        <button
          type="button"
          onClick={(event) => openView("home", howFrom(event))}
          onAuxClick={(event) => event.button === 1 && openView("home", "tab")}
          aria-current={homeActive ? "page" : undefined}
          className={`${ROW} ${homeActive ? ACTIVE_ROW : IDLE_ROW}`}
        >
          <Icon name="home" className="size-[17px]" />
          <span className="flex-1">Home</span>
        </button>
        <SidebarNav />
        <button type="button" onClick={() => newPage()} className={`${ROW} ${IDLE_ROW}`} title={keyTitle("New page", "new-page")}>
          <Icon name="compose" className="size-[17px]" />
          <span className="flex-1">New page</span>
        </button>
      </div>

      <div data-tree="" className="mt-2 min-h-0 flex-1 overflow-y-auto px-2">
        <TreeFilterBox value={query} onChange={setQuery} />
        <TreeFilterProvider value={match}>
          {match && match.show.size === 0 && <p className="px-3 py-2 text-13 text-muted">No page is called “{query.trim()}”.</p>}
          {(favouriteNotes.length > 0 || favouriteBoards.length > 0 || favouriteDecks.length > 0 || favouriteDiagrams.length > 0) && (
            <Section title="Favourites">
              {favouriteNotes.map((note) => (
                <TreeRow key={note.path} note={note} />
              ))}
              <FavouriteBoards paths={favouriteBoards} />
              <FavouriteDecks paths={favouriteDecks} />
              <FavouriteDiagrams paths={favouriteDiagrams} />
            </Section>
          )}
          <Section title="Projects" onAdd={() => setNaming(true)} addLabel="New project" actions={<ProjectsHubButton />}>
            <ProjectList>
              {naming && (
                <li className="px-1 py-0.5">
                  <input
                    autoFocus
                    aria-label="Project name"
                    placeholder="Project name, then Enter"
                    className="h-7 w-full rounded-md border border-accent/60 bg-canvas px-2 text-13 outline-none"
                    onBlur={() => setNaming(false)}
                    onKeyDown={(event) => {
                      const name = event.currentTarget.value.trim();
                      if (event.key === "Escape") setNaming(false);
                      if (event.key !== "Enter" || !name) return;
                      setNaming(false);
                      // A new project starts blank; "/" then "Template…" in
                      // its empty page fills it from one.
                      void create({ kind: "project", title: name, template: null });
                    }}
                  />
                </li>
              )}
            </ProjectList>
          </Section>
          <Section title="Pages" onAdd={() => newPage()} addLabel="New page" drop={pagesDrop}>
            <RowList notes={sidebarLoose(notes, pinnedPages)} listKey="pages" />
          </Section>
          {noteFolders(notes).count > 0 && (
            <Section title="Folders">
              <FolderTree root={noteFolders(notes)} />
            </Section>
          )}
        </TreeFilterProvider>
      </div>

      <SelectionBar />
      <div className="mt-1 flex items-center gap-1 border-t border-line px-2 pt-2">
        <FooterButton />
        <HelpMenu />
        <BackupDot />
      </div>
      <ResizeHandle
        label="Resize the sidebar"
        edge="right"
        width={width}
        {...SIDEBAR_WIDTH}
        onChange={setDragWidth}
        onCommit={(w) => {
          usePrefs.getState().set({ sidebarWidth: w });
          setDragWidth(null);
        }}
      />
    </nav>
  );
}

/** Settings, at the foot of the sidebar. */
function FooterButton() {
  const active = useActive(SETTINGS_NAV.id);
  return (
    <button
      type="button"
      title={SETTINGS_NAV.label}
      aria-label={SETTINGS_NAV.label}
      aria-current={active ? "page" : undefined}
      onClick={(event) => openView(SETTINGS_NAV.id, howFrom(event))}
      className={`rounded-md p-1.5 transition-colors hover:bg-hover hover:text-ink ${active ? "bg-selected text-ink" : "text-muted"}`}
    >
      <Icon name={SETTINGS_NAV.icon} className="size-[17px]" />
    </button>
  );
}

/** Help: the keyboard shortcuts and the tour of the app. */
function HelpMenu() {
  return (
    <Menu
      label="Help"
      align="left"
      float
      buttonClass="rounded-md p-1.5 text-muted transition-colors hover:bg-hover hover:text-ink"
      items={[
        { label: "Keyboard shortcuts", hint: "?", onSelect: () => useShell.getState().setShortcuts(true) },
        { label: "Take the tour", onSelect: () => void useWorkspace.getState().takeTour() },
      ]}
    >
      <Icon name="help" className="size-[17px]" />
    </Menu>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  /** Small buttons beside the heading, ahead of "+". */
  actions?: ReactNode;
  /** Pages dropped here move in. */
  drop?: ReturnType<typeof useDropInto>;
}

function Section({ title, children, onAdd, addLabel, actions, drop }: SectionProps) {
  const folded = usePrefs((s) => s.foldedSections.includes(title));
  const fold = () => {
    const { foldedSections, set } = usePrefs.getState();
    set({ foldedSections: folded ? foldedSections.filter((t) => t !== title) : [...foldedSections, title] });
  };
  return (
    <section className={`mt-4 ${drop?.over ? DROP_INTO : ""}`} aria-label={title} data-drop-into={drop?.over ? "" : undefined} {...drop?.handlers}>
      <div className="group flex h-6 items-center pl-1 pr-2">
        <h2 className="flex-1">
          <button type="button" aria-expanded={!folded} onClick={fold} className="flex items-center gap-1 rounded px-1 text-12 font-medium text-muted hover:text-ink">
            {title}
            <Icon name="chevron" className={`size-3 opacity-0 group-hover:opacity-100 ${folded ? "" : "rotate-90"}`} />
          </button>
        </h2>
        {actions}
        {onAdd && (
          <button
            type="button"
            aria-label={addLabel}
            title={addLabel}
            onClick={onAdd}
            className="grid size-5 place-items-center rounded-md text-muted opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100 focus:opacity-100"
          >
            <Icon name="plus" className="size-3.5" />
          </button>
        )}
      </div>
      {!folded && <ul>{children}</ul>}
    </section>
  );
}

/** The backup status dot; the status bar has the words. */
function BackupDot() {
  const status = useVaultStatus((s) => s.status);
  const error = useVaultStatus((s) => s.error);
  const client = useWorkspace((s) => s.client);
  const shown = status ? describeBackup(status) : null;
  const tone = error ? "failing" : (shown?.tone ?? "off");
  const label = client?.kind === "preview" ? `Browser preview: notes are kept ${client.kept === "memory" ? "until you reload" : "in this browser"}` : error ? `Problem saving history: ${error}` : shown ? `${shown.label}. ${shown.detail}` : "Backup status";
  return <span className={`ml-auto mr-1.5 size-2 rounded-full ring-4 ring-hover ${DOT[tone]}`} role="status" aria-label={label} title={label} />;
}
