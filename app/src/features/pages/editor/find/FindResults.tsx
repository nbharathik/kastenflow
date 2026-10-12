// The pages that hold the text, under a page and its sub-pages: each with its
// number of matches and the lines around the first few, a click opening the
// page with the find bar on the same text. A page whose title holds it is
// offered "Rename…" (a title is never replaced in place, because a rename
// rewrites the links to the page).

import { useState, type MouseEvent as ReactMouseEvent } from "react";

import type { NoteMatches } from "../../../../lib/vault/types";
import { linkHowOf } from "../links";
import type { SubPageResults } from "./use-sub-page-find";
import type { SubPageFind } from "./sub-pages";

export function FindResults({ results, query, scope }: { results: SubPageResults; query: string; scope: SubPageFind }) {
  const { pages, more, searching, error } = results;
  if (error) {
    return (
      <p className="kasten-find-note" role="alert">
        {error}
      </p>
    );
  }
  if (!query) return <p className="kasten-find-note">Type to look through this page and its sub-pages.</p>;
  if (pages.length === 0) return <p className="kasten-find-note">{searching ? "Searching…" : "No page here holds this."}</p>;
  return (
    <>
      <ul className="kasten-find-results" aria-label="Pages that hold the text" aria-busy={searching}>
        {pages.map((page) => (
          <Page key={page.path} page={page} query={query} scope={scope} />
        ))}
      </ul>
      {more && <p className="kasten-find-note">More pages hold this than are listed. Narrow the search to replace.</p>}
    </>
  );
}

function Page({ page, query, scope }: { page: NoteMatches; query: string; scope: SubPageFind }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title);
  const open = (event: ReactMouseEvent) => scope.open(page.path, query, linkHowOf(event));
  const menu = (event: ReactMouseEvent) => {
    if (scope.openMenu?.(event.nativeEvent, page.path)) event.preventDefault();
  };
  return (
    <li className="kasten-find-page">
      <div className="kasten-find-page-head">
        <button type="button" className="kasten-find-page-title" onClick={open} onAuxClick={(event) => event.button === 1 && scope.open(page.path, query, "tab")} onContextMenu={menu}>
          {page.title || "Untitled"}
        </button>
        {page.count > 0 && (
          <span className="kasten-find-badge" title={`${page.count} ${page.count === 1 ? "match" : "matches"} in the text`}>
            {page.count.toLocaleString()}
          </span>
        )}
        {page.locked && (
          <span className="kasten-find-badge is-quiet" title="A locked page is never replaced in">
            Locked
          </span>
        )}
        {page.titleHit && !renaming && (
          <button type="button" className="kasten-find-rename" onClick={() => setRenaming(true)}>
            Rename…
          </button>
        )}
      </div>
      {page.titleHit && <p className="kasten-find-hint">The title holds it; Replace leaves titles alone.</p>}
      {renaming && (
        <input
          autoFocus
          className="kasten-find-input kasten-find-rename-field"
          aria-label={`New title for ${page.title || "Untitled"}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setRenaming(false);
            } else if (event.key === "Enter" && title.trim() && title.trim() !== page.title) {
              event.preventDefault();
              scope.rename(page.path, title.trim());
              setRenaming(false);
            }
          }}
        />
      )}
      {page.samples.map((sample, i) => (
        <button key={`${sample.line}:${i}`} type="button" className="kasten-find-sample" onClick={open} onContextMenu={menu} title={`Line ${sample.line + 1}`}>
          <span className="kasten-find-before">{sample.before}</span>
          <mark className="kasten-find-hit">{sample.text}</mark>
          <span className="kasten-find-after">{sample.after}</span>
        </button>
      ))}
      {page.count > page.samples.length && <p className="kasten-find-hint">and {(page.count - page.samples.length).toLocaleString()} more</p>}
    </li>
  );
}
