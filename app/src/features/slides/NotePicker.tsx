import { useMemo, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { isPage } from "./page-picker";

/** How many pages are listed at once; typing narrows them. */
const MOST = 6;

/** A small list to choose the page a deck is made from: the pages last edited first, found by the words of their name. */
export function NotePicker({ onPick, onClose }: { onPick(note: NoteMeta): void; onClose(): void }) {
  const notes = useWorkspace((s) => s.notes);
  const [query, setQuery] = useState("");
  const found = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return notes
      .filter((note) => isPage(note) && (note.kind === "page" || note.kind === "card"))
      .filter((note) => words.every((word) => titleOf(note).toLowerCase().includes(word)))
      .sort((a, b) => b.modified - a.modified)
      .slice(0, MOST);
  }, [notes, query]);
  return (
    <div role="dialog" aria-label="Choose a page" className="mt-3 rounded-xl border border-line bg-canvas p-3 shadow-card" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted focus-within:border-accent/60">
          <Icon name="search" />
          <input autoFocus type="search" aria-label="Find a page" placeholder="Find the page to turn into slides" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none" />
        </label>
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-13 text-muted hover:bg-hover hover:text-ink">
          Cancel
        </button>
      </div>
      {found.length === 0 ? (
        <p className="mt-3 text-13 text-muted">No page is called that.</p>
      ) : (
        <ul className="mt-2 grid gap-0.5">
          {found.map((note) => (
            <li key={note.path}>
              <button type="button" onClick={() => onPick(note)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-13 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/60">
                <Icon name="page" className="size-4 text-muted" />
                <span className="min-w-0 flex-1 truncate">{titleOf(note)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-12 text-muted">A line of --- starts a new slide. You see the slides before anything is made.</p>
    </div>
  );
}
