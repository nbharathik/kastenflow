// "Open my backup from GitHub": the signed-in account's private repositories,
// the ones KastenFlow made for a backup first, searchable and paged. Choosing
// one only selects it; the Restore button does the work.

import { useEffect, useRef, useState } from "react";

import { relativeTime } from "../../lib/dates";
import type { RepoRow } from "../../lib/vault/backup-types";
import { call, sentence } from "../backup/wizard/api";

const SEARCH_AFTER_MS = 300;

type Load = { state: "loading" } | { state: "ready"; repos: RepoRow[]; hasMore: boolean; page: number } | { state: "failed"; message: string };

export function GitHubBackups({ chosen, onChoose }: { chosen: string | null; onChoose: (repo: RepoRow) => void }) {
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [more, setMore] = useState(false);
  const asked = useRef(0);

  const fetchPage = (text: string, page: number) => {
    const turn = ++asked.current;
    return call("github_repos", { query: text, page }).then(
      (found) => (turn === asked.current ? found : null),
      (err: unknown) => {
        if (turn === asked.current) setLoad({ state: "failed", message: sentence(err) });
        return null;
      },
    );
  };

  useEffect(() => {
    setLoad({ state: "loading" });
    const timer = setTimeout(
      () => {
        void fetchPage(query.trim(), 1).then((found) => found && setLoad({ state: "ready", repos: found.repos, hasMore: found.hasMore, page: 1 }));
      },
      query ? SEARCH_AFTER_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const showMore = async () => {
    if (load.state !== "ready") return;
    setMore(true);
    const found = await fetchPage(query.trim(), load.page + 1);
    setMore(false);
    if (found) setLoad({ state: "ready", repos: [...load.repos, ...found.repos], hasMore: found.hasMore, page: load.page + 1 });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-12 text-muted">
        Search your private repositories
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="h-9 rounded-lg bg-canvas px-3 text-13 text-ink ring-1 ring-line"
        />
      </label>
      {load.state === "loading" && (
        <p role="status" className="text-13 text-muted">
          Looking at your repositories…
        </p>
      )}
      {load.state === "failed" && (
        <p role="alert" className="text-13 text-danger">
          {load.message}
        </p>
      )}
      {load.state === "ready" && load.repos.length === 0 && (
        <p className="text-13 text-muted">{query.trim() ? "No private repository matches that." : "You have no private repositories yet."}</p>
      )}
      {load.state === "ready" && load.repos.length > 0 && (
        <ul aria-label="Your private repositories" className="max-h-48 overflow-auto rounded-lg border border-line">
          {load.repos.map((r) => (
            <li key={r.fullName}>
              <button
                type="button"
                aria-pressed={chosen === r.fullName}
                onClick={() => onChoose(r)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-13 hover:bg-hover aria-pressed:bg-selected"
              >
                <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                {r.isBackup && <span className="shrink-0 rounded-md bg-soft px-1.5 text-12 text-muted">KastenFlow backup</span>}
                {r.updatedAt && <span className="shrink-0 text-12 text-muted">{relativeTime(Date.parse(r.updatedAt))}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {load.state === "ready" && load.hasMore && (
        <button type="button" disabled={more} onClick={() => void showMore()} className="h-8 self-start rounded-lg px-3 text-13 ring-1 ring-line hover:bg-hover disabled:opacity-60">
          {more ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}
