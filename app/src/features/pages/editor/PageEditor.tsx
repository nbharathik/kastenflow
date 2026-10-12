import "./styles/crepe.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles/tokens.css";
import "./styles/notion.css";
import "./styles/mentions.css";
import "./styles/blocks.css";
import "./styles/menus.css";
import "./styles/agent.css";

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AgentMark } from "../../../lib/vault/types";
import { closeAi, onAiOpen, type AiOpen } from "./ai/ai";
import { AiPanel } from "./ai/AiPanel";
import { setAgentMarks, type AgentActions } from "./blocks/agent-marks";
import { createKastenCrepe } from "./crepe";
import type { FileProvider } from "./files";
import { FindBar, useFindKeys, type FindOpen } from "./find/FindBar";
import type { SubPageFind } from "./find/sub-pages";
import { findLink, type LinkProvider } from "./links";
import { handleFor, type PageEditorHandle } from "./page-handle";
import { setSmart } from "./sections/api";
import { foldKeyCtx } from "./sections/key";
import { openNote, type OpenNote } from "./session";

export type { PageEditorHandle } from "./page-handle";

export interface PageEditorProps {
  /** The note body: Markdown without its frontmatter. */
  body: string;
  /** Receives the body to write after every change. Blocks the user did not
   * touch keep their exact bytes. */
  onChange?: (body: string) => void;
  /** Receives a handle once the editor is ready, and null when it goes. */
  onReady?: (handle: PageEditorHandle | null) => void;
  /** The pages `[[links]]` point at. Read when a link is drawn or typed. */
  links?: LinkProvider;
  /** Where pasted and dropped files are kept, and pictures shown from. */
  files?: FileProvider;
  /** The lines of the body an agent wrote that the person has not edited or
   * accepted: their blocks get a margin, and each mark a badge. */
  marks?: readonly AgentMark[];
  /** What the badge on an agent's writing can do. */
  agent?: AgentActions;
  /** The page's title, which AI is told along with the page. */
  title?: string;
  /** Opens the template gallery to fill the page: "Template…" in the slash
   * menu while the page is empty. Read when the editor is made. */
  onTemplate?: () => void;
  /** Which page this is, for the sections folded in it, which are kept for
   * the page, and for the menus that fold or present it: its note id, or its
   * path while it is a draft. Read when the editor is made, and again when it
   * changes. */
  pageKey?: string;
  /** Draws the page's sections as slide-like cards (its `layout: sections`);
   * follows the prop as it changes. */
  smart?: boolean;
  /** Called when "/smart page" in the slash menu turns the sections layout
   * on, so the page can keep it as its `layout`. */
  onSmartPage?: () => void;
  /** What the find bar needs to look through this page and its sub-pages
   * ("+ sub-pages"); without it the bar finds in this page only. */
  subPageFind?: SubPageFind;
}

