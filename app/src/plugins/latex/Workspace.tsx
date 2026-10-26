// An open LaTeX document: toolbar, files, source, PDF preview and the status
// line. The state lives in a `Session` (session.ts); this file draws it and
// wires the keys, the palette's actions and the three panels' widths.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { ResizeHandle } from "../../ui/ResizeHandle";
import { registerActions } from "./actions";
import { type LatexBackend, sentence } from "./backend";
import "./assist.css";
import { Banners } from "./Banners";
import { useDiagnostics } from "./diagnostics";
import { Editor, type EditorHandle } from "./editor/Editor";
import { ErrorList } from "./ErrorList";
import { FileTree } from "./FileTree";
import { insertCitation } from "./insert-citation";
import { Outline } from "./Outline";
import { USUAL_PREVIEW, USUAL_TREE, useLatexPrefs } from "./prefs";
import { PreviewPane, type PreviewHandle } from "./PreviewPane";
import { Session } from "./session";
import { StatusLine } from "./StatusLine";
import { Toolbar } from "./Toolbar";
import type { LatexDoc } from "./types";
import { useAssist } from "./useAssist";
import { useLatexChat } from "./useLatexChat";

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function Workspace({ backend, doc, file }: { backend: LatexBackend; doc: LatexDoc; file: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const first = useRef(file);
  useEffect(() => {
    const made = new Session(backend, doc);
    setSession(made);
    void made.start(first.current);
    // The window closing: what was typed in the last half second is saved too.
    const leaving = () => void made.saveAll();
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      made.dispose();
    };
    // A document is its folder: a refreshed list gives a new object for the same document.
  }, [backend, doc.folder]);
  // A link to another file of the same document while it is open.
  useEffect(() => {
    if (session && file !== first.current) {
      first.current = file;
      void session.openFile(file);
    }
  }, [session, file]);
  if (!session) return <div className="latex-view" aria-busy="true" />;
  return <Body backend={backend} session={session} />;
}

