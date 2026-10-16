// "Add existing pages": a searchable list of the pages that are not in the
// tag yet, driven from the keyboard like the Move picker. Up and Down move,
// Space ticks, Enter adds the ticked pages (or the one the cursor is on). The
// pages stay where they are; they gain the tag.

import "../workspace/overlays/overlays.css";
import "./tag-drop.css";

import { useMemo, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Modal } from "../../ui/Modal";
import { iconOf, titleOf } from "../workspace/names";
import { byModified, matchTitles } from "../workspace/overlays/match";
import { useWorkspace } from "../workspace/store";
import { carries } from "./model";

/** Rows listed at once. */
const SHOWN = 40;

/** The pages the picker offers for `tag`: openable pages that do not carry it. */
export function candidates(notes: readonly NoteMeta[], tag: string, query: string): NoteMeta[] {
  const free = notes.filter((n) => n.kind !== "template" && !carries(n, tag));
  return query.trim() ? matchTitles(free, query, SHOWN) : byModified(free).slice(0, SHOWN);
}

export function AddExistingPages({ tag, onAdd, onClose }: { tag: string; onAdd(paths: string[]): void; onClose(): void }) {
  const notes = useWorkspace((s) => s.notes);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const rows = useMemo(() => candidates(notes, tag, query), [notes, tag, query]);
  const current = Math.min(at, Math.max(0, rows.length - 1));

  const toggle = (path: string) => setTicked((was) => (was.includes(path) ? was.filter((p) => p !== path) : [...was, path]));
  const submit = () => {
    const paths = ticked.length > 0 ? [...ticked] : rows[current] ? [rows[current].path] : [];
    if (paths.length === 0) return;
    onClose();
    onAdd(paths);
  };

  return (
    <Modal plain label={`Add existing pages to #${tag}`} onClose={onClose} className="kasten-palette">
      <input
        autoFocus
        className="kasten-palette-input"
        placeholder={`Find pages to add to #${tag}…`}
        aria-label={`Find pages to add to #${tag}`}
        aria-controls="kasten-add-pages"
        aria-activedescendant={rows.length > 0 ? `kasten-add-page-${current}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") setAt(Math.min(current + 1, rows.length - 1));
          else if (e.key === "ArrowUp") setAt(Math.max(current - 1, 0));
          else if (e.key === " " && rows[current] && (e.ctrlKey || query === "")) toggle(rows[current].path);
          else if (e.key === "Enter") submit();
          else return;
          e.preventDefault();
        }}
      />
      <div id="kasten-add-pages" className="kasten-palette-list" role="listbox" aria-label="Pages" aria-multiselectable="true">
        {rows.length === 0 && <p className="kasten-palette-empty">{query.trim() ? "No page matches" : "Every page is in #" + tag + " already"}</p>}
        {rows.map((note, i) => (
          <button
            key={note.path}
            type="button"
            role="option"
            id={`kasten-add-page-${i}`}
            aria-selected={ticked.includes(note.path)}
            data-current={i === current || undefined}
            className="kasten-palette-row"
            onMouseMove={() => setAt(i)}
            onClick={(e) => (e.ctrlKey || e.metaKey || ticked.length > 0 ? toggle(note.path) : (onClose(), onAdd([note.path])))}
          >
            <span className="kasten-palette-icon" aria-hidden="true">
              <IconOrEmoji icon={iconOf(note)} />
            </span>
            <span className="kasten-palette-text">
              <span className="kasten-palette-label">
                {ticked.includes(note.path) ? "✓ " : ""}
                {titleOf(note)}
              </span>
              <span className="kasten-palette-detail">{note.project ?? (note.path.startsWith("inbox/") ? "Inbox" : "Pages")}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="kasten-palette-foot">
        <span>↑↓ to choose</span>
        <span>Ctrl+Space ticks{query === "" ? " (Space, while the box is empty)" : ""}</span>
        <span>↵ to add{ticked.length > 0 ? ` ${ticked.length} ticked` : ""}</span>
        <span>Esc to close</span>
      </div>
    </Modal>
  );
}
