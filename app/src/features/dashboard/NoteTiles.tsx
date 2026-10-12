// Notes, boards and decks as a dashboard shows them: gallery tiles with a
// cover (or a tint of their own), and compact rows. Right-click on any of
// them shows the Open menu; the middle button opens a tab.

import type { MouseEvent, ReactNode } from "react";

import { relativeTime } from "../../lib/dates";
import type { BoardInfo, DeckInfo, NoteMeta } from "../../lib/vault/types";
import { openMenuHandlers } from "../../shell/open-menu";
import { BoardThumb } from "../boards/BoardThumb";
import { usePreview } from "../boards/previews";
import { coverBackground } from "../pages/page/covers";
import { DeckThumb } from "../slides/DeckThumb";
import { useDeckPreview } from "../slides/previews";
import { iconOf, titleOf } from "../workspace/names";
import { howFrom, howFromView, useWorkspace } from "../workspace/store";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { lineIcon } from "../../ui/glyph";

/** A soft colour of the note's own, for tiles without a cover. */
export function tint(text: string): string {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `color-mix(in srgb, hsl(${Math.abs(hash) % 360} 70% 60%) 22%, var(--color-canvas))`;
}

const open = (path: string, peek = false) => (e: MouseEvent) => useWorkspace.getState().openPath(path, peek ? howFromView(e) : howFrom(e));

/** A page or card: its cover or a tint, its icon, title and a detail line.
 * `peek` opens it as views of many do (a plain click peeks). */
export function NoteTile({ note, detail, peek = false }: { note: NoteMeta; detail?: ReactNode; peek?: boolean }) {
  return (
    <button type="button" onClick={open(note.path, peek)} {...openMenuHandlers(note.path)} className="kasten-tile">
      <span className="kasten-tile-cover" style={{ background: (note.cover && coverBackground(note.cover)) || tint(note.title) }} aria-hidden="true" />
      <span className="kasten-tile-body">
        <span className="kasten-tile-icon"><IconOrEmoji icon={iconOf(note)} /></span>
        <span className="kasten-tile-title">{titleOf(note)}</span>
        {note.kind === "card" && note.excerpt && <span className="kasten-tile-excerpt">{note.excerpt}</span>}
        <span className="kasten-tile-detail">{detail ?? relativeTime(note.modified)}</span>
      </span>
    </button>
  );
}

/** A whiteboard, with a sketch of it on top. */
export function BoardTile({ board, detail }: { board: BoardInfo; detail?: ReactNode }) {
  const view = usePreview(board);
  return (
    <button type="button" onClick={open(board.path)} {...openMenuHandlers(board.path)} className="kasten-tile is-board">
      <span className="kasten-tile-sketch" aria-hidden="true">
        <BoardThumb board={view} />
      </span>
      <span className="kasten-tile-body">
        <span className="kasten-tile-title">
          <IconOrEmoji icon={lineIcon("board")} /> {board.title}
        </span>
        <span className="kasten-tile-detail">{detail ?? `Whiteboard · ${relativeTime(board.modified)}`}</span>
      </span>
    </button>
  );
}

/** A deck, with its first slide on top. */
export function DeckTile({ deck, detail }: { deck: DeckInfo; detail?: ReactNode }) {
  const preview = useDeckPreview(deck);
  const slides = deck.slides === 1 ? "1 slide" : `${deck.slides} slides`;
  return (
    <button type="button" onClick={open(deck.path)} {...openMenuHandlers(deck.path)} className="kasten-tile is-deck">
      <span className="kasten-tile-sketch" aria-hidden="true">
        <DeckThumb deck={preview} frame="fill" />
      </span>
      <span className="kasten-tile-body">
        <span className="kasten-tile-title">
          <IconOrEmoji icon={lineIcon("present")} /> {deck.title}
        </span>
        <span className="kasten-tile-detail">{detail ?? `Deck · ${slides} · ${relativeTime(deck.modified)}`}</span>
      </span>
    </button>
  );
}

/** A whiteboard as a compact row: a small sketch, a one-line title and what is on it. */
export function BoardMini({ board }: { board: BoardInfo }) {
  const view = usePreview(board);
  const things = board.nodes === 1 ? "1 thing" : `${board.nodes} things`;
  return (
    <button type="button" onClick={open(board.path)} {...openMenuHandlers(board.path)} className="kasten-mini" title={board.title}>
      <span className="kasten-mini-sketch" aria-hidden="true">
        <BoardThumb board={view} />
      </span>
      <span className="kasten-mini-text">
        <span className="kasten-mini-title">{board.title}</span>
        <span className="kasten-mini-detail">
          {things} · {relativeTime(board.modified)}
        </span>
      </span>
    </button>
  );
}

/** A deck as a compact row: its first slide small, a one-line title and its length. */
export function DeckMini({ deck }: { deck: DeckInfo }) {
  const preview = useDeckPreview(deck);
  const slides = deck.slides === 1 ? "1 slide" : `${deck.slides} slides`;
  return (
    <button type="button" onClick={open(deck.path)} {...openMenuHandlers(deck.path)} className="kasten-mini" title={deck.title}>
      <span className="kasten-mini-sketch is-deck" aria-hidden="true">
        <DeckThumb deck={preview} frame="fill" />
      </span>
      <span className="kasten-mini-text">
        <span className="kasten-mini-title">{deck.title}</span>
        <span className="kasten-mini-detail">
          {slides} · {relativeTime(deck.modified)}
        </span>
      </span>
    </button>
  );
}

export { NoteRow } from "./NoteRow";
