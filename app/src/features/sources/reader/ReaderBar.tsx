// The reader's bar: the source's title, which page is in view (click it
// to go to another), the PDF's outline, find, the zoom (the percentage
// goes back to fitting the width), the clip tool's switch, and the highlights
// list.

import { useRef, useState, type ReactNode } from "react";

import { Popup } from "../../pages/page/Popup";
import { Icon } from "../../../ui/Icon";
import type { OutlineItem } from "./pdf-text";

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

interface Props {
  title: string;
  page: number;
  pages: number;
  scale: number;
  /** Fitted to the width, not zoomed by hand. */
  fitted: boolean;
  onZoom(zoom: number | null): void;
  count: number;
  listOpen: boolean;
  onList(): void;
  onGo(page: number): void;
  outline: readonly OutlineItem[];
  onFind(): void;
  /** Whether the clip tool is on. */
  clipping: boolean;
  onClip(): void;
  /** The button that asks AI about pages of this PDF (AskAboutPages). */
  ask?: ReactNode;
}

/** "Page 3 of 12", which becomes a field to type another page into. */
function PageField({ page, pages, onGo }: { page: number; pages: number; onGo(page: number): void }) {
  const [typing, setTyping] = useState<string | null>(null);
  if (typing === null) {
    return (
      <button type="button" className="kasten-reader-where" aria-live="polite" title="Go to a page" onClick={() => setTyping(String(page))}>
        Page {page} of {pages}
      </button>
    );
  }
  const go = () => {
    const n = Number.parseInt(typing, 10);
    if (n >= 1 && n <= pages) onGo(n);
    setTyping(null);
  };
  return (
    <span className="kasten-reader-where">
      Page{" "}
      <input
        autoFocus
        inputMode="numeric"
        aria-label="Go to page"
        value={typing}
        onChange={(e) => setTyping(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTyping(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
          else if (e.key === "Escape") setTyping(null);
        }}
        className="kasten-reader-page-input"
      />{" "}
      of {pages}
    </span>
  );
}

/** The PDF's own table of contents, each entry going to its page. */
function Outline({ items, onGo }: { items: readonly OutlineItem[]; onGo(page: number): void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative">
      <button ref={button} type="button" className="kasten-reader-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Outline
      </button>
      {open && (
        <Popup label="Outline" role="menu" anchor={button} onClose={() => setOpen(false)} className="kasten-reader-outline">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              style={{ paddingLeft: 10 + item.depth * 14 }}
              onClick={() => {
                setOpen(false);
                onGo(item.page);
              }}
            >
              <span>{item.title}</span>
              <span className="kasten-reader-outline-page">{item.page}</span>
            </button>
          ))}
        </Popup>
      )}
    </span>
  );
}

export function ReaderBar({ title, page, pages, scale, fitted, onZoom, count, listOpen, onList, onGo, outline, onFind, clipping, onClip, ask }: Props) {
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > scale + 0.001) : [...ZOOMS].reverse().find((z) => z < scale - 0.001);
    if (next) onZoom(next);
  };
  return (
    <header className="kasten-reader-bar">
      <span className="kasten-reader-icon" aria-hidden="true">
        <Icon name="book" className="size-[18px]" />
      </span>
      <h1 className="kasten-reader-title" title={title}>
        {title}
      </h1>
      {pages > 0 && <PageField page={page} pages={pages} onGo={onGo} />}
      {outline.length > 0 && <Outline items={outline} onGo={onGo} />}
      <button type="button" className="kasten-reader-toggle" aria-label="Find in this PDF" title="Find (Ctrl+F)" onClick={onFind}>
        <Icon name="search" className="size-4" />
      </button>
      <div className="kasten-reader-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={scale <= ZOOMS[0]!} onClick={() => step(-1)}>
          <Icon name="minus" className="size-4" />
        </button>
        <button type="button" className="kasten-reader-scale" aria-pressed={fitted} title="Fit to the width" onClick={() => onZoom(null)}>
          {Math.round(scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={scale >= ZOOMS[ZOOMS.length - 1]!} onClick={() => step(1)}>
          <Icon name="plus" className="size-4" />
        </button>
      </div>
      {ask}
      <button type="button" className="kasten-reader-toggle" aria-pressed={clipping} disabled={pages === 0} title="Clip a figure to the gallery: drag a box around it" onClick={onClip}>
        Clip
      </button>
      <button type="button" className="kasten-reader-toggle" aria-pressed={listOpen} onClick={onList}>
        Highlights <span>{count}</span>
      </button>
    </header>
  );
}
