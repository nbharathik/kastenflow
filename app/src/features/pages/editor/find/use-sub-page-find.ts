// Finding and replacing under a page and its sub-pages: the preview (which
// pages, how many matches, with lines around them) is asked for after a
// pause in typing, and "Replace all" sends back exactly what the preview
// showed, so a page that changed since is noticed and nothing is written.

import { useCallback, useEffect, useReducer, useState } from "react";

import { REPLACE_LIMITS, replaceWasStale } from "../../../../lib/vault/replace-types";
import type { NoteMatches } from "../../../../lib/vault/types";
import { MAX_PAGES, type SubPageFind } from "./sub-pages";

/** How long typing pauses before the pages are searched. */
const PAUSE_MS = 250;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface SubPageResults {
  /** The pages with the text (at most `MAX_PAGES`), the page itself first. */
  pages: NoteMatches[];
  /** More pages hold it than are listed. */
  more: boolean;
  searching: boolean;
  error: string | null;
  /** Looks again now, as after a replace, or one that was refused. */
  refresh(): void;
}

/** What the query finds under the page, once `on` and the query is a line
 * the core takes (1 to 200 characters). */
export function useSubPageResults(scope: SubPageFind | undefined, on: boolean, query: string, matchCase: boolean, wholeWord: boolean): SubPageResults {
  const [found, setFound] = useState<{ pages: NoteMatches[]; more: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, refresh] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!scope || !on || !query) {
      setFound(null);
      setSearching(false);
      setError(null);
      return;
    }
    if (query.length > REPLACE_LIMITS.queryChars || /[\r\n]/.test(query)) {
      setFound(null);
      setSearching(false);
      setError(`Look for one line of up to ${REPLACE_LIMITS.queryChars} characters under sub-pages.`);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      scope.find({ query, matchCase, wholeWord }, MAX_PAGES + 1).then(
        (pages) => {
          if (!live) return;
          setFound({ pages: pages.slice(0, MAX_PAGES), more: pages.length > MAX_PAGES });
          setError(null);
          setSearching(false);
        },
        (err: unknown) => {
          if (!live) return;
          setFound(null);
          setError(messageOf(err));
          setSearching(false);
        },
      );
    }, PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scope, on, query, matchCase, wholeWord, again]);

  return { pages: found?.pages ?? [], more: found?.more ?? false, searching, error, refresh };
}

/** The pages "Replace all" would change: those with matches in their text that are not locked. */
export const replaceable = (pages: readonly NoteMatches[]): NoteMatches[] => pages.filter((p) => p.count > 0 && !p.locked);

/** What the preview says in a line: "12 matches in 4 pages". */
export function summary(pages: readonly NoteMatches[]): string {
  const inText = replaceable(pages);
  const matches = inText.reduce((sum, p) => sum + p.count, 0);
  const noun = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  return `${noun(matches, "match", "matches")} in ${noun(inText.length, "page", "pages")}`;
}

/** Replacing what the preview showed. */
export function useSubPageReplace(scope: SubPageFind | undefined, query: string, matchCase: boolean, wholeWord: boolean, results: SubPageResults) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { pages, more, refresh } = results;

  const replaceAll = useCallback(
    async (text: string) => {
      const going = replaceable(pages);
      if (!scope || busy || going.length === 0 || more) return;
      setBusy(true);
      setNote(null);
      try {
        const done = await scope.replace({
          spec: { query, matchCase, wholeWord },
          with: text,
          expect: going.map(({ path, hash, count }) => ({ path, hash, count })),
        });
        setNote(`Replaced ${done.total.toLocaleString()} in ${done.notes.length.toLocaleString()} ${done.notes.length === 1 ? "page" : "pages"}.`);
      } catch (err) {
        setNote(replaceWasStale(err) ? "Pages changed since the preview, so nothing was replaced. Look again, then replace." : messageOf(err));
      }
      setBusy(false);
      refresh();
    },
    [scope, busy, pages, more, query, matchCase, wholeWord, refresh],
  );

  return { replaceAll, busy, note, clearNote: () => setNote(null) };
}
