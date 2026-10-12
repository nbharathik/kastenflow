import "../../pages/editor/styles/tokens.css";
import "../../pages/page/page.css";
import "../../pages/page/popups.css";
import "./note-page.css";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { webTitle } from "../../../lib/api";
import { isDay } from "../../../lib/dates";
import { useShell } from "../../../lib/store";
import { showOpenMenu } from "../../../shell/open-menu";
import type { VaultClient } from "../../../lib/vault/types";
import { refreshMentions } from "../../pages/editor/blocks/wikilink-view";
import type { LinkHow, LinkProvider } from "../../pages/editor/links";
import { PageEditor, type PageEditorHandle } from "../../pages/editor/PageEditor";
import { PageHeader } from "../../pages/page/PageHeader";
import { PagePresenter } from "../../pages/present/PagePresenter";
import { SectionStrip } from "../../pages/present/SectionStrip";
import { usePresenting } from "../../pages/present/use-presenting";
import { readPageMeta, type MetaKey, type PageMeta } from "../../pages/page/page-meta";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { useBoards } from "../../boards/store";
import { useTags } from "../../tags/store";
import { RightPanel } from "../../panel/RightPanel";
import { showSpot, spotOfLink } from "../../sources/highlight-request";
import { sourceOf } from "../../sources/source-of";
import { SourceStrip } from "../../sources/SourceStrip";
import { iconOf, readable, titleOf } from "../names";
import { usePrefs, type PageFont } from "../prefs";
import { useWorkspace } from "../store";
import { usePaneId } from "../pane-context";
import { isArchived } from "../project-order";
import { movable, noteAt } from "../tree";
import { ArchivedBanner } from "./ArchivedBanner";
import { boardLinks } from "./board-links";
import { databaseLinks } from "./database-links";
import { deckLinks } from "./deck-links";
import { diagramLinks } from "./diagram-links";
import { usePageJumps } from "./jump";
import { HOLDS_PAGES, newPageHome } from "./new-page-home";
import { pageFiles } from "./page-files";
import { pageDateProps } from "./page-date";
import { subPageFind } from "./sub-page-find";
import { clicksOpen, linkedNote, pageLink, pageLinks } from "./page-links";
import { peopleLinks } from "./people-links";
import { PageFooter } from "./PageFooter";
import { PageProperties } from "./PageProperties";
import { passTyping, setPagePass, setPageView } from "./open-page";
import type { PageSession } from "./page-session";
import { useAgentMarks } from "./use-agent-marks";
import { useNoteSession, type LoadedNote } from "./use-note-session";
import { keepLayout, readLayout, setLayout, shownLayout, usePageLayouts } from "./page-layout";
import { inProject, placeLabel } from "./place-label";
import { SourcePanel } from "./SourcePanel";
import { pageFontSize } from "./text-size";
import { projectTemplateFor } from "../../projects/page-template";

const ProjectHome = lazy(() => import("../../projects/ProjectHome").then((m) => ({ default: m.ProjectHome })));

const FONTS: Record<PageFont, string> = {
  default: "var(--notion-font)",
  serif: "var(--notion-font-serif)",
  mono: "var(--notion-font-mono)",
};

/** A note from the vault as a Notion page, saved as you type. `compact`
 * is the side stack's card: no cover, footer or panels. `headless` also
 * leaves out the title and icon, for a feed that names the page itself
 * (the journal). `peek` is the whole page in a peek, without the panels
 * beside it. `linksOpen` is where a plain click on its links opens. */
export function NotePage({
  client,
  path,
  compact = false,
  headless = false,
  peek = false,
  linksOpen = "here",
}: {
  client: VaultClient;
  path: string;
  compact?: boolean;
  headless?: boolean;
  peek?: boolean;
  linksOpen?: LinkHow;
}) {
  const { loaded, error, conflict, dismissConflict, session, reload } = useNoteSession(client, path);
  if (error) return <p className="kasten-note-message">This page could not be opened: {error}</p>;
  if (!loaded || !session.current) return <p className="kasten-note-message">Opening…</p>;
  return (
    <LoadedPage
      key={loaded.version}
      client={client}
      loaded={loaded}
      session={session.current}
      conflict={conflict}
      onDismissConflict={dismissConflict}
      onReload={reload}
      compact={compact}
      headless={headless}
      peek={peek}
      linksOpen={linksOpen}
    />
  );
}

