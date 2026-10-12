import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useMemo } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { Icon } from "../ui/Icon.tsx";
import { isOwnLayout, markedDefault, ownFirst } from "./default-layout.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import "./layouts.css";

export interface LayoutPickerProps {
  deck: Deck;
  imageUrl: ImageUrl;
  /** The layout that is in use, marked as chosen. */
  current?: string | undefined;
  /** How many layouts make a row. */
  columns?: number;
  /** The width of each thumbnail, in CSS pixels. */
  thumbWidth?: number;
  onPick(name: string): void;
  label?: string;
}

/**
 * The layouts of the deck's theme as a grid of live thumbnails with their names, the person's own first and then the built-in
 * ones. One is picked with a click or Enter; the arrow keys walk the grid.
 */
export function LayoutPicker({ deck, imageUrl, current, columns = 3, thumbWidth = 132, onPick, label = "Layouts" }: LayoutPickerProps): JSX.Element {
  const layouts = useMemo(() => ownFirst(deck.theme.layouts), [deck.theme.layouts]);
  const marked = markedDefault(deck);
  const at = layouts.findIndex((layout) => layout.name === current);
  return (
    <div className="ks-lp" role="listbox" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, ${thumbWidth + 18}px)` }} onKeyDown={(event) => walkOptions(event, columns)}>
      {layouts.map((layout, i) => {
        const on = layout.name === current;
        return (
          <button
            key={layout.name}
            type="button"
            role="option"
            aria-selected={on}
            aria-label={layout.label}
            tabIndex={stopAt(i, at)}
            className={`ks-btn ks-lp-item${on ? " is-on" : ""}`}
            data-layout={layout.name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(layout.name)}
          >
            <LayoutThumb deck={deck} layout={layout} width={thumbWidth} imageUrl={imageUrl} />
            <span className="ks-lp-line">
              <span className="ks-lp-name">{layout.label}</span>
              {isOwnLayout(layout.name) ? <span className="ks-lp-own">Yours</span> : null}
              {marked === layout.name ? <Icon name="star" size={12} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
