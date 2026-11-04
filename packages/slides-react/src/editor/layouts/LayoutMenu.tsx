// The rows of the Layout menu: every layout of the deck with its live thumbnail beside it, the person's own first.

import { type Row, plainItem } from "../menus/build.ts";
import { applyLayout } from "../panels/format/layout.ts";
import type { EditorSession } from "../session/session.ts";
import { ownFirst } from "./default-layout.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import { keptLibrary } from "./library-cache.ts";
import { copyLibraryLayout, copyOf } from "./library-ops.ts";
import { drawnWith } from "./library.ts";
import "./layouts.css";

/** How tall a layout is drawn in a menu row: what fits in the 28 px of a row. */
const THUMB_HEIGHT = 22;

/**
 * One row for each layout of the deck's theme (the person's own first, then the built-in ones), each with a small live drawing of the
 * layout beside its name; the one the slide shown is on is checked. Choosing one puts the slide (or the slides picked in the filmstrip)
 * on it, as one step. Then the layouts of My layouts that the deck has no copy of (see `library-cache`). The drawings are made when they scroll into view, so a long list costs what is shown.
 */
export function layoutRows(session: EditorSession): Row[] {
  const { slideId, deck } = session.state;
  const current = deck.slides.find((slide) => slide.id === slideId)?.layout;
  const imageUrl = (path: string) => session.host.imageUrl(path);
  // As wide as the slide's shape makes it at that height: a tall page is a narrow drawing.
  const width = Math.round(Math.min(44, (THUMB_HEIGHT * deck.size.w) / deck.size.h));
  const own = ownFirst(deck.theme.layouts).map((layout) =>
    plainItem(`layout-${layout.name}`, layout.label, () => applyLayout(session, layout.name), {
      checked: layout.name === current,
      trailing: <LayoutThumb deck={deck} layout={layout} width={width} imageUrl={imageUrl} />,
    }),
  );
  // My layouts that this deck has no copy of yet follow, drawn in the deck's colours; choosing one copies it in and puts the slide on it.
  const mine = keptLibrary(session.host.layoutLibrary).filter((item) => !copyOf(deck, item.entry.id));
  if (mine.length === 0) return own;
  const drawn = drawnWith(deck, mine.map((item) => item.layout));
  return [
    ...own,
    ...mine.map((item) =>
      plainItem(
        `library-${item.entry.id}`,
        item.layout.label,
        () => {
          const name = copyLibraryLayout(session, item.layout);
          if (name) applyLayout(session, name);
        },
        { description: "My layouts", trailing: <LayoutThumb deck={drawn} layout={item.layout.layout} width={width} imageUrl={imageUrl} /> },
      ),
    ),
  ];
}