interface LoadedPageProps {
  client: VaultClient;
  loaded: LoadedNote;
  session: PageSession;
  conflict: string | null;
  onDismissConflict: () => void;
  onReload: LoadedNoteReload;
  compact: boolean;
  headless: boolean;
  peek: boolean;
  linksOpen: LinkHow;
}
type LoadedNoteReload = ReturnType<typeof useNoteSession>["reload"];

function LoadedPage({ client, loaded, session, conflict, onDismissConflict, onReload, compact, headless, peek, linksOpen }: LoadedPageProps) {
  const { note } = loaded;
  const journal = note.meta.kind === "journal";
  const [header, setHeader] = useState<PageMeta>(() => readPageMeta(loaded.prefix));
  const committed = useRef(header.title);
  const typedTitle = useRef(header.title);
  const [body, setBody] = useState(loaded.body);
  const [freshPage] = useState(() => !loaded.body.trim() && !header.title.trim());
  const editor = useRef<PageEditorHandle | null>(null);
  const bodyRoot = useRef<HTMLDivElement>(null);
  const prefs = usePrefs();
  const [opened] = useState(() => readLayout(loaded.prefix));
  const own = usePageLayouts((s) => s.of.get(session)) ?? opened;
  const layout = shownLayout(own, prefs);
  useEffect(() => {
    keepLayout(session, opened);
    return () => keepLayout(session, null);
  }, [session, opened]);
  const paneId = usePaneId();
  const panelOpen = useShell((s) => s.panels.includes(paneId));
  const sourceOpen = useShell((s) => s.sourceOpen);
  const notes = useWorkspace((s) => s.notes);
  const live = noteAt(notes, session.path) ?? note.meta;
  // The sections layout (`layout: sections`) and the page being presented.
  const smart = own.layout === "sections";
  const pageKey = live.id || session.path;
  const frame = useRef<HTMLDivElement>(null);
  const presenting = usePresenting(frame) !== null;
  /** "/smart page" in the editor: the page keeps the layout in its frontmatter. */
  const keepSmart = useCallback(() => setLayout(session, "layout", "sections"), [session]);
  const scroller = useCallback(() => bodyRoot.current?.closest<HTMLElement>(".kasten-page-main") ?? null, []);
  const source = useMemo(() => (live.kind === "highlight" ? sourceOf(loaded.prefix) : null), [live.kind, loaded.prefix]);

  const boards = useBoards((s) => s.list);
  const schemas = useTags((s) => s.schemas);
  useEffect(() => {
    refreshMentions();
  }, [notes, boards, schemas]);
  // /database lists the tag databases: have them at hand before it opens.
  useEffect(() => {
    if (useTags.getState().schemas === null) void useTags.getState().load();
  }, []);

  const links = useMemo<LinkProvider>(
    () => clicksOpen({
      ...pageLinks(() => session.path),
      create: async (title, open) => {
        const workspace = useWorkspace.getState();
        if (isDay(title)) {
          if (open) void workspace.openJournal(title, linksOpen);
          return null;
        }
        // A page's sub-page, or from a journal day or a card a page of its own.
        const made = await workspace.create({ kind: "page", title, ...newPageHome(noteAt(workspace.notes, session.path)) }, false);
        if (made && open) useWorkspace.getState().openPath(made.meta.path, linksOpen);
        return made ? pageLink(made.meta, useWorkspace.getState().notes) : null;
      },
      preview: async (target) => {
        const note = linkedNote(session.path, target);
        if (!note) return null;
        const { body } = splitFrontmatter((await client.read(note.path)).text);
        const text = readable(body.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8).join("\n"));
        return { title: titleOf(note), icon: iconOf(note), text: text.slice(0, 400) };
      },
      openFile: (href, how) => {
        const spot = spotOfLink(href, session.path);
        if (spot) showSpot(spot, how);
        return Boolean(spot);
      },
      ...boardLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...deckLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...diagramLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...peopleLinks(),
      webTitle,
      openMenu: (event, path) => {
        showOpenMenu(event, path);
        return true;
      },
      ...databaseLinks(() => (HOLDS_PAGES.has(noteAt(useWorkspace.getState().notes, session.path)?.kind ?? "") ? session.path : null)),
      embed: (target) => {
        const note = linkedNote(session.path, target);
        if (!note) return null;
        return {
          stamp: `${note.path}:${note.modified}`,
          load: async () => ({
            title: titleOf(note),
            icon: iconOf(note),
            markdown: splitFrontmatter((await client.read(note.path)).text).body,
            url: pageFiles(client, () => note.path).url,
          }),
        };
      },
    }, linksOpen),
    [session, client, linksOpen],
  );

  const files = useMemo(() => pageFiles(client, () => session.path), [client, session]);
  const subPages = useMemo(() => subPageFind(client, () => session.path), [client, session]);
  // Properties under the title: not in the side stack's cards or a journal day.
  const panelPage = useMemo(() => ({ client, session, onReload }), [client, session, onReload]);
  const [addingProp, setAddingProp] = useState(false);
  const showProps = !headless && !compact && !journal;
  const hasProps = live.tags.length > 0 || Object.keys(live.props).length > 0;
  const { marks, agent } = useAgentMarks(client, session, loaded.prefix + loaded.body === note.text);

  const onBody = useCallback(
    (next: string) => {
      setBody(next);
      session.editBody(next);
    },
    [session],
  );
  const [editorReady, setEditorReady] = useState(0);
  usePageJumps(session.path, editor, editorReady);
  const onReady = useCallback(
    (handle: PageEditorHandle | null) => {
      editor.current = handle;
      if (handle) setEditorReady((n) => n + 1);
      const scroller = () => bodyRoot.current?.closest<HTMLElement>(".kasten-page-main") ?? null;
      if (!handle) return setPageView(session, null);
      setPageView(session, () => ({ caret: handle.caret(), scroll: scroller()?.scrollTop ?? 0 }));
      // After a reload, go back to where the reader was.
      const { keep } = loaded;
      if (keep) {
        const root = scroller();
        if (root) root.scrollTop = keep.scroll;
        if (keep.caret !== null) handle.placeCaret(keep.caret);
      } else if (journal && !compact && !headless && !loaded.body.trim()) {
        // An empty journal day is there to be written in.
        handle.focusStart();
      }
    },
    [loaded, session, journal, compact, headless],
  );

  const onHeader = (key: MetaKey, value: string | null) => {
    setHeader((h) => ({ ...h, [key]: value ?? "" }));
    if (key === "title") typedTitle.current = value ?? "";
    else session.editHeader(key, value);
  };
  const onTitleDone = () => {
    const title = header.title.trim();
    if (!title) return setHeader((h) => ({ ...h, title: committed.current }));
    if (title === committed.current) return;
    committed.current = title;
    session.rename(title);
    void session.flush();
  };

  // Before the session writes, closes or reloads: the editor's last moments
  // of typing, and a title typed but never left (a closing page has no blur).
  useEffect(() => {
    setPagePass(session, () => {
      editor.current?.flush();
      const title = typedTitle.current.trim();
      if (journal || !title || title === committed.current) return;
      committed.current = title;
      session.rename(title);
    });
    return () => setPagePass(session, null);
  }, [session, journal]);

  /** Fills the blank page from a template; the page goes on either way. */
  const fillFrom = async (template: string) => {
    passTyping(session);
    await session.close();
    const filled = await useWorkspace.getState().applyTemplate(session.path, template);
    // Refused (toasted): the page goes on with a live session all the same.
    const next = filled ?? (await client.read(session.path).catch(() => null));
    if (next) onReload(next);
  };
  // "Template…" in the slash menu of an empty page opens the gallery, on
  // the project's own template when it names one. Nothing shows until asked.
  const pickTemplate = () => useShell.getState().openGallery({ onPick: (template: string) => void fillFrom(template), select: projectTemplateFor(live, notes) ?? undefined });
  const blank = !journal && !compact && !body.trim();

  const style = {
    "--page-font": FONTS[layout.font],
    "--page-font-size": pageFontSize(layout.text),
  } as CSSProperties;
  const shownHeader = journal ? { ...header, title: titleOf(live) } : header;

  return (
    <div ref={frame} tabIndex={presenting ? -1 : undefined} className={`kasten-page${layout.full ? " is-full-width" : ""}${compact ? " is-compact" : ""}${headless ? " is-headless" : ""}${smart ? " is-sections" : ""}${presenting ? " is-presenting" : ""}`} style={style}>
      {smart && !compact && !headless && !peek && <SectionStrip editor={editor} body={body} ready={editorReady} />}
      <div className="kasten-page-main">
        {conflict && (
          <div className="kasten-note-banner" role="alert">
            <span>This page changed outside KastenFlow, so your latest edits were kept in a copy.</span>
            <button type="button" onClick={() => useWorkspace.getState().openPath(conflict)}>
              Open the copy
            </button>
            <button type="button" onClick={onDismissConflict}>
              Dismiss
            </button>
          </div>
        )}
        {!headless && live.kind === "project" && isArchived(live) && <ArchivedBanner note={live} />}
        {!headless && (
          <PageHeader
            meta={shownHeader}
            onChange={onHeader}
            onEnterBody={() => editor.current?.focusStart()}
            onTitleDone={journal ? undefined : onTitleDone}
            titleReadOnly={journal || session.path.startsWith("templates/")}
            autoFocusTitle={freshPage && !journal && !compact}
            place={blank && movable(live) && inProject(live) ? { label: placeLabel(live, notes), onMove: () => useShell.getState().setMoving(session.path) } : undefined}
            onAddProperty={showProps && !hasProps && !addingProp ? () => setAddingProp(true) : undefined}
            fresh={blank}
            files={files}
            {...pageDateProps(live, panelPage, showProps && !session.path.startsWith("templates/"))}
          />
        )}
        {showProps && <PageProperties note={live} page={panelPage} adding={addingProp} onAdding={setAddingProp} />}
        {!headless && source && <SourceStrip spot={source} />}
        {!headless && !compact && live.kind === "project" && (
          <div className="kasten-page-column">
            <Suspense fallback={null}>
              <ProjectHome project={live} />
            </Suspense>
          </div>
        )}
        {/* A click in the margins or below the text writes there, a drag selects blocks (the editor's gutter). */}
        <div ref={bodyRoot} className="kasten-page-column kasten-page-body" data-editor-gutter="" spellCheck={prefs.spellcheck}>
          <PageEditor body={loaded.body} onChange={onBody} onReady={onReady} links={links} files={files} marks={marks} agent={agent} title={titleOf(live)} onTemplate={journal || compact ? undefined : pickTemplate} pageKey={pageKey} smart={smart} onSmartPage={keepSmart} subPageFind={compact || headless ? undefined : subPages} />
          <div className="kasten-page-tail" aria-hidden="true" />
          {!compact && <PageFooter note={live} notes={notes} client={client} />}
        </div>
      </div>
      {panelOpen && !compact && !peek && <RightPanel note={live} body={body} root={bodyRoot} client={client} session={session} onReload={onReload} />}
      {sourceOpen && !compact && !peek && <SourcePanel session={session} client={client} body={body} />}
      <PagePresenter root={frame} scroller={scroller} />
    </div>
  );
}
