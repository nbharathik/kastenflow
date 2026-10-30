import { memo, useId, type MouseEvent, type DragEvent } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteStats } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { openMenuHandlers } from "../../shell/open-menu";
import { readable } from "../workspace/names";
import type { Row } from "./filters";
import { KindTile } from "./kind-tile";
import { AgentStar, Glyph, Marked, TagChips, fullDate } from "./parts";

export interface CardProps {
  row: Row;
  index: number;
  selected: boolean;
  /** Something is selected, so every checkbox shows. */
  selecting: boolean;
  /** The card Tab lands on (roving focus). */
  current: boolean;
  stats: NoteStats | undefined;
  /** A full-text snippet to show instead of the excerpt. */
  snippet: string | null;
  words: readonly string[];
  tagColors: Record<string, string>;
  /** An agent's writing in it waits to be edited or accepted. */
  marked: boolean;
  onClick(index: number, event: MouseEvent<HTMLElement>): void;
  onCheck(index: number, event: MouseEvent<HTMLElement>): void;
  onFocus(index: number): void;
  /** Dragging the card, say onto a whiteboard. */
  onDragStart(index: number, event: DragEvent<HTMLElement>): void;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One note as a card: icon and title, first lines, tags, and where and when. */
export const LibraryCard = memo(function LibraryCard({ row, index, selected, selecting, current, stats, snippet, words, tagColors, marked, onClick, onCheck, onFocus, onDragStart }: CardProps) {
  const titleId = useId();
  const text = snippet ? readable(snippet) : row.note.excerpt;
  const backlinks = stats?.backlinks ?? 0;
  const boards = stats?.boards ?? 0;
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-labelledby={titleId}
      tabIndex={current ? 0 : -1}
      data-index={index}
      data-library-item=""
      onClick={(event) => onClick(index, event)}
      // Right-click shows the Open menu, middle-click opens a tab.
      {...openMenuHandlers(row.path)}
      draggable
      onDragStart={(event) => onDragStart(index, event)}
      // Shift+click extends the selection, not the text selection.
      onMouseDown={(event) => event.shiftKey && event.preventDefault()}
      onFocus={() => onFocus(index)}
      className={`group relative flex min-h-[176px] cursor-pointer [contain-intrinsic-block-size:auto_176px] [content-visibility:auto] scroll-mb-24 scroll-mt-44 flex-col rounded-xl border p-4 text-left outline-none transition ease-standard focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none ${
        selected
          ? "border-accent/60 bg-raised shadow-card ring-1 ring-accent/40"
          : "border-line bg-raised shadow-card hover:border-line-hover hover:shadow-hover"
      }`}
    >
      <span
        aria-hidden="true"
        data-check=""
        title={selected ? "Unselect" : "Select"}
        onClick={(event) => {
          event.stopPropagation();
          onCheck(index, event);
        }}
        className={`absolute right-3 top-3 grid size-[18px] place-items-center rounded-[5px] border transition ${
          selected ? "border-accent bg-accent text-on-accent" : `border-muted/45 bg-raised text-transparent hover:border-accent ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`
        }`}
      >
        <Glyph name="tick" className="size-3" />
      </span>

      <div className="flex items-start gap-2 pr-6">
        <span className="-mt-[2px]">
          <KindTile kind={row.note.kind} icon={row.icon} />
        </span>
        <h3 id={titleId} className="line-clamp-2 min-w-0 break-words text-14 font-semibold leading-[22px] text-ink">
          <Marked text={row.title} words={words} />
        </h3>
        {marked && (
          <span className="mt-0.5">
            <AgentStar />
          </span>
        )}
      </div>

      {text && (
        <p className={`mt-2 line-clamp-4 break-words text-13 leading-[1.55] ${snippet ? "text-ink/75" : "text-muted"}`}>
          <Marked text={text} words={words} />
        </p>
      )}

      {row.note.tags.length > 0 && (
        <div className="mt-3">
          <TagChips tags={row.note.tags} colors={tagColors} />
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-3 text-12 text-muted">
        <span className="truncate">{row.placeLabel}</span>
        <span aria-hidden="true">·</span>
        <time className="shrink-0" title={`Updated ${fullDate(row.updated)}`}>
          {relativeTime(row.updated)}
        </time>
        <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-2">
          {backlinks > 0 && (
            <span className="flex items-center gap-1" title={`${plural(backlinks, "backlink")}`} aria-label={plural(backlinks, "backlink")}>
              <Glyph name="link" className="size-3.5" />
              {backlinks}
            </span>
          )}
          {boards > 0 && (
            <span className="flex items-center gap-1" title={`On ${plural(boards, "board")}`} aria-label={`On ${plural(boards, "board")}`}>
              <Icon name="board" className="size-3.5" />
              {boards}
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
