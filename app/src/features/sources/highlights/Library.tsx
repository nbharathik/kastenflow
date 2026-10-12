// The Highlights view's shelf: each PDF as a book cover with its title under
// it, how much of it is highlighted, and in which colours. It scrolls sideways
// when there are many. A click opens the reader; while filters are on, a
// book none of whose highlights match is quieter.

import type { MouseEvent } from "react";

import type { Highlight, HighlightColor, SourceInfo } from "../../../lib/vault/types";
import { colorOf, HIGHLIGHT_COLORS } from "../colors";
import { count, cover } from "./cover";

import "./shelf.css";

interface Props {
  sources: readonly SourceInfo[];
  highlights: Record<string, Highlight[] | undefined>;
  /** How many of each PDF's highlights the filters keep, while any are on. */
  kept?: ReadonlyMap<string, number>;
  onOpen(path: string, event: MouseEvent): void;
}

export function Library({ sources, highlights, kept, onOpen }: Props) {
  return (
    <section className="kasten-hls-library" aria-label="PDFs">
      <ul>
        {sources.map((source) => {
          const list = highlights[source.path] ?? [];
          const total = list.length || source.highlights;
          const cards = list.filter((h) => h.card).length;
          const by = new Map<HighlightColor, number>();
          for (const h of list) by.set(colorOf(h.color), (by.get(colorOf(h.color)) ?? 0) + 1);
          const shown = kept?.get(source.path);
          return (
            <li key={source.path}>
              <button type="button" className={`kasten-hls-book${shown === 0 ? " is-quiet" : ""}`} onClick={(e) => onOpen(source.path, e)} title={`Open ${source.title}`}>
                <span className="kasten-hls-cover" style={{ background: cover(source.title) }} aria-hidden="true">
                  <span className="kasten-hls-cover-title">{source.title}</span>
                  <span className="kasten-hls-cover-badge">{total}</span>
                  <span className="kasten-hls-cover-open">Open</span>
                </span>
                <span className="kasten-hls-book-body">
                  <span className="kasten-hls-book-title">{source.title}</span>
                  <span className="kasten-hls-book-detail">
                    {count(total, "highlight")}
                    {cards > 0 ? ` · ${count(cards, "card")}` : ""}
                    {shown !== undefined ? ` · ${shown} shown` : ""}
                  </span>
                  {list.length > 0 && (
                    <span className="kasten-hls-mix" aria-hidden="true">
                      {HIGHLIGHT_COLORS.filter((c) => by.has(c)).map((c) => (
                        <span key={c} style={{ flexGrow: by.get(c), background: `var(--swatch-${c})` }} />
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