/** The Milkdown page editor. Reloads when `body` changes identity. */
export function PageEditor({ body, onChange, onReady, links, files, marks, agent, title = "", onTemplate, pageKey, smart = false, onSmartPage, subPageFind }: PageEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const linksRef = useRef(links);
  const filesRef = useRef(files);
  const marksRef = useRef(marks);
  const agentRef = useRef(agent);
  const templateRef = useRef(onTemplate);
  const pageKeyRef = useRef(pageKey);
  const smartRef = useRef(smart);
  const smartPageRef = useRef(onSmartPage);
  const crepeRef = useRef<Crepe | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [find, setFind] = useState<FindOpen | null>(null);
  useFindKeys(rootRef, crepeRef, setFind);
  const [ai, setAi] = useState<AiOpen | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
    linksRef.current = links;
    filesRef.current = files;
    agentRef.current = agent;
    templateRef.current = onTemplate;
    pageKeyRef.current = pageKey;
    smartRef.current = smart;
    smartPageRef.current = onSmartPage;
  }, [onChange, onReady, links, files, agent, onTemplate, pageKey, smart, onSmartPage]);

  // The sections layout follows the page's `layout` key without rebuilding the editor.
  useEffect(() => {
    if (view) setSmart(view, smart);
  }, [view, smart]);

  // A page's key changes while it is open (a draft becomes a page, a page is given an id): the editor goes by the new one.
  useEffect(() => {
    const crepe = crepeRef.current;
    if (view && crepe && pageKey) crepe.editor.ctx.set(foldKeyCtx.key, pageKey);
  }, [view, pageKey]);

  // New marks reach the open editor without rebuilding it.
  useEffect(() => {
    marksRef.current = marks;
    const crepe = crepeRef.current;
    if (crepe) setAgentMarks(crepe.editor.ctx.get(editorViewCtx), { marks: marks ?? [] });
  }, [marks]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let crepe: Crepe | undefined;
    let note: OpenNote | undefined;
    let stopAi: (() => void) | undefined;
    /** The document last handed to onChange. */
    let sent: ProseNode | null = null;
    const send = (doc: ProseNode) => {
      if (!note || doc === sent) return;
      sent = doc;
      onChangeRef.current?.(note.save());
    };
    const flush = () => {
      if (crepe && !disposed) send(crepe.editor.ctx.get(editorViewCtx).state.doc);
    };
    void createKastenCrepe(root, {
      onUpdate: (_ctx, doc) => send(doc),
      // Always the latest pages and handlers, without rebuilding the editor.
      links: {
        pages: () => linksRef.current?.pages() ?? [],
        find: (target) => (linksRef.current ? findLink(linksRef.current, target) : null),
        linkText: (page) => linksRef.current?.linkText?.(page) ?? page.title,
        open: (title, how, heading) => (heading === undefined ? linksRef.current?.open(title, how) : linksRef.current?.open(title, how, heading)),
        headings: (page, then) => linksRef.current?.headings?.(page, then) ?? [],
        create: (title, open) => linksRef.current?.create?.(title, open),
        preview: (title) => linksRef.current?.preview?.(title) ?? Promise.resolve(null),
        openFile: (href, how) => linksRef.current?.openFile?.(href, how) ?? false,
        embed: (title) => linksRef.current?.embed?.(title) ?? null,
        boards: () => linksRef.current?.boards?.() ?? [],
        createBoard: (title) => linksRef.current?.createBoard?.(title) ?? Promise.resolve(null),
        mountBoard: (host, path, options) => (options ? linksRef.current?.mountBoard?.(host, path, options) : linksRef.current?.mountBoard?.(host, path)) ?? (() => {}),
        openBoard: (path, how) => linksRef.current?.openBoard?.(path, how),
        decks: () => linksRef.current?.decks?.() ?? [],
        createDeck: (title) => linksRef.current?.createDeck?.(title) ?? Promise.resolve(null),
        mountDeck: (host, path) => linksRef.current?.mountDeck?.(host, path) ?? (() => {}),
        openDeck: (path, how) => linksRef.current?.openDeck?.(path, how),
        diagrams: () => linksRef.current?.diagrams?.() ?? [],
        createDiagram: (title) => linksRef.current?.createDiagram?.(title) ?? Promise.resolve(null),
        mountDiagram: (host, path) => linksRef.current?.mountDiagram?.(host, path) ?? (() => {}),
        openDiagram: (path, how) => linksRef.current?.openDiagram?.(path, how),
        webTitle: (url) => linksRef.current?.webTitle?.(url) ?? Promise.resolve(null),
        people: () => linksRef.current?.people?.() ?? [],
        weekStart: () => linksRef.current?.weekStart?.() ?? 1,
        openMenu: (event, path) => linksRef.current?.openMenu?.(event, path) ?? false,
        databases: () => linksRef.current?.databases?.() ?? [],
        mountDatabase: (host, tag, view) => linksRef.current?.mountDatabase?.(host, tag, view) ?? (() => {}),
        openDatabase: (tag, how) => linksRef.current?.openDatabase?.(tag, how),
        createDatabase: (name, view) => linksRef.current?.createDatabase?.(name, view) ?? Promise.resolve(null),
        viewOf: (tag, view) => linksRef.current?.viewOf?.(tag, view) ?? Promise.resolve(null),
      },
      files: filesRef.current && {
        save: (file) => filesRef.current?.save(file) ?? Promise.reject(new Error("This page keeps no files")),
        url: (src) => filesRef.current?.url(src) ?? src,
      },
      agent: {
        accept: () => agentRef.current?.accept() ?? Promise.resolve(),
        undo: (session) => agentRef.current?.undo(session) ?? Promise.resolve(),
        history: (session) => agentRef.current?.history(session),
      },
      onTemplate: templateRef.current && (() => templateRef.current?.()),
      ...(pageKeyRef.current ? { foldKey: pageKeyRef.current } : {}),
      smart: smartRef.current,
      onSmartPage: () => smartPageRef.current?.(),
    }).then((created) => {
      if (disposed) {
        void created.destroy();
        return;
      }
      crepe = created;
      note = openNote(created, body);
      setAgentMarks(created.editor.ctx.get(editorViewCtx), { blocks: note.blocks, marks: marksRef.current ?? [] });
      crepeRef.current = created;
      // Heard from the moment the editor is there, so no opening is missed.
      stopAi = onAiOpen(created.editor.ctx.get(editorViewCtx), setAi);
      setView(created.editor.ctx.get(editorViewCtx));
      send(created.editor.ctx.get(editorViewCtx).state.doc);
      const openFind = (seed: string) => setFind((was) => ({ replace: false, seed, opened: (was?.opened ?? 0) + 1 }));
      onReadyRef.current?.(handleFor(created, flush, openFind));
    });
    return () => {
      // Typing still inside the 200 ms pause is handed on, not dropped.
      flush();
      disposed = true;
      crepeRef.current = null;
      setView(null);
      setFind(null);
      stopAi?.();
      setAi(null);
      if (crepe) onReadyRef.current?.(null);
      void crepe?.destroy();
    };
  }, [body]);

  return (
    <>
      {find && view && (
        <div className="kasten-find-dock">
          <FindBar view={view} find={find} onClose={() => setFind(null)} subPages={subPageFind} />
        </div>
      )}
      <div ref={rootRef} className="kasten-page-editor" data-testid="page-editor" />
      {ai &&
        view &&
        createPortal(
          <AiPanel
            key={ai.opened}
            view={view}
            open={ai}
            title={title}
            parse={(markdown) => crepeRef.current?.editor.ctx.get(parserCtx)(markdown) ?? null}
            serialize={(doc) => crepeRef.current?.editor.ctx.get(serializerCtx)(doc) ?? ""}
            onClose={() => {
              closeAi(view);
              setAi(null);
            }}
          />,
          ai.host,
        )}
    </>
  );
}
