// What a tag database does to take pages in: the add (from a drop or the
// picker), the picker's state, and the pages revealed although the view's
// filters hide them. The Tag Database and a database inside a page share it.

import { useCallback, useMemo, useState } from "react";

import type { NoteMeta, TagSchema, TagView } from "../../lib/vault/types";
import { addPagesToTag } from "./membership";

export interface Membership {
  /** Adds the tag to these pages (a drop's, or the picker's). */
  add(paths: string[]): void;
  picking: boolean;
  setPicking(open: boolean): void;
  /** The pages shown although the view's filters hide them. */
  revealed: readonly string[];
  hideRevealed(): void;
}

export function useTagMembership(tag: string, view: TagView, schema: TagSchema | null, folder: string | null): Membership {
  const [picking, setPicking] = useState(false);
  const [revealed, setRevealed] = useState<readonly string[]>([]);
  const add = useCallback(
    (paths: string[]) => {
      void addPagesToTag(paths, { tag, view, schema, folder, reveal: (hidden) => setRevealed((was) => [...new Set([...was, ...hidden])]) });
    },
    [tag, view, schema, folder],
  );
  const hideRevealed = useCallback(() => setRevealed([]), []);
  return useMemo(() => ({ add, picking, setPicking, revealed, hideRevealed }), [add, picking, revealed, hideRevealed]);
}

/** `shown` and, after them, the revealed pages among `tagged` that it does not list. */
export function withRevealed(shown: NoteMeta[], tagged: readonly NoteMeta[], revealed: readonly string[]): NoteMeta[] {
  if (revealed.length === 0) return shown;
  const listed = new Set(shown.map((n) => n.path));
  const more = tagged.filter((n) => revealed.includes(n.path) && !listed.has(n.path));
  return more.length === 0 ? shown : [...shown, ...more];
}

/** "Showing 2 pages this view’s filters hide", with a way to stop. */
export function RevealedLine({ count, onHide }: { count: number; onHide(): void }) {
  if (count === 0) return null;
  return (
    <p className="kasten-tag-revealed" role="status">
      <span>
        Showing {count} added {count === 1 ? "page" : "pages"} that this view’s filters hide.
      </span>
      <button type="button" className="kasten-tagdb-button" onClick={onHide}>
        Hide {count === 1 ? "it" : "them"} again
      </button>
    </p>
  );
}