function Body({ backend, session }: { backend: LatexBackend; session: Session }) {
  const snap = useSyncExternalStore(session.subscribe, session.snapshot);
  const prefs = useLatexPrefs();
  const editor = useRef<EditorHandle>(null);
  const preview = useRef<PreviewHandle>(null);
  const [treeWidth, setTreeWidth] = useState(prefs.treeWidth);
  const [previewWidth, setPreviewWidth] = useState(prefs.previewWidth);
  const say = useWorkspace.getState().toast;
  const { doc } = snap;
  const hasPdf = snap.build.pdfSeq > 0;
  const building = snap.requesting || snap.build.phase === "queued" || snap.build.phase === "running";
  const side = useRef<HTMLDivElement>(null);
  const sourceBox = useRef<HTMLDivElement>(null);
  const assist = useAssist({ session, backend, editor, preview, open: snap.open, side, source: sourceBox });
  const problems = useDiagnostics((s) => s.byDoc[doc.folder]);
  const chat = useLatexChat(editor, snap.open, doc.folder);

  // The editor follows the session when a merge or a choice changes a file's text.
  useEffect(() => {
    session.onReplace = (path, text) => {
      if (path === session.snapshot().open) editor.current?.replaceText(text);
      else editor.current?.forget(path);
    };
  }, [session]);

  useEffect(() => {
    if (snap.notice) say(snap.notice.text);
    // Said once per notice.
  }, [snap.notice?.n]);

  const exportPdf = async () => {
    if (session.snapshot().build.pdfSeq === 0) return say("Build the document first, then export it.");
    try {
      const path = await backend.exportPdf(doc.folder);
      say(`Kept ${nameOf(path)} in the document's folder.`);
    } catch (err) {
      say(`The PDF could not be kept: ${sentence(err)}`);
    }
  };

  const syncToPdf = async () => {
    const at = session.snapshot().open;
    if (at && editor.current) await assist.toPdf(at, editor.current.caretLine());
  };

  const toggleAuto = () => prefs.set({ autoBuild: !useLatexPrefs.getState().autoBuild });
  const toggleFiles = () => prefs.set({ treeOpen: !useLatexPrefs.getState().treeOpen });

  // The palette's commands act on this document while it is on screen.
  const latest = useRef({ exportPdf, syncToPdf, toggleAuto, toggleFiles });
  latest.current = { exportPdf, syncToPdf, toggleAuto, toggleFiles };
  const assistRef = useRef(assist);
  assistRef.current = assist;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    const withdraw = registerActions({
      build: () => void session.buildNow(),
      stop: () => session.cancel(),
      exportPdf: () => void latest.current.exportPdf(),
      syncToPdf: () => void latest.current.syncToPdf(),
      toggleAuto: () => latest.current.toggleAuto(),
      toggleFiles: () => latest.current.toggleFiles(),
      focusOutline: () => assistRef.current.focusOutline(),
      focusProblems: () => assistRef.current.focusProblems(),
      insertCitation: () => insertCitation(assistRef.current.index, editor),
      fixWithAi: () => chatRef.current.fix(),
    });
    return withdraw;
  }, [session]);

  const open = snap.open;
  return (
    <div className="latex-view">
      <Toolbar
        title={doc.title}
        folder={doc.folder}
        filesOpen={prefs.treeOpen}
        auto={prefs.autoBuild}
        building={building}
        hasPdf={hasPdf}
        onFiles={toggleFiles}
        onAuto={(on) => prefs.set({ autoBuild: on })}
        onBuild={() => void session.buildNow()}
        onStop={() => session.cancel()}
        onExport={() => void exportPdf()}
        onSync={() => void syncToPdf()}
        onCite={() => insertCitation(assist.index, editor)}
      />
      <Banners snap={snap} onKeepMine={() => void session.keepMine()} onUseDisk={() => session.useDisk()} onRetry={() => void session.saveAll()} />
      <div className="latex-body">
        {prefs.treeOpen && (
          <div className="latex-panel" style={{ width: treeWidth }}>
            <div ref={side} className="latex-side">
              <FileTree files={snap.files} folder={doc.folder} open={open} dirty={snap.dirty} onOpen={(path) => void session.openFile(path).then(() => editor.current?.focus())} />
              <Outline index={assist.index} path={open} onJump={(line) => editor.current?.goToLine(line)} onAdd={assist.addSection} />
            </div>
            <ResizeHandle label="Resize the files" edge="right" width={treeWidth} min={120} max={400} initial={USUAL_TREE} onChange={setTreeWidth} onCommit={(treeWidth) => prefs.set({ treeWidth })} />
          </div>
        )}
        <div ref={sourceBox} className="latex-source">
          {snap.loadProblem ? (
            <div className="latex-note" role="alert">
              <p className="m-0">{snap.loadProblem}</p>
            </div>
          ) : open ? (
            <Editor
              ref={editor}
              fileKey={open}
              initial={session.textOf(open)}
              label={`Source of ${nameOf(open)}`}
              hooks={{
                change: (text) => {
                  const at = session.snapshot().open ?? open;
                  session.edit(at, text);
                  assist.index.setText(at, text);
                },
                build: () => void session.buildNow(),
                save: () => session.saveAndBuild(),
              }}
            />
          ) : (
            <div className="latex-note" aria-busy="true">
              <p className="m-0">Opening the document…</p>
            </div>
          )}
          <ErrorList diagnostics={problems ?? []} folder={doc.folder} main={doc.main} files={snap.files} onJump={assist.goTo} onFix={chat.fix} />
        </div>
        <div className="latex-panel" style={{ width: previewWidth }}>
          <ResizeHandle label="Resize the preview" edge="left" width={previewWidth} min={240} max={900} initial={USUAL_PREVIEW} onChange={setPreviewWidth} onCommit={(previewWidth) => prefs.set({ previewWidth })} />
          <PreviewPane ref={preview} backend={backend} session={session} snap={snap} onPick={(point) => void assist.fromPdf(point)} />
        </div>
      </div>
      <StatusLine snap={snap} />
    </div>
  );
}
