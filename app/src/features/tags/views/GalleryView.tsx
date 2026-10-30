// A tag's notes as a gallery: a tile each with its cover (or a tint of its
// own), icon, title, first lines and the values of its first properties.
// A plain click peeks, as in the other views; "+ New" adds a note.

import "../../dashboard/dashboard.css";

import { useState } from "react";

import type { NoteMeta, PropDef } from "../../../lib/vault/types";
import { NoteTile } from "../../dashboard/NoteTiles";
import { addNote } from "../actions";
import { useNoteHome } from "../home";
import { ParentChip, useParentTitle } from "../sub-items";
import type { ViewProps } from "./types";
import { rowDefs, Values } from "./ListView";

/** Tiles drawn at first, and added per "Show more". */
const PAGE = 60;

/** A tile; a sub-item of another note of the database says so with a chip. */
function Tile({ note, defs }: { note: NoteMeta; defs: PropDef[] }) {
  const parent = useParentTitle(note);
  return (
    <NoteTile
      note={note}
      peek
      detail={
        defs.length || parent ? (
          <>
            <ParentChip note={note} />
            {defs.length ? <Values note={note} defs={defs} /> : null}
          </>
        ) : undefined
      }
    />
  );
}

export function GalleryView({ tag, schema, notes, project = null }: ViewProps) {
  const home = useNoteHome();
  const defs = rowDefs(schema);
  const [limit, setLimit] = useState(PAGE);
  const more = notes.length - limit;
  return (
    <div className="kasten-tag-gallery">
      <div className="kasten-tiles is-four" aria-label="Notes">
        {notes.slice(0, limit).map((note) => (
          <Tile key={note.path} note={note} defs={defs} />
        ))}
        <button type="button" className="kasten-tile is-new" onClick={() => void addNote(tag, "Untitled", {}, { project: project ?? home.project, parent: home.parent })}>
          <span className="kasten-tile-body">+ New</span>
        </button>
      </div>
      {more > 0 && (
        <button type="button" className="kasten-dash-more" onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(more, PAGE)} more
        </button>
      )}
    </div>
  );
}
