// The PDF on the right. A new build's PDF is drawn off-screen and swapped in
// with the zoom and the reader's place kept (preview/controller.ts); if it
// cannot be shown, or the build failed, the last good PDF stays with a line
// saying so. Before any PDF there is one plain sentence and the button for the
// next step (the engine card when there is nothing to build with).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Button, IconButton } from "../../ui/Button";
import type { LatexBackend } from "./backend";
import { sentence } from "./backend";
import { EngineCard } from "./EngineCard";
import { PreviewController, type Zoom } from "./preview/controller";
import { pdfDeps } from "./preview/pdf-deps";
import type { Session, Snapshot } from "./session";
import type { SyncHit } from "./types";

export interface PreviewHandle {
  showHit(hit: SyncHit): Promise<void>;
  /** The underlying controller, for the parts that need the pointer position (clicks in the PDF). */
  controller(): PreviewController | null;
}

interface Props {
  backend: LatexBackend;
  session: Session;
  snap: Snapshot;
  /** A place in the PDF was picked (double-click, or Enter on the column): find its line in the source. */
  onPick?(point: { page: number; x: number; y: number }): void;
}

/** The first error of a failed build, in a sentence. */
function firstProblem(snap: Snapshot): string {
  const error = snap.build.diagnostics.find((d) => d.severity === "error");
  if (error) return error.line ? `${error.message} (line ${error.line})` : error.message;
  return snap.build.error?.message ?? "The last build did not work.";
}

export const PreviewPane = forwardRef<PreviewHandle, Props>(function PreviewPane({ backend, session, snap, onPick }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const controller = useRef<PreviewController | null>(null);
  const [shown, setShown] = useState(false);
  const [scale, setScale] = useState(1);
  const [zoom, setZoomState] = useState<Zoom>("fit");
  const [problem, setProblem] = useState<string | null>(null);
  const folder = snap.doc.folder;

  useImperativeHandle(ref, () => ({ showHit: async (hit) => controller.current?.showHit(hit), controller: () => controller.current }), []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const made = new PreviewController(el, pdfDeps, {
      problem: setProblem,
      scaled: (next) => {
        setScale(next);
        setShown(made.shown);
        setZoomState(made.currentZoom);
      },
    });
    controller.current = made;
    // The PDF the last build left (from an earlier visit) is there at once.
    void backend
      .readPdf(folder)
      .then((bytes) => made.load(bytes))
      // No earlier PDF (never built, or cleaned): the pane waits for the first build.
      .catch(() => {});
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watch =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (made.currentZoom !== "fit") return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void made.relayout(), 150);
          });
    watch?.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      watch?.disconnect();
      made.dispose();
      controller.current = null;
    };
  }, [backend, folder]);

  const pdfSeq = snap.build.pdfSeq;
  useEffect(() => {
    if (pdfSeq === 0) return;
    let stale = false;
    backend
      .readPdf(folder)
      .then((bytes) => (stale ? false : controller.current?.load(bytes)))
      .catch((err: unknown) => {
        if (!stale) setProblem(`The new PDF could not be read: ${sentence(err)}`);
      });
    return () => {
      stale = true;
    };
  }, [backend, folder, pdfSeq]);

  // The page and point under (x, y) in the window, found in the source.
  const pick = (x: number, y: number) => {
    const point = controller.current?.pointAt(x, y);
    if (point) onPick?.(point);
  };
  const pickMiddle = () => {
    const rect = scroller.current?.getBoundingClientRect();
    if (rect) pick(rect.left + rect.width / 2, rect.top + rect.height / 3);
  };

  const working = snap.requesting || snap.build.phase === "queued" || snap.build.phase === "running";
  const failed = snap.build.phase === "failed";
  const banner = problem ?? (failed && shown ? `Showing the last PDF that worked. ${firstProblem(snap)}` : null);

  return (
    <div className="latex-preview" aria-label="PDF preview" role="region">
      <div className="latex-preview-bar">
        <IconButton size="sm" icon="zoom-out" label="Zoom out" disabled={!shown} onClick={() => void controller.current?.zoomBy(-1)} />
        <IconButton size="sm" icon="zoom-in" label="Zoom in" disabled={!shown} onClick={() => void controller.current?.zoomBy(1)} />
        <IconButton size="sm" icon="fit" label="Fit to width" active={zoom === "fit"} disabled={!shown} onClick={() => void controller.current?.setZoom("fit")} />
        {onPick && <IconButton size="sm" icon="code" label="Find this place in the source" disabled={!shown} title="Find this place in the source (double-click a place, or press Enter in the PDF)" onClick={pickMiddle} />}
        <span aria-live="off">{shown ? `${Math.round(scale * 100)} %` : ""}</span>
      </div>
      {banner && (
        <div className={`latex-banner ${problem ? "is-danger" : "is-warning"}`} role="status">
          <span>{banner}</span>
        </div>
      )}
      <div className="latex-preview-body">
        <div
          ref={scroller}
          className="latex-preview-scroll"
          tabIndex={0}
          aria-label="PDF pages"
          onDoubleClick={(e) => pick(e.clientX, e.clientY)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) pickMiddle();
          }}
        />
        {(!shown || snap.noEngine) && (
          <div className="latex-empty">
            {snap.noEngine ? (
              <EngineCard error={snap.noEngine} session={session} />
            ) : working ? (
              <p className="m-0">{snap.build.note ?? "Building your first preview…"}</p>
            ) : failed ? (
              <>
                <p className="m-0">{firstProblem(snap)}</p>
                <Button onClick={() => void session.buildNow()}>Build again</Button>
              </>
            ) : (
              <>
                <p className="m-0">Nothing to show yet.</p>
                <Button tone="primary" icon="refresh" onClick={() => void session.buildNow()}>
                  Build
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
