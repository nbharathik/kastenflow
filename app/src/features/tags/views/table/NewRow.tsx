// The table's foot: "+ New" opens a title field under the rows; Enter makes
// a note carrying the tag, with the values the view's filters imply so it
// shows up here, and the field stays for the next one. Escape closes it.
// The count of notes shown sits on the right.

import { useEffect, useRef, useState, type RefObject } from "react";

import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { useWorkspace } from "../../../workspace/store";
import { addNote } from "../../actions";
import { titleOf } from "../../../workspace/names";
import { useNoteHome } from "../../home";
import { Glyph } from "./icons";
import { prefill } from "./prefill";
import { addSubItem } from "./sub-moves";
import { IconOrEmoji } from "../../../../ui/IconOrEmoji";
import { lineIcon } from "../../../../ui/glyph";

const FRESH_MS = 1600;

/** The note just added here: scrolled into view once the table lists it,
 * and marked for a moment so the eye finds it. */
export function useFresh(notes: readonly NoteMeta[], reveal: (row: number) => void): [string | null, (path: string) => void] {
  const [fresh, setFresh] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(null), FRESH_MS);
    return () => clearTimeout(timer);
  }, [fresh]);
  useEffect(() => {
    if (!fresh || shown.current === fresh) return;
    const row = notes.findIndex((n) => n.path === fresh);
    if (row < 0) return;
    shown.current = fresh;
    reveal(row);
  }, [fresh, notes, reveal]);
  return [fresh, setFresh];
}

interface NewRowProps {
  tag: string;
  view: TagView;
  schema: TagSchema | null;
  count: number;
  /** The note made, so the table can show where it went. */
  onAdded(path: string): void;
  /** The foot, where Tab past the table's last cell lands. */
  footRef: RefObject<HTMLDivElement | null>;
  /** Makes the note for a table that is not one tag's; without it, a note carrying the tag. */
  add?(title: string): Promise<NoteMeta | null>;
  /** What the table is called, in place of "#tag". */
  label?: string;
  /** The row a new sub-item is being made under: the field opens for it, and
   * new rows are its sub-items until it is closed. */
  under?: NoteMeta | null;
  onUnderDone?(): void;
}

export function NewRow({ tag, view, schema, count, onAdded, footRef, add, label, under = null, onUnderDone }: NewRowProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const home = useNoteHome();
  useEffect(() => {
    if (under) setAdding(true);
  }, [under]);
  const close = () => {
    setAdding(false);
    setTitle("");
    onUnderDone?.();
  };
  const create = async () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    // With "match any" no one filter is implied, so a new row takes no values from them.
    const implied = view.filter_mode === "any" ? undefined : view.filter;
    const made = under
      ? addSubItem(tag, under, text, add ? {} : prefill(implied, schema), add)
      : add
        ? add(text).then((meta) => meta?.path ?? null)
        : addNote(tag, text, prefill(implied, schema), home).then((note) => note?.meta.path ?? null);
    const path = await made.catch((err: unknown) => {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (path) onAdded(path);
    // The core said why (toasted); what was typed comes back to try again.
    else setTitle((typed) => typed || text);
  };
  return (
    <div ref={footRef} className="kasten-table-foot">
      {adding ? (
        <form
          className="kasten-table-new"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <span className="kasten-table-icon" aria-hidden="true">
            <IconOrEmoji icon={lineIcon("page")} />
          </span>
          <input
            autoFocus
            aria-label={under ? `Title of a new sub-item of ${titleOf(under)}` : label ? `Title of a new page in ${label}` : `Title of a new row in #${tag}`}
            placeholder={under ? `Sub-item of “${titleOf(under)}”, then Enter…` : "Title, then Enter…"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            onBlur={() => !title.trim() && close()}
          />
        </form>
      ) : (
        <button type="button" className="kasten-table-new-button" aria-label="New row" onClick={() => setAdding(true)}>
          <Glyph name="plus" />
          New
        </button>
      )}
      <span className="kasten-table-count" aria-live="polite">
        {count.toLocaleString()} {count === 1 ? "note" : "notes"}
      </span>
    </div>
  );
}
