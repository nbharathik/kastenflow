// The rows of the Layout menu: every layout of the deck with its live thumbnail beside it, the person's own first.

import { type Row, plainItem } from "../menus/build.ts";
import { applyLayout } from "../panels/format/layout.ts";
import type { EditorSession } from "../session/session.ts";
import { ownFirst } from "./default-layout.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import "./layouts.css";

/** How tall a layout is drawn in a menu row: what fits in the 28 px of a row. */
const THUMB_HEIGHT = 22;

/**
 * One row for each layout of the deck's theme (the person's own first, then the built-in ones), each with a small live drawing of the
 * layout beside its name; the one the slide shown is on is checked. Choosing one puts the slide (or the slides picked in the filmstrip)
 * on it, as one step. The drawings are made when they scroll into view, so a long list costs what is shown.
 */
export function layoutRows(session: EditorSession): Row[] {
  const { slideId, deck } = session.state;
  const current = deck.slides.find((slide) => slide.id === slideId)?.layout;
  const imageUrl = (path: string) => session.host.imageUrl(path);
  // As wide as the slide's shape makes it at that height: a tall page is a narrow drawing.
  const width = Math.round(Math.min(44, (THUMB_HEIGHT * deck.size.w) / deck.size.h));
  return ownFirst(deck.theme.layouts).map((layout) =>
    plainItem(`layout-${layout.name}`, layout.label, () => applyLayout(session, layout.name), {
      checked: layout.name === current,
      trailing: <LayoutThumb deck={deck} layout={layout} width={width} imageUrl={imageUrl} />,
    }),
  );
}
