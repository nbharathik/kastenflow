import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useMemo } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import { copyOf } from "./library-ops.ts";
import type { LibraryItem, LibraryView } from "./library-state.ts";
import { drawnWith } from "./library.ts";
import "./layouts.css";
import "./library.css";

export interface LibraryPickerProps {
  /** The deck the layouts are drawn in: they take on its colours and fonts. */
  deck: Deck;
  imageUrl: ImageUrl;
  view: LibraryView;
  /** How many layouts make a row. */
  columns?: number;
  /** The width of each thumbnail, in CSS pixels. */
  thumbWidth?: number;
  onPick(item: LibraryItem): void;
}

/**
 * "My layouts": the layouts kept for every deck, drawn in this deck's colours and fonts. Picking one uses it here: the deck gets its own
 * copy (once; a layout the deck already holds is not copied again). One is picked with a click or Enter; the arrow keys walk the grid.
 */
export function LibraryPicker({ deck, imageUrl, view, columns = 3, thumbWidth = 132, onPick }: LibraryPickerProps): JSX.Element | null {
  // The layouts name text styles of their own; they are drawn with them, and with the deck's where the deck has the same name.
  const drawn = useMemo(() => drawnWith(deck, view.items.map((item) => item.layout)), [deck, view.items]);
  if (view.state === "none") return null;
  return (
    <section className="ks-lp-library" aria-label="My layouts">
      <h3 className="ks-lp-heading">My layouts</h3>
      {view.state === "loading" && view.items.length === 0 ? <p className="ks-lp-note">Loading your layouts…</p> : null}
      {view.state === "failed" ? (
        <p className="ks-lp-note" role="alert">
          Your layouts could not be loaded.{" "}
          <button type="button" className="ks-btn ks-lp-link" onClick={view.reload}>
            Try again
          </button>
        </p>
      ) : null}
      {view.state === "ready" && view.items.length === 0 ? <p className="ks-lp-note">Layouts you save for all decks show up here, in every deck.</p> : null}
      {view.items.length > 0 ? (
        <div className="ks-lp" role="listbox" aria-label="My layouts" style={{ gridTemplateColumns: `repeat(${columns}, ${thumbWidth + 18}px)` }} onKeyDown={(event) => walkOptions(event, columns)}>
          {view.items.map((item, i) => {
            const here = copyOf(deck, item.entry.id);
            return (
              <button
                key={item.entry.id}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={item.layout.label}
                tabIndex={stopAt(i, 0)}
                className="ks-btn ks-lp-item"
                data-library={item.entry.id}
                title={here ? "This deck has a copy. Using it again uses that copy." : "Adds a copy to this deck"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
              >
                <LayoutThumb deck={drawn} layout={item.layout.layout} width={thumbWidth} imageUrl={imageUrl} />
                <span className="ks-lp-line">
                  <span className="ks-lp-name">{item.layout.label}</span>
                  {here ? <span className="ks-lp-own">In this deck</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
