import "../../pages/editor/styles/tokens.css";
import "../../pages/page/page.css";
import "../../pages/page/popups.css";
import "./note-page.css";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useShell } from "../../../lib/store";
import type { VaultClient } from "../../../lib/vault/types";
import { isCaptured } from "../../annotations/captured";
import { HighlightBar } from "../../annotations/HighlightBar";
import { useHighlighter } from "../../annotations/highlight-actions";
import { useTextHighlights } from "../../annotations/use-text-highlights";
import { CommentsColumn } from "../../pages/comments/CommentsColumn";
import { refreshMentions } from "../../pages/editor/blocks/wikilink-view";
import type { LinkHow } from "../../pages/editor/links";
import { PageEditor, type PageEditorHandle } from "../../pages/editor/PageEditor";
import { PageHeader } from "../../pages/page/PageHeader";
import { PagePresenter } from "../../pages/present/PagePresenter";
import { SectionStrip } from "../../pages/present/SectionStrip";
import { usePresenting } from "../../pages/present/use-presenting";
import { useBoards } from "../../boards/store";
import { useTags } from "../../tags/store";
import { RightPanel } from "../../panel/RightPanel";
import { sourceOf } from "../../sources/source-of";
import { SourceStrip } from "../../sources/SourceStrip";
import { titleOf } from "../names";
import { usePrefs, type PageFont } from "../prefs";
import { useWorkspace } from "../store";
import { usePaneId } from "../pane-context";
import { isArchived } from "../project-order";
import { movable, noteAt } from "../tree";
import { ArchivedBanner } from "./ArchivedBanner";
import { ConflictBanner } from "./ConflictBanner";
import { pageFiles } from "./page-files";
import { pageDateProps } from "./page-date";
import { subPageFind } from "./sub-page-find";
import { PageFooter } from "./PageFooter";
import { PageProperties } from "./PageProperties";
import type { PageSession } from "./page-session";
import { useAgentMarks } from "./use-agent-marks";
import { useNoteSession, type LoadedNote } from "./use-note-session";
import { useTemplateFill } from "./use-template-fill";
import { useBlank, useBody, usePageEditor } from "./use-page-editor";
import { usePageHeader } from "./use-page-header";
import { usePageLinks } from "./use-page-links";
import { keepLayout, readLayout, setLayout, shownLayout, usePageLayouts } from "./page-layout";
import { inProject, placeLabel } from "./place-label";
import { SourcePanel } from "./SourcePanel";
import { pageFontSize } from "./text-size";
import { inTauri } from "../../../lib/api";
import { useSmartRunning } from "../../smart/run-switch";
import { SmartOffLine, SmartTabs } from "../../smart/SmartTabs";
import { useSmartSide } from "../../smart/use-smart-side";

