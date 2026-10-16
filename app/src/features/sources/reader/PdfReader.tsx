// The reader for a PDF in sources/: its pages in
// one scroll, fitted to the pane's width or zoomed. Text selected on a page
// becomes a highlight in one of five colours, with a comment if wanted; a
// highlight clicked shows its colour, comment and card. The source's
// highlights list beside the pages. A card's link back (showSpot) scrolls
// to the page and flashes the highlight. A PDF opens where it was left;
// the bar goes to a page or a chapter of its outline, and Mod+F finds text.

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Highlight, HighlightColor, PdfRect } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { useSpotRequests, type Spot } from "../highlight-request";
import { hits, lineBoxes, pdfRects, viewBox, type Transform } from "../pdf/geometry";
import { openPdf } from "../pdf/load";
import { useSources, useSourceTitle } from "../store";
import { AskAboutPages } from "./AskAboutPages";
import { HighlightList } from "./HighlightList";
import { HighlightPop } from "./HighlightPop";
import { PdfFind } from "./PdfFind";
import { ClipTool } from "./clip/ClipTool";
import { readOutline, type OutlineItem } from "./pdf-text";
import { keepPage, lastPage } from "./reading-place";
import { PdfPage, type PageSize } from "./PdfPage";
import { ReaderBar } from "./ReaderBar";
import { SelectionBar } from "./SelectionBar";

import "../colors.css";
import "./reader.css";

const NONE: Highlight[] = [];
/** Pixels beside the pages when they fit the width. */
const GUTTER = 28;
const FLASH_MS = 1800;

/** The sheet's pages, not the bars and popups drawn among them. */
const pageEls = (sheet: HTMLElement) => sheet.querySelectorAll<HTMLElement>(":scope > .kasten-pdf-page");