const ProjectHome = lazy(() => import("../../projects/ProjectHome").then((m) => ({ default: m.ProjectHome })));
/** A smart page's view loads when the first one is opened. */
const SmartPage = lazy(() => import("../../smart/SmartPage").then((m) => ({ default: m.SmartPage })));

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
  const editor = useRef<PageEditorHandle | null>(null);
  const bodyRoot = useRef<HTMLDivElement>(null);
  const font = usePrefs((s) => s.font);
  const textSize = usePrefs((s) => s.textSize);
  const pageWidth = usePrefs((s) => s.pageWidth);
  const spellcheck = usePrefs((s) => s.spellcheck);
  const defaults = useMemo(() => ({ font, textSize, pageWidth }), [font, textSize, pageWidth]);
  const [opened] = useState(() => readLayout(loaded.prefix));
  const own = usePageLayouts((s) => s.of.get(session)) ?? opened;
  const layout = shownLayout(own, defaults);
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
  // A smart page (`layout: smart`): its smart view, its notes (this page) or the history of its code.
  const smartOn = own.layout === "smart" && !compact && !headless && !journal;
  const desktop = inTauri();
  const run = useSmartRunning(undefined, smartOn && desktop, session.path);
  const [side, setSide] = useSmartSide(pageKey);
  const smartOff = smartOn && desktop && run.known && !run.on;
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

  const links = usePageLinks(client, session, linksOpen);

  const files = useMemo(() => pageFiles(client, () => session.path), [client, session]);
  const subPages = useMemo(() => subPageFind(client, () => session.path), [client, session]);
  // Properties under the title: not in the side stack's cards or a journal day.
  const panelPage = useMemo(() => ({ client, session, onReload }), [client, session, onReload]);
  const [addingProp, setAddingProp] = useState(false);
  const showProps = !headless && !compact && !journal;
  const hasProps = live.tags.length > 0 || Object.keys(live.props).length > 0;
  const { marks, agent } = useAgentMarks(client, session, loaded.prefix + loaded.body === note.text);

  const { body: typed, onBody, editorReady, onReady } = usePageEditor({ loaded, session, journal, compact, headless, editor, bodyRoot });
  const { header, freshPage, onHeader, onTitleDone } = usePageHeader(loaded, session, journal, editor);
  // A page kept from the web can be highlighted: marks over its words, kept beside it.
  const captured = !compact && !headless && isCaptured(live, loaded.prefix);
  // Only what reads the text draws again as it is typed: the section strip,
  // comments, the side panels and the highlights, while they show.
  const inView = !compact && !peek;
  const body = useBody(typed, captured || (smart && !headless && inView) || (panelOpen && inView) || (sourceOpen && inView));
  const highlights = useTextHighlights({ client, path: session.path, editor, ready: editorReady, body, enabled: captured });
  useHighlighter(highlights, editor, frame, captured);
  const pickTemplate = useTemplateFill(client, session, onReload, live, notes);
  const blank = useBlank(typed, !journal && !compact);

  const style = {
    "--page-font": FONTS[layout.font],
    "--page-font-size": pageFontSize(layout.text),
  } as CSSProperties;
  const shownHeader = journal ? { ...header, title: titleOf(live) } : header;

  // The app has not said yet whether smart pages run: a moment, not a flash of the wrong side.
  if (smartOn && desktop && !run.known) return <p className="kasten-note-message">Opening…</p>;
  if (smartOn && !smartOff && side !== "notes") {
    return (
      <div ref={frame} className={`kasten-page is-smart-view${layout.width === "full" ? " is-full-width" : ""}`} style={style}>
        <Suspense fallback={<p className="kasten-note-message">Opening…</p>}>
          <SmartPage pagePath={session.path} pageId={live.id ?? ""} title={titleOf(live)} side={side} onSide={setSide} />
        </Suspense>
      </div>
    );
  }

  return (
    <div ref={frame} tabIndex={presenting ? -1 : undefined} className={`kasten-page${layout.width === "full" ? " is-full-width" : layout.width === "wide" ? " is-wide" : ""}${compact ? " is-compact" : ""}${headless ? " is-headless" : ""}${smart ? " is-sections" : ""}${presenting ? " is-presenting" : ""}`} style={style}>
      {smart && !compact && !headless && !peek && <SectionStrip editor={editor} body={body} ready={editorReady} />}
      <div className="kasten-page-main">
        {smartOn && (
          <div className="kasten-smart-notes-bar">
            {smartOff ? <SmartOffLine page={session.path} /> : <SmartTabs side="notes" onSide={setSide} />}
          </div>
        )}
        {conflict && <ConflictBanner copy={conflict} onDismiss={onDismissConflict} />}
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
        <div ref={bodyRoot} className="kasten-page-column kasten-page-body" data-editor-gutter="" spellCheck={spellcheck}>
          <PageEditor body={loaded.body} onChange={onBody} onReady={onReady} links={links} files={files} marks={marks} agent={agent} title={titleOf(live)} onTemplate={journal || compact ? undefined : pickTemplate} pageKey={pageKey} smart={smart} onSmartPage={keepSmart} subPageFind={compact || headless ? undefined : subPages} />
          <div className="kasten-page-tail" aria-hidden="true" />
          {!compact && <PageFooter note={live} notes={notes} client={client} />}
        </div>
      </div>
      {captured && <HighlightBar model={highlights} editor={editor} ready={editorReady} root={bodyRoot} />}
      {smart && !compact && !headless && !peek && <CommentsColumn client={client} path={session.path} editor={editor} ready={editorReady} body={body} />}
      {panelOpen && !compact && !peek && (
        <RightPanel note={live} body={body} root={bodyRoot} client={client} session={session} onReload={onReload} editor={editor} ready={editorReady} highlights={captured ? highlights : undefined} />
      )}
      {sourceOpen && !compact && !peek && <SourcePanel session={session} client={client} body={body} />}
      <PagePresenter root={frame} scroller={scroller} />
    </div>
  );
}