interface Draft {
  page: number;
  rects: PdfRect[];
  text: string;
  at: { left: number; top: number };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

export default function PdfReader({ path }: { path: string }) {
  const client = useWorkspace((s) => s.client);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [first, setFirst] = useState<PageSize | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([1, 2]));
  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opened, setOpened] = useState<{ id: string; at: { left: number; top: number } } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [outline, setOutline] = useState<readonly OutlineItem[]>([]);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  // The clip tool (clip/): a box drawn over a figure is kept in the gallery.
  const [clipping, setClipping] = useState(false);
  // Whether the page it was left on has been gone back to, so the page in
  // view is kept only after that.
  const restored = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const transforms = useRef(new Map<number, Transform>());
  const pending = useRef<Spot | null>(null);
  const highlights = useSources((s) => s.highlights[path]) ?? NONE;
  const loaded = useSources((s) => s.highlights[path] !== undefined);
  const title = useSourceTitle(path);
  const latest = useRef(highlights);
  latest.current = highlights;
  const byPage = useMemo(() => {
    const pages = new Map<number, Highlight[]>();
    for (const h of highlights) pages.set(h.page, [...(pages.get(h.page) ?? []), h]);
    return pages;
  }, [highlights]);

  useEffect(() => {
    if (!client) return;
    let live = true;
    let opening: PDFDocumentProxy | null = null;
    setDoc(null);
    setProblem(null);
    setOutline([]);
    restored.current = false;
    transforms.current.clear();
    client
      .readSource(path)
      .then(openPdf)
      .then(async (pdf) => {
        if (!live) return void pdf.loadingTask.destroy();
        opening = pdf;
        const size = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (!live) return;
        setFirst({ width: size.width, height: size.height });
        setDoc(pdf);
        void readOutline(pdf).then((items) => live && setOutline(items));
      })
      .catch((err: unknown) => live && setProblem(message(err)));
    const sources = useSources.getState();
    void sources.load(path);
    if (!sources.list) void sources.loadList();
    return () => {
      live = false;
      void opening?.loadingTask.destroy();
    };
  }, [client, path]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    setWidth(root.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, [doc]);

  const fit = first && width ? Math.round(Math.min(Math.max((width - 2 * GUTTER) / first.width, 0.4), 3) * 1000) / 1000 : 1;
  const scale = zoom ?? fit;

  // Pages within a screen and a half of the view are drawn.
  useEffect(() => {
    const root = scroller.current;
    const pages = sheet.current;
    if (!doc || !root || !pages || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) seen.add(n);
          else seen.delete(n);
        }
        setNear(new Set(seen));
      },
      { root, rootMargin: "150% 0px" },
    );
    for (const page of pageEls(pages)) observer.observe(page);
    return () => observer.disconnect();
  }, [doc]);

  const onTransform = useCallback((n: number, t: Transform) => void transforms.current.set(n, t), []);
  const transformOf = (n: number): Transform => transforms.current.get(n) ?? [scale, 0, 0, -scale, 0, (first?.height ?? 0) * scale];
  const pageEl = (n: number) => sheet.current?.querySelector<HTMLElement>(`.kasten-pdf-page[data-page="${n}"]`) ?? null;

  const show = useCallback(() => {
    const spot = pending.current;
    const root = scroller.current;
    if (!spot || !doc || !root || !loaded) return;
    const h = spot.highlight ? latest.current.find((x) => x.id === spot.highlight) : undefined;
    const target = pageEl(h?.page ?? spot.page ?? 1);
    if (!target) return;
    pending.current = null;
    const box = h?.rects[0] ? viewBox(transformOf(h.page), h.rects[0]) : null;
    const offset = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: Math.max(0, offset + (box ? box.top - root.clientHeight * 0.3 : -12)) });
    if (h) {
      setFlash(h.id);
      window.setTimeout(() => setFlash((now) => (now === h.id ? null : now)), FLASH_MS);
    }
    // transformOf reads the latest transforms and scale.
  }, [doc, loaded, scale]);

  useSpotRequests(path, (spot) => {
    restored.current = true;
    pending.current = spot;
    show();
  });
  useEffect(show, [show, highlights]);

  const go = useCallback(
    (page: number) => {
      pending.current = { source: path, page };
      show();
    },
    [path, show],
  );

  // Back where it was left, unless a card's link asked for a spot.
  useEffect(() => {
    if (!doc || !loaded || restored.current) return;
    restored.current = true;
    const page = lastPage(path);
    if (!pending.current && page && page <= doc.numPages) go(page);
  }, [doc, loaded, path, go]);
  useEffect(() => {
    if (doc && restored.current) keepPage(path, current);
  }, [doc, path, current]);

  const onScroll = () => {
    const root = scroller.current;
    const pages = sheet.current;
    if (!root || !pages) return;
    const mark = root.scrollTop + root.clientHeight * 0.3 - pages.offsetTop;
    let n = 1;
    for (const page of pageEls(pages)) {
      if (page.offsetTop > mark) break;
      n = Number(page.dataset.page);
    }
    setCurrent(n);
  };

  /** After a pointer goes up: the selection as a draft highlight, or the highlight clicked. */
  const afterPointer = (x: number, y: number, target: Element | null) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const page = elementOf(range.startContainer)?.closest<HTMLElement>(".kasten-pdf-page");
      if (!page || !sheet.current?.contains(page)) return;
      const n = Number(page.dataset.page);
      // A selection running onto later pages keeps to its first.
      const onPage = range.cloneRange();
      const words = page.querySelector(".textLayer");
      if (!page.contains(range.endContainer) && words?.lastChild) onPage.setEndAfter(words.lastChild);
      const boxes = lineBoxes([...onPage.getClientRects()], page.getBoundingClientRect());
      const text = onPage.toString().trim();
      const last = boxes[boxes.length - 1];
      setOpened(null);
      if (!last || !text) return setDraft(null);
      setDraft({ page: n, rects: pdfRects(transformOf(n), boxes), text, at: { left: page.offsetLeft + last.left + last.width / 2, top: page.offsetTop + last.top + last.height + 10 } });
      return;
    }
    setDraft(null);
    const page = target?.closest<HTMLElement>(".kasten-pdf-page");
    if (!page) return setOpened(null);
    const n = Number(page.dataset.page);
    const box = page.getBoundingClientRect();
    const [px, py] = [x - box.left, y - box.top];
    const hit = [...latest.current].reverse().find((h) => h.page === n && hits(transformOf(n), h.rects, px, py));
    setOpened(hit ? { id: hit.id, at: { left: page.offsetLeft + px, top: page.offsetTop + py + 14 } } : null);
  };

  const highlight = async (color: HighlightColor, comment: string | null) => {
    if (!draft) return;
    setDraft(null);
    window.getSelection()?.removeAllRanges();
    await useSources.getState().add(path, { page: draft.page, rects: draft.rects, text: draft.text, color, comment });
  };

  const clicked = opened && highlights.find((h) => h.id === opened.id);
  return (
    <div
      className="kasten-reader"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && doc) {
          e.preventDefault();
          setFinding(true);
        }
      }}
    >
      <ReaderBar
        title={title}
        page={current}
        pages={doc?.numPages ?? 0}
        scale={scale}
        fitted={zoom === null}
        onZoom={setZoom}
        count={highlights.length}
        listOpen={listOpen}
        onList={() => setListOpen((o) => !o)}
        onGo={go}
        outline={outline}
        onFind={() => setFinding(true)}
        ask={doc ? <AskAboutPages source={path} title={title} current={current} pages={doc.numPages} highlights={highlights} /> : null}
        clipping={clipping}
        onClip={() => {
          setClipping((on) => !on);
          setDraft(null);
          setOpened(null);
          window.getSelection()?.removeAllRanges();
        }}
      />
      <div className="kasten-reader-body">
        {finding && doc && <PdfFind doc={doc} onQuery={setQuery} onGo={go} onClose={() => setFinding(false)} />}
        <div
          ref={scroller}
          className="kasten-reader-pages"
          onScroll={onScroll}
          onPointerUp={(e) => {
            if (e.button !== 0) return;
            const { clientX, clientY } = e;
            const target = e.target as Element;
            window.setTimeout(() => afterPointer(clientX, clientY, target), 0);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            setDraft(null);
            setOpened(null);
          }}
        >
          {problem ? (
            <p className="kasten-reader-note" role="alert">
              This PDF could not be opened: {problem}
            </p>
          ) : !doc || !first ? (
            <p className="kasten-reader-note">Opening…</p>
          ) : (
            <div ref={sheet} className="kasten-reader-sheet">
              {Array.from({ length: doc.numPages }, (_, i) => (
                <PdfPage
                  key={i + 1}
                  doc={doc}
                  number={i + 1}
                  scale={scale}
                  fallback={first}
                  near={near.has(i + 1)}
                  highlights={byPage.get(i + 1) ?? NONE}
                  flashing={flash}
                  onTransform={onTransform}
                  find={query || null}
                />
              ))}
              {clipping && <ClipTool doc={doc} path={path} scale={scale} transformOf={transformOf} onStop={() => setClipping(false)} />}
              {draft && <SelectionBar at={draft.at} onPick={(color, comment) => void highlight(color, comment)} onClose={() => setDraft(null)} />}
              {clicked && <HighlightPop key={clicked.id} source={path} highlight={clicked} at={opened.at} onClose={() => setOpened(null)} />}
            </div>
          )}
        </div>
        {listOpen && (
          <HighlightList
            source={path}
            highlights={highlights}
            onPick={(h) => {
              pending.current = { source: path, highlight: h.id };
              show();
            }}
          />
        )}
      </div>
    </div>
  );
}
